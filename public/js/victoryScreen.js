import { Settings } from './settings.js';
import { Localization } from './localization.js?v=3';
import EventBus from './eventbus.js';
import { GameState } from './game.js';
import { StreakTracker } from './streakTracker.js';
import { ResultCard } from './resultCard.js';
import { formatDailyUrl } from './inviteLink.js';
import { todayKey } from './dailyScore.js';
import { MatchContext } from './matchContext.js';

export const VictoryScreen = {
    init() {
        this.screenVictory = document.getElementById('victory-screen');
        this.screenGame = document.getElementById('game-container');
        this.screenMenu = document.getElementById('main-menu');
        this.confettiContainer = document.getElementById('confetti');
        this.msgEl = document.getElementById('victory-message');
        this.victoryTitle = document.getElementById('victory-title');
        this.isDefeat = false;
        this.redirectTimeout = null;
        this.lastCoinDelta = null;
        // v3.17.0: the finished match's numbers, frozen.
        //
        // GameState.stats is a LIVE object on the running game, and it is
        // replaced wholesale when a new game starts (game.js) or a new
        // multiplayer round begins (multiplayerMode.js). The victory screen
        // reports a match that is OVER, so every number it shows or shares
        // must come from a copy taken when the screen appeared -- otherwise
        // the card says 14 cards and the share text, pressed a moment later,
        // says 0. That disagreement was reported from the live site.
        this.lastStats = null;

        EventBus.on('gameStarted', () => {
            this.lastCoinDelta = null; // Defensive reset — don't show a stale value from a previous match.
        });

        // Registered here (init time), well before show() actually runs — see
        // cardSkins.js::computeReward for why this doesn't recompute the
        // formula itself, just displays what was already awarded.
        EventBus.on('coinsAwarded', ({ amount }) => {
            this.lastCoinDelta = amount;
        });

        // v3.12.0 — the 1500ms pause is deliberate (the last slap should land
        // before the screen changes), but until now the timer had no handle
        // and no owner. Anything the player did inside that window — and
        // `#btn-quit` is live on the game screen for the whole of it — was
        // overwritten when the timer fired and pushed a full-viewport
        // `z-index: 1000` victory screen over the main menu.
        //
        // Found by the overlay walk in `npm run smoke`, not by hand: it is the
        // same defect class as the winner banner that survived the menu, and
        // that is exactly the class that gate was written to catch.
        EventBus.on('gameOver', (winnerId) => {
            if (this.showTimeout) clearTimeout(this.showTimeout);
            this.showTimeout = setTimeout(() => {
                this.showTimeout = null;
                this.show(winnerId);
            }, 1500);
        });

        document.getElementById('btn-play-again').addEventListener('click', () => {
            if (this.redirectTimeout) clearTimeout(this.redirectTimeout);
            
            // Clean visual overrides
            const overlay = document.querySelector('.victory-effect-overlay');
            if (overlay) overlay.remove();
            const trophy = document.getElementById('victory-trophy-3d');
            if (trophy) trophy.remove();
            const oldPanel = document.querySelector('.stats-panel');
            if (oldPanel) oldPanel.remove();

            if (this.lastWinnerId === 99) {
                this.screenVictory.classList.remove('active');
                this.clearDefeatVisuals();
                this.screenGame.classList.add('active');
                this.stopParticles();
                
                // Spectator Mode UI Locks.
                //
                // The DECK is locked, and correctly: a seat holding nothing has
                // no card to play, and its turn is skipped by getNextPlayer.
                //
                // The PILE is NOT locked, and this is the whole feature. The
                // slap is a `pointerdown` on #center-pile (ui.js), so the line
                // that used to sit here — `pile.style.pointerEvents = 'none'`
                // — was the single statement that made "Spectator Mode & Slap
                // Back" unreachable no matter what the game logic allowed. The
                // rules panel promises, in four languages: "You can still slap
                // the pile even with 0 cards — a successful slap resurrects you
                // with the pile!" It is the pile you slap.
                const humanDeck = document.getElementById('human-deck');
                if (humanDeck) {
                    humanDeck.style.pointerEvents = 'none';
                    humanDeck.style.opacity = '0.5';
                }
                const pile = document.getElementById('center-pile');
                if (pile) {
                    pile.style.pointerEvents = 'auto';
                }
                return;
            }

            import('./gameManager.js').then(gm => {
                if (gm.GameManager.activeMode === 'multiplayer') {
                    this.returnToWaitingRoom();
                    return;
                }
                this.screenVictory.classList.remove('active');
                this.clearDefeatVisuals();
                this.screenGame.classList.add('active');
                this.stopParticles();
                
                // Hard reset of UI state to fix residual card bug
                import('./ui.js').then(ui => {
                    if (ui.UIManager.pileEl) ui.UIManager.pileEl.innerHTML = '';
                    if (ui.UIManager.logEl) ui.UIManager.logEl.innerHTML = '';
                    ui.UIManager.deckEls.forEach(el => {
                        el.classList.remove('active');
                        el.style.filter = 'none';
                        el.style.opacity = '1';
                        el.style.pointerEvents = 'auto';
                    });
                    
                    EventBus.emit('restartGame');
                    EventBus.emit('gameStateChanged', 'gameplay');
                });
            });
        });

        document.getElementById('btn-victory-menu').addEventListener('click', () => {
            if (this.redirectTimeout) clearTimeout(this.redirectTimeout);
            
            // Clean visual overrides
            const overlay = document.querySelector('.victory-effect-overlay');
            if (overlay) overlay.remove();
            const trophy = document.getElementById('victory-trophy-3d');
            if (trophy) trophy.remove();
            const oldPanel = document.querySelector('.stats-panel');
            if (oldPanel) oldPanel.remove();

            this.returnToMainMenuUI();
        });

        // ── Share the match (v3.13.0) ───────────────────────────────────────
        //
        // ers-revamp shipped this button reading `ers_high_score` — a
        // localStorage key NOTHING in this codebase writes, so every share
        // read "beat my score of 0". It shares the match instead: won or
        // lost, cards taken, fastest slap. Those three are already computed
        // and already on the screen behind this button.
        //
        // The clipboard path is LobbyUI.copyToClipboard, not a second copy of
        // the same logic. That function exists because `navigator.clipboard`
        // is `undefined` in an insecure context, so the member access throws
        // SYNCHRONOUSLY and a trailing .catch() has nothing to attach to —
        // and because a failed copy has to offer the manual path rather than
        // leaving a button that did nothing. The version this was ported from
        // had a bare `.catch(() => {})`, which is both mistakes at once.
        const btnShare = document.getElementById('btn-challenge-share');
        if (btnShare) {
            btnShare.addEventListener('click', async () => {
                const text = this.buildShareText();
                try {
                    if (navigator.share) {
                        await navigator.share({ title: 'Egyptian Rat Screw', text });
                        return;
                    }
                } catch (err) {
                    // A dismissed share sheet rejects. That is the player
                    // changing their mind, not a failure — and falling through
                    // to the clipboard would copy something they just declined
                    // to send.
                    if (err && err.name === 'AbortError') return;
                }
                const { LobbyUI } = await import('./lobbyUI.js');
                await LobbyUI.copyToClipboard(text, btnShare, 'shareCopied', null);
            });
        }

        this.lastWinnerId = -1;
        EventBus.on('languageChanged', () => {
            if (this.screenVictory.classList.contains('active') && this.lastWinnerId !== -1) {
                this.show(this.lastWinnerId);
            }
        });

        EventBus.on('resurrected', (playerId) => {
            if (playerId === 0) {
                // Instantly clear the blocking defeat screen to allow normal play again
                if (this.redirectTimeout) clearTimeout(this.redirectTimeout);
                
                const overlay = document.querySelector('.victory-effect-overlay');
                if (overlay) overlay.remove();
                const trophy = document.getElementById('victory-trophy-3d');
                if (trophy) trophy.remove();
                const oldPanel = document.querySelector('.stats-panel');
                if (oldPanel) oldPanel.remove();

                this.screenVictory.classList.remove('active');
                this.clearDefeatVisuals();
                this.stopParticles();

                // Undo the spectator lock. clearDefeatVisuals() only removes a
                // CSS class; the deck was disabled with inline styles above and
                // nothing on this path put them back — so without these four
                // lines a resurrected player returns holding cards they cannot
                // play. (resetOfflineUI does this, but only on the way out to
                // the menu, which is the opposite of coming back.)
                const humanDeck = document.getElementById('human-deck');
                if (humanDeck) {
                    humanDeck.style.pointerEvents = 'auto';
                    humanDeck.style.opacity = '1';
                }
                const pile = document.getElementById('center-pile');
                if (pile) pile.style.pointerEvents = 'auto';

                this.screenGame.classList.add('active');
            }
        });

        // Offline elimination. Multiplayer has raised screen 99 since v2.x via
        // multiplayerMode.checkElimination(); offline never did, because
        // checkGameOver ended the match instead of eliminating anybody. Now
        // that it does not, the same screen — "eliminated, the match is still
        // ongoing" — is what puts the player into Spectator Mode.
        // (v3.18.0: the Duat Journey narrates elimination itself — MatchContext.ownsElimination.)
        EventBus.on('humanEliminated', (playerId) => {
            if (playerId !== 0) return;
            import('./gameManager.js').then(gm => {
                if (gm.GameManager.activeMode === 'multiplayer' || MatchContext.ownsElimination) return;
                this.show(99);
            });
        });
    },


    /**
     * Abandon a victory screen that has been scheduled but not yet shown.
     * Called from GameManager.quitGame(), which is the one teardown both
     * modes go through.
     */
    cancelPendingShow() {
        if (this.showTimeout) { clearTimeout(this.showTimeout); this.showTimeout = null; }
        if (this.redirectTimeout) { clearTimeout(this.redirectTimeout); this.redirectTimeout = null; }
        this.screenVictory.classList.remove('active');
    },

    /**
     * The three facts already on the victory screen, in one sentence.
     * `bestReflex === 9999` is this codebase's "no reading taken" sentinel,
     * so that case gets its own string rather than sharing "9999ms" or a
     * dash dropped into the middle of a sentence.
     */
    buildShareText() {
        const stats = this.lastStats || {};
        const cards = Number(stats.cardsWon) || 0;
        const reflex = (typeof stats.bestReflex === 'number' && stats.bestReflex < 9999)
            ? stats.bestReflex : null;
        const won = this.lastWinnerId === 0;
        const key = reflex === null
            ? (won ? 'shareTextWinNoReflex' : 'shareTextLossNoReflex')
            : (won ? 'shareTextWin' : 'shareTextLoss');
        // v3.16.5: the link is TODAY'S BOARD, not the homepage.
        //
        // The stats above are from whatever match just ended, which is often
        // not the Daily Challenge at all. So the sentence keeps the two apart:
        // the numbers are mine, the link is the board that is the same for
        // everyone today. Claiming the friend gets this exact deal would be
        // false for a bots match and false again after UTC midnight.
        //
        // formatDailyUrl returns "" for anything that is not a date, and the
        // fallback is the origin — a share must never carry half a URL.
        const dailyUrl = formatDailyUrl(todayKey(), window.location.origin)
            || window.location.origin;
        return Localization.get(key)
            .replace('{cards}', String(cards))
            .replace('{reflex}', String(reflex))
            .replace('{url}', dailyUrl);
    },

    show(winnerId) {
        if (this.redirectTimeout) clearTimeout(this.redirectTimeout);
        this.lastWinnerId = winnerId;
        // Freeze BEFORE anything renders, so the panel, the PNG and the share
        // text are three views of one set of numbers rather than three reads
        // of a moving one.
        this.lastStats = (GameState && GameState.stats)
            ? { ...GameState.stats }
            : null;

        // v3.16.9 (council ERS-15): retire any notice already standing.
        //
        // Refusing NEW notices while this screen is up is only half the rule.
        // gameOver posts the winner banner as PERMANENT and this screen is
        // raised 1500ms LATER -- so that one is already on the glass before the
        // refusal can apply to it, and being permanent it would never leave on
        // its own. It is retired here rather than in the refusal, because the
        // two are different failures: one is a notice that must not arrive, the
        // other is a notice that must not stay.
        import('./ui.js').then(m => m.UIManager.hideNotification()).catch(() => {
            // A teardown is not a dependency. If ui.js cannot be reached the
            // screen still opens; it just opens under an old banner.
        });
        this.screenGame.classList.remove('active');
        this.screenVictory.classList.add('active');
        this.isDefeat = winnerId !== 0;

        // Auto-redirect to menu after 30 seconds
        this.redirectTimeout = setTimeout(() => {
            console.log("30s timeout reached. Returning to main menu.");
            this.returnToMainMenuUI();
        }, 30000);

        Promise.all([
            import('./ui.js'),
            import('./gameManager.js')
        ]).then(([uiModule, gmModule]) => {
            const isMultiplayer = gmModule.GameManager.activeMode === 'multiplayer';
            const btnPlayAgain = document.getElementById('btn-play-again');
            
            if (isMultiplayer && winnerId !== 99) {
                btnPlayAgain.style.display = 'none';
            } else {
                btnPlayAgain.style.display = 'block';
            }

            if (winnerId === 99) {
                btnPlayAgain.innerText = Localization.get('spectate') || 'Spectate';
            } else {
                btnPlayAgain.innerText = Localization.get('playAgain') || 'Play Again';
            }

            const winnerName = uiModule.UIManager.getVisualName(winnerId);

            // Sinematic Vignettes & 3D Trophy Additions
            const oldOverlay = document.querySelector('.victory-effect-overlay');
            if (oldOverlay) oldOverlay.remove();
            const oldTrophy = document.getElementById('victory-trophy-3d');
            if (oldTrophy) oldTrophy.remove();
            const oldStreakBanner = document.querySelector('.streak-banner');
            if (oldStreakBanner) oldStreakBanner.remove();

            if (winnerId === 0) {
                // === WIN ===
                this.clearDefeatVisuals();
                this.victoryTitle.innerText = Localization.get('win') || '🏆 Victory!';
                this.victoryTitle.style.color = 'gold';
                this.victoryTitle.style.textShadow = '0 0 30px gold, 0 0 60px rgba(255,200,0,0.4)';
                this.msgEl.innerText = `${winnerName} — ${Localization.get('youWonMsg') || 'You collected all 52 cards!'}`;
                this.msgEl.style.color = '#e6edf3';
                
                // Add Golden Vignette
                const goldenGlow = document.createElement('div');
                goldenGlow.className = 'victory-effect-overlay golden-vignette';
                document.body.appendChild(goldenGlow);

                // Add 3D Trophy
                const trophyEl = document.createElement('div');
                trophyEl.id = 'victory-trophy-3d';
                trophyEl.innerText = '🏆';
                this.screenVictory.querySelector('.victory-title').insertAdjacentElement('beforebegin', trophyEl);

                this.startConfetti();
                this.showScoreIncrement();
                this.renderStreakBanner();
            } else {
                // === DEFEAT / ELIMINATION ===
                this.screenVictory.classList.add('defeat-mode');
                
                // Add Crimson Blood Vignette
                const bloodGlow = document.createElement('div');
                bloodGlow.className = 'victory-effect-overlay blood-vignette';
                document.body.appendChild(bloodGlow);

                if (winnerId === 99) {
                    this.victoryTitle.innerText = Localization.get('eliminatedTag') || 'ELIMINATED';
                    this.victoryTitle.style.color = 'var(--error)';
                    this.victoryTitle.style.textShadow = '0 0 30px #f85149, 0 0 70px rgba(248,81,73,0.5)';
                    this.msgEl.innerText = Localization.get('eliminatedMsg') || "You have been eliminated! The match is still ongoing.";
                    this.msgEl.style.color = '#aaa';
                } else if (winnerId === -1) {
                    this.victoryTitle.innerText = Localization.get('gameOver') || 'GAME OVER';
                    this.victoryTitle.style.color = 'var(--error)';
                    this.msgEl.innerText = Localization.get('totalDefeatMsg') || "Everyone was eliminated! No winner this match.";
                    this.msgEl.style.color = '#aaa';
                } else {
                    this.victoryTitle.innerText = Localization.get('defeat') || '💀 Defeated';
                    this.victoryTitle.style.color = 'var(--error)';
                    this.victoryTitle.style.textShadow = '0 0 30px #f85149, 0 0 70px rgba(248,81,73,0.5)';
                    this.msgEl.innerText = `${winnerName} ${Localization.get('botWonMsg')} ${Localization.get('betterLuck')}`;
                    this.msgEl.style.color = '#aaa';
                }
                this.stopParticles();
                this.startEmbers();
                this.shakeScreen();
            }

            // Build Stats Panel
            let statsHtml = '';
            const snap = this.lastStats;
            if (snap) {
                const rx = snap.bestReflex === 9999 ? '---' : `${snap.bestReflex} ms`;
                const cards = snap.cardsWon;
                const burns = snap.burns;
                const slaps = snap.resurrections;
                const mvpText = this.computeMvpMoment(snap, winnerId === 0);
                const mvpHtml = mvpText ? `<div class="mvp-moment">${mvpText}</div>` : '';

                let coinHtml = '';
                if (typeof this.lastCoinDelta === 'number') {
                    const isGain = this.lastCoinDelta > 0;
                    const sign = isGain ? '+' : '';
                    coinHtml = `<div class="coin-result-badge ${isGain ? 'coin-gain' : 'coin-loss'}">🪙 ${sign}${this.lastCoinDelta}</div>`;
                }

                statsHtml = `
                    ${mvpHtml}
                    ${coinHtml}
                    <div class="stats-panel">
                        <div class="stat-card">
                            <span class="stat-title">${Localization.get('statReaction') || 'Reaction Time'}</span>
                            <span class="stat-value" style="color: #58a6ff;">⚡ ${rx}</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-title">${Localization.get('statCardsWon') || 'Cards Won'}</span>
                            <span class="stat-value" style="color: gold;">🃏 ${cards}</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-title">${Localization.get('statBurns') || 'Burn Penalty'}</span>
                            <span class="stat-value" style="color: var(--error);">🔥 ${burns}</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-title">${Localization.get('statSlapBacks') || 'Slap Backs'}</span>
                            <span class="stat-value" style="color: var(--accent);">👋 ${slaps}</span>
                        </div>
                        <button id="btn-share-result" class="share-result-btn" type="button">📤 ${Localization.get('shareResultBtn') || 'Share Result'}</button>
                    </div>
                `;
            }

            // Remove any existing stats panel
            const oldPanel = document.querySelector('.stats-panel');
            if (oldPanel) oldPanel.remove();

            // Insert statsHtml before the menu-buttons
            const menuButtons = this.screenVictory.querySelector('.menu-buttons');
            if (menuButtons && statsHtml) {
                menuButtons.insertAdjacentHTML('beforebegin', statsHtml);

                const shareBtn = document.getElementById('btn-share-result');
                if (shareBtn && snap) {
                    shareBtn.addEventListener('click', () => this.handleShareClick(winnerId, winnerName));
                }
            }
        });
    },

    handleShareClick(winnerId, winnerName) {
        const btn = document.getElementById('btn-share-result');
        if (!btn || btn.disabled) return;
        const originalLabel = btn.innerHTML;
        btn.disabled = true;
        btn.style.opacity = '0.6';

        const snap = this.lastStats || {};
        const rxRaw = snap.bestReflex;
        ResultCard.shareResult({
            won: winnerId === 0,
            winnerName: winnerId === 0 ? (Settings.config.playerName || Localization.get('you') || 'YOU') : winnerName,
            bestReflexMs: rxRaw === 9999 ? null : rxRaw,
            cardsWon: snap.cardsWon,
            streak: StreakTracker.currentStreak
        }).finally(() => {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.innerHTML = originalLabel;
        });
    },

    // Picks ONE narrative highlight for the match from stats that already
    // exist (GameState.stats) — no new tracking added. Checked in order from
    // most to least notable; only the first match is shown. Returns null for
    // a loss with nothing notable, deliberately — no manufactured backhanded
    // compliment for a rough match (see also StreakTracker's own
    // positive-only design, same principle).
    computeMvpMoment(stats, won) {
        if (stats.resurrections >= 2) {
            return Localization.get('mvpComeback').replace('{n}', stats.resurrections);
        }
        if (stats.bestReflex !== 9999 && stats.bestReflex <= 250) {
            return Localization.get('mvpLightning').replace('{ms}', stats.bestReflex);
        }
        if (stats.burns === 0 && stats.cardsWon >= 15) {
            return Localization.get('mvpFlawless');
        }
        if (stats.resurrections === 1) {
            return Localization.get('mvpSurvivor');
        }
        if (won) {
            return Localization.get('mvpSolidWin');
        }
        return null;
    },

    renderStreakBanner() {
        const info = StreakTracker.getBannerInfo();
        if (!info) return;
        const banner = document.createElement('div');
        banner.className = 'streak-banner' + (info.isMilestone ? ' streak-banner-milestone' : (info.isNewBest ? ' streak-banner-best' : ''));
        banner.textContent = info.text;
        const trophyEl = document.getElementById('victory-trophy-3d');
        if (trophyEl) {
            trophyEl.insertAdjacentElement('afterend', banner);
        } else {
            this.screenVictory.querySelector('.victory-title').insertAdjacentElement('afterend', banner);
        }
    },

    shakeScreen() {
        this.screenVictory.style.animation = 'defeatShake 0.5s ease';
        setTimeout(() => {
            this.screenVictory.style.animation = '';
        }, 600);
    },

    returnToWaitingRoom() {
        if (this.redirectTimeout) clearTimeout(this.redirectTimeout);
        this.stopParticles();
        this.clearDefeatVisuals();
        import('./gameManager.js').then(gm => gm.GameManager.quitGame());

        document.body.classList.remove('game-screen');
        document.body.classList.add('menu-screen');
        this.screenVictory.classList.remove('active');

        import('./tableManager.js').then(tm => {
            tm.TableManager.resetToWaiting().then(() => {
                import('./lobbyUI.js').then(module => {
                    module.LobbyUI.enterWaitingRoom(tm.TableManager.currentTableId, false);
                });
            });
        });
        EventBus.emit('gameStateChanged', 'menu');
    },

    /**
     * Clear the defeat paint. v3.7.3 — this used to be five scattered
     * `classList.remove('defeat-mode')` calls shadowed by a sixth marker,
     * `body.defeat-screen`, which had no CSS rule and no reader at all. The two
     * had already drifted: returnToMainMenuUI() cleared the marker that did
     * nothing and left the one that paints, benign only because the win branch
     * happened to re-clear it. One state, one place to clear it.
     */
    clearDefeatVisuals() {
        if (this.screenVictory) this.screenVictory.classList.remove('defeat-mode');
    },

    returnToMainMenuUI() {
        if (this.redirectTimeout) clearTimeout(this.redirectTimeout);
        this.stopParticles();
        
        import('./gameManager.js').then(gm => {
            // Unconditionally reset UI to ensure Spectator Mode locks are always cleared
            import('./ui.js').then(ui => ui.UIManager.resetOfflineUI());
            gm.GameManager.quitGame();
        });
        
        // Hide ALL screens to be safe and avoid "missing button" errors
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        
        // Reset body classes
        document.body.classList.remove('game-screen');
        // v3.7.3: defeat-screen / lobby-screen / waiting-screen were toggled here for
        // months with no CSS rule and no JS reader — pure no-ops. The class that
        // actually paints the defeat state is #victory-screen.defeat-mode
        // (style.css), and THAT is what this path forgot to clear.
        this.clearDefeatVisuals();
        document.body.classList.add('menu-screen');
        
        // Activate main menu
        this.screenMenu.classList.add('active');
        
        // Ensure UI loading state is hidden
        import('./ui.js').then(ui => ui.UIManager.hideLoading());

        EventBus.emit('gameStateChanged', 'menu');
    },

    startConfetti() {
        this.stopParticles();
        this.confettiContainer.innerHTML = '';
        this.particleInterval = setInterval(() => {
            const confetti = document.createElement('div');
            confetti.classList.add('confetti-piece');
            confetti.style.left = Math.random() * 100 + 'vw';
            confetti.style.backgroundColor = ['#f85149', '#58a6ff', '#3fb950', 'gold', '#a371f7'][Math.floor(Math.random() * 5)];
            confetti.style.animationDuration = Math.random() * 3 + 2 + 's';
            this.confettiContainer.appendChild(confetti);
            setTimeout(() => confetti.remove(), 5000);
        }, 100);
    },

    startEmbers() {
        this.stopParticles();
        this.confettiContainer.innerHTML = '';
        this.particleInterval = setInterval(() => {
            const ember = document.createElement('div');
            ember.classList.add('ember-piece');
            ember.style.left = Math.random() * 100 + 'vw';
            const size = Math.random() * 6 + 3;
            ember.style.width = size + 'px';
            ember.style.height = size + 'px';
            ember.style.animationDuration = Math.random() * 3 + 2 + 's';
            ember.style.opacity = Math.random() * 0.7 + 0.3;
            this.confettiContainer.appendChild(ember);
            setTimeout(() => ember.remove(), 5000);
        }, 80);
    },

    stopParticles() {
        clearInterval(this.particleInterval);
        if (this.confettiContainer) this.confettiContainer.innerHTML = '';
    },

    // Kept for backward compat
    stopConfetti() { this.stopParticles(); },

    showScoreIncrement() {
        const existingInc = document.getElementById('score-increment-anim');
        if (existingInc) existingInc.remove();

        const incrementEl = document.createElement('div');
        incrementEl.id = 'score-increment-anim';
        incrementEl.innerText = '+1';
        incrementEl.style.cssText = `
            position: absolute;
            font-size: 3rem;
            font-weight: 900;
            color: gold;
            text-shadow: 0 0 15px gold, 0 5px 10px rgba(0,0,0,0.8);
            top: 60%;
            left: 50%;
            transform: translate(-50%, -50%);
            opacity: 0;
            pointer-events: none;
            animation: floatUpFade 2s ease-out forwards;
        `;
        this.screenVictory.appendChild(incrementEl);
    }
};
