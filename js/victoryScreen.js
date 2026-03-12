import { Settings } from './settings.js';
import { Localization } from './localization.js?v=2';
import EventBus from './eventbus.js';

export const VictoryScreen = {
    init() {
        this.screenVictory = document.getElementById('victory-screen');
        this.screenGame = document.getElementById('game-container');
        this.screenMenu = document.getElementById('main-menu');
        this.confettiContainer = document.getElementById('confetti');
        this.msgEl = document.getElementById('victory-message');
        this.victoryTitle = document.getElementById('victory-title');

        EventBus.on('gameOver', (winnerId) => {
            setTimeout(() => {
                this.show(winnerId);
            }, 1500); // Wait a bit after the win notification finishes
        });

        document.getElementById('btn-play-again').addEventListener('click', () => {
            import('./gameManager.js').then(gm => {
                if (gm.GameManager.activeMode === 'multiplayer') {
                    this.returnToWaitingRoom();
                    return;
                }
                this.screenVictory.classList.remove('active');
                this.screenGame.classList.add('active');
                EventBus.emit('restartGame');
                EventBus.emit('gameStateChanged', 'gameplay');
            });
        });

        document.getElementById('btn-victory-menu').addEventListener('click', () => {
            import('./gameManager.js').then(gm => {
                if (gm.GameManager.activeMode === 'multiplayer') {
                    this.returnToWaitingRoom();
                    return;
                }
                document.body.classList.remove('game-screen');
                document.body.classList.add('menu-screen');
                this.screenVictory.classList.remove('active');
                this.screenMenu.classList.add('active');
                this.stopConfetti();
                EventBus.emit('gameStateChanged', 'menu');
            });
        });
    },

    show(winnerId) {
        this.screenGame.classList.remove('active');
        this.screenVictory.classList.add('active');

        // Dynamically get name
        import('./ui.js').then(ui => {
            const winnerName = ui.UIManager.getVisualName(winnerId);

            // e.g. "Congratulations Ahmet! You won the game!"
            this.msgEl.innerText = winnerId == 0
                ? `${winnerName} - ${Localization.get('youWonMsg') || "You won the game!"}`
                : `${winnerName} ${Localization.get('botWonMsg') || "won the game!"}`;

            if (winnerId == 0) {
                // WIN
                this.victoryTitle.innerText = Localization.get('win');
                this.victoryTitle.style.color = "var(--primary)";
                this.victoryTitle.style.textShadow = "0 0 20px var(--primary)";
                this.startConfetti();

                // Trigger animated +1 score visual
                this.showScoreIncrement();
            } else {
                // LOSE
                this.victoryTitle.innerText = Localization.get('defeat');
                this.victoryTitle.style.color = "var(--error)";
                this.victoryTitle.style.textShadow = "0 0 30px var(--error)";
                this.stopConfetti();
            }
        });
    },

    returnToWaitingRoom() {
        this.stopConfetti();
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

    startConfetti() {
        this.confettiContainer.innerHTML = '';
        this.confettiInterval = setInterval(() => {
            const confetti = document.createElement('div');
            confetti.classList.add('confetti-piece');
            confetti.style.left = Math.random() * 100 + 'vw';
            confetti.style.backgroundColor = ['#f85149', '#58a6ff', '#3fb950', 'gold', '#a371f7'][Math.floor(Math.random() * 5)];
            confetti.style.animationDuration = Math.random() * 3 + 2 + 's';
            this.confettiContainer.appendChild(confetti);

            // Remove after it falls
            setTimeout(() => {
                confetti.remove();
            }, 5000);
        }, 100);
    },

    stopConfetti() {
        clearInterval(this.confettiInterval);
        this.confettiContainer.innerHTML = '';
    },

    showScoreIncrement() {
        const existingInc = document.getElementById('score-increment-anim');
        if (existingInc) existingInc.remove();

        const incrementEl = document.createElement('div');
        incrementEl.id = 'score-increment-anim';
        incrementEl.innerText = '+1';
        incrementEl.style.position = 'absolute';
        incrementEl.style.fontSize = '3rem';
        incrementEl.style.fontWeight = '900';
        incrementEl.style.color = 'gold';
        incrementEl.style.textShadow = '0 0 15px gold, 0 5px 10px rgba(0,0,0,0.8)';
        incrementEl.style.top = '60%';
        incrementEl.style.left = '50%';
        incrementEl.style.transform = 'translate(-50%, -50%)';
        incrementEl.style.opacity = '0';
        incrementEl.style.pointerEvents = 'none';
        incrementEl.style.animation = 'floatUpFade 2s ease-out forwards';
        this.screenVictory.appendChild(incrementEl);
    }
};
