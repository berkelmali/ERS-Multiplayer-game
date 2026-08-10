import { Settings } from './settings.js';
import { Localization } from './localization.js?v=3';
import EventBus from './eventbus.js';
import { GameState } from './game.js';
import { StreakTracker } from './streakTracker.js';
import { ResultCard } from './resultCard.js';

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

        EventBus.on('gameOver', (winnerId) => {
            setTimeout(() => {
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
                this.screenVictory.classList.remove('defeat-mode');
                document.body.classList.remove('defeat-screen');
                this.screenGame.classList.add('active');
                this.stopParticles();
                
                // Spectator Mode UI Locks
                const humanDeck = document.getElementById('human-deck');
                if (humanDeck) {
                    humanDeck.style.pointerEvents = 'none';
                    humanDeck.style.opacity = '0.5';
                }
                const pile = document.getElementById('center-pile');
                if (pile) {
                    pile.style.pointerEvents = 'none';
                }
                return;
            }

            import('./gameManager.js').then(gm => {
                if (gm.GameManager.activeMode === 'multiplayer') {
                    this.returnToWaitingRoom();
                    return;
                }
                this.screenVictory.classList.remove('active');
                this.screenVictory.classList.remove('defeat-mode');
                document.body.classList.remove('defeat-screen');
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
                this.screenVictory.classList.remove('defeat-mode');
                document.body.classList.remove('defeat-screen');
                this.stopParticles();
            }
        });
    },


    show(winnerId) {
        if (this.redirectTimeout) clearTimeout(this.redirectTimeout);
        this.lastWinnerId = winnerId;
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
                this.screenVictory.classList.remove('defeat-mode');
                document.body.classList.remove('defeat-screen');
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
                document.body.classList.add('defeat-screen');
                
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
            if (GameState && GameState.stats) {
                const rx = GameState.stats.bestReflex === 9999 ? '---' : `${GameState.stats.bestReflex} ms`;
                const cards = GameState.stats.cardsWon;
                const burns = GameState.stats.burns;
                const slaps = GameState.stats.resurrections;
                const mvpText = this.computeMvpMoment(GameState.stats, winnerId === 0);
                const mvpHtml = mvpText ? `<div class="mvp-moment">${mvpText}</div>` : '';

                statsHtml = `
                    ${mvpHtml}
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
                if (shareBtn && GameState && GameState.stats) {
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

        const rxRaw = GameState.stats.bestReflex;
        ResultCard.shareResult({
            won: winnerId === 0,
            winnerName: winnerId === 0 ? (Settings.config.playerName || Localization.get('you') || 'YOU') : winnerName,
            bestReflexMs: rxRaw === 9999 ? null : rxRaw,
            cardsWon: GameState.stats.cardsWon,
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
        this.screenVictory.classList.remove('defeat-mode');
        document.body.classList.remove('defeat-screen');
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
        document.body.classList.remove('game-screen', 'defeat-screen', 'lobby-screen', 'waiting-screen');
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
