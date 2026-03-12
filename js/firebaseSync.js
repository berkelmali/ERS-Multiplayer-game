import { getFirestore, doc, collection, onSnapshot, updateDoc, arrayUnion, serverTimestamp, runTransaction, query, orderBy, getDocs, deleteDoc, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import { GameState } from "./game.js";
import EventBus from "./eventbus.js";

const db = getFirestore(app);

export const FirebaseSync = {
    unsubRoom: null,
    unsubSlaps: null,
    roomId: null,
    localPlayerIndex: -1,
    roomData: null,

    // State trackers for synthesizing local event logs
    lastPileLength: 0,
    lastPlayerCardCounts: [],

    listenToRoom(roomId, playerIndex) {
        this.roomId = roomId;
        this.localPlayerIndex = playerIndex;
        const roomRef = doc(db, "gameRooms", roomId);

        this.unsubRoom = onSnapshot(roomRef, (snap) => {
            if (!snap.exists()) {
                // Room was deleted by the host (game cleanup)
                GameState.gameOver = true;
                GameState.gameStarted = false;
                EventBus.emit('gameAbandoned', null); // Reuse the abandoned UI to show they were kicked
                import('./ui.js').then(ui => ui.UIManager.showNotification("Game finished. Returning to menu.", "var(--primary)"));
                return;
            }

            const data = snap.data();
            if (!data) return;

            this.roomData = data;
            this.syncToLocal(data);
        });

        // Host listens to Slap Attempts subcollection to resolve them transactionally
        if (this.localPlayerIndex === 0) {
            const slapsRef = collection(db, "gameRooms", roomId, "slapAttempts");
            const slapsQuery = query(slapsRef, orderBy("time", "asc"));
            this.unsubSlaps = onSnapshot(slapsQuery, (snap) => {
                if (!snap.empty) {
                    this.resolveSlapsTransactionally(snap.docs);
                }
            });
        }
    },

    syncToLocal(data) {
        // Delta calculation for UI events (Action Log / Sounds)
        if (this.lastPlayerCardCounts.length > 0) {
            const currentPileLength = data.pile ? data.pile.length : 0;
            const pileGrew = currentPileLength === this.lastPileLength + 1;
            const pileCleared = currentPileLength === 0 && this.lastPileLength > 0;
            const pileMaintained = currentPileLength === this.lastPileLength;

            if (pileGrew) {
                // Either someone played a card, or someone burned a card.
                // If the top changed, it's a play. If the bottom changed, it's a burn.
                // Simplest check: Did activePlayerId change OR did someone's count drop by 1?
                let actorId = -1;
                for (let i = 0; i < 4; i++) {
                    if (data.players[i].cards.length === this.lastPlayerCardCounts[i] - 1) {
                        actorId = i;
                        break;
                    }
                }
                if (actorId !== -1) {
                    const visualId = (actorId - this.localPlayerIndex + 4) % 4;
                    // Check if it's a play or burn by looking at activePlayerId
                    if (data.activePlayerId !== actorId && !data.challenge?.active && data.pile.length > 1) {
                        // Rough heuristic for burn: pile grew, but it wasn't a standard turn
                        EventBus.emit('invalidSlap', { playerId: visualId, burned: data.pile[0] });
                    } else {
                        // Play
                        const newCard = data.pile[data.pile.length - 1];
                        EventBus.emit('cardPlayed', { playerId: visualId, card: newCard });
                    }
                }
            } else if (pileCleared) {
                // Someone won the pile
                let winnerId = -1;
                for (let i = 0; i < 4; i++) {
                    // Winner's cards increase by at least the pile size
                    if (data.players[i].cards.length >= this.lastPlayerCardCounts[i] + this.lastPileLength) {
                        winnerId = i;
                        break;
                    }
                }
                if (winnerId !== -1) {
                    const visualId = (winnerId - this.localPlayerIndex + 4) % 4;
                    EventBus.emit('pileWon', { winnerId: visualId, reason: 'slap' });
                }
            }
        }

        // Sync players - Rotate so local player is always index 0 (bottom)
        GameState.players = [[], [], [], []];
        data.players.forEach((p, i) => {
            const visualIndex = (i - this.localPlayerIndex + 4) % 4;
            GameState.players[visualIndex] = p.cards || [];
        });

        GameState.pile = data.pile || [];
        GameState.activePlayerId = (data.activePlayerId - this.localPlayerIndex + 4) % 4;

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
        GameState.gameStarted = data.gameStarted;
        GameState.gameOver = data.gameOver;
        GameState.lastPlayTime = data.lastPlayTime;

        if (!previouslyOver && data.gameOver) {
            const winnerActualId = (data.players || []).findIndex(p => p.cards && p.cards.length === 52);
            if (winnerActualId !== -1) {
                const winnerUid = data.players[winnerActualId].uid;

                // If I am the winner and it's a real player account, increment score
                import('./auth.js').then(({ AuthSystem }) => {
                    if (AuthSystem.currentUser && AuthSystem.currentUser.uid === winnerUid) {
                        const userRef = doc(db, "users", AuthSystem.currentUser.uid);
                        updateDoc(userRef, { score: increment(1) }).catch(e => console.error("Failed to update score", e));
                    }
                });

                EventBus.emit('gameOver', (winnerActualId - this.localPlayerIndex + 4) % 4);

                // If I am the host, schedule room deletion
                if (this.localPlayerIndex === 0 && data.status === 'finished') {
                    setTimeout(async () => {
                        try {
                            // Extract tableId from roomId (format: "room_{tableId}_{timestamp}")
                            const parts = this.roomId.split('_');
                            if (parts.length >= 2) {
                                const tableId = parts[1];
                                await deleteDoc(doc(db, "multiplayer_tables", tableId));
                            }
                            await deleteDoc(doc(db, "gameRooms", this.roomId));
                            console.log("Room cleaned up successfully.");
                        } catch (e) {
                            console.error("Cleanup failed:", e);
                        }
                    }, 5000);
                }
            }
        }

        // Update trackers for next delta
        this.lastPileLength = data.pile ? data.pile.length : 0;
        this.lastPlayerCardCounts = data.players.map(p => p.cards ? p.cards.length : 0);

        EventBus.emit('gameSynced', data);
    },

    stopListening() {
        if (this.unsubRoom) {
            this.unsubRoom();
            this.unsubRoom = null;
        }
        if (this.unsubSlaps) {
            this.unsubSlaps();
            this.unsubSlaps = null;
        }
    },

    async pushUpdate(updates) {
        if (!this.roomId) return;
        const roomRef = doc(db, "gameRooms", this.roomId);
        await updateDoc(roomRef, updates);
    },

    async abandonRoom() {
        if (!this.roomId || !this.roomData || !this.roomData.players) return;
        const roomRef = doc(db, "gameRooms", this.roomId);
        try {
            const newPlayers = [...this.roomData.players];
            if (newPlayers[this.localPlayerIndex]) {
                newPlayers[this.localPlayerIndex] = {
                    ...newPlayers[this.localPlayerIndex],
                    uid: `bot_${this.localPlayerIndex}`,
                    name: `Bot ${this.localPlayerIndex}`
                };
                await updateDoc(roomRef, {
                    players: newPlayers
                });
            }
        } catch (e) {
            console.error("Failed to abandon room on disconnect", e);
        }
    },

    async pushSlapAttempt(eventData) {
        if (!this.roomId) return;
        const slapsRef = collection(db, "gameRooms", this.roomId, "slapAttempts");
        // We use an auto-generated ID for the attempt document
        const attemptRef = doc(slapsRef);
        await updateDoc(attemptRef, {
            playerIndex: eventData.playerIndex,
            time: serverTimestamp()
        }, { merge: true }).catch(e => {
            // If updateDoc on a new doc fails or we prefer setDoc for creation:
            import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js").then(fs => {
                fs.setDoc(attemptRef, {
                    playerIndex: eventData.playerIndex,
                    time: fs.serverTimestamp()
                });
            });
        });
    },

    async resolveSlapsTransactionally(slapDocs) {
        if (!this.roomId) return;

        // Grab the very first slap that reached the server
        const firstSlapDoc = slapDocs[0];
        const firstSlapData = firstSlapDoc.data();
        if (!firstSlapData.time) return; // Wait until server timestamp resolves

        const roomRef = doc(db, "gameRooms", this.roomId);

        try {
            await runTransaction(db, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (!roomSnap.exists()) return;

                const data = roomSnap.data();

                // Read the queue again inside the transaction to ensure we are operating on the right pile state
                // However, subcollections are tricky in transactions if we want to delete them all.
                // Instead, we trust `data.pile` as the source of truth for the transaction condition.

                const isValid = this.evaluateSlap(data.pile);

                if (isValid) {
                    // Winner gets pile
                    const winnerId = firstSlapData.playerIndex;
                    const winnerCards = [...data.players[winnerId].cards, ...data.pile];

                    const playersUpdate = [...data.players];
                    playersUpdate[winnerId] = { ...playersUpdate[winnerId], cards: winnerCards };

                    const isGameOver = winnerCards.length === 52;
                    transaction.update(roomRef, {
                        players: playersUpdate,
                        pile: [],
                        challenge: { active: false, attackerId: null, defenderId: null, chancesLeft: 0 },
                        activePlayerId: winnerId,
                        gameOver: isGameOver ? true : data.gameOver,
                        status: isGameOver ? "finished" : data.status,
                        winnerId: isGameOver ? data.players[winnerId].uid : (data.winnerId || null)
                    });
                } else {
                    // Burn card for firstSlap player
                    const burnerId = firstSlapData.playerIndex;
                    if (data.players[burnerId].cards.length > 0) {
                        const playersUpdate = [...data.players];
                        const burnerCards = [...playersUpdate[burnerId].cards];
                        const burned = burnerCards.shift();
                        playersUpdate[burnerId] = { ...playersUpdate[burnerId], cards: burnerCards };

                        transaction.update(roomRef, {
                            players: playersUpdate,
                            pile: [burned, ...data.pile] // Add to bottom
                        });
                    }
                }
            });

            // Cleanup the processed attempt and any concurrent ones that were pending
            for (const docSnap of slapDocs) {
                await deleteDoc(docSnap.ref);
            }

        } catch (e) {
            console.error("Transaction failed: ", e);
        }
    },

    evaluateSlap(pile) {
        if (!pile || pile.length < 2) return false;
        const top = pile[pile.length - 1];
        const prev = pile[pile.length - 2];
        if (top.rank === prev.rank) return true;
        if (top.rank <= 10 && prev.rank <= 10 && top.rank + prev.rank === 10) return true;
        if ((top.rank === 12 && prev.rank === 13) || (top.rank === 13 && prev.rank === 12)) return true;
        if (pile.length >= 3) {
            const prev2 = pile[pile.length - 3];
            if (top.rank === prev2.rank) return true;
        }
        return false;
    }
};
