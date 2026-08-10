import EventBus from './eventbus.js';
import { Settings } from './settings.js';
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 11=J, 12=Q, 13=K, 14=A
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const FACE_CHANCES = { 11: 1, 12: 2, 13: 3, 14: 4 };

export function getRankName(rank) {
    if (rank <= 10) return rank.toString();
    if (rank === 11) return 'J';
    if (rank === 12) return 'Q';
    if (rank === 13) return 'K';
    if (rank === 14) return 'A';
}

export function getSuitSymbol(suit) {
    switch (suit) {
        case 'hearts': return '♥';
        case 'diamonds': return '♦';
        case 'clubs': return '♣';
        case 'spades': return '♠';
    }
}

export function createDeck() {
    let deck = [];
    for (let s of SUITS) {
        for (let r of RANKS) {
            deck.push({ rank: r, suit: s });
        }
    }
    // Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

export const GameState = {
    players: [[], [], [], []], // 0: Human, 1: Left Bot, 2: Top Bot, 3: Right Bot
    pile: [],
    burnPile: [], // Burned cards — excluded from slap rules, awarded to pile winner
    activePlayerId: 0,
    challenge: {
        active: false,
        attackerId: null,
        defenderId: null,
        chancesLeft: 0
    },
    gameStarted: false,
    gameOver: false,
    lastPlayTime: 0,
    turnTimeoutId: null,
    turnTransitionTimeout: null,

    getTimeoutDuration() {
        if (this.isMultiplayer) return 15000; // Competitive standard
        const diff = Settings.config.difficulty;
        if (diff === 'easy') return 20000;
        if (diff === 'hard') return 10000;
        return 15000; // Medium/Default
    },

    resetTurnTimer() {
        if (this.turnTimeoutId) clearTimeout(this.turnTimeoutId);
        if (!this.gameStarted || this.gameOver || this.isMultiplayer) return;

        const pid = this.activePlayerId;
        if (this.players[pid].length > 0) {
            const duration = this.getTimeoutDuration();
            this.turnTimeoutId = setTimeout(() => {
                this.handleTurnTimeout(pid);
            }, duration);
            
            // Sync UI progress bar duration
            EventBus.emit('syncTurnTimer', { activeId: pid, duration });
        }
    },

    handleTurnTimeout(pid) {
        if (!this.gameStarted || this.gameOver || this.activePlayerId !== pid) return;
        if (this.isMultiplayer) return; // Server handles multiplayer timeout

        if (this.players[pid].length > 0) {
            const burned = this.players[pid].shift();
            this.burnPile.push(burned);
            if (pid === 0 && this.stats) this.stats.burns++;

            // Reset streak on timeout
            if (!this.streaks) this.streaks = [0, 0, 0, 0];
            if (this.streaks[pid] >= 2) {
                import('./audioManager.js').then(module => {
                    if (module.AudioManager && module.AudioManager.playStreakBreak) {
                        module.AudioManager.playStreakBreak();
                    }
                });
            }
            this.streaks[pid] = 0;
            GameState.streaks = this.streaks;

            EventBus.emit('invalidSlap', { playerId: pid, burned, reason: 'timeout' });
            
            if (this.players[pid].length === 0) {
                this.checkGameOver();
            }
        }

        this.lastPlayTime = Date.now(); // Prevents anti-spam lockout

        if (this.challenge && this.challenge.active) {
            this.challengeResolverActive = true;
            this.challenge.chancesLeft = 0;
            if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
            EventBus.emit('turnChanged', -1);
            this.turnTransitionTimeout = setTimeout(() => { 
                this.challengeResolverActive = false;
                this.winPile(this.challenge.attackerId, 'challenge'); 
            }, 1000);
        } else {
            this.challengeResolverActive = false;
            const next = this.getNextPlayer(pid);
            this.activePlayerId = next !== null ? next : pid;
            if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
            EventBus.emit('turnChanged', -1); // Clear UI immediately
            this.turnTransitionTimeout = setTimeout(() => { 
                EventBus.emit('turnChanged', this.activePlayerId); 
            }, 1000);
        }
    },

    init() {
        const deck = createDeck();
        this.players = [[], [], [], []];
        this.streaks = [0, 0, 0, 0]; // BUG-01 FIX: Reset streaks on new game
        let p = 0;
        while (deck.length > 0) {
            this.players[p].push(deck.pop());
            p = (p + 1) % 4;
        }
        this.activePlayerId = 0;
        this.pile = [];
        this.burnPile = [];
        this.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
        this.challengeResolverActive = false;
        this.gameStarted = true;
        this.gameOver = false;
        this.humanEliminated = false;
        this.lastPlayTime = Date.now();
        this.lastSlapWinTime = 0;
        this.stats = {
            bestReflex: 9999,
            cardsWon: 0,
            burns: 0,
            resurrections: 0
        };

        EventBus.emit('gameStarted');
        EventBus.emit('turnChanged', this.activePlayerId);
        window.GameState = this; // Exposed for testing
        
        if (!this._turnListenerAttached) {
            this._onTurnChanged = () => this.resetTurnTimer();
            EventBus.on('turnChanged', this._onTurnChanged);
            this._turnListenerAttached = true;
        }
    },

    quitGame() {
        this.gameOver = true;
        this.gameStarted = false;
        if (this.turnTimeoutId) clearTimeout(this.turnTimeoutId);
        if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
        if (this.shieldDecayTimers) {
            this.shieldDecayTimers.forEach(t => { if (t) clearTimeout(t); });
            this.shieldDecayTimers = [null, null, null, null];
        }
        this.pile = [];
        this.burnPile = [];
        this.players = [[], [], [], []];
        this.streaks = [0, 0, 0, 0]; // BUG-02 FIX: Clean up streaks on quit
        this.challengeResolverActive = false;
    },

    startShieldTimer(playerId) {
        if (!this.shieldDecayTimers) this.shieldDecayTimers = [null, null, null, null];
        if (this.shieldDecayTimers[playerId]) {
            clearTimeout(this.shieldDecayTimers[playerId]);
        }
        this.shieldDecayTimers[playerId] = setTimeout(() => {
            this.expireShield(playerId);
        }, 30000);
    },

    expireShield(playerId) {
        if (this.streaks && this.streaks[playerId] >= 3) {
            this.streaks[playerId] = 0;
            GameState.streaks = this.streaks;
            EventBus.emit('shieldExpired', playerId);
        }
    },

    getNextPlayer(id) {
        let next = (id + 1) % 4;
        let count = 0;
        while (this.players[next].length === 0 && count < 4) {
            next = (next + 1) % 4;
            count++;
        }
        if (count >= 4) return null; // No one has cards
        return next;
    },

    checkGameOver() {
        if (this.gameOver) return;

        // --- Classic win: one player has all 52 cards ---
        if (this.players.some(p => p.length === 52)) {
            this.gameOver = true;
            this.gameStarted = false;
            let pId = this.players.findIndex(p => p.length === 52);
            EventBus.emit('gameOver', pId);
            return;
        }

        // --- Defeat check: ONLY call this AFTER winPile (pile is empty) ---
        const humanHasCards = this.players[0].length > 0;
        const activePlayers = this.players.filter(p => p.length > 0).length;

        if (activePlayers <= 1) {
            this.gameOver = true;
            this.gameStarted = false;
            let winnerId = this.players.findIndex(p => p.length > 0);
            if (winnerId === -1) winnerId = 1; // Fallback
            EventBus.emit('gameOver', winnerId);
            return;
        }

        if (!humanHasCards && !this.humanEliminated) {
            this.humanEliminated = true;
            if (!this.isMultiplayer) {
                this.gameOver = true;
                this.gameStarted = false;
                let maxCards = -1;
                let winnerBotId = 1;
                for (let i = 1; i < 4; i++) {
                    if (this.players[i].length > maxCards) {
                        maxCards = this.players[i].length;
                        winnerBotId = i;
                    }
                }
                EventBus.emit('gameOver', winnerBotId);
            }
            // else: Multiplayer mode handles its own instant defeat screen via checkElimination in multiplayerMode.js
        }
    },

    // --- v2.9.0: Quick Match Timer / Blitz Mode (offline only, see matchTimer.js) ---
    // Ends the match early on a timeout instead of full elimination: whoever
    // has the most cards right now wins. Deliberately a NEW, separate method —
    // does not touch checkGameOver()'s own win-condition logic at all, and
    // reuses the exact same 'gameOver' event every other end-of-game path
    // already uses, so VictoryScreen/ScoreSystem/StreakTracker/BotNemesis/the
    // MVP Moment callout all handle it correctly with no changes needed.
    forceTimeUp() {
        if (this.gameOver) return;
        this.gameOver = true;
        this.gameStarted = false;

        let maxCards = -1;
        let winnerId = 0;
        for (let i = 0; i < 4; i++) {
            if (this.players[i].length > maxCards) {
                maxCards = this.players[i].length;
                winnerId = i;
            }
        }
        EventBus.emit('gameOver', winnerId);
    },

    playCard(playerId) {
        if (this.gameOver || !this.gameStarted) return;
        if (playerId !== this.activePlayerId) return;

        // Strict lock on current pile evaluation sweeps
        if (this.challengeResolverActive) return;

        // Hardware double-tap / spam prevention, allows valid rapid plays
        if (Date.now() - this.lastPlayTime < 50) return;

        if (this.players[playerId].length === 0) {
            // Player has no cards.
            // BUG FIX: If they are the defender in an active challenge, they instantly fail and attacker wins!
            if (this.challenge.active && this.challenge.defenderId === playerId) {
                this.challengeResolverActive = true;
                if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
                EventBus.emit('turnChanged', -1);
                this.turnTransitionTimeout = setTimeout(() => { 
                    this.challengeResolverActive = false;
                    this.winPile(this.challenge.attackerId, 'challenge'); 
                }, 1000);
                return;
            }

            // Normal turn skip if not in a challenge
            const next = this.getNextPlayer(playerId);
            if (next !== null) {
                this.activePlayerId = next;
                if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
                EventBus.emit('turnChanged', -1); // Önce temizle
                this.turnTransitionTimeout = setTimeout(() => { 
                    EventBus.emit('turnChanged', this.activePlayerId); 
                }, 300); // Hızlı geçiş
            }
            return;
        }

        const card = this.players[playerId].shift(); // Draw from top
        this.pile.push(card);
        this.lastPlayTime = Date.now();
        EventBus.emit('cardPlayed', { playerId, card });

        // Dead Game Check
        if (this.players.every(p => p.length === 0)) {
            if (!this.isValidSlap()) {
                this.gameOver = true;
                this.gameStarted = false;
                setTimeout(() => { EventBus.emit('gameOver', -1); }, 1000);
                return;
            } else {
                setTimeout(() => {
                    if (!this.gameOver && this.players.every(p => p.length === 0)) {
                        this.gameOver = true;
                        this.gameStarted = false;
                        EventBus.emit('gameOver', -1);
                    }
                }, 3000);
            }
        }

        const isFaceCard = card.rank >= 11;

        if (this.challenge.active) {
            if (isFaceCard) {
                // Challenge passed to next person
                this.challenge.attackerId = playerId;
                const next = this.getNextPlayer(playerId);
                this.challenge.defenderId = next;
                this.challenge.chancesLeft = FACE_CHANCES[card.rank];
                this.activePlayerId = next;
                EventBus.emit('challengeStarted', this.challenge);
                if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
                EventBus.emit('turnChanged', -1);
                this.turnTransitionTimeout = setTimeout(() => { 
                    EventBus.emit('turnChanged', this.activePlayerId); 
                }, 1000);
            } else {
                // Defender played a non-face card
                this.challenge.chancesLeft--;
                EventBus.emit('challengeUpdated', this.challenge);

                if (this.challenge.chancesLeft <= 0 || this.players[playerId].length === 0) {
                    // Defender exhausted all chances or ran out of cards
                    this.challengeResolverActive = true;
                    if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
                    EventBus.emit('turnChanged', -1);
                    this.turnTransitionTimeout = setTimeout(() => { 
                        this.challengeResolverActive = false;
                        this.winPile(this.challenge.attackerId, 'challenge'); 
                    }, 1000);
                } else {
                    // Defender still has chances left
                    this.challengeResolverActive = true;
                    if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
                    EventBus.emit('turnChanged', -1);
                    this.turnTransitionTimeout = setTimeout(() => { 
                        this.challengeResolverActive = false;
                        EventBus.emit('turnChanged', this.activePlayerId); 
                    }, 1000);
                }
            }
        } else {
            if (isFaceCard) {
                // Start Challenge
                this.challenge.active = true;
                this.challenge.attackerId = playerId;
                const next = this.getNextPlayer(playerId);
                this.challenge.defenderId = next;
                this.challenge.chancesLeft = FACE_CHANCES[card.rank];
                this.activePlayerId = next;
                EventBus.emit('challengeStarted', this.challenge);

                // 1 SECOND DELAY before next turn
                if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
                EventBus.emit('turnChanged', -1);
                this.turnTransitionTimeout = setTimeout(() => { 
                    EventBus.emit('turnChanged', this.activePlayerId); 
                }, 1000);
            } else {
                // Normal play
                const next = this.getNextPlayer(playerId);
                this.activePlayerId = next;

                // 1 SECOND DELAY before next turn
                if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
                EventBus.emit('turnChanged', -1);
                this.turnTransitionTimeout = setTimeout(() => { 
                    EventBus.emit('turnChanged', this.activePlayerId); 
                }, 1000);
            }
        }
    },

    isValidSlap() {
        const p = this.pile;
        if (p.length === 0 || p.length < 2) return false;
        
        const top = p[p.length - 1];
        const prev = p[p.length - 2];

        // Doubles
        if (top.rank === prev.rank) return { label: 'double', indices: [p.length - 1, p.length - 2] };

        // Tens (only number cards summing to 10)
        if (top.rank <= 10 && prev.rank <= 10 && top.rank + prev.rank === 10) return { label: 'tens', indices: [p.length - 1, p.length - 2] };

        // Marriage (K and Q)
        if ((top.rank === 12 && prev.rank === 13) || (top.rank === 13 && prev.rank === 12)) return { label: 'marriage', indices: [p.length - 1, p.length - 2] };

        // Sandwich
        if (p.length >= 3) {
            const prev2 = p[p.length - 3];
            if (top.rank === prev2.rank) return { label: 'sandwich', indices: [p.length - 1, p.length - 3] };
        }

        return false;
    },

    slap(playerId) {
        if (this.gameOver || !this.gameStarted) return;
        
        // Anti-Ghost Slap for Offline Matches
        if (!this.isMultiplayer && playerId === 0 && this.humanEliminated) return;

        // Slap Grace Period to prevent double-slap race conditions penalty
        if (Date.now() - this.lastSlapWinTime < 500) return;

        EventBus.emit('slapAttempt', playerId);

        // Check reaction speed
        const timeSincePlay = Date.now() - this.lastPlayTime;
        const isFastSlap = timeSincePlay < 400 && this.pile.length > 0;

        const slapCheck = this.isValidSlap();
        if (slapCheck) {
            if (isFastSlap && playerId === 0) {
                EventBus.emit('fastSlapBonus', playerId);
            }
            this.winPile(playerId, 'slap', slapCheck.indices);
        } else {
            // Reset streak on invalid slap
            if (!this.streaks) this.streaks = [0, 0, 0, 0];
            const hadShield = this.streaks[playerId] >= 3;
            
            if (hadShield) {
                this.streaks[playerId] = 0;
                GameState.streaks = this.streaks;
                EventBus.emit('shieldShattered', { playerId });
            } else {
                if (this.streaks[playerId] >= 2) {
                    import('./audioManager.js').then(module => {
                        if (module.AudioManager && module.AudioManager.playStreakBreak) {
                            module.AudioManager.playStreakBreak();
                        }
                    });
                }
                this.streaks[playerId] = 0;
                GameState.streaks = this.streaks;

                // Burn a card: goes into the separate burnPile, NOT the normal pile.
                if (this.players[playerId].length > 0) {
                    const burned = this.players[playerId].shift();
                    this.burnPile.push(burned); // stored separately
                    if (playerId === 0 && this.stats) this.stats.burns++;
                    EventBus.emit('invalidSlap', { playerId, burned });
                    
                    // If they just burned their last card, handle challenge failure!
                    if (this.players[playerId].length === 0) {
                        if (this.challenge.active && this.challenge.defenderId === playerId) {
                            this.challengeResolverActive = true;
                            if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
                            EventBus.emit('turnChanged', -1);
                            this.turnTransitionTimeout = setTimeout(() => { 
                                this.challengeResolverActive = false;
                                this.winPile(this.challenge.attackerId, 'challenge'); 
                            }, 1000);
                            return;
                        } else if (this.activePlayerId === playerId) {
                            const next = this.getNextPlayer(playerId);
                            this.activePlayerId = next !== null ? next : playerId;
                            if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
                            EventBus.emit('turnChanged', -1);
                            this.turnTransitionTimeout = setTimeout(() => { 
                                EventBus.emit('turnChanged', this.activePlayerId); 
                            }, 500);
                        }
                    }
                }
            }
        }
        this.checkGameOver();
    },

    winPile(winnerId, reason, indices = []) {
        this.challengeResolverActive = false;
        const reactionTime = (reason === 'slap') ? (Date.now() - this.lastPlayTime) : null;
        
        // Track Stats
        if (winnerId === 0 && this.stats) {
            if (reactionTime !== null && reactionTime < this.stats.bestReflex) {
                this.stats.bestReflex = reactionTime;
            }
            this.stats.cardsWon += (this.burnPile.length + this.pile.length);
            if (this.humanEliminated) {
                this.stats.resurrections++;
            }
        }

        // ERS exact stacking rule — all cards go to the BOTTOM of winner's deck:
        //   Step 1: Burned cards (penalty from invalid slaps) — burnPile[0]...burnPile[n]
        //   Step 2: Played cards in chronological order — pile[0] (first played) ... pile[last] (winning card)
        //
        // Array model: players[id][0] = top (shift draws here), players[id][last] = bottom (push adds here)
        // pile[0]     = first card played in this round (oldest)
        // pile[last]  = last card played / the trigger card (newest)
        //
        // So:  push( ...burnPile, ...pile )  gives exactly: [burned...] [first played...] [winning card]
        //      all appended to the bottom of the winner's existing hand.

        this.players[winnerId].push(...this.burnPile, ...this.pile);

        // Win streak calculations for offline mode
        if (!this.streaks) this.streaks = [0, 0, 0, 0];

        if (reason === 'slap') {
            // RENEW SHIELD: Zaten kalkanı varsa timer'ı sıfırla, streak'i 3'te tut
            if (this.streaks[winnerId] >= 3) {
                this.streaks[winnerId] = 3;
                this.startShieldTimer(winnerId);
            } else {
                this.streaks[winnerId] = (this.streaks[winnerId] || 0) + 1;
                if (this.streaks[winnerId] === 3) {
                    EventBus.emit('shieldEarned', winnerId);
                    this.startShieldTimer(winnerId);
                }
            }
        } else {
            // CHALLENGE WIN: Streak artırılmaz ve sıfırlanmaz (aynı bırakılır)
            this.streaks[winnerId] = this.streaks[winnerId] || 0;
        }

        for (let i = 0; i < 4; i++) {
            if (i !== winnerId) {
                // ACTIVE SHIELD PERSISTENCE: Kalkanı olanların kalkanı başkası el aldı diye sönmez
                if (this.streaks[i] >= 3) {
                    continue;
                }

                if (this.streaks[i] >= 2) {
                    import('./audioManager.js').then(module => {
                        if (module.AudioManager && module.AudioManager.playStreakBreak) {
                            module.AudioManager.playStreakBreak();
                        }
                    });
                }
                if (this.shieldDecayTimers && this.shieldDecayTimers[i]) {
                    clearTimeout(this.shieldDecayTimers[i]);
                    this.shieldDecayTimers[i] = null;
                }
                this.streaks[i] = 0;
            }
        }
        GameState.streaks = this.streaks;

        this.pile = [];
        this.burnPile = [];
        this.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
        this.activePlayerId = winnerId;
        this.lastSlapWinTime = Date.now();
        EventBus.emit('pileWon', { winnerId, reason, indices, reactionTime });

        this.checkGameOver();
        if (this.gameOver) return;

        // Dynamic delay before next turn to sync with UI clearing the table
        let transitionDelay = 1000;
        if (reason === 'slap') {
            transitionDelay = Settings.config.fastAnimations ? 700 : 1000;
        } else if (reason === 'challenge') {
            transitionDelay = 400; // Fast sweep for challenges matches animation time
        }

        if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
        EventBus.emit('turnChanged', -1);
        this.turnTransitionTimeout = setTimeout(() => { 
            EventBus.emit('turnChanged', this.activePlayerId); 
        }, transitionDelay);
    }
};
