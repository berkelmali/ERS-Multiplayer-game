import { GameState } from './game.js';
import { FirebaseSync } from './firebaseSync.js?v=7';
import { Localization } from './localization.js?v=3';
import { getRankName, getSuitSymbol } from './game.js';
import { BotConfig } from './ai.js';
import { godConfig } from './pantheon.js';
import { Settings } from './settings.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { functions } from "./firebaseConfig.js";
import EventBus from './eventbus.js';
import { NetQuality } from './netQuality.js';


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
            // v3.19.2 — before anything that asks "am I the host?": a host
            // who dropped without closing the tab is replaced by the first
            // connected human (slapOutcome.orphanedHostHeir).
            FirebaseSync.claimOrphanedHost(data);
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
            // v3.19.2 — back in, so a SECOND elimination must show the defeat
            // screen again. The flag was set once and never cleared.
            if (playerId === 0) this.eliminationShown = false;
        };

        // v3.19.2 — registered NOW, before the room listener below. These used
        // to wait for a dynamic import() of eventbus.js (already imported at
        // the top of this file), so a snapshot delivered before that import
        // settled — a cached room, or the fuzzer's in-memory RTDB — reached
        // nobody: the host scheduled no bot move and armed no turn timer, and
        // an idle first turn sat there until some other write happened.
        EventBus.on('gameSynced', this.syncListener);
        EventBus.on('invalidSlap', this.emojiBurnHandler);
        EventBus.on('pileWon', this.emojiWinHandler);
        EventBus.on('gameOver', this.gameOverListener);
        EventBus.on('pileWon', this.pileWonStatListener);
        EventBus.on('invalidSlap', this.invalidSlapStatListener);
        EventBus.on('resurrected', this.resurrectedStatListener);
        this.connectionListener = (connected) => { if (!connected) this.standDown(); };
        EventBus.on('roomConnection', this.connectionListener);

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
            // Synchronously, like start(): the deferred version read
            // this.syncListener AFTER the line below had nulled it, so the
            // old sync listener was never removed and every rematch added one
            // more — each snapshot then scheduled the bots twice, three times...
            EventBus.off('gameSynced', this.syncListener);
            EventBus.off('invalidSlap', this.emojiBurnHandler);
            EventBus.off('pileWon', this.emojiWinHandler);
            if (this.gameOverListener) EventBus.off('gameOver', this.gameOverListener);
            EventBus.off('pileWon', this.pileWonStatListener);
            EventBus.off('invalidSlap', this.invalidSlapStatListener);
            EventBus.off('resurrected', this.resurrectedStatListener);
            if (this.connectionListener) EventBus.off('roomConnection', this.connectionListener);
            this.connectionListener = null;
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
                const amIHost = this.drivesRoom(FirebaseSync.roomData, auth.AuthSystem.currentUser);
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
        // GameState.lastPlayTime was converted to the local clock at the sync
        // boundary (firebaseSync.js), so this stays a plain local subtraction.
        this.localSlapReaction = Date.now() - GameState.lastPlayTime;

        // Offline play emits this from GameState.slap(); multiplayer resolves
        // slaps through RTDB and never went through that path, which is why the
        // slap coach used to be silent online. Emitting the same event here
        // gives both modes identical coaching with no special-casing downstream.
        EventBus.emit('slapAttempt', visualPlayerId);

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

    /**
     * v3.19.2 (council ERS-23) — does this client drive the room right now?
     * The host, and only while it is connected: a host that lost the database
     * stops (its timers are cleared on 'roomConnection' false) and resumes on
     * the next snapshot if the room is still its own.
     */
    drivesRoom(data, user) {
        return !!(data && user && data.hostId === user.uid && FirebaseSync.isConnected !== false);
    },

    /** Stops every timer this client runs as the host. */
    standDown() {
        Object.values(this.botTimeouts).forEach(clearTimeout);
        Object.values(this.botSlapTimeouts).forEach(clearTimeout);
        Object.values(this.conversionTimeouts).forEach(clearTimeout);
        this.botTimeouts = {};
        this.botSlapTimeouts = {};
        this.conversionTimeouts = {};
        if (this.timeoutWatcher) clearTimeout(this.timeoutWatcher);
        this.timeoutWatcher = null;
        this.timeoutLocks = {};
    },

    toActual(visualIndex) {
        return (visualIndex + this.localPlayerIndex) % 4;
    },

    /** v3.18.0 — the god's seat plays as its god (Ra quickens at noon); every other bot is Challenger. */
    botConfigFor(data, seat) {
        if (data && data.god && seat === data.godSeat) return godConfig(data.god, { noon: !!data.godNoon }) || BotConfig.challenger;
        return BotConfig.challenger;
    },

    checkBotTurn(data) {
        if (!data || !data.players || !data.players[0]) return;
        import('./auth.js').then(auth => {
            const amIHost = this.drivesRoom(data, auth.AuthSystem.currentUser);
            if (!amIHost || !data.gameStarted || data.gameOver) return;

            const activeActual = data.activePlayerId;
            const playerObj = data.players[activeActual];

            if (playerObj && playerObj.uid.startsWith('bot_') && !playerObj.eliminated) {
                const visualId = (activeActual - this.localPlayerIndex + 4) % 4;
                if (this.botTimeouts[visualId]) clearTimeout(this.botTimeouts[visualId]);

                // Use playDelay + playVariance for card-play timing (NOT minReaction which is for slaps)
                const diffConfig = this.botConfigFor(data, activeActual);
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
            const me = auth.AuthSystem.currentUser;
            const amIHost = this.drivesRoom(data, me);
            if (!amIHost || !data.gameStarted || data.gameOver) return;

            const validSlap = FirebaseSync.evaluateSlap(data.pile);

            data.players.forEach((p, idx) => {
                if (p.uid.startsWith('bot_') && !p.eliminated) {
                    const visualId = (idx - this.localPlayerIndex + 4) % 4;
                    if (this.botSlapTimeouts[visualId]) clearTimeout(this.botSlapTimeouts[visualId]);

                    const config = this.botConfigFor(data, idx);

                    if (validSlap) {
                        // Challenger AI Slap Check
                        if (Math.random() < config.accuracy) {
                            const delay = config.minReaction + (Math.random() * (config.maxReaction - config.minReaction));
                            const scheduledTime = Date.now();
                            this.botSlapTimeouts[visualId] = setTimeout(async () => {
                                const drift = Date.now() - scheduledTime - delay;
                                if (drift > 2000) return; // Stale suspension slap
                                if (!this.drivesRoom(FirebaseSync.roomData, me)) return; // ERS-23: no longer the host
                                
                                if (FirebaseSync.evaluateSlap(FirebaseSync.roomData.pile)) {
                                    FirebaseSync.pushSlapAttempt({ playerIndex: idx });
                                }
                            }, delay);
                        }
                    } else if (data.pile.length > 0) {
                        // False Slap Probability Override
                        // v3.19.2 — RTDB stores no empty array: a bot that has just
                        // played its last card has NO `cards` field until the next
                        // award marks it out, and `.length` of undefined threw
                        // here, dropping every later bot's slap for that snapshot.
                        if (Math.random() < config.falseSlap && (data.players[idx].cards || []).length > 0) {
                            const falseDelay = config.minReaction + (Math.random() * (config.maxReaction - config.minReaction)) + 200;
                            const scheduledTime = Date.now();
                            this.botSlapTimeouts[visualId] = setTimeout(async () => {
                                const drift = Date.now() - scheduledTime - falseDelay;
                                if (drift > 2000) return; // Stale false slap
                                if (!this.drivesRoom(FirebaseSync.roomData, me)) return; // ERS-23: no longer the host

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
            const amIHost = this.drivesRoom(data, auth.AuthSystem.currentUser);
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
            const amIHost = this.drivesRoom(data, auth.AuthSystem.currentUser);
            if (!amIHost) return;

            // Are all real human players at 0 cards or eliminated? (Ignore completely disconnected/abandoned players possibly?)
            // Condition: Are all real human players at 0 cards?
            const realHumans = data.players.filter(p => !p.uid.startsWith('bot_') && p.status !== 'disconnected');
            if (realHumans.length === 0) return; // if no humans left at all, maybe handle elsewhere or let it be

            // v3.19.2 — "out" is what the room's own transactions say: the
            // `eliminated` flag. An empty hand is not out yet: a human who has
            // just played their last card may slap the pair it made, or is the
            // attacker of a live challenge, and the award that settles it is
            // the one that marks them out. Testing `cards.length` here ended the
            // match as "no human won" in that half second (found by the host
            // fuzzer: tools/fuzz-pantheon.mjs --mode host).
            const humansStillPlaying = realHumans.some(p => !p.eliminated);
            
            if (!humansStillPlaying) {
                console.log("All humans eliminated. Triggering global teardown.");
                // v3.19.2 (ERS-23): a transaction that re-checks all of
                // this on the server's copy — it was a blind update().
                FirebaseSync.endIfNoHumanLeft();
            }
        });
    },

    checkTurnTimeouts(data) {
        if (!data || !data.players || !data.gameStarted || data.gameOver) return;
        import('./auth.js').then(auth => {
            const amIHost = this.drivesRoom(data, auth.AuthSystem.currentUser);
            if (!amIHost) return;

            const activeActual = data.activePlayerId;
            const playerObj = data.players[activeActual];
            
            // Timeout humans who take longer than 15s (Competitive Standard)
            if (playerObj && !playerObj.eliminated && !playerObj.uid.startsWith('bot_')) {
                // `data.lastPlayTime` is on the shared server clock, so the elapsed
                // check has to be too — a device with a skewed local clock must not
                // time other players out early (or never).
                const elapsed = NetQuality.serverNow() - (data.lastPlayTime || NetQuality.serverNow());
                const timeoutLimit = FirebaseSync.TURN_TIMEOUT_MS;
                if (elapsed > timeoutLimit) {
                    if (!this.timeoutLocks) this.timeoutLocks = {};
                    if (!this.timeoutLocks[activeActual]) {
                        this.timeoutLocks[activeActual] = true;
                        import('./firebaseSync.js?v=7').then(fs => fs.FirebaseSync.pushTimeout(activeActual).finally(() => {
                           delete this.timeoutLocks[activeActual]; 
                        }));
                    }
                } else {
                    // Schedule a check
                    if (this.timeoutWatcher) clearTimeout(this.timeoutWatcher);
                    this.timeoutWatcher = setTimeout(() => {
                        import('./firebaseSync.js?v=7').then(fs => {
                            this.checkTurnTimeouts(fs.FirebaseSync.roomData);
                        });
                    }, FirebaseSync.TURN_TIMEOUT_MS - elapsed + 100);
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
