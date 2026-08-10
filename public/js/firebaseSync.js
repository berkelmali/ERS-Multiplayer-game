import { getFirestore, doc, getDoc, updateDoc, increment, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref as dbRef, onValue, off, update as rtdbUpdate, remove as rtdbRemove, onDisconnect, serverTimestamp as rtdbServerTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { app, rtdb, functions } from "./firebaseConfig.js";
import { GameState } from "./game.js";
import EventBus from "./eventbus.js";

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


    evaluateSlap(pile) {
        if (!pile || pile.length < 2) return false;
        const top = pile[pile.length - 1];
        const prev = pile[pile.length - 2];

        // Doubles
        if (top.rank === prev.rank) return true;
        // Tens
        if (top.rank <= 10 && prev.rank <= 10 && top.rank + prev.rank === 10) return true;
        // Marriage (K & Q)
        if ((top.rank === 12 && prev.rank === 13) || (top.rank === 13 && prev.rank === 12)) return true;
        // Sandwich
        if (pile.length >= 3) {
            const prev2 = pile[pile.length - 3];
            if (top.rank === prev2.rank) return true;
        }
        return false;
    },

    listenToRoom(roomId, playerIndex) {
        this.roomId = roomId;
        this.localPlayerIndex = playerIndex;
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
                if (snap.val() === true) {
                    // Connection established or re-established
                    onDisconnect(myPlayerRef).update({ status: 'disconnected', disconnectedAt: rtdbServerTimestamp() }).catch(e => console.warn("onDisconnect failed", e));

                    // Explicitly mark as online
                    rtdbUpdate(myPlayerRef, { status: 'online', disconnectedAt: null }).catch(console.warn);
                }
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
                for (let i = 0; i < 4; i++) {
                    if (data.players[i].cards && data.players[i].cards.length >= this.lastPlayerCardCounts[i] + totalAwarded) {
                        winnerId = i;
                        break;
                    }
                }
                if (winnerId !== -1) {
                    const visualId = (winnerId - this.localPlayerIndex + 4) % 4;
                    EventBus.emit('pileWon', { winnerId: visualId, reason: data.lastWinReason || 'slap', totalAwarded });
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
        GameState.lastPlayTime = data.lastPlayTime;

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

                // Score increment for human winner
                import('./auth.js').then(({ AuthSystem }) => {
                    if (AuthSystem.currentUser && AuthSystem.currentUser.uid === winnerUid) {
                        const userRef = doc(db, "users", AuthSystem.currentUser.uid);
                        updateDoc(userRef, { score: increment(1) }).catch(e => console.error("Failed to update score", e));
                    }
                });

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

    async pushSlapAttempt({ playerIndex }) {
        if (!this.roomId) return;
        if (this.USE_SERVER_VALIDATION) return this._pushSlapAttemptSecure(playerIndex);
        const roomRef = dbRef(rtdb, `gameRooms/${this.roomId}`);

        try {
            await runTransaction(roomRef, (data) => {
                if (!data || data.gameOver) return;
                if (!data.players || !data.players[playerIndex]) return;

                // If they are already eliminated, they can't slap
                if (data.players[playerIndex].eliminated) return;

                const pile = data.pile || [];
                const burnPile = data.burnPile || [];
                const isValid = this.evaluateSlap(pile);

                const players = [...data.players];
                if (isValid) {
                    const winnerId = playerIndex;
                    const playerCards = players[winnerId].cards || [];
                    playerCards.push(...burnPile, ...pile);

                    players[winnerId].cards = playerCards;

                    // Update streaks (with RENEWAL and ACTIVE SHIELD PERSISTENCE)
                    players.forEach((p, i) => {
                        if (i === winnerId) {
                            if (p.streak >= 3) {
                                p.streak = 3; // Keep shield/renew
                            } else {
                                p.streak = (p.streak || 0) + 1;
                            }
                        } else {
                            if (p.streak < 3) {
                                p.streak = 0;
                            }
                        }
                    });

                    // NEW: Elimination Logic - Mark anyone with 0 cards who didn't win as eliminated
                    players.forEach((p, i) => {
                        if (i !== winnerId && (!p.cards || p.cards.length === 0)) {
                            // If it's a real player or if we want to mark bots as well for UI
                            p.eliminated = true;
                        }
                    });

                    data.players = players;
                    data.pile = [];
                    data.burnPile = [];
                    data.activePlayerId = winnerId;
                    data.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
                    data.lastWinReason = 'slap';

                    // NEW: Persistent Win Condition - End if 1 left OR no HUMANS left
                    const nonEliminated = players.filter(p => !p.eliminated);
                    const humansLeft = nonEliminated.filter(p => !p.uid.startsWith('bot_')).length;

                    if (playerCards.length === 52 || nonEliminated.length <= 1) {
                        data.gameOver = true;
                        data.status = 'finished';
                        // Set explicit winner
                        if (nonEliminated.length === 1) {
                            data.winnerId = players.findIndex(p => !p.eliminated);
                        } else if (playerCards.length === 52) {
                            data.winnerId = winnerId;
                        } else {
                            data.winnerId = -1; // No winner (all humans out)
                        }
                    }

                    // Robust Host Migration: If current host is now eliminated or disconnected, find a new one
                    const currentHost = players.find(p => p.uid === data.hostId);
                    if (!currentHost || currentHost.eliminated || currentHost.status === 'disconnected') {
                        const nextHost = players.find(p => !p.uid.startsWith('bot_') && !p.eliminated && p.status !== 'disconnected');
                        if (nextHost) {
                            data.hostId = nextHost.uid;
                            data.hostUsername = nextHost.name;
                        }
                    }

                } else {
                    const burnerId = playerIndex;
                    const p = players[burnerId];
                    if (p.streak && p.streak >= 3) {
                        p.streak = 0;
                        data.players = players;
                        data.lastShieldShatterId = burnerId;
                        data.lastShieldShatterTime = Date.now();
                    } else if (p.cards && p.cards.length > 0) {
                        const cards = [...p.cards];
                        const burned = cards.shift();
                        const currentBurnPile = [...(data.burnPile || [])];
                        currentBurnPile.push(burned);

                        players[burnerId].cards = cards;
                        p.streak = 0; // Reset streak
                        data.players = players;
                        data.burnPile = currentBurnPile;

                        // If they just burned their last card, handle challenge failure!
                        if (cards.length === 0) {
                            let challenge = data.challenge || { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
                            if (challenge.active && challenge.defenderId === burnerId) {
                                const winnerId = challenge.attackerId;
                                players[winnerId].cards = players[winnerId].cards || [];
                                players[winnerId].cards.push(...currentBurnPile, ...(data.pile || []));

                                players.forEach((px, i) => {
                                    if (i === winnerId) {
                                        px.streak = px.streak || 0;
                                    } else {
                                        if (px.streak < 3) px.streak = 0;
                                    }
                                });

                                players.forEach((px, i) => {
                                    if (i !== winnerId && (!px.cards || px.cards.length === 0)) {
                                        px.eliminated = true;
                                    }
                                });

                                data.pile = [];
                                data.burnPile = [];
                                data.players = players;
                                data.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
                                data.activePlayerId = winnerId;
                                data.lastWinReason = 'challenge';

                                const nonEliminated = players.filter(px => !px.eliminated);
                                if (players[winnerId].cards.length === 52 || nonEliminated.length <= 1) {
                                    data.gameOver = true;
                                    data.status = 'finished';
                                    if (nonEliminated.length === 1) {
                                        data.winnerId = players.findIndex(px => !px.eliminated);
                                    } else {
                                        data.winnerId = winnerId;
                                    }
                                }
                            } else if (data.activePlayerId === burnerId) {
                                let next = (burnerId + 1) % 4;
                                let count = 0;
                                while ((!players[next].cards || players[next].cards.length === 0 || players[next].eliminated) && count < 4) {
                                    next = (next + 1) % 4;
                                    count++;
                                }
                                data.activePlayerId = count < 4 ? next : null;
                                data.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
                            }
                        }
                    } else {
                        // DEAD SLAP: 0 cards and failed slap = ELIMINATED
                        p.eliminated = true;
                        p.streak = 0; // Reset streak
                        data.players = players;

                        // Check if game ends now (no humans left or only 1 total left)
                        const nonEliminated = players.filter(px => !px.eliminated);
                        if (nonEliminated.length <= 1) {
                            data.gameOver = true;
                            data.status = 'finished';
                            if (nonEliminated.length === 1) {
                                data.winnerId = players.findIndex(p => !p.eliminated);
                            } else {
                                data.winnerId = -1;
                            }
                        } else {
                            // If the eliminated player was active, pass turn
                            if (data.activePlayerId === burnerId) {
                                let next = (burnerId + 1) % 4;
                                let count = 0;
                                while ((!players[next].cards || players[next].cards.length === 0 || players[next].eliminated) && count < 4) {
                                    next = (next + 1) % 4;
                                    count++;
                                }
                                data.activePlayerId = count < 4 ? next : null;
                                data.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
                            }
                        }

                        // NEW: Host Migration if Host was Dead-Slap Eliminated
                        const currentHost = players.find(px => px.uid === data.hostId);
                        if (!currentHost || currentHost.eliminated || currentHost.status === 'disconnected') {
                            const nextHost = players.find(px => !px.uid.startsWith('bot_') && !px.eliminated && px.status !== 'disconnected');
                            if (nextHost) {
                                data.hostId = nextHost.uid;
                                data.hostUsername = nextHost.name;
                            }
                        }
                    }
                }
                return data;
            });
        } catch (error) {
            console.error("Slap transaction failed:", error);
        }
    },

    async pushPlayCard({ playerIndex }) {
        if (!this.roomId) return;
        if (this.USE_SERVER_VALIDATION) return this._pushPlayCardSecure(playerIndex);
        const roomRef = dbRef(rtdb, `gameRooms/${this.roomId}`);

        try {
            await runTransaction(roomRef, (data) => {
                if (!data || data.gameOver || !data.gameStarted) return;
                if (!data.players || !data.players[playerIndex]) return;
                if (data.activePlayerId !== playerIndex) return data;
                if (data.players[playerIndex].eliminated) return data;

                const players = [...data.players];
                let challenge = data.challenge || { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
                if (!players[playerIndex].cards || players[playerIndex].cards.length === 0) {
                    // Defender has 0 cards and it's their turn to play in a challenge -> Attacker wins!
                    if (challenge.active && challenge.defenderId === playerIndex) {
                        const winnerId = challenge.attackerId;
                        const currentBurnPile = data.burnPile || [];
                        const pile = data.pile || [];
                        players[winnerId].cards = players[winnerId].cards || [];
                        players[winnerId].cards.push(...currentBurnPile, ...pile);

                        players.forEach((p, i) => {
                            if (i === winnerId) {
                                p.streak = p.streak || 0;
                            } else {
                                if (p.streak < 3) p.streak = 0;
                            }
                        });

                        players.forEach((p, i) => {
                            if (i !== winnerId && (!p.cards || p.cards.length === 0)) {
                                p.eliminated = true;
                            }
                        });

                        data.pile = [];
                        data.burnPile = [];
                        data.players = players;
                        data.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
                        data.activePlayerId = winnerId;
                        data.lastWinReason = 'challenge';

                        const nonEliminated = players.filter(p => !p.eliminated);
                        if (players[winnerId].cards.length === 52 || nonEliminated.length <= 1) {
                            data.gameOver = true;
                            data.status = 'finished';
                            if (nonEliminated.length === 1) {
                                data.winnerId = players.findIndex(p => !p.eliminated);
                            } else {
                                data.winnerId = winnerId;
                            }
                        }
                    }
                    return data;
                }

                const pile = data.pile || [];
                const card = players[playerIndex].cards.shift();
                pile.push(card);



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
                            const winnerId = challenge.attackerId;
                            const currentBurnPile = data.burnPile || [];
                            players[winnerId].cards.push(...currentBurnPile, ...pile);

                            // Update streaks for challenge win (kept as is for winner, kept if streak >= 3 for others, reset otherwise)
                            players.forEach((p, i) => {
                                if (i === winnerId) {
                                    p.streak = p.streak || 0;
                                } else {
                                    if (p.streak < 3) {
                                        p.streak = 0;
                                    }
                                }
                            });

                            // NEW: Elimination Logic
                            players.forEach((p, i) => {
                                if (i !== winnerId && (!p.cards || p.cards.length === 0)) {
                                    p.eliminated = true;
                                }
                            });

                            data.pile = [];
                            data.burnPile = [];
                            data.players = players;
                            data.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
                            data.activePlayerId = winnerId;
                            data.lastWinReason = 'challenge';

                            // NEW: Persistent Win Condition
                            const nonEliminated = players.filter(p => !p.eliminated);

                            if (players[winnerId].cards.length === 52 || nonEliminated.length <= 1) {
                                data.gameOver = true;
                                data.status = 'finished';
                                if (nonEliminated.length === 1) {
                                    data.winnerId = players.findIndex(p => !p.eliminated);
                                } else if (players[winnerId].cards.length === 52) {
                                    data.winnerId = winnerId;
                                } else {
                                    data.winnerId = -1;
                                }
                            }

                            // Robust Host Migration
                            const currentHost = players.find(p => p.uid === data.hostId);
                            if (!currentHost || currentHost.eliminated || currentHost.status === 'disconnected') {
                                const nextHost = players.find(p => !p.uid.startsWith('bot_') && !p.eliminated && p.status !== 'disconnected');
                                if (nextHost) {
                                    data.hostId = nextHost.uid;
                                    data.hostUsername = nextHost.name;
                                }
                            }

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
                data.lastPlayTime = Date.now();
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
                        await updateDoc(tableRef, { players: newPlayers });
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
                if (data.activePlayerId !== playerIndex) return data;
                if (data.players[playerIndex].eliminated) return data;

                const players = [...data.players];
                const p = players[playerIndex];
                if (!p.cards || p.cards.length === 0) return data;

                const cards = [...p.cards];
                const burned = cards.shift();
                const currentBurnPile = [...(data.burnPile || [])];
                currentBurnPile.push(burned);

                players[playerIndex].cards = cards;
                data.players = players;
                data.burnPile = currentBurnPile;
                data.lastBurnReason = 'timeout'; 

                let challenge = data.challenge || { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };

                if (challenge.active) {
                    const winnerId = challenge.attackerId;
                    const pile = data.pile || [];
                    players[winnerId].cards.push(...currentBurnPile, ...pile);

                    // Update streaks for challenge win on timeout (kept as is for winner, kept if streak >= 3 for others, reset otherwise)
                    players.forEach((px, i) => {
                        if (i === winnerId) {
                            px.streak = px.streak || 0;
                        } else {
                            if (px.streak < 3) {
                                px.streak = 0;
                            }
                        }
                    });

                    data.pile = [];
                    data.burnPile = [];
                    data.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
                    data.activePlayerId = winnerId;
                    data.lastWinReason = 'challenge';
                    
                    players.forEach((px, i) => {
                        if (i !== winnerId && (!px.cards || px.cards.length === 0)) {
                            px.eliminated = true;
                        }
                    });
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

                data.lastPlayTime = Date.now();
                return data;
            });
        } catch (error) {
            console.error("Timeout transaction failed:", error);
        }
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

                if (!this.dbShieldDecayTimers[dbIndex] || justWonSlap) {
                    if (this.dbShieldDecayTimers[dbIndex]) {
                        clearTimeout(this.dbShieldDecayTimers[dbIndex]);
                    }
                    this.dbShieldDecayTimers[dbIndex] = setTimeout(() => {
                        this.expireDbShield(dbIndex);
                    }, 30000);
                }
            } else {
                if (this.dbShieldDecayTimers[dbIndex]) {
                    clearTimeout(this.dbShieldDecayTimers[dbIndex]);
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

        // Check authoritative role:
        // 1. If it is the local player themselves
        // 2. If it is a bot and the local player is the host
        const isSelf = (dbIndex === this.localPlayerIndex);
        const isBot = targetPlayer.uid && targetPlayer.uid.startsWith('bot_');
        const isHost = this.roomData.hostId && window.AuthSystem && window.AuthSystem.currentUser && (window.AuthSystem.currentUser.uid === this.roomData.hostId);

        if (isSelf || (isBot && isHost)) {
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
