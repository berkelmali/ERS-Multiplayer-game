import { getFirestore, doc, getDoc, updateDoc, increment, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref as dbRef, onValue, off, update as rtdbUpdate, remove as rtdbRemove, onDisconnect, serverTimestamp as rtdbServerTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { app, rtdb, functions } from "./firebaseConfig.js";
import { GameState, SHIELD_DURATION_MS } from "./game.js";
import EventBus from "./eventbus.js";
import { playerIdsOf } from "./tableIds.js";
import { matchSlap } from "./slapRules.js";
import { HouseRules } from "./houseRules.js";
import { NetQuality } from "./netQuality.js";
import { ConnectionBanner } from "./connectionBanner.js";
import { Localization } from "./localization.js?v=3";
import { AuthSystem } from "./auth.js";
import { applySlapWin, applySlapBurn, awardChallenge, dropHollowHand, getNextPlayer as nextSeat, emptySlapLocked, orphanedHostHeir, isBotSeat, TURN_TIMEOUT_MS } from "./slapOutcome.js";
import { applyGodSlapWin, applyGodBurn } from "./pantheonRoom.js";
import * as FairSlap from "./fairSlap.js";
import { registerProtocol } from "./roomProtocol.js";

const db = getFirestore(app);

export const FirebaseSync = {
    unsubRoom: null,
    unsubConnected: null,
    unsubSlaps: null,
    roomId: null,
    localPlayerIndex: -1,
    roomData: null,

    // --- v2.9.0: staged server-validation rollout (CLAUDE.md §6.21) ---
    // OFF by default. The Cloud Functions in functions/ are unit-tested
    // (functions/gameLogic.js + test_gameLogic.mjs, 53/53 passing) but have
    // NEVER been run against a live Firebase project or the emulator suite —
    // no network access in the environment that built them. Do not flip this
    // to true until you've verified them yourself with
    // `firebase emulators:start` against real gameplay. See CLAUDE.md for the
    // full staged rollout plan (this flag is Phase 2; Phase 3 is locking down
    // database.rules.json once this has run clean in production for a while).
    USE_SERVER_VALIDATION: false,

    FACE_CHANCES: { 11: 1, 12: 2, 13: 3, 14: 4 },

    // State trackers for synthesizing local event logs
    lastPileLength: 0,
    lastPlayerCardCounts: [],
    lastActivePlayerId: null, // Track the last active player ID to prevent turn timer UI flicker


    /** Timer that closes an open fair-slap contest. */
    contestTimer: null,

    /**
     * v3.0.0: was a third hand-written copy of the slap rules. Now a thin
     * adapter over the single registry, evaluated against the ROOM's rule set
     * (`gameRooms/{id}/houseRules`) rather than whatever this client happens to
     * prefer — every seat must reach the same verdict for the transaction to be
     * safe. Still returns a boolean, so the call site below is unchanged.
     */
    evaluateSlap(pile) {
        return matchSlap(pile, HouseRules.active()) !== null;
    },

    listenToRoom(roomId, playerIndex) {
        this.roomId = roomId;
        this.localPlayerIndex = playerIndex;
        // v3.19.0 — before any write to the room: a god room refuses writes
        // from a user who has not registered this protocol (roomProtocol.js).
        registerProtocol(AuthSystem.currentUser?.uid);
        NetQuality.init();
        import('./auth.js')
            .then(({ AuthSystem }) => NetQuality.start(AuthSystem.currentUser?.uid))
            .catch(() => { /* signed-out spectator: clock still works, no RTT probe */ });
        this.lastActivePlayerId = null; // Reset tracker for the new game session
        this.lastEmojiT = {}; // Reset emoji trackers for the new game session
        this.lastShieldShatterTime = 0;
        this.lastPlayerStreaks = [0, 0, 0, 0];
        if (this.dbShieldDecayTimers) {
            this.dbShieldDecayTimers.forEach(t => { if (t) clearTimeout(t); });
        }
        this.dbShieldDecayTimers = [null, null, null, null];

        if (playerIndex >= 0 && playerIndex < 4) {
            const myPlayerRef = dbRef(rtdb, `gameRooms/${roomId}/players/${playerIndex}`);
            const connectedRef = dbRef(rtdb, ".info/connected");

            this.unsubConnected = onValue(connectedRef, (snap) => {
                // v3.19.2 (council ERS-23): a client that has lost the
                // database stops driving the room — its bot, timeout and
                // conversion timers would otherwise fire into writes that the
                // SDK queues and replays on reconnect, into a room that may
                // have a new host by then (MultiplayerMode.drivesRoom).
                this.isConnected = snap.val() === true;
                EventBus.emit('roomConnection', this.isConnected);
                if (snap.val() === true) {
                    // Connection established or re-established
                    onDisconnect(myPlayerRef).update({ status: 'disconnected', disconnectedAt: rtdbServerTimestamp() }).catch(e => console.warn("onDisconnect failed", e));

                    // Explicitly mark as online
                    rtdbUpdate(myPlayerRef, { status: 'online', disconnectedAt: null }).catch(console.warn);
                    ConnectionBanner.clear();
                } else {
                    // v3.7.0. There was no `else` here before, which is the most
                    // literal version of the problem this release exists to fix:
                    // the SDK hands us the fact that the connection dropped, and
                    // the app threw it away. The player's cards simply stopped
                    // responding and nothing on screen said why.
                    //
                    // A banner rather than a modal — taking the board away from
                    // someone mid-hand over a blip they may not even notice is
                    // worse than the silence. The grace period keeps ordinary
                    // socket churn from flashing it.
                    ConnectionBanner.armLost();
                }
            }, (err) => {
                // v3.7.3 — without this, a failure of the connectivity listener
                // itself was silent, and the v3.7.0 connection banner simply
                // never armed: the app would be back to saying nothing at all
                // about a dropped connection, which is the defect that release
                // existed to end. Treat a broken connectivity probe as a
                // connection problem, because from the player's side it is one.
                console.error("Connectivity listener failed:", err);
                ConnectionBanner.armLost(0);
            });
        }

        const roomRef = dbRef(rtdb, `gameRooms/${roomId}`);

        this.unsubRoom = onValue(roomRef, (snap) => {
            if (!snap.exists()) {
                // Room was deleted by the host (game cleanup)
                GameState.gameOver = true;
                GameState.gameStarted = false;
                EventBus.emit('gameAbandoned', null); // Reuse the abandoned UI to show they were kicked
                import('./ui.js').then(ui => ui.UIManager.showNotification("Game finished. Returning to menu.", "var(--primary)"));
                return;
            }

            const data = snap.val();
            if (!data) return;

            this.roomData = data;
            this.syncToLocal(data);
        }, (error) => {
            // v3.7.0. This second argument did not exist. onValue() without an
            // error callback swallows the failure entirely: on a permission
            // change, a CSP block or a dropped socket the board simply stopped
            // updating, with no exception, no console line and no message. The
            // player saw a frozen table and their own hand. This is the highest
            // severity defect the ERS-08 review found, because it happens during
            // a live match.
            console.error("Game room sync error:", error);
            ConnectionBanner.armLost(0);
            import('./ui.js').then(ui => ui.UIManager.showNotification(
                Localization.get('errReasonSyncLost'), "var(--error)", true
            )).catch(() => {});
        });
    },

    syncToLocal(data) {
        // Delta calculation for UI events (Action Log / Sounds)
        if (this.lastPlayerCardCounts.length > 0) {
            // Sync shield shatters
            const currentShieldShatterTime = data.lastShieldShatterTime || 0;
            const lastShieldShatterTime = this.lastShieldShatterTime || 0;
            const shatterHappened = currentShieldShatterTime > lastShieldShatterTime;
            if (shatterHappened) {
                const visualId = (data.lastShieldShatterId - this.localPlayerIndex + 4) % 4;
                EventBus.emit('shieldShattered', { playerId: visualId });
            }

            // Compare streaks to detect shield earned or expired
            // CRITICAL: lastPlayerStreaks is stored by DB index (not visual index) to match data.players[i].streak
            data.players.forEach((p, i) => {
                const visualIndex = (i - this.localPlayerIndex + 4) % 4;
                const oldStreak = (this.lastPlayerStreaks && this.lastPlayerStreaks[i] !== undefined) ? this.lastPlayerStreaks[i] : 0;
                const newStreak = p.streak || 0;
                if (oldStreak < 3 && newStreak === 3) {
                    EventBus.emit('shieldEarned', visualIndex);
                } else if (oldStreak === 3 && newStreak === 0 && !shatterHappened) {
                    EventBus.emit('shieldExpired', visualIndex);
                }
            });

            // Start/Manage multiplayer shield decay timers
            this.manageMultiplayerShieldDecay(data);

            const currentPileLength = data.pile ? data.pile.length : 0;
            const currentBurnLength = data.burnPile ? data.burnPile.length : 0;
            const lastBurnLength = this.lastBurnPileLength || 0;

            // Log virtually appended cards during a transaction sweep
            const virtPileLength = currentPileLength === 0 && this.lastPileLength > 0 ? this.lastPileLength + 1 : currentPileLength;

            const pileGrew = virtPileLength === this.lastPileLength + 1;
            const burnGrew = currentBurnLength === lastBurnLength + 1;
            const pileCleared = currentPileLength === 0 && this.lastPileLength > 0;

            if (burnGrew) {
                // A card was burned — detect who did it and emit invalidSlap
                let actorId = -1;
                for (let i = 0; i < 4; i++) {
                    if (data.players[i].cards && data.players[i].cards.length === this.lastPlayerCardCounts[i] - 1) {
                        actorId = i;
                        break;
                    }
                }
                if (actorId !== -1) {
                    const visualId = (actorId - this.localPlayerIndex + 4) % 4;
                    const burned = data.burnPile[data.burnPile.length - 1]; // newest burn
                    EventBus.emit('invalidSlap', { playerId: visualId, burned, reason: data.lastBurnReason });
                }
            } else if (currentPileLength > this.lastPileLength) {
                // One or more cards were played normally
                const newCardsCount = currentPileLength - this.lastPileLength;

                // Identify actor (closest guess if multiple)
                let actorId = -1;
                for (let i = 0; i < 4; i++) {
                    if (data.players[i].cards && data.players[i].cards.length < this.lastPlayerCardCounts[i]) {
                        actorId = i; // This is an approximation for multiple cards, but good for single
                    }
                }

                // Ensure we emit the final trailing card correctly
                for (let i = 0; i < newCardsCount; i++) {
                    const cardIndex = this.lastPileLength + i;
                    const newCard = data.pile[cardIndex];
                    if (newCard) {
                        const finalActorId = (actorId !== -1) ? actorId : data.activePlayerId;
                        const visualId = (finalActorId - this.localPlayerIndex + 4) % 4;
                        EventBus.emit('cardPlayed', { playerId: visualId, card: newCard });
                    }
                }
            }
            // Now safely process a pile sweep, recognizing the cards that were just virtually emitted
            if (pileCleared) {
                // Someone won the pile — winner gained pile + burnPile cards
                const totalAwarded = this.lastPileLength + lastBurnLength;
                let winnerId = -1;
                let vanished = 0;
                // v3.19.0: the room SAYS who won (slapOutcome.awardPile). The
                // count diff below cannot be trusted once ghosts exist: the
                // winner grows by fewer cards than the pile held, and the god
                // may grow by its new clones in the same write.
                const stamp = data.lastPile;
                if (stamp && typeof stamp.winner === 'number' && stamp.seq !== this.lastPileSeq) {
                    winnerId = stamp.winner;
                    vanished = stamp.vanished || 0;
                } else if (!stamp) {
                    // A room dealt before v3.19.0 carries no stamp: infer as before.
                    for (let i = 0; i < 4; i++) {
                        if (data.players[i].cards && data.players[i].cards.length >= this.lastPlayerCardCounts[i] + totalAwarded) {
                            winnerId = i;
                            break;
                        }
                    }
                }
                if (winnerId !== -1) {
                    const visualId = (winnerId - this.localPlayerIndex + 4) % 4;
                    EventBus.emit('pileWon', { winnerId: visualId, reason: data.lastWinReason || 'slap', totalAwarded, vanished });

                    // Photo finish: the pile was actually contested and decided
                    // on reaction time. Surfacing the margin is what makes the
                    // fairness change visible instead of merely true.
                    if (data.lastWinReason === 'slap' && (data.lastSlapClaims || 0) >= 2) {
                        EventBus.emit('slapPhotoFinish', {
                            winnerId: visualId,
                            reactionMs: data.lastSlapReaction || null,
                            marginMs: data.lastSlapMargin,
                            contenders: data.lastSlapClaims
                        });
                    }

                    // The comeback. `applySlapWin` stamps the room with the
                    // seat it just brought back, so every client learns it from
                    // the transaction that caused it instead of inferring it
                    // from a diff of the eliminated flags — which is exactly
                    // the kind of guess that goes wrong when two updates land
                    // together.
                    //
                    // This is the emitter that never existed. `resurrected`
                    // has had listeners in ui.js, victoryScreen.js and
                    // multiplayerMode.js — a notification, a defeat-screen
                    // teardown and a statistic — and nothing in the codebase
                    // ever fired it.
                    if (typeof data.lastResurrectedId === 'number') {
                        const backId = (data.lastResurrectedId - this.localPlayerIndex + 4) % 4;
                        EventBus.emit('resurrected', backId);
                    }
                }
            }
        }

        // Sync players - Rotate so local player is always index 0 (bottom)
        // Check for bot replacements
        if (this.lastPlayerUids && this.lastPlayerUids.length === 4) {
            data.players.forEach((p, i) => {
                const oldUid = this.lastPlayerUids[i];
                if (oldUid && !oldUid.startsWith('bot_') && p.uid.startsWith('bot_')) {
                    // The player was replaced by a bot!
                    EventBus.emit('botReplacement', { oldName: this.lastPlayerNames[i], newName: p.name });
                }
            });
        }

        // Emoji Extraction
        data.players.forEach((p, i) => {
            if (p.activeEmoji && p.activeEmoji.t) {
                const prev = this.lastEmojiT[i];
                if (!prev || p.activeEmoji.t > prev) {
                    this.lastEmojiT[i] = p.activeEmoji.t;
                    const elapsed = Date.now() - p.activeEmoji.t;
                    // Dont show emojis older than 5 seconds
                    if (elapsed < 5000) {
                        const visualId = (i - this.localPlayerIndex + 4) % 4;
                        if (visualId !== 0) { // Local player already showed their emoji
                            EventBus.emit('showEmoji', { playerId: visualId, emoji: p.activeEmoji.e });
                        }
                    }
                }
            }
        });

        this.lastPlayerUids = data.players.map(p => p.uid);
        this.lastPlayerNames = data.players.map(p => p.name);

        GameState.players = [[], [], [], []];
        GameState.streaks = [0, 0, 0, 0];
        data.players.forEach((p, i) => {
            const visualIndex = (i - this.localPlayerIndex + 4) % 4;
            GameState.players[visualIndex] = p.cards || [];
            GameState.streaks[visualIndex] = p.streak || 0;
        });

        GameState.pile = data.pile || [];
        GameState.burnPile = data.burnPile || [];
        
        // Synced Active Player ID (Safe fallback for null/undefined activePlayerId)
        const newVisualActivePlayerId = (data.activePlayerId !== null && data.activePlayerId !== undefined)
            ? (data.activePlayerId - this.localPlayerIndex + 4) % 4
            : -1;
            
        GameState.activePlayerId = newVisualActivePlayerId;

        // Emit turnChanged event ONLY when active player index actually changes (prevents visual UI flickering)
        if (this.lastActivePlayerId !== newVisualActivePlayerId) {
            this.lastActivePlayerId = newVisualActivePlayerId;
            EventBus.emit('turnChanged', newVisualActivePlayerId);
        }

        if (data.challenge && data.challenge.active) {
            GameState.challenge = {
                active: data.challenge.active,
                attackerId: data.challenge.attackerId !== null ? (data.challenge.attackerId - this.localPlayerIndex + 4) % 4 : null,
                defenderId: data.challenge.defenderId !== null ? (data.challenge.defenderId - this.localPlayerIndex + 4) % 4 : null,
                chancesLeft: data.challenge.chancesLeft
            };
        } else {
            GameState.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
        }

        if (data.status === 'abandoned' && GameState.gameStarted) {
            GameState.gameOver = true;
            GameState.gameStarted = false;
            EventBus.emit('gameAbandoned', (data.abandonedBy - this.localPlayerIndex + 4) % 4);
            return;
        }

        const previouslyOver = GameState.gameOver;
        const previouslyStarted = GameState.gameStarted;

        GameState.gameStarted = data.gameStarted;
        GameState.gameOver = data.gameOver;
        // `data.lastPlayTime` is on the SERVER clock; everything downstream
        // (reflex readouts, `Date.now() - lastPlayTime`, animations) is on the
        // local one. Convert exactly once, here at the boundary.
        GameState.lastPlayTime = NetQuality.toLocal(data.lastPlayTime);

        // The table's rule set is authoritative for as long as the room lives.
        // Read on EVERY snapshot, not just the first, so a client that joined
        // late or reconnected can never evaluate slaps under its own local
        // preferences while everyone else uses the host's.
        HouseRules.applyRoom(data.houseRules || '');
        // v3.18.0 — every client draws the god's life from the room itself.
        import('./pantheon.js').then(m => m.PantheonMode.syncRoom(data)).catch(() => {});

        // Keep the fair-slap window armed. This is what guarantees a contest
        // always closes even if the client that opened it goes silent.
        this.scheduleContestClose(data.slapContest || null);
        if (data.slapContest && FairSlap.isStale(data.slapContest, NetQuality.serverNow())) {
            this.closeSlapContest();
        }

        if (!previouslyStarted && data.gameStarted) {
            EventBus.emit('gameStarted');
        }

        if (!previouslyOver && data.gameOver) {
            localStorage.removeItem('ers_active_table');
            
            // Clean up visual turn borders and countdown timers upon game end
            EventBus.emit('turnChanged', -1);

            // USE THE SERVER-ASSIGNED WINNER ID (handles elimination wins)
            const winnerActualId = (data.winnerId !== undefined) ? data.winnerId : -1;


            if (winnerActualId !== -1) {
                const winnerUid = (data.players[winnerActualId] || {}).uid;

                // The winner's record is written once, by ScoreSystem on
                // gameOver (playerRecord.js). A second write here used to bump a
                // stray `score` field nothing reads; firestore.rules now refuses it.

                EventBus.emit('gameOver', (winnerActualId - this.localPlayerIndex + 4) % 4);
            } else {
                // Total Defeat Scenario
                EventBus.emit('gameOver', -1);
            }

            // NEW: Safe Cleanup logic based on current host
            import('./auth.js').then(({ AuthSystem }) => {
                const amIHost = data.hostId === AuthSystem.currentUser?.uid;
                if (amIHost && data.status === 'finished') {
                    setTimeout(async () => {
                        // ERS-23: re-read at fire time, not at scheduling — a
                        // client that lost the connection or the host role in
                        // these 5 s must not delete the room.
                        const now = this.roomData;
                        if (this.isConnected === false || !now || now.hostId !== AuthSystem.currentUser?.uid || now.status !== 'finished') return;
                        try {
                            const parts = this.roomId.split('_');
                            if (parts.length >= 2) {
                                const tableId = parts[1];
                                await deleteDoc(doc(db, "multiplayer_tables", tableId));
                            }
                            await rtdbRemove(dbRef(rtdb, `gameRooms/${this.roomId}`));
                            console.log("Room cleaned up successfully.");
                        } catch (e) {
                            console.error("Cleanup failed:", e);
                        }
                    }, 5000);
                }
            });
        }

        // Update trackers for next delta
        this.lastPileSeq = data.lastPile ? data.lastPile.seq : null;
        this.lastPileLength = data.pile ? data.pile.length : 0;
        this.lastBurnPileLength = data.burnPile ? data.burnPile.length : 0;
        this.lastPlayerCardCounts = data.players.map(p => p.cards ? p.cards.length : 0);
        this.lastShieldShatterTime = data.lastShieldShatterTime || 0;
        // CRITICAL: Store by DB index to match the comparison in syncToLocal streak delta logic
        this.lastPlayerStreaks = data.players.map(p => p.streak || 0);
        if (!this.lastEmojiT) this.lastEmojiT = {};

        EventBus.emit('gameSynced', data);
    },


    stopListening() {
        if (this.contestTimer) {
            clearTimeout(this.contestTimer);
            this.contestTimer = null;
        }
        NetQuality.stop();
        // Hand rule authority back to the player's own preference. Without this
        // a table that had Tens switched off would keep it off in the next
        // offline match.
        HouseRules.clearRoom();
        if (this.unsubRoom) {
            this.unsubRoom();
            this.unsubRoom = null;
        }
        if (this.unsubConnected) {
            this.unsubConnected();
            this.unsubConnected = null;
        }
        if (this.dbShieldDecayTimers) {
            this.dbShieldDecayTimers.forEach(t => { if (t) clearTimeout(t); });
            this.dbShieldDecayTimers = [null, null, null, null];
        }
        if (this.roomId && this.localPlayerIndex >= 0 && this.localPlayerIndex < 4) {
            const myPlayerRef = dbRef(rtdb, `gameRooms/${this.roomId}/players/${this.localPlayerIndex}`);
            onDisconnect(myPlayerRef).cancel().catch(e => console.warn("Failed to cancel onDisconnect", e));
        }
    },

    /**
     * v3.19.2 — host failover (slapOutcome.orphanedHostHeir). Called on every
     * snapshot by MultiplayerMode; cheap until this client is the heir, and
     * then one transaction that re-checks the same rule on the server's copy,
     * so two clients can never both take the room.
     */
    /** A human's turn online (ms): the host's timer and the timeout transaction share it. */
    TURN_TIMEOUT_MS,

    /**
     * ERS-23 fence: may THIS client write for seat `seatIndex`? A human seat
     * writes for itself; a bot seat only through the room's current host.
     */
    _mayDrive(data, seatIndex) {
        const p = data.players && data.players[seatIndex];
        if (!p || !isBotSeat(p)) return true;
        return data.hostId === AuthSystem.currentUser?.uid;
    },

    /**
     * v3.19.2 (council ERS-23) — "every human is out", as a transaction. It
     * was a blind update(): an offline ex-host's queued copy could end a live
     * match on reconnect. Re-checked on the server's copy: this client is the
     * host, and every connected human is ELIMINATED (an empty hand is not out).
     */
    endIfNoHumanLeft() {
        const uid = AuthSystem.currentUser?.uid;
        if (!this.roomId || !uid) return Promise.resolve();
        const roomRef = dbRef(rtdb, `gameRooms/${this.roomId}`);
        return runTransaction(roomRef, (data) => {
            if (!data || data.gameOver || !data.gameStarted || !data.players) return;
            if (data.hostId !== uid) return;
            const humans = data.players.filter(p => p && !isBotSeat(p) && p.status !== 'disconnected');
            if (humans.length === 0 || humans.some(p => !p.eliminated)) return;
            data.gameOver = true;
            data.status = 'finished';
            data.winnerId = -1;   // no human won
            return data;
        }).catch(e => console.warn('end-of-match (no human left) failed', e));
    },

    claimOrphanedHost(data) {
        const uid = AuthSystem.currentUser?.uid;
        if (!this.roomId || !uid || !data || data.gameOver || this._claimingHost) return;
        const heir = orphanedHostHeir(data);
        if (!heir || heir.uid !== uid) return;
        this._claimingHost = true;
        const roomRef = dbRef(rtdb, `gameRooms/${this.roomId}`);
        return runTransaction(roomRef, (room) => {
            if (!room || room.gameOver || !room.players) return;
            const h = orphanedHostHeir(room);
            if (!h || h.uid !== uid) return;
            room.hostId = h.uid;
            room.hostUsername = h.name;
            return room;
        }).catch(e => console.warn('host failover failed', e)).finally(() => { this._claimingHost = false; });
    },

    async pushUpdate(updates) {
        if (!this.roomId) return;
        const roomRef = dbRef(rtdb, `gameRooms/${this.roomId}`);
        await rtdbUpdate(roomRef, updates);
    },

    async pushEmoji(emojiString) {
        if (!this.roomId || this.localPlayerIndex < 0) return;
        const pRef = dbRef(rtdb, `gameRooms/${this.roomId}/players/${this.localPlayerIndex}/activeEmoji`);
        await rtdbUpdate(pRef, {
            e: emojiString,
            t: rtdbServerTimestamp()
        });
    },

    async pushBotEmoji(actualId, emojiString) {
        if (!this.roomId) return;
        const pRef = dbRef(rtdb, `gameRooms/${this.roomId}/players/${actualId}/activeEmoji`);
        await rtdbUpdate(pRef, {
            e: emojiString,
            t: rtdbServerTimestamp()
        });
    },

    async abandonRoom() {
        if (!this.roomId || !this.roomData || !this.roomData.players) return;
        const roomRef = dbRef(rtdb, `gameRooms/${this.roomId}`);

        try {
            await runTransaction(roomRef, (data) => {
                if (!data || !data.players) return;

                const myUid = this.roomData.players[this.localPlayerIndex].uid;
                const newPlayers = [...data.players];
                if (newPlayers[this.localPlayerIndex]) {
                    newPlayers[this.localPlayerIndex].status = 'disconnected';
                    newPlayers[this.localPlayerIndex].disconnectedAt = Date.now();
                }

                // If I am the host, migrate hostId to someone else before I leave
                if (data.hostId === myUid) {
                    const nextHost = newPlayers.find(p => !p.uid.startsWith('bot_') && p.uid !== myUid && p.status !== 'disconnected' && !p.eliminated);
                    if (nextHost) {
                        data.hostId = nextHost.uid;
                        data.hostUsername = nextHost.name;
                    }
                }

                data.players = newPlayers;
                return data;
            });
        } catch (e) {
            console.error("Failed to abandon room on disconnect", e);
        }
    },

    // -----------------------------------------------------------------------
    // Slap outcome application
    //
    // These two blocks used to live inline inside pushSlapAttempt's transaction.
    // They were lifted out verbatim (only the seat variable is now a parameter)
    // so that fair-slap arbitration can apply the SAME outcome when a contest
    // closes, instead of a second, subtly different copy of the award logic.
    // Both mutate `data` in place and are called only from inside a transaction.
    // -----------------------------------------------------------------------

    /** Awards the pile (+ burn pile) to `seatIndex`. */
    /**
     * The outcome of a slap now lives in ONE place: slapOutcome.js.
     *
     * This method used to hold a full copy of it, and functions/gameLogic.js
     * held a second, hand-written "faithful port". Because
     * USE_SERVER_VALIDATION is false, THIS copy is the one that runs in every
     * live multiplayer match — and every slap assertion in the suite targeted
     * the other one. The most consequential code in the game (card ownership,
     * burn penalties, permanent elimination, host migration, the winner) was
     * executed by no test at all, while 1,200+ assertions certified its dormant
     * twin. The two were held together by a sentence in a comment.
     *
     * Delegating makes the tested code and the live code the same code.
     */
    _applySlapWin(data, seatIndex) {
        // v3.18.0 — a god at the table: its life changes in THIS transaction.
        // The pattern is read before the pile is handed over.
        // v3.19.0 — and the pile itself, with the pattern's positions, so the
        // god can keep its ghost clones in this same write.
        const m = data.god ? matchSlap(data.pile || [], HouseRules.active()) : null;
        const slapped = data.god ? { pile: [...(data.pile || [])], indices: m ? m.indices : [] } : null;
        applySlapWin(data, seatIndex);
        if (data.god) applyGodSlapWin(data, seatIndex, m ? m.id : undefined, NetQuality.serverNow(), slapped);
        return data;
    },

    /** Applies the invalid-slap penalty (shield shatter, or burn a card). */
    _applySlapBurn(data, seatIndex) {
        const before = data.god ? ((data.players[seatIndex] || {}).cards || []).length : 0;
        applySlapBurn(data, seatIndex);
        // Anubis: a card actually burned (no shield, not the last) burns twice.
        if (data.god && ((data.players[seatIndex] || {}).cards || []).length === before - 1) applyGodBurn(data, seatIndex);
        return data;
    },

    async pushSlapAttempt({ playerIndex }) {
        if (!this.roomId) return;
        if (this.USE_SERVER_VALIDATION) return this._pushSlapAttemptSecure(playerIndex);
        const roomRef = dbRef(rtdb, `gameRooms/${this.roomId}`);

        try {
            await runTransaction(roomRef, (data) => {
                if (!data || data.gameOver) return;
                if (!data.players || !data.players[playerIndex]) return;
                // v3.19.2 (ERS-23 fence): a bot seat is driven by the host
                // alone. Checked on the server's copy, so a write queued by a
                // host that has since been replaced aborts when it replays.
                if (!this._mayDrive(data, playerIndex)) return;

                // v3.19.2 — an eliminated seat MAY slap. This line refused it
                // ("If they are already eliminated, they can't slap") and was
                // the fifth lock on Slap Back In, the one v3.11.0's four-lock
                // sweep missed: the rules panel promises the comeback in four
                // languages, _settleContest was opened for it, applySlapWin
                // stamps it — and not one eliminated player online could
                // reach any of it. A wrong slap from an empty hand costs
                // nothing (applySlapBurn: nothing to burn), exactly as offline —
                // ONCE per pile: council ERS-22 (c). A second attempt on the
                // same pile after a miss from an empty hand is refused here.
                if (emptySlapLocked(data, playerIndex)) return;

                const serverNow = NetQuality.serverNow();
                const pile = data.pile || [];
                const isValid = this.evaluateSlap(pile);

                // --- 1. A WRONG slap is not a race. Burn it immediately. ---
                // Holding invalid slaps for the contest window would add a
                // visible delay to the punishment and, worse, would let a
                // player fish for a pattern that has not appeared yet.
                if (!isValid) {
                    this._applySlapBurn(data, playerIndex);
                    return data;
                }

                // --- 2. No possible race → keep the old zero-latency path. ---
                // With fewer than two live humans nobody can be beaten by a
                // better connection, so this room pays nothing for fairness.
                if (!FairSlap.needsContest(data.players)) {
                    this._applySlapWin(data, playerIndex);
                    return data;
                }

                // --- 3. Contested. Arbitrate on reaction, not on arrival. ---
                const reactionMs = serverNow - (data.lastPlayTime || serverNow);
                const contest = data.slapContest;

                if (!contest) {
                    data.slapContest = FairSlap.openContest(serverNow, { index: playerIndex, reactionMs });
                    return data;
                }
                if (!FairSlap.isExpired(contest, serverNow)) {
                    data.slapContest = FairSlap.addClaim(contest, serverNow, { index: playerIndex, reactionMs });
                    return data;
                }

                // The window already closed and nobody settled it yet (a client
                // went quiet). Settle it now; this late claim is dropped,
                // because the pile it was aimed at is about to be awarded.
                this._settleContest(data, serverNow);
                return data;
            });
        } catch (error) {
            console.error("Slap transaction failed:", error);
        }
    },

    /**
     * Closes an open contest and awards the pile to the lowest reaction time.
     * Mutates `data`; only ever called from inside a transaction.
     * @returns {boolean} true when a pile was actually awarded.
     */
    _settleContest(data, serverNow) {
        const contest = data.slapContest;
        if (!contest) return false;

        const winner = FairSlap.resolveContest(contest);
        data.slapContest = null;
        if (!winner) return false;
        // v3.19.2 — defence in depth: a window whose pile is gone (awarded by
        // a path that did not settle it first) awards nothing. An empty or
        // changed pile is no longer the pattern the claimants slapped.
        if (!this.evaluateSlap(data.pile || [])) return false;

        // Publish the race result so the UI can show "won by 12ms". Written
        // even when the winner turns out to be unavailable, so the log is honest.
        data.lastSlapReaction = winner.reactionMs;
        data.lastSlapMargin = FairSlap.winningMargin(contest);
        data.lastSlapClaims = FairSlap.claimCount(contest);

        // A seat that no longer exists cannot be awarded a pile. An ELIMINATED
        // seat can, and that is the point: the rules panel's "Spectator Mode &
        // Slap Back" section says a player with no cards may still slap, and a
        // successful slap brings them back with the pile. `p.eliminated` used
        // to be part of this refusal, so an eliminated player could win the
        // race on reaction time and have the win silently thrown away — the
        // third of four locks on a feature the game documents in four languages.
        // `applySlapWin` clears the flag when the pile lands.
        //
        // The v3.7.4 product rule is untouched. When the LAST live human is
        // eliminated, resolveEndOfMatch ends the match at that same slap
        // outcome, so no later pile exists for them to slap at. This only
        // reaches the case that rule never covered: somebody else is still in.
        const p = data.players && data.players[winner.index];
        if (!p) return false;

        this._applySlapWin(data, winner.index);
        return true;
    },

    /**
     * Every client races to close the window; the transaction is idempotent, so
     * whoever gets there first wins and the rest abort harmlessly. Running it
     * on all clients — rather than only the host — means a host whose tab is
     * throttled cannot freeze the table.
     */
    async closeSlapContest() {
        if (!this.roomId) return;
        const roomRef = dbRef(rtdb, `gameRooms/${this.roomId}`);
        try {
            await runTransaction(roomRef, (data) => {
                if (!data || !data.slapContest) return;
                const now = NetQuality.serverNow();
                if (!FairSlap.isExpired(data.slapContest, now)) return;
                this._settleContest(data, now);
                return data;
            });
        } catch (e) {
            console.warn("Slap contest close failed", e);
        }
    },

    /** Arms (or re-arms) the local timer that closes the current contest. */
    scheduleContestClose(contest) {
        if (this.contestTimer) {
            clearTimeout(this.contestTimer);
            this.contestTimer = null;
        }
        if (!contest) return;
        const delay = Math.max(0, Number(contest.deadline || 0) - NetQuality.serverNow());
        this.contestTimer = setTimeout(() => {
            this.contestTimer = null;
            this.closeSlapContest();
        }, delay + 10); // +10ms so the deadline is unambiguously in the past
    },


    /**
     * v3.19.1 — a turn held by a seat that cannot take it is passed on.
     * Both the play and the timeout transaction used to return the room
     * unchanged for an eliminated seat (and the timeout one for an empty
     * hand), so a turn that landed there was held forever and the table froze
     * — found by tools/fuzz-pantheon.mjs. A defender with no cards is not
     * "unable": its empty turn loses the challenge, handled by the callers.
     * Returns true when the turn was passed (or there is no one to pass to).
     */
    _passIfUnable(data, playerIndex) {
        const holder = data.players[playerIndex];
        const ch = data.challenge || {};
        const defending = ch.active && ch.defenderId === playerIndex;
        const empty = !holder.cards || holder.cards.length === 0;
        if (defending && empty) return false;
        if (!holder.eliminated && !empty) return false;
        const next = nextSeat(data.players, playerIndex);
        if (next !== null && next !== playerIndex) {
            data.activePlayerId = next;
            // Council ERS-21: a forced pass repairs a state that should not
            // exist, so it must never be silent. It is stamped in the room
            // (every client sees it) and logged, and tools/fuzz-pantheon.mjs
            // fails on any stamp — the repair cannot hide the next freeze bug.
            const prev = data.forcedTurnPass || {};
            data.forcedTurnPass = { seat: playerIndex, to: next, count: (prev.count || 0) + 1, at: NetQuality.serverNow() };
            console.warn(`forced turn pass: seat ${playerIndex} could not act (eliminated=${!!holder.eliminated}, cards=${(holder.cards || []).length}); turn to seat ${next}`);
        }
        return true;
    },

    async pushPlayCard({ playerIndex }) {
        if (!this.roomId) return;
        if (this.USE_SERVER_VALIDATION) return this._pushPlayCardSecure(playerIndex);
        const roomRef = dbRef(rtdb, `gameRooms/${this.roomId}`);

        try {
            await runTransaction(roomRef, (data) => {
                if (!data || data.gameOver || !data.gameStarted) return;
                if (!data.players || !data.players[playerIndex]) return;
                if (!this._mayDrive(data, playerIndex)) return;   // ERS-23 fence: bots are the host's

                // The pile is under dispute for the length of an open contest
                // window. Letting a card land on top of it mid-arbitration
                // would change what the claimants were slapping at. Aborting
                // costs at most one dropped tap: a human can tap again a
                // fraction of a second later, and a bot is re-scheduled by
                // `checkBotTurn()` on the very next snapshot (closing the
                // contest produces one), with `checkTurnTimeouts()` behind that
                // as a second safety net.
                if (data.slapContest && !FairSlap.isExpired(data.slapContest, NetQuality.serverNow())) {
                    return;
                }
                // v3.19.2 — a window that has closed but not been settled yet
                // (its close timer is ~10 ms behind the deadline) is settled
                // FIRST: the slap was earlier than this card, so the pile is
                // the claimant's and this play is superseded. It used to land
                // on the disputed pile — and when that card ended a challenge,
                // the pile went to the attacker and the contest then awarded
                // the EMPTY table to the slapper, turn and god damage included
                // (host fuzzer, seed 19).
                if (data.slapContest && this._settleContest(data, NetQuality.serverNow())) return data;

                if (data.activePlayerId !== playerIndex) return data;
                if (this._passIfUnable(data, playerIndex)) return data;

                const players = [...data.players];
                let challenge = data.challenge || { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
                if (!players[playerIndex].cards || players[playerIndex].cards.length === 0) {
                    // Defender has 0 cards and it's their turn to play in a challenge -> Attacker wins!
                    if (challenge.active && challenge.defenderId === playerIndex) {
                        // v3.19.1: the one challenge award (slapOutcome.awardChallenge).
                        awardChallenge(data, players, challenge.attackerId);
                    }
                    return data;
                }

                const pile = data.pile || [];
                const card = players[playerIndex].cards.shift();
                pile.push(card);
                // v3.19.0: a hand left holding only ghosts is empty.
                dropHollowHand(players[playerIndex]);



                const isFaceCard = card.rank >= 11;
                challenge = data.challenge || { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
                let nextActiveId = playerIndex;

                const getNextPlayer = (currentId) => {
                    let next = (currentId + 1) % 4;
                    let count = 0;
                    while ((!players[next].cards || players[next].cards.length === 0 || players[next].eliminated) && count < 4) {
                        next = (next + 1) % 4;
                        count++;
                    }
                    return count < 4 ? next : null;
                };

                if (challenge.active) {
                    if (isFaceCard) {
                        challenge.attackerId = playerIndex;
                        challenge.defenderId = getNextPlayer(playerIndex);
                        challenge.chancesLeft = this.FACE_CHANCES[card.rank];
                        nextActiveId = challenge.defenderId;
                    } else {
                        challenge.chancesLeft = (challenge.chancesLeft || 1) - 1;
                        // If they have no cards left, they instantly fail the challenge
                        if (challenge.chancesLeft <= 0 || players[playerIndex].cards.length === 0) {
                            data.pile = pile;
                            awardChallenge(data, players, challenge.attackerId);
                            return data;
                        } else {
                            nextActiveId = playerIndex;
                        }
                    }
                } else {
                    if (isFaceCard) {
                        challenge.active = true;
                        challenge.attackerId = playerIndex;
                        challenge.defenderId = getNextPlayer(playerIndex);
                        challenge.chancesLeft = this.FACE_CHANCES[card.rank];
                        nextActiveId = challenge.defenderId;
                    } else {
                        nextActiveId = getNextPlayer(playerIndex);
                    }
                }

                data.players = players;
                data.pile = pile;
                data.activePlayerId = nextActiveId;

                // Safety: If no one has cards left to play, end the match
                const humansWithCards = players.filter(p => !p.uid.startsWith('bot_') && !p.eliminated && p.cards && p.cards.length > 0).length;
                if (nextActiveId === null && !data.gameOver) {
                    data.gameOver = true;
                    data.status = 'finished';
                    data.winnerId = -1;
                }

                data.challenge = challenge;
                data.lastPlayTime = NetQuality.serverNow(); // shared clock — see netQuality.js
                return data;
            });
        } catch (error) {
            console.error("Play card transaction failed:", error);
        }
    },

    // --- v2.9.0: secure calling paths, only used when USE_SERVER_VALIDATION
    // is true (see the flag's own comment above). Translates the existing
    // {playerIndex} convention (an already-resolved DB seat index) into the
    // Cloud Function's identity-derived convention: if that seat's uid is the
    // caller's own, act as self; otherwise it must be a bot seat the host is
    // simulating, so pass it explicitly as actingForBotSeat. See
    // functions/gameLogic.js::resolveActingSeat for the server-side check
    // this relies on — the server independently re-verifies this, it does
    // not just trust what the client claims here.
    async _currentAuthUid() {
        const { AuthSystem } = await import('./auth.js');
        return AuthSystem.currentUser?.uid || null;
    },

    async _pushSlapAttemptSecure(playerIndex) {
        const seat = this.roomData?.players?.[playerIndex];
        if (!seat) return;
        try {
            const myUid = await this._currentAuthUid();
            const attemptSlap = httpsCallable(functions, 'attemptSlap');
            await attemptSlap({
                roomId: this.roomId,
                actingForBotSeat: (seat.uid === myUid) ? undefined : playerIndex
            });
        } catch (error) {
            console.error("Secure slap attempt failed:", error);
        }
    },

    async _pushPlayCardSecure(playerIndex) {
        const seat = this.roomData?.players?.[playerIndex];
        if (!seat) return;
        try {
            const myUid = await this._currentAuthUid();
            const attemptPlayCard = httpsCallable(functions, 'attemptPlayCard');
            await attemptPlayCard({
                roomId: this.roomId,
                actingForBotSeat: (seat.uid === myUid) ? undefined : playerIndex
            });
        } catch (error) {
            console.error("Secure play card attempt failed:", error);
        }
    },

    async convertToBot(playerIndex) {
        if (!this.roomId) return;
        const roomRef = dbRef(rtdb, `gameRooms/${this.roomId}`);
        const tableRef = doc(db, "multiplayer_tables", this.roomId);

        console.log(`Converting player index ${playerIndex} to bot for room ${this.roomId}`);

        try {
            let assignedBotId = null;
            let assignedBotName = null;

            // 1. Update RTDB Room via transaction to handle race condition safely
            await runTransaction(roomRef, (data) => {
                if (!data || !data.players || !data.players[playerIndex]) return;
                const p = data.players[playerIndex];
                if (p.uid.startsWith('bot_')) return; // Already converted
                // ERS-23 fence: the host converts a departed seat; a player may
                // convert their own. Nobody else — and not an ex-host replaying.
                const me = AuthSystem.currentUser?.uid;
                if (data.hostId !== me && p.uid !== me) return;

                // RACE CONDITION DEFENSE: If player just reconnected and went online, abort bot conversion!
                if (p.status === 'online') return;

                // Find a unique Bot name not already taken by any player at the table
                const existingNames = data.players.filter(pl => pl && pl.name).map(pl => pl.name.trim());
                let botNum = 1;
                while (existingNames.includes(`Bot ${botNum}`)) {
                    botNum++;
                }

                assignedBotId = `bot_${Date.now()}_${playerIndex}`;
                assignedBotName = `Bot ${botNum}`;

                p.uid = assignedBotId;
                p.name = assignedBotName;
                p.status = 'online';
                p.disconnectedAt = null;
                // Preserve elimination state
                p.eliminated = p.eliminated || false;
                data.players[playerIndex] = p;
                return data;
            });

            // 2. Update Firestore Table with the EXACT synced Bot credentials
            if (assignedBotId && assignedBotName) {
                const snap = await getDoc(tableRef);
                if (snap.exists()) {
                    const tableData = snap.data();
                    const newPlayers = [...tableData.players];
                    const p = newPlayers.find(x => x.index === playerIndex);
                    if (p && !p.uid.startsWith('bot_')) {
                        p.uid = assignedBotId;
                        p.name = assignedBotName;
                        p.status = 'online';
                        p.disconnectedAt = null;
                        await updateDoc(tableRef, { players: newPlayers, playerIds: playerIdsOf(newPlayers) });
                    }
                }
            }
        } catch (error) {
            console.error("Bot conversion failed:", error);
        }
    },

    async pushTimeout(playerIndex) {
        if (!this.roomId) return;
        const roomRef = dbRef(rtdb, `gameRooms/${this.roomId}`);

        try {
            await runTransaction(roomRef, (data) => {
                if (!data || data.gameOver || !data.gameStarted) return;
                if (!data.players || !data.players[playerIndex]) return;
                // v3.19.2 (council ERS-23): only the CURRENT host times a turn
                // out, and only a turn that has really run its 15 s — both read
                // from the server's copy, so a timeout queued by an offline
                // ex-host cannot burn a card from a live match when it replays.
                if (data.hostId !== AuthSystem.currentUser?.uid) return;
                if (NetQuality.serverNow() - (data.lastPlayTime || 0) < TURN_TIMEOUT_MS) return;
                // v3.19.2 — like a play: a timeout waits out an open slap
                // window, and settles a closed one first. A defender with no
                // cards timing out mid-window used to hand the disputed pile to
                // the attacker under the claimants' hands.
                if (data.slapContest && !FairSlap.isExpired(data.slapContest, NetQuality.serverNow())) return;
                if (data.slapContest && this._settleContest(data, NetQuality.serverNow())) return data;
                if (data.activePlayerId !== playerIndex) return data;
                if (this._passIfUnable(data, playerIndex)) return data;

                const players = [...data.players];
                const p = players[playerIndex];
                if (!p.cards || p.cards.length === 0) {
                    // A defender with nothing left to play has lost the challenge.
                    const ch = data.challenge || {};
                    if (ch.active && ch.defenderId === playerIndex) awardChallenge(data, players, ch.attackerId);
                    return data;
                }

                const cards = [...p.cards];
                const burned = cards.shift();
                const currentBurnPile = [...(data.burnPile || [])];
                currentBurnPile.push(burned);

                players[playerIndex].cards = cards;
                dropHollowHand(players[playerIndex]);
                data.players = players;
                data.burnPile = currentBurnPile;
                data.lastBurnReason = 'timeout'; 

                let challenge = data.challenge || { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };

                if (challenge.active) {
                    awardChallenge(data, players, challenge.attackerId);
                } else {
                    // Reset streak on normal timeout
                    players[playerIndex].streak = 0;

                    let next = (playerIndex + 1) % 4;
                    let count = 0;
                    while ((!players[next].cards || players[next].cards.length === 0 || players[next].eliminated) && count < 4) {
                        next = (next + 1) % 4;
                        count++;
                    }
                    data.activePlayerId = count < 4 ? next : null;
                }

                data.lastPlayTime = NetQuality.serverNow(); // shared clock — see netQuality.js
                return data;
            });
        } catch (error) {
            console.error("Timeout transaction failed:", error);
        }
    },

    /**
     * Which seats may this client expire?
     *
     * Nobody may reset another human's streak — their own client owns that. Bot
     * seats are the host's responsibility, because otherwise every client would
     * race to expire the same bot.
     *
     * v3.7.2 — this used to read `window.AuthSystem`, which is **never assigned
     * anywhere in the app**. main.js exposes window.GameState, window.HouseRules
     * and window.UI, but never AuthSystem, so `isHost` was `undefined && ...`,
     * i.e. permanently false. The consequence was not cosmetic: a bot that
     * reached a 3-slap streak in multiplayer kept its Combustion Shield for the
     * REST OF THE MATCH, because the only time-based decay path in multiplayer
     * is expireDbShield and no client would ever run it for a bot. The server
     * never expires it either — functions/gameLogic.js keeps a non-winner's
     * streak when it is already at 3. A real import cannot be silently
     * undefined, which is why this no longer goes through a global.
     */
    isShieldAuthorityFor(dbIndex) {
        const players = (this.roomData && this.roomData.players) || [];
        const target = players[dbIndex];
        if (!target) return false;
        if (dbIndex === this.localPlayerIndex) return true;          // my own shield
        const isBot = !!(target.uid && target.uid.startsWith('bot_'));
        if (!isBot) return false;                                     // another human owns theirs
        const me = AuthSystem && AuthSystem.currentUser;
        return !!(me && this.roomData && this.roomData.hostId && me.uid === this.roomData.hostId);
    },

    manageMultiplayerShieldDecay(data) {
        if (!data || !data.players) return;
        if (!this.dbShieldDecayTimers) this.dbShieldDecayTimers = [null, null, null, null];

        data.players.forEach((p, dbIndex) => {
            const streak = p.streak || 0;
            if (streak === 3) {
                // FIX: justWonSlap was using lastWinReason which persists forever in RTDB,
                // causing the timer to reset on every sync after a slap win.
                // Instead, detect a slap win only when the pile was just cleared (pileCleared event)
                // by comparing against a reliable signal: pile just became empty AND lastWinReason=slap
                // AND the winner is this player AND we haven't already processed this exact event.
                const lastWinKey = `${data.lastWinReason}_${data.activePlayerId}_${data.lastPlayTime}`;
                const justWonSlap = (
                    data.lastWinReason === 'slap' &&
                    data.activePlayerId === dbIndex &&
                    this.lastPileLength > 0 &&  // pile was non-empty last sync
                    (data.pile ? data.pile.length : 0) === 0 && // pile is now empty
                    this.lastManagedShieldWinKey !== lastWinKey // haven't processed this exact win yet
                );

                if (justWonSlap) {
                    this.lastManagedShieldWinKey = lastWinKey;
                }

                const authoritative = this.isShieldAuthorityFor(dbIndex);
                const armed = !!this.dbShieldDecayTimers[dbIndex];

                // v3.7.2 — the drawn countdown and the real expiry are now
                // decided separately, because they answer to different things.
                //
                // The countdown belongs to EVERY seat with a live shield: a
                // player watching an opponent's shield needs to see it running
                // down. The expiry timer belongs only to the seat this client is
                // allowed to write. Arming them together (v3.7.1) meant a
                // non-authoritative seat got neither — so an opponent's or a
                // bot's shield drew as a bare icon with no number, which is the
                // very symptom this whole line of work started from.
                const shieldStarts = !armed || justWonSlap;

                if (authoritative && shieldStarts) {
                    if (this.dbShieldDecayTimers[dbIndex]) {
                        clearTimeout(this.dbShieldDecayTimers[dbIndex]);
                    }
                    this.dbShieldDecayTimers[dbIndex] = setTimeout(() => {
                        // Release the slot BEFORE the attempt. Left set, a fired
                        // timer reads as "already armed" forever and the seat can
                        // never be re-armed — a shield that outlived one failed
                        // expiry would then never be retried.
                        this.dbShieldDecayTimers[dbIndex] = null;
                        this.expireDbShield(dbIndex);
                    }, SHIELD_DURATION_MS);
                }

                // v3.7.1 — announce every start, not just the first. The drawn
                // countdown used to be armed only by 'shieldEarned', which fires
                // on the 0 -> 3 streak transition. A renewing slap holds the
                // streak at 3, so no event fired and the drawn clock was never
                // refreshed while the real one was: the number ran to zero and
                // vanished while the shield kept protecting for up to another 30
                // seconds. One condition now starts both.
                if (shieldStarts) {
                    EventBus.emit('shieldRenewed', (dbIndex - this.localPlayerIndex + 4) % 4);
                    // Mark non-authoritative seats as observed too, so a renewal
                    // is detected by justWonSlap rather than re-firing every sync.
                    if (!authoritative && !armed) this.dbShieldDecayTimers[dbIndex] = 'observed';
                }
            } else {
                if (this.dbShieldDecayTimers[dbIndex]) {
                    // 'observed' is a marker, not a handle — clearTimeout on it
                    // is harmless, but only a real handle needs cancelling.
                    if (this.dbShieldDecayTimers[dbIndex] !== 'observed') {
                        clearTimeout(this.dbShieldDecayTimers[dbIndex]);
                    }
                    this.dbShieldDecayTimers[dbIndex] = null;
                }
            }
        });
    },

    async expireDbShield(dbIndex) {
        if (!this.roomId || !this.roomData) return;
        const players = this.roomData.players || [];
        const targetPlayer = players[dbIndex];
        if (!targetPlayer) return;

        // One rule, stated once — see isShieldAuthorityFor.
        if (this.isShieldAuthorityFor(dbIndex)) {
            const roomRef = dbRef(rtdb, `gameRooms/${this.roomId}`);
            try {
                await runTransaction(roomRef, (currentData) => {
                    if (!currentData || !currentData.players || !currentData.players[dbIndex]) return;
                    // Atomically verify that streak is still 3 before resetting to 0
                    if (currentData.players[dbIndex].streak >= 3) {
                        currentData.players[dbIndex].streak = 0;
                    }
                    return currentData;
                });
            } catch (e) {
                console.error("Failed to expire shield in RTDB transaction:", e);
            }
        }
    }
};
