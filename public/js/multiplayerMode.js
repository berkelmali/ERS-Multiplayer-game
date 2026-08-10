import { GameState } from './game.js';
import { FirebaseSync } from './firebaseSync.js?v=7';
import { Localization } from './localization.js';
import { getRankName, getSuitSymbol } from './game.js';
import { BotConfig } from './ai.js';
import { Settings } from './settings.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { functions } from "./firebaseConfig.js";


export const MultiplayerMode = {
    localPlayerIndex: 0,
    roomId: null,
    botTimeouts: {},
    botSlapTimeouts: {},
    conversionTimeouts: {},
    syncListener: null,

    start(roomId, playerIndex) {
        console.log(`Starting Multiplayer Game - Room: ${roomId}, Index: ${playerIndex}`);
        this.roomId = roomId;
        this.localPlayerIndex = playerIndex;

        GameState.gameStarted = true;
        GameState.gameOver = false;
        GameState.isMultiplayer = true;
        this.eliminationShown = false;
        
        GameState.stats = {
            bestReflex: 9999,
            cardsWon: 0,
            burns: 0,
            resurrections: 0
        };
        this.localSlapReaction = null;

        const logEl = document.getElementById('action-log');
        if (logEl) logEl.innerHTML = '';

        this.syncListener = (data) => {
            this.checkBotTurn(data);
            this.checkBotSlaps(data);
            this.checkPlayerDisconnections(data);
            this.checkElimination(data);
            this.checkGlobalDefeat(data);
            this.checkTurnTimeouts(data);
            
            // Force refresh nameplates if needed (status changes)
            import('./ui.js').then(module => {
                module.UIManager.updateAll(false);
            });
        };

        this.gameOverListener = () => {
            console.log("[MultiplayerMode] Game over received. Cleaning up bot timeouts.");
            Object.values(this.botTimeouts).forEach(clearTimeout);
            Object.values(this.botSlapTimeouts).forEach(clearTimeout);
            this.botTimeouts = {};
            this.botSlapTimeouts = {};
        };

        this.pileWonStatListener = ({ winnerId, reason, totalAwarded }) => {
            if (winnerId === 0 && GameState.stats) {
                if (totalAwarded) {
                    GameState.stats.cardsWon += totalAwarded;
                }
                if (reason === 'slap' && this.localSlapReaction) {
                    if (this.localSlapReaction < GameState.stats.bestReflex) {
                        GameState.stats.bestReflex = this.localSlapReaction;
                    }
                    this.localSlapReaction = null;
                }
            }
        };

        this.invalidSlapStatListener = ({ playerId }) => {
            if (playerId === 0 && GameState.stats) {
                GameState.stats.burns++;
            }
        };

        this.resurrectedStatListener = (playerId) => {
            if (playerId === 0 && GameState.stats) {
                GameState.stats.resurrections++;
            }
        };

        import('./eventbus.js').then(module => {
            module.default.on('gameSynced', this.syncListener);
            module.default.on('invalidSlap', this.emojiBurnHandler);
            module.default.on('pileWon', this.emojiWinHandler);
            module.default.on('gameOver', this.gameOverListener);
            module.default.on('pileWon', this.pileWonStatListener);
            module.default.on('invalidSlap', this.invalidSlapStatListener);
            module.default.on('resurrected', this.resurrectedStatListener);
        });

        FirebaseSync.listenToRoom(roomId, playerIndex);
    },

    quit() {
        if (this.roomId) {
            FirebaseSync.abandonRoom();
        }
        FirebaseSync.stopListening();
        this.roomId = null;
        Object.values(this.botTimeouts).forEach(clearTimeout);
        Object.values(this.botSlapTimeouts).forEach(clearTimeout);
        this.botTimeouts = {};
        this.botSlapTimeouts = {};
        Object.values(this.conversionTimeouts).forEach(clearTimeout);
        this.conversionTimeouts = {};
        if (this.syncListener) {
            import('./eventbus.js').then(module => {
                module.default.off('gameSynced', this.syncListener);
                module.default.off('invalidSlap', this.emojiBurnHandler);
                module.default.off('pileWon', this.emojiWinHandler);
                if (this.gameOverListener) module.default.off('gameOver', this.gameOverListener);
                module.default.off('pileWon', this.pileWonStatListener);
                module.default.off('invalidSlap', this.invalidSlapStatListener);
                module.default.off('resurrected', this.resurrectedStatListener);
            });
            this.syncListener = null;
            this.gameOverListener = null;
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
                const amIHost = FirebaseSync.roomData.hostId === auth.AuthSystem.currentUser.uid;
                if (isBot && amIHost) {
                    this.executePlay(visualPlayerId);
                }
            });
            return;
        }

        this.executePlay(visualPlayerId);
    },

    async executePlay(visualPlayerId) {
        if (GameState.gameOver || !GameState.gameStarted) return;
        if (GameState.activePlayerId !== visualPlayerId) return;

        try {
            const actualPlayerId = this.toActual(visualPlayerId);
            await FirebaseSync.pushPlayCard({ playerIndex: actualPlayerId });
        } catch (error) {
            console.error("Play Card Error:", error);
            import('./ui.js').then(ui => ui.UIManager.showNotification("Failed to play: " + error.message, "var(--error)"));
        }
    },



    slap(visualPlayerId) {
        if (!GameState.gameStarted || GameState.gameOver) return;
        if (visualPlayerId !== 0) return; // You can only slap for yourself

        // Anti-Spam Protection
        if (this.lastSlapTime && Date.now() - this.lastSlapTime < 150) {
            return;
        }
        this.lastSlapTime = Date.now();
        this.localSlapReaction = Date.now() - GameState.lastPlayTime;

        const actualId = this.toActual(visualPlayerId);
        // Push a slap event via RTDB Transaction (Secure and Free)
        FirebaseSync.pushSlapAttempt({
            playerIndex: actualId
        });
    },

    sendEmoji(emojiStr) {
        if (!GameState.gameStarted || GameState.gameOver) return;
        FirebaseSync.pushEmoji(emojiStr);
    },

    emojiBurnHandler: ({ playerId }) => {
        // Random chance for a bot to act sad
        import('./auth.js').then(auth => {
            if (FirebaseSync.roomData?.hostId === auth.AuthSystem.currentUser?.uid) {
                const actual = MultiplayerMode.toActual(playerId);
                const p = FirebaseSync.roomData.players[actual];
                if (p && p.uid.startsWith('bot_') && Math.random() < 0.15) {
                    setTimeout(() => FirebaseSync.pushBotEmoji(actual, '😭'), 400 + Math.random() * 500);
                }
            }
        });
    },

    emojiWinHandler: ({ winnerId, reason }) => {
        import('./auth.js').then(auth => {
            if (FirebaseSync.roomData?.hostId === auth.AuthSystem.currentUser?.uid) {
                const actual = MultiplayerMode.toActual(winnerId);
                const p = FirebaseSync.roomData.players[actual];
                if (p && p.uid.startsWith('bot_')) {
                    if (reason === 'challenge' && Math.random() < 0.15) {
                        setTimeout(() => FirebaseSync.pushBotEmoji(actual, '🔥'), 500 + Math.random() * 500);
                    } else if (reason === 'slap' && Math.random() < 0.1) {
                        setTimeout(() => FirebaseSync.pushBotEmoji(actual, '👏'), 300 + Math.random() * 500);
                    }
                }
            }
        });
    },

    toActual(visualIndex) {
        return (visualIndex + this.localPlayerIndex) % 4;
    },

    checkBotTurn(data) {
        if (!data || !data.players || !data.players[0]) return;
        import('./auth.js').then(auth => {
            const amIHost = data.hostId === auth.AuthSystem.currentUser.uid;
            if (!amIHost || !data.gameStarted || data.gameOver) return;

            const activeActual = data.activePlayerId;
            const playerObj = data.players[activeActual];

            if (playerObj && playerObj.uid.startsWith('bot_') && !playerObj.eliminated) {
                const visualId = (activeActual - this.localPlayerIndex + 4) % 4;
                if (this.botTimeouts[visualId]) clearTimeout(this.botTimeouts[visualId]);

                // Use playDelay + playVariance for card-play timing (NOT minReaction which is for slaps)
                const diffConfig = BotConfig.challenger;
                const delay = diffConfig.playDelay + Math.random() * diffConfig.playVariance;
                const scheduledTime = Date.now();

                this.botTimeouts[visualId] = setTimeout(() => {
                    const drift = Date.now() - scheduledTime - delay;
                    if (drift > 2000) {
                        // Tab was frozen, re-evaluate natively from current firebase state
                        this.checkBotTurn(FirebaseSync.roomData);
                        return;
                    }
                    
                    if (FirebaseSync.roomData.activePlayerId === activeActual) {
                        this.playCard(visualId);
                    }
                }, delay);
            }
        });
    },

    checkBotSlaps(data) {
        if (!data || !data.pile || data.pile.length === 0) return;
        import('./auth.js').then(auth => {
            const amIHost = data.hostId === auth.AuthSystem.currentUser.uid;
            if (!amIHost || !data.gameStarted || data.gameOver) return;

            const validSlap = FirebaseSync.evaluateSlap(data.pile);

            data.players.forEach((p, idx) => {
                if (p.uid.startsWith('bot_') && !p.eliminated) {
                    const visualId = (idx - this.localPlayerIndex + 4) % 4;
                    if (this.botSlapTimeouts[visualId]) clearTimeout(this.botSlapTimeouts[visualId]);

                    const config = BotConfig.challenger;

                    if (validSlap) {
                        // Challenger AI Slap Check
                        if (Math.random() < config.accuracy) {
                            const delay = config.minReaction + (Math.random() * (config.maxReaction - config.minReaction));
                            const scheduledTime = Date.now();
                            this.botSlapTimeouts[visualId] = setTimeout(async () => {
                                const drift = Date.now() - scheduledTime - delay;
                                if (drift > 2000) return; // Stale suspension slap
                                
                                if (FirebaseSync.evaluateSlap(FirebaseSync.roomData.pile)) {
                                    FirebaseSync.pushSlapAttempt({ playerIndex: idx });
                                }
                            }, delay);
                        }
                    } else if (data.pile.length > 0) {
                        // False Slap Probability Override
                        if (Math.random() < config.falseSlap && data.players[idx].cards.length > 0) {
                            const falseDelay = config.minReaction + (Math.random() * (config.maxReaction - config.minReaction)) + 200;
                            const scheduledTime = Date.now();
                            this.botSlapTimeouts[visualId] = setTimeout(async () => {
                                const drift = Date.now() - scheduledTime - falseDelay;
                                if (drift > 2000) return; // Stale false slap

                                FirebaseSync.pushSlapAttempt({ playerIndex: idx });
                            }, falseDelay);
                        }
                    }
                }
            });
        });
    },

    checkPlayerDisconnections(data) {
        if (!data || !data.players || !data.gameStarted || data.gameOver) return;

        // Only the Host handles bot conversion to avoid duplicate updates
        import('./auth.js').then(auth => {
            const amIHost = data.hostId === auth.AuthSystem.currentUser.uid;
            if (!amIHost) return;

            data.players.forEach((p, idx) => {
                if (!p.uid.startsWith('bot_')) {
                    if (p.status === 'disconnected') {
                        if (!this.conversionTimeouts[idx]) {
                            const elapsed = Date.now() - (p.disconnectedAt || Date.now());
                            const remaining = Math.max(0, 60000 - elapsed);

                            console.log(`Player ${p.name} disconnected. Converting to bot in ${remaining / 1000}s`);

                            this.conversionTimeouts[idx] = setTimeout(async () => {
                                console.log(`60s passed. Converting ${p.name} to Bot.`);
                                await FirebaseSync.convertToBot(idx);
                                delete this.conversionTimeouts[idx];

                                // Force an immediate check so bot takes its turn instantly
                                this.checkBotTurn(FirebaseSync.roomData);
                                this.checkBotSlaps(FirebaseSync.roomData);
                            }, remaining);
                        }
                    } else if (p.status === 'online') {
                        if (this.conversionTimeouts[idx]) {
                            console.log(`Player ${p.name} reconnected. Cancelling bot conversion.`);
                            clearTimeout(this.conversionTimeouts[idx]);
                            delete this.conversionTimeouts[idx];
                        }
                    }
                }
            });
        });
    },

    getVisualNames() {
        const data = FirebaseSync.roomData;
        if (!data || !data.players) {
            return [
                Settings.config.playerName || Localization.get('you'),
                Localization.get('bot1'),
                Localization.get('bot2'),
                Localization.get('bot3')
            ];
        }

        const names = [];
        for (let visual = 0; visual < 4; visual++) {
            const actual = this.toActual(visual);
            if (data.players[actual]) {
                names.push(data.players[actual].name);
            } else {
                // For slots that might be empty or bots not yet synced/registered
                names.push(visual === 0 ? (Settings.config.playerName || Localization.get('you')) : Localization.get(`bot${visual}`));
            }
        }
        return names;
    },


    getPlayerStatus(visualIndex) {
        const data = FirebaseSync.roomData;
        if (!data || !data.players) return null;
        const actual = this.toActual(visualIndex);
        return data.players[actual] ? { 
            status: data.players[actual].status, 
            disconnectedAt: data.players[actual].disconnectedAt,
            eliminated: data.players[actual].eliminated
        } : null;
    },

    checkElimination(data) {
        if (!data || !data.players || !data.gameStarted || data.gameOver) return;
        const me = data.players[this.localPlayerIndex];
        // Only trigger defeat when explicitly eliminated by the server transaction
        if (me && me.eliminated) {
            if (!this.eliminationShown) {
                this.eliminationShown = true;
                console.log("Local player eliminated. Triggering defeat flow without quitting.");
                import('./victoryScreen.js').then(vs => {
                    vs.VictoryScreen.show(99); // Show early defeat screen, but remain connected to spectate/sync
                });
            }
        }
    },

    checkGlobalDefeat(data) {
        if (!data || !data.players || !data.gameStarted || data.gameOver) return;

        // The Host logic must constantly evaluate the state of all connected real human players
        import('./auth.js').then(auth => {
            const amIHost = data.hostId === auth.AuthSystem.currentUser?.uid;
            if (!amIHost) return;

            // Are all real human players at 0 cards or eliminated? (Ignore completely disconnected/abandoned players possibly?)
            // Condition: Are all real human players at 0 cards?
            const realHumans = data.players.filter(p => !p.uid.startsWith('bot_') && p.status !== 'disconnected');
            if (realHumans.length === 0) return; // if no humans left at all, maybe handle elsewhere or let it be

            const humansStillPlaying = realHumans.some(p => p.cards && p.cards.length > 0 && !p.eliminated);
            
            if (!humansStillPlaying) {
                console.log("All humans eliminated. Triggering global teardown.");
                FirebaseSync.pushUpdate({
                    gameOver: true,
                    status: 'finished',
                    winnerId: -1 // -1 means no human won, all defeated
                });
            }
        });
    },

    checkTurnTimeouts(data) {
        if (!data || !data.players || !data.gameStarted || data.gameOver) return;
        import('./auth.js').then(auth => {
            const amIHost = data.hostId === auth.AuthSystem.currentUser?.uid;
            if (!amIHost) return;

            const activeActual = data.activePlayerId;
            const playerObj = data.players[activeActual];
            
            // Timeout humans who take longer than 15s (Competitive Standard)
            if (playerObj && !playerObj.eliminated && !playerObj.uid.startsWith('bot_')) {
                const elapsed = Date.now() - (data.lastPlayTime || Date.now());
                const timeoutLimit = 15000; 
                if (elapsed > timeoutLimit) {
                    if (!this.timeoutLocks) this.timeoutLocks = {};
                    if (!this.timeoutLocks[activeActual]) {
                        this.timeoutLocks[activeActual] = true;
                        import('./firebaseSync.js').then(fs => fs.FirebaseSync.pushTimeout(activeActual).finally(() => {
                           delete this.timeoutLocks[activeActual]; 
                        }));
                    }
                } else {
                    // Schedule a check
                    if (this.timeoutWatcher) clearTimeout(this.timeoutWatcher);
                    this.timeoutWatcher = setTimeout(() => {
                        import('./firebaseSync.js').then(fs => {
                            this.checkTurnTimeouts(fs.FirebaseSync.roomData);
                        });
                    }, 15000 - elapsed + 100);
                }
            }
        });
    }
};

window.addEventListener('beforeunload', () => {
    if (MultiplayerMode.roomId) {
        FirebaseSync.abandonRoom();
    }
});
