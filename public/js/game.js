import EventBus from './eventbus.js';
import { Settings } from './settings.js';
import { Rng } from './rng.js';
import { matchSlap } from './slapRules.js';
import { HouseRules } from './houseRules.js';
import { MatchContext, difficultyInForce, turnTimeoutMs, transitionDelayMs } from './matchContext.js';
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 11=J, 12=Q, 13=K, 14=A
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const FACE_CHANCES = { 11: 1, 12: 2, 13: 3, 14: 4 };

// Card formatting lives in ruleDoc.js so the Rules page can generate its pattern
// previews without importing game.js (and Settings, and the event bus) to do it.
// Re-exported here because settings.js and ui.js already import them from this
// module — same arrangement as ai.js re-exporting BotConfig from botConfig.js.
export { getRankName, getSuitSymbol } from './ruleDoc.js';

export function createDeck() {
    let deck = [];
    for (let s of SUITS) {
        for (let r of RANKS) {
            deck.push({ rank: r, suit: s });
        }
    }
    // Fisher-Yates. `Rng.random()` IS `Math.random()` unless something has
    // deliberately seeded it (only the Daily Challenge does), so normal matches
    // shuffle exactly as they always have.
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Rng.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

/**
 * How long a Combustion Shield lasts, in milliseconds.
 *
 * Single source of truth. This value used to be written out as a bare `30000`
 * in three separate files (game.js, firebaseSync.js, ui.js) — one for the
 * offline timer, one for the multiplayer timer, one for the on-screen
 * countdown. Three copies of a number that must agree is a drift waiting to
 * happen, and the rules page promises "30 seconds" in four languages.
 */
export const SHIELD_DURATION_MS = 30000;

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

    /**
     * The clock the ACTIVE MATCH runs on.
     *
     * This used to read `Settings.config.difficulty` straight, while the Daily
     * Challenge set the bots' tier through a different variable the timer never
     * saw — so two players on the same scored seed had 20 000 ms and 10 000 ms
     * to play a card. See matchContext.js for the measured cost.
     */
    getTimeoutDuration() {
        const diff = difficultyInForce(MatchContext.difficultyOverride, Settings.config.difficulty);
        return turnTimeoutMs(diff, this.isMultiplayer);
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

    /**
     * @param {object|null} scenario Optional pre-built position (Daily Challenge,
     *   see dailyScenario.js): hands already uneven, cards already on the pile.
     *   Passing nothing deals a fresh 13/13/13/13 game exactly as before.
     *
     * Deliberately ONE method rather than a separate `initFromScenario()`: every
     * line below the deal — stats, flags, the turn listener, the events other
     * modules key off — must be identical for both entry points, and the surest
     * way to keep them identical is to have only one copy of them.
     */
    init(scenario = null) {
        this.players = [[], [], [], []];
        this.streaks = [0, 0, 0, 0]; // BUG-01 FIX: Reset streaks on new game

        if (scenario) {
            // Copy, never alias: the scenario object is rebuilt from the seed on
            // every visit to the panel, and gameplay mutates these arrays.
            this.players = scenario.hands.map(h => h.map(c => ({ ...c })));
            this.pile = scenario.pile.map(c => ({ ...c }));
            this.burnPile = (scenario.burnPile || []).map(c => ({ ...c }));
            this.activePlayerId = scenario.activePlayerId ?? 0;
            this.challenge = { ...scenario.challenge };
            this.streaks = [...(scenario.streaks || [0, 0, 0, 0])];
        } else {
            const deck = createDeck();
            let p = 0;
            while (deck.length > 0) {
                this.players[p].push(deck.pop());
                p = (p + 1) % 4;
            }
            this.activePlayerId = 0;
            this.pile = [];
            this.burnPile = [];
            this.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
        }

        this.challengeResolverActive = false;
        this.gameStarted = true;
        this.gameOver = false;
        this.humanEliminated = false;
        this.playCount = 0;
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

    /**
     * Arm (or re-arm) the shield's real expiry clock.
     *
     * v3.7.1 — this function now also announces itself. Before, the shield had
     * TWO independent 30-second clocks: this one, and the countdown drawn on the
     * deck (ui.js `shieldExpireTimestamps`). The drawn one was armed ONLY by the
     * `shieldEarned` event, which fires on the 0 -> 3 streak transition. A
     * renewing slap keeps the streak at 3, so no event fired and the drawn clock
     * was never refreshed — while this one was. The two then diverged: the
     * number on the shield counted to zero and vanished, and the shield itself
     * kept protecting the player for up to another full 30 seconds. The player
     * saw a shield that had "expired" but was still there, and an expiry message
     * that arrived long after the counter had run out.
     *
     * Emitting from inside the arming function is what makes divergence
     * structurally impossible: exactly one condition now starts both clocks.
     */
    startShieldTimer(playerId) {
        if (!this.shieldDecayTimers) this.shieldDecayTimers = [null, null, null, null];
        if (this.shieldDecayTimers[playerId]) {
            clearTimeout(this.shieldDecayTimers[playerId]);
        }
        this.shieldDecayTimers[playerId] = setTimeout(() => {
            this.expireShield(playerId);
        }, SHIELD_DURATION_MS);
        EventBus.emit('shieldRenewed', playerId);
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
            // SLAP BACK IN — this branch used to end the offline match on the
            // spot and crown whichever bot held the most cards.
            //
            // That is not what this game tells the player. The rules panel has
            // a section headed "👁️ Spectator Mode & Slap Back" which says, in
            // four languages: "Eliminated? Don't leave yet! You enter Spectator
            // Mode where you can watch the match ... and still attempt to Slap
            // Back In at any time. A successful slap resurrects you with the
            // pile!" Ending the match here made that unreachable by half a
            // second.
            //
            // Nothing has to replace it. `activePlayers <= 1` twelve lines
            // above is the real terminal condition and it was already correct;
            // this branch was an EXTRA ending layered on top of it, and only
            // for the human seat. Removing it lets the match run on exactly as
            // it does when a bot runs dry, which is what the spectator screen
            // and the resurrection handlers in victoryScreen.js and ui.js were
            // written for.
            //
            // 99 is the "eliminated, match still ongoing" screen — the same one
            // multiplayer has raised since v2.x through checkElimination().
            // Offline never reached it, because offline never survived to.
            EventBus.emit('humanEliminated', 0);
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

    /**
     * v3.18.0 — a mode that ends the match on its own terms: the Pantheon ends
     * it the moment the god's life reaches zero, whoever holds the cards. Same
     * single 'gameOver' event every other ending uses, so the victory screen,
     * scoring and streaks need no second path.
     */
    endMatch(winnerId) {
        if (this.gameOver) return;
        this.gameOver = true;
        this.gameStarted = false;
        if (this.turnTimeoutId) clearTimeout(this.turnTimeoutId);
        if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
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
        // Monotonic index of every card played this match. The Daily Challenge
        // keys its deterministic bot rolls off this, so the same decision point
        // produces the same roll on every machine (see rng.js::hashRandom).
        this.playCount = (this.playCount || 0) + 1;
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

    /**
     * v3.0.0: this used to be a hand-written second copy of the slap rules,
     * living a long way from `firebaseSync.js`'s third copy. Both are gone —
     * offline and multiplayer now evaluate the SAME registry with the SAME
     * active rule set, so a rule can no longer be added to one and forgotten in
     * the other (COUNCIL.md, Engineer, `[Kesin]`).
     *
     * Return shape is unchanged (`{label, indices}` or `false`), so `slap()`,
     * `playCard()`'s dead-game check and `ai.js` need no changes.
     */
    isValidSlap() {
        const m = matchSlap(this.pile, HouseRules.active());
        return m ? { label: m.id, indices: m.indices } : false;
    },

    slap(playerId) {
        if (this.gameOver || !this.gameStarted) return;
        
        // No anti-ghost guard on the human seat any more. It used to read
        //   if (!this.isMultiplayer && playerId === 0 && this.humanEliminated) return;
        // and it is the second of the two locks that made "Slap Back In"
        // impossible — a seat with no cards was refused the one action the
        // rules panel says it still has.
        //
        // Nothing is at risk without it. An invalid slap burns a card only
        // `if (this.players[playerId].length > 0)` below, so a seat holding
        // nothing pays nothing; getNextPlayer already skips empty seats, so an
        // eliminated player still never gets a TURN. They can slap. That is
        // the whole of what elimination now means offline.

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
                // The comeback. This counter has existed since v2.9.0 and could
                // never once be reached: checkGameOver ended the match the
                // moment humanEliminated became true, and slap() refused the
                // seat anyway. The victory screen has been printing "Slap
                // Backs: 0" and withholding the mvpComeback badge ever since,
                // in four languages.
                this.humanEliminated = false;
                this.stats.resurrections++;
                EventBus.emit('resurrected', 0);
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

        // Delay before the next turn, so the table finishes clearing. `fastAnimations`
        // is the player's own preference everywhere EXCEPT a scored run, where the
        // 300 ms it saves per pile is paid out as score (see matchContext.js).
        const transitionDelay = transitionDelayMs(
            reason, Settings.config.fastAnimations, MatchContext.scored
        );

        if (this.turnTransitionTimeout) clearTimeout(this.turnTransitionTimeout);
        EventBus.emit('turnChanged', -1);
        this.turnTransitionTimeout = setTimeout(() => { 
            EventBus.emit('turnChanged', this.activePlayerId); 
        }, transitionDelay);
    }
};
