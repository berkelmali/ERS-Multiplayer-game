import { GameState } from './game.js';
import { FirebaseSync } from './firebaseSync.js?v=6';
import { Localization } from './localization.js';
import { getRankName, getSuitSymbol } from './game.js';
import { BotConfig } from './ai.js';

const FACE_CHANCES = { 11: 1, 12: 2, 13: 3, 14: 4 };

export const MultiplayerMode = {
    localPlayerIndex: 0,
    roomId: null,
    botTimeouts: {},
    botSlapTimeouts: {},
    syncListener: null,

    start(roomId, playerIndex) {
        console.log(`Starting Multiplayer Game - Room: ${roomId}, Index: ${playerIndex}`);
        this.roomId = roomId;
        this.localPlayerIndex = playerIndex;

        GameState.gameStarted = true;
        GameState.gameOver = false;

        const logEl = document.getElementById('action-log');
        if (logEl) logEl.innerHTML = '';

        this.syncListener = (data) => {
            this.checkBotTurn(data);
            this.checkBotSlaps(data);
        };
        import('./eventbus.js').then(module => {
            module.default.on('gameSynced', this.syncListener);
        });

        FirebaseSync.listenToRoom(roomId, playerIndex);
    },

    quit() {
        FirebaseSync.stopListening();
        this.roomId = null;
        Object.values(this.botTimeouts).forEach(clearTimeout);
        Object.values(this.botSlapTimeouts).forEach(clearTimeout);
        this.botTimeouts = {};
        this.botSlapTimeouts = {};
        if (this.syncListener) {
            import('./eventbus.js').then(module => {
                module.default.off('gameSynced', this.syncListener);
            });
            this.syncListener = null;
        }
    },

    playCard(visualPlayerId) {
        if (!GameState.gameStarted || GameState.gameOver) return;
        if (visualPlayerId !== GameState.activePlayerId) return;

        // Handle Bot Turns (Only Host can play for Bots)
        if (visualPlayerId !== 0) {
            const actualPlayerId = this.toActual(visualPlayerId);
            const playerObj = FirebaseSync.roomData.players[actualPlayerId];
            const isBot = playerObj && playerObj.uid.startsWith('bot_');

            import('./auth.js').then(auth => {
                const amIHost = FirebaseSync.roomData.players[0].uid === auth.AuthSystem.currentUser.uid;
                if (isBot && amIHost) {
                    this.executePlay(visualPlayerId);
                }
            });
            return;
        }

        this.executePlay(visualPlayerId);
    },

    executePlay(visualPlayerId) {
        if (GameState.players[visualPlayerId].length === 0) {
            // Pass turn if no cards
            const nextVisual = this.getNextVisualPlayer(visualPlayerId);
            if (nextVisual !== null) {
                const actualNext = this.toActual(nextVisual);
                FirebaseSync.pushUpdate({ activePlayerId: actualNext });
            }
            return;
        }

        const data = FirebaseSync.roomData;
        const actualPlayerId = this.toActual(visualPlayerId);

        // Deep copy from room data to manipulate
        const newPlayersCards = [[], [], [], []];
        data.players.forEach((p, i) => { newPlayersCards[i] = [...p.cards]; });
        const newPile = [...data.pile];
        const newChallenge = { ...data.challenge };

        const card = newPlayersCards[actualPlayerId].shift();
        newPile.push(card);
        const nextTime = Date.now();

        const isFaceCard = card.rank >= 11;
        let nextActiveId = actualPlayerId;

        if (newChallenge.active) {
            if (isFaceCard) {
                newChallenge.attackerId = actualPlayerId;
                const nextVisual = this.getNextVisualPlayer(visualPlayerId);
                newChallenge.defenderId = this.toActual(nextVisual);
                newChallenge.chancesLeft = FACE_CHANCES[card.rank];
                nextActiveId = newChallenge.defenderId;
            } else {
                newChallenge.chancesLeft--;
                if (newChallenge.chancesLeft <= 0) {
                    // Attacker wins
                    this.winPile(newChallenge.attackerId, newPlayersCards, newPile, newChallenge);
                    return; // winPile does the push
                } else {
                    nextActiveId = actualPlayerId; // Same defender
                }
            }
        } else {
            if (isFaceCard) {
                newChallenge.active = true;
                newChallenge.attackerId = actualPlayerId;
                const nextVisual = this.getNextVisualPlayer(visualPlayerId);
                newChallenge.defenderId = this.toActual(nextVisual);
                newChallenge.chancesLeft = FACE_CHANCES[card.rank];
                nextActiveId = newChallenge.defenderId;
            } else {
                const nextVisual = this.getNextVisualPlayer(visualPlayerId);
                nextActiveId = this.toActual(nextVisual);
            }
        }

        const updatedPlayers = [...data.players];
        updatedPlayers[actualPlayerId] = { ...updatedPlayers[actualPlayerId], cards: newPlayersCards[actualPlayerId] };

        FirebaseSync.pushUpdate({
            pile: newPile,
            players: updatedPlayers,
            activePlayerId: nextActiveId,
            challenge: newChallenge,
            lastPlayTime: nextTime
        }).catch(err => {
            console.error("Play Card Error:", err);
            import('./ui.js').then(ui => ui.UIManager.showNotification("Failed to play: " + err.message, "var(--error)"));
        });
    },

    slap(visualPlayerId) {
        if (!GameState.gameStarted || GameState.gameOver) return;
        if (visualPlayerId !== 0) return; // You can only slap for yourself

        // Anti-Spam Protection
        if (this.lastSlapTime && Date.now() - this.lastSlapTime < 400) {
            return;
        }
        this.lastSlapTime = Date.now();

        const actualId = this.toActual(visualPlayerId);
        // Push a slap event to the subcollection
        import('./firebaseSync.js').then(sync => {
            sync.FirebaseSync.pushSlapAttempt({
                playerIndex: actualId
            });
        });
    },

    winPile(winnerActualId, newPlayersCards, newPile, newChallenge) {
        newPlayersCards[winnerActualId].push(...newPile);
        newPile = [];
        newChallenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
        const nextActiveId = winnerActualId;

        const updatedPlayers = [...FirebaseSync.roomData.players];
        updatedPlayers[winnerActualId] = { ...updatedPlayers[winnerActualId], cards: newPlayersCards[winnerActualId] };

        const pushData = {
            pile: newPile,
            players: updatedPlayers,
            activePlayerId: nextActiveId,
            challenge: newChallenge
        };

        if (newPlayersCards[winnerActualId].length === 52) {
            pushData.gameOver = true;
        }

        FirebaseSync.pushUpdate(pushData);
    },

    getNextVisualPlayer(id) {
        let next = (id + 1) % 4;
        let count = 0;
        while (GameState.players[next].length === 0 && count < 4) {
            next = (next + 1) % 4;
            count++;
        }
        if (count >= 4) return null; // GameOver should trigger
        return next;
    },

    toActual(visualIndex) {
        return (visualIndex + this.localPlayerIndex) % 4;
    },

    checkBotTurn(data) {
        if (!data || !data.players || !data.players[0]) return;
        import('./auth.js').then(auth => {
            const realPlayers = data.players.filter(p => !p.uid.startsWith('bot_'));
            const amIHost = realPlayers.length > 0 && realPlayers[0].uid === auth.AuthSystem.currentUser.uid;
            if (!amIHost || !data.gameStarted || data.gameOver) return;

            const activeActual = data.activePlayerId;
            const playerObj = data.players[activeActual];

            if (playerObj && playerObj.uid.startsWith('bot_')) {
                const visualId = (activeActual - this.localPlayerIndex + 4) % 4;
                if (this.botTimeouts[visualId]) clearTimeout(this.botTimeouts[visualId]);

                // Hardcoded Competitive AI (Between Medium 900 and Hard 600)
                const delay = 750 + Math.random() * 250;

                this.botTimeouts[visualId] = setTimeout(() => {
                    if (FirebaseSync.roomData.activePlayerId === activeActual) {
                        this.playCard(visualId);
                    }
                }, delay);
            }
        });
    },

    checkBotSlaps(data) {
        if (!data || !data.players || !data.players[0]) return;
        import('./auth.js').then(auth => {
            const realPlayers = data.players.filter(p => !p.uid.startsWith('bot_'));
            const amIHost = realPlayers.length > 0 && realPlayers[0].uid === auth.AuthSystem.currentUser.uid;
            if (!amIHost || !data.gameStarted || data.gameOver) return;

            const validSlap = FirebaseSync.evaluateSlap(data.pile);

            data.players.forEach((p, idx) => {
                if (p.uid.startsWith('bot_')) {
                    const visualId = (idx - this.localPlayerIndex + 4) % 4;
                    if (this.botSlapTimeouts[visualId]) clearTimeout(this.botSlapTimeouts[visualId]);

                    const config = BotConfig.challenger;

                    if (validSlap) {
                        // Challenger AI Slap Check
                        if (Math.random() < config.accuracy) {
                            const delay = config.minReaction + (Math.random() * (config.maxReaction - config.minReaction));
                            this.botSlapTimeouts[visualId] = setTimeout(async () => {
                                if (FirebaseSync.evaluateSlap(FirebaseSync.roomData.pile)) {
                                    const syncMod = await import('./firebaseSync.js');
                                    syncMod.FirebaseSync.pushSlapAttempt({ playerIndex: idx });
                                }
                            }, delay);
                        }
                    } else if (data.pile.length > 0) {
                        // False Slap Probability Override
                        if (Math.random() < config.falseSlap && data.players[idx].cards.length > 0) {
                            const falseDelay = config.minReaction + (Math.random() * (config.maxReaction - config.minReaction)) + 200;
                            this.botSlapTimeouts[visualId] = setTimeout(async () => {
                                const syncMod = await import('./firebaseSync.js');
                                syncMod.FirebaseSync.pushSlapAttempt({ playerIndex: idx });
                            }, falseDelay);
                        }
                    }
                }
            });
        });
    },

    getVisualNames() {
        const data = FirebaseSync.roomData;
        if (!data || !data.players) return ["YOU", "Bot 1", "Bot 2", "Bot 3"];

        const names = [];
        for (let visual = 0; visual < 4; visual++) {
            const actual = this.toActual(visual);
            names.push(data.players[actual] ? data.players[actual].name : `Bot ${visual}`);
        }
        return names;
    }
};

window.addEventListener('beforeunload', () => {
    if (MultiplayerMode.roomId) {
        FirebaseSync.abandonRoom();
    }
});
