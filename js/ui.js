import EventBus from './eventbus.js';
import { GameState, getRankName, getSuitSymbol } from './game.js';
import { Localization } from './localization.js?v=2';
import { Settings } from './settings.js';
import { GameManager } from './gameManager.js';

export const UIManager = {
    init() {
        this.deckEls = [
            document.getElementById('human-deck'),
            document.getElementById('left-deck'),
            document.getElementById('top-deck'),
            document.getElementById('right-deck')
        ];
        this.countEls = [
            document.getElementById('p0-count'),
            document.getElementById('p1-count'),
            document.getElementById('p2-count'),
            document.getElementById('p3-count')
        ];
        this.pileEl = document.getElementById('pile-cards');
        this.notifyEl = document.getElementById('notifications');
        this.centerPile = document.getElementById('center-pile');
        this.logEl = document.getElementById('action-log');

        EventBus.on('gameStarted', () => this.updateAll(true));
        EventBus.on('gameSynced', () => this.handleGameSynced());
        EventBus.on('turnChanged', (activeId) => {
            this.deckEls.forEach((el, idx) => {
                if (idx === activeId) el.classList.add('active');
                else el.classList.remove('active');
            });
        });

        EventBus.on('cardPlayed', ({ playerId, card }) => {
            this.updateCounts();
            this.renderPileCard(card);

            const pName = this.getVisualName(playerId);
            const cName = `${getRankName(card.rank)}${getSuitSymbol(card.suit)}`;
            this.addLog(`<strong>${pName}</strong> ${Localization.get('played')} ${cName}`, 'normal');
        });

        EventBus.on('pileWon', ({ winnerId, reason }) => {
            this.updateCounts();
            this.pileEl.innerHTML = '';

            const winnerStr = this.getVisualName(winnerId);
            const msg = reason === 'slap' ? `${winnerStr} ${Localization.get('slapMsg')}` : `${winnerStr} ${Localization.get('wonMsg')}`;
            this.showNotification(msg, 'var(--accent)');
            this.addLog(`<strong>${winnerStr}</strong> ${Localization.get('wonThePile')}`, 'highlight');
        });

        EventBus.on('invalidSlap', ({ playerId, burned }) => {
            this.updateCounts();
            this.renderBurnedCard(burned);

            const pName = this.getVisualName(playerId);

            this.showNotification(`${pName} ${Localization.get('burnMsg')}`, 'var(--error)');
            this.addLog(`<strong>${pName}</strong> ${Localization.get('burnedACard')} (${getRankName(burned.rank)}${getSuitSymbol(burned.suit)})`, 'warning');
        });

        EventBus.on('challengeStarted', (chal) => {
            this.showNotification(`${Localization.get('challengeMsg')} ${chal.chancesLeft} ${Localization.get('chances')}`, 'var(--primary)');
        });

        EventBus.on('gameOver', (winnerId) => {
            const winnerStr = this.getVisualName(winnerId);
            this.showNotification(`${winnerStr} ${Localization.get('winMsg')}`, 'gold', true);
        });

        EventBus.on('gameAbandoned', (visualId) => {
            const abortMsg = visualId === 0 ? Localization.get('you') + " disconnected." : `Player disconnected. Match ended.`;
            this.showNotification(abortMsg, 'var(--error)', true);
            setTimeout(() => {
                document.getElementById('btn-quit').click();
            }, 3000);
        });

        // Input 
        this.centerPile.addEventListener('click', (e) => {
            e.preventDefault();
            GameManager.slap(0);
        });

        this.deckEls[0].addEventListener('click', (e) => {
            e.preventDefault();
            GameManager.playCard(0);
        });
    },

    updateAll(clearLog = false) {
        this.updateCounts();
        this.pileEl.innerHTML = '';
        if (clearLog) {
            this.logEl.innerHTML = '';
        }

        document.getElementById('player-name-display').innerText = this.getVisualName(0);
        document.getElementById('p1-name').innerText = this.getVisualName(1);
        document.getElementById('p2-name').innerText = this.getVisualName(2);
        document.getElementById('p3-name').innerText = this.getVisualName(3);
    },

    handleGameSynced() {
        this.updateAll(false);
        // Redraw pile
        this.pileEl.innerHTML = '';
        if (GameState.pile && GameState.pile.length > 0) {
            GameState.pile.forEach(card => {
                const div = this.createCardElement(card);
                const rot = (card.suit.length + card.rank * 7) % 30 - 15; // deterministic rotation
                div.style.transform = `rotate(${rot}deg) scale(1)`;
                this.pileEl.appendChild(div);
            });
        }

        this.deckEls.forEach((el, idx) => {
            if (idx === GameState.activePlayerId) el.classList.add('active');
            else el.classList.remove('active');
        });

        if (GameState.challenge && GameState.challenge.active) {
            this.showNotification(`${Localization.get('challengeMsg')} ${GameState.challenge.chancesLeft} ${Localization.get('chances')}`, 'var(--primary)');
        }
    },

    getVisualName(visualId) {
        if (GameManager.activeMode === 'multiplayer' && GameManager.modeInstance.getVisualNames) {
            return GameManager.modeInstance.getVisualNames()[visualId];
        }
        if (visualId === 0) return Settings.config.playerName || Localization.get('you');
        return `Bot ${visualId}`;
    },

    updateCounts() {
        for (let i = 0; i < 4; i++) {
            this.countEls[i].innerText = GameState.players[i].length;
            if (GameState.players[i].length === 0) {
                this.deckEls[i].style.opacity = '0.3';
                this.deckEls[i].style.pointerEvents = 'none';
            } else {
                this.deckEls[i].style.opacity = '1';
                this.deckEls[i].style.pointerEvents = 'auto';
            }
        }
    },

    renderPileCard(card) {
        const div = this.createCardElement(card);
        const rot = (Math.random() - 0.5) * 30;
        div.style.transform = `rotate(${rot}deg) scale(0)`;
        this.pileEl.appendChild(div);
        setTimeout(() => {
            div.style.transform = `rotate(${rot}deg) scale(1)`;
        }, 50);
    },

    renderBurnedCard(card) {
        const div = this.createCardElement(card);
        const rot = (Math.random() - 0.5) * 45;
        div.style.transform = `rotate(${rot}deg) scale(1)`;
        this.pileEl.prepend(div);
    },

    createCardElement(card) {
        const div = document.createElement('div');
        div.className = `card ${card.suit === 'hearts' || card.suit === 'diamonds' ? 'red' : 'black'}`;
        const rankStr = getRankName(card.rank);
        const suitStr = getSuitSymbol(card.suit);
        div.innerHTML = `
            <div class="card-top">${rankStr} ${suitStr}</div>
            <div class="card-center">${suitStr}</div>
            <div class="card-bottom">${rankStr} ${suitStr}</div>
        `;
        return div;
    },

    showNotification(msg, color, permanent = false) {
        this.notifyEl.innerText = msg;
        this.notifyEl.style.color = color;
        this.notifyEl.style.transform = 'translate(-50%, -50%) scale(0)';
        this.notifyEl.style.opacity = '1';

        setTimeout(() => {
            this.notifyEl.style.transform = 'translate(-50%, -50%) scale(1.1)';
            setTimeout(() => {
                this.notifyEl.style.transform = 'translate(-50%, -50%) scale(1)';
                if (!permanent) {
                    setTimeout(() => {
                        this.notifyEl.style.opacity = '0';
                    }, 1200);
                }
            }, 200);
        }, 10);
    },

    addLog(htmlContent, type = 'normal') {
        const div = document.createElement('div');
        div.className = `log-entry log-${type}`;
        
        const now = new Date();
        const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        
        div.innerHTML = `<span class="time">[${timeStr}]</span> ${htmlContent}`;
        this.logEl.appendChild(div);
        
        if (this.logEl.children.length > 9) {
            this.logEl.removeChild(this.logEl.firstChild);
        }
        this.logEl.scrollTop = this.logEl.scrollHeight;
    },

    showLoading(message) {
        const overlay = document.getElementById('loading-overlay');
        const msgEl = document.getElementById('loading-message');
        if (msgEl) msgEl.innerText = message || "Connecting...";
        if (overlay) {
            overlay.style.display = 'flex';
        }
    },

    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }
};
