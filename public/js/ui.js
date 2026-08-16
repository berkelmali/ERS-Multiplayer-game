import EventBus from './eventbus.js';
import { GameState, getRankName, getSuitSymbol } from './game.js';
import { Localization } from './localization.js?v=3';
import { Settings } from './settings.js';
import { GameManager } from './gameManager.js';
import { CardSkins } from './cardSkins.js';

export const UIManager = {
    initialized: false,
    init() {
        if (this.initialized) return;
        this.initialized = true;
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
        this.challengeBannerEl = document.getElementById('challenge-banner');
        this.challengeAttackerNameEl = document.getElementById('challenge-attacker-name');
        this.challengeDefenderNameEl = document.getElementById('challenge-defender-name');
        this.challengeChancesContainerEl = document.getElementById('challenge-chances-container');
        this.burnPileIndicatorEl = document.getElementById('burn-pile-indicator');
        this.burnPileCountEl = document.getElementById('burn-pile-count');

        this.initEmojiUI();
        this.initQuickChatUI();

        this.previousStatuses = {};
        this.timers = {};
        this.timerInterval = null;
        this.shieldExpireTimestamps = [0, 0, 0, 0];

        // Start premium real-time shield countdown tick interval
        if (this.shieldIntervalId) clearInterval(this.shieldIntervalId);
        this.shieldIntervalId = setInterval(() => {
            const now = Date.now();
            for (let i = 0; i < 4; i++) {
                const expireTime = this.shieldExpireTimestamps ? this.shieldExpireTimestamps[i] : 0;
                const shieldIcon = this.deckEls[i].querySelector('.deck-shield');
                if (shieldIcon && expireTime > now) {
                    const secsLeft = Math.ceil((expireTime - now) / 1000);
                    let shieldText = shieldIcon.querySelector('.shield-timer-text');
                    if (!shieldText) {
                        shieldIcon.innerHTML = `🛡️ <span class="shield-timer-text">${secsLeft}</span>`;
                        shieldText = shieldIcon.querySelector('.shield-timer-text');
                    }
                    if (shieldText) {
                        shieldText.innerText = secsLeft;
                    }
                }
            }
        }, 200);

        EventBus.off('gameStarted');
        EventBus.on('gameStarted', () => {
            this.previousStatuses = {};
            this.shieldExpireTimestamps = [0, 0, 0, 0];
            
            // Clear burn pile indicators at game start
            if (this.burnPileCountEl) this.burnPileCountEl.innerText = '0';
            if (this.burnPileIndicatorEl) this.burnPileIndicatorEl.style.display = 'none';
            
            // Hide challenge banner at game start
            if (this.challengeBannerEl) this.challengeBannerEl.style.display = 'none';

            this.updateAll(true);
        });
        EventBus.off('gameSynced');
        EventBus.on('gameSynced', (data) => this.handleGameSynced(data));

        EventBus.off('syncTurnTimer');
        EventBus.on('syncTurnTimer', ({ activeId, duration }) => {
            const targetDeck = this.deckEls[activeId];
            if (targetDeck) {
                const progress = targetDeck.querySelector('.turn-progress');
                if (progress) {
                    progress.style.animationDuration = `${duration}ms`;
                }
            }
        });

        EventBus.off('turnChanged');
        EventBus.on('turnChanged', (activeId) => {
            // 1. Force remove .active and .turn-progress from EVERYONE first
            document.querySelectorAll('.deck').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.turn-progress').forEach(el => el.remove());

            if (activeId === -1) return; // Sadece temizlik yap ve çık

            // 2. Apply ONLY to the new active player
            const targetDeck = this.deckEls[activeId];
            if (targetDeck) {
                targetDeck.classList.add('active');
                const progress = document.createElement('div');
                progress.className = 'turn-progress';
                targetDeck.appendChild(progress);
                void progress.offsetWidth; // Force animation start
                
                // Use difficult-based duration if available
                const duration = (typeof GameState !== 'undefined' && GameState.getTimeoutDuration) ? GameState.getTimeoutDuration() : 15000;
                progress.style.animationDuration = `${duration}ms`;
            }

            if (activeId === 0 && 'vibrate' in navigator) navigator.vibrate(50);
        });

        EventBus.off('slapAttempt');
        EventBus.on('slapAttempt', (playerId) => {
            if (this.centerPile) {
                this.centerPile.classList.remove('slap-impact');
                void this.centerPile.offsetWidth;
                this.centerPile.classList.add('slap-impact');
                setTimeout(() => {
                    if (this.centerPile) {
                        this.centerPile.classList.remove('slap-impact');
                    }
                }, 300);
            }
        });

        EventBus.off('cardPlayed');
        EventBus.on('cardPlayed', ({ playerId, card }) => {
            this.updateCounts();
            this.renderPileCard(card, playerId);

            const pName = this.getVisualName(playerId);
            const cName = `${getRankName(card.rank)}${getSuitSymbol(card.suit)}`;
            this.addLog(`<strong>${pName}</strong> ${Localization.get('played')} ${cName}`, 'normal');
        });

        EventBus.off('pileWon');
        EventBus.on('pileWon', async ({ winnerId, reason, indices, reactionTime }) => {
            if (winnerId === 0 && reason === 'slap' && 'vibrate' in navigator) navigator.vibrate([100, 50, 100]);

            // BUG FIX: Sync shieldExpireTimestamps with actual game streaks BEFORE updateCounts()
            // game.js winPile() resets streaks[i]=0 for non-winner/non-shield players, but
            // shieldExpireTimestamps is only cleared by shieldShattered/shieldExpired events.
            // This causes the shield icon to persist even after the streak has been reset.
            if (this.shieldExpireTimestamps) {
                for (let i = 0; i < 4; i++) {
                    if (i !== winnerId) {
                        const currentStreak = (GameState.streaks && GameState.streaks[i]) ? GameState.streaks[i] : 0;
                        // If the streak is no longer >= 3, the shield was lost — clear the timestamp
                        if (currentStreak < 3 && this.shieldExpireTimestamps[i] > 0) {
                            this.shieldExpireTimestamps[i] = 0;
                        }
                    }
                }
            }

            this.updateCounts();

            // Reflex Speedometer HUD triggering for slaps
            if (reason === 'slap') {
                let slapTime = reactionTime;
                if (winnerId === 0) {
                    const { GameManager } = await import('./gameManager.js');
                    if (GameManager.activeMode === 'multiplayer' && GameManager.modeInstance && GameManager.modeInstance.localSlapReaction) {
                        slapTime = GameManager.modeInstance.localSlapReaction;
                    } else {
                        slapTime = Date.now() - GameState.lastPlayTime;
                    }
                } else if (!slapTime) {
                    slapTime = Math.floor(320 + Math.random() * 250);
                }

                if (slapTime > 0 && slapTime < 3000) {
                    this.showReflexSpeedometer(winnerId, slapTime);
                }
            }

            // Reset burn pile indicator on pile won
            if (this.burnPileCountEl) {
                this.burnPileCountEl.innerText = '0';
            }
            if (this.burnPileIndicatorEl) {
                this.burnPileIndicatorEl.style.display = 'none';
            }

            // Hide challenge banner when pile is won
            if (this.challengeBannerEl) {
                this.challengeBannerEl.style.display = 'none';
            }

            // Trigger successful slap shockwave
            if (reason === 'slap') {
                this.triggerShockwave('slap');

                // Perfect Slap: tap/click landed within 15px of the pile's visual
                // center on the winning slap. The rules panel has always promised
                // this (see rPerfectTitle/rPerfectDesc in localization.js) — this is
                // what actually implements it.
                if (winnerId === 0 && this._lastSlapAttempt &&
                    (performance.now() - this._lastSlapAttempt.t) < 300 &&
                    this._lastSlapAttempt.dist <= 15) {
                    this.triggerPerfectSlap();
                }
                this._lastSlapAttempt = null;
            }

            const pileCards = Array.from(this.pileEl.children);
            const animateWin = () => {
                if (pileCards.length > 0) {
                    const targetDeck = this.deckEls[winnerId];
                    if (targetDeck) {
                        const deckRect = targetDeck.getBoundingClientRect();
                        const pileRect = this.pileEl.getBoundingClientRect();
                        const tx = deckRect.left + deckRect.width / 2 - (pileRect.left + pileRect.width / 2);
                        const ty = deckRect.top + deckRect.height / 2 - (pileRect.top + pileRect.height / 2);

                        pileCards.forEach(card => {
                            card.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease-out';
                            card.style.transform = `translate(${tx}px, ${ty}px) scale(0.3)`;
                            card.style.opacity = '0';
                        });
                    }
                }

                setTimeout(() => {
                    // Only remove the cards we animated to prevent wiping newly played cards
                    pileCards.forEach(card => card.remove());
                }, 400);
            };

            if (reason === 'slap' && indices && indices.length > 0) {
                indices.forEach(idx => {
                    if (pileCards[idx]) {
                        pileCards[idx].classList.add('highlight-slap');
                    }
                });
                const animDelay = document.body.classList.contains('fast-animations') ? 300 : 600;
                setTimeout(animateWin, animDelay);
            } else {
                animateWin();
            }

            const winnerStr = this.getVisualName(winnerId);

            if (reason === 'slap') {
                this.addLog(`<strong>${winnerStr}</strong> ${Localization.get('slapLogObj')}`, 'slap');
                this.showNotification(`${winnerStr} ${Localization.get('slapLogObj')}`, 'var(--accent)');
            } else {
                this.addLog(`<strong>${winnerStr}</strong> ${Localization.get('chalLogObj')}`, 'challenge');
                this.showNotification(`${winnerStr} ${Localization.get('chalLogObj')}`, 'gold');
            }
        });

        EventBus.off('invalidSlap');
        EventBus.on('invalidSlap', ({ playerId, burned, reason }) => {
            if (playerId === 0 && 'vibrate' in navigator) navigator.vibrate([50, 100, 50, 100, 50]);
            this.updateCounts();
            this.renderBurnedCard(burned);

            // Update burn pile indicator count
            if (typeof GameState !== 'undefined' && GameState.burnPile) {
                const count = GameState.burnPile.length;
                if (this.burnPileCountEl) this.burnPileCountEl.innerText = count;
                if (this.burnPileIndicatorEl) this.burnPileIndicatorEl.style.display = count > 0 ? 'flex' : 'none';
            }

            // Trigger burn shockwave
            this.triggerShockwave('burn');

            const deckEl = this.deckEls[playerId];
            if (deckEl) {
                deckEl.classList.remove('burn-shake');
                void deckEl.offsetWidth;
                deckEl.classList.add('burn-shake');
                setTimeout(() => {
                    if (deckEl) deckEl.classList.remove('burn-shake');
                }, 300);
            }

            const pName = this.getVisualName(playerId);

            if (reason === 'timeout') {
                this.showNotification(`${pName} ${Localization.get('burnMsg') || 'Burned a Card!'}`, 'var(--error)');
                this.addLog(`<strong>${pName}</strong> ${Localization.get('timeoutLogObj') || 'waited too long and burned a card!'} (${getRankName(burned.rank)}${getSuitSymbol(burned.suit)})`, 'error');
            } else {
                this.showNotification(`${pName} ${Localization.get('burnMsg')}`, 'var(--error)');
                this.addLog(`<strong>${pName}</strong> ${Localization.get('burnedACard')} (${getRankName(burned.rank)}${getSuitSymbol(burned.suit)})`, 'warning');
            }
        });
        EventBus.off('challengeStarted');
        EventBus.on('challengeStarted', (chal) => {
            this.showNotification(`${Localization.get('challengeMsg')} ${chal.chancesLeft} ${Localization.get('chances')}`, 'var(--primary)');
            this.updateChallengeBanner(chal);
        });

        EventBus.off('challengeUpdated');
        EventBus.on('challengeUpdated', (chal) => {
            this.updateChallengeBanner(chal);
        });

        EventBus.off('gameOver');
        EventBus.on('gameOver', (winnerId) => {
            const winnerStr = this.getVisualName(winnerId);
            this.showNotification(`${winnerStr} ${Localization.get('winMsg')}`, 'gold', true);
            if (this.challengeBannerEl) this.challengeBannerEl.style.display = 'none';
        });

        EventBus.off('gameAbandoned');
        EventBus.on('gameAbandoned', (visualId) => {
            const abortMsg = visualId === 0 ? Localization.get('youDisconnected') : Localization.get('playerDisconnected');
            this.showNotification(abortMsg, 'var(--error)', true);
            setTimeout(() => {
                document.getElementById('btn-quit').click();
            }, 3000);
        });

        EventBus.off('botReplacement');
        EventBus.on('botReplacement', ({ oldName, newName }) => {
            const rawMsg = Localization.get('botReplacedMsg') || "{old} disconnected! {new} replaced them.";
            const logMsg = rawMsg.replace('{old}', `<strong>${oldName}</strong>`).replace('{new}', `<strong>${newName}</strong>`);
            const notifMsg = rawMsg.replace('{old}', oldName).replace('{new}', newName);

            this.addLog(logMsg, 'warning');
            this.showNotification(notifMsg, 'var(--accent)');
        });

        EventBus.off('resurrected');
        EventBus.on('resurrected', (playerId) => {
            if (playerId === 0) {
                this.showNotification(Localization.get('resurrectedMsg') || "You Slapped Back In!", "var(--accent)");
                this.addLog(`<strong>${this.getVisualName(0)}</strong> ${Localization.get('resurrectedLog') || 'successfully slapped back into the game!'}`, 'highlight');
                this.updateCounts();
            }
        });

        // --- fastSlapBonus (Hızlı Şaplak) Geri Bildirimi ---
        EventBus.off('fastSlapBonus');
        EventBus.on('fastSlapBonus', (playerId) => {
            if (playerId === 0) {
                const title = Localization.get('fastSlapBonusTitle') || "⚡ FAST SLAP! ⚡";
                this.showNotification(title, "gold");
                const logMsg = Localization.get('fastSlapBonusLog') || "made a ⚡ <strong>FAST SLAP</strong> ⚡ (Reaction under 400ms!)";
                this.addLog(`<strong>${this.getVisualName(0)}</strong> ${logMsg}`, 'highlight');
            }
        });

        EventBus.off('shieldEarned');
        EventBus.on('shieldEarned', (playerId) => {
            const pName = this.getVisualName(playerId);
            const title = Localization.get('shieldActivatedTitle') || "SHIELD ACTIVATED!";
            const logMsg = Localization.get('shieldActivatedLog') || "activated Combustion Shield!";
            this.showNotification(`${pName}: ${title}`, "var(--primary)");
            this.addLog(`<strong>${pName}</strong> ${logMsg}`, 'highlight');
            
            // Set 30s expiry timestamp for countdown display
            if (!this.shieldExpireTimestamps) this.shieldExpireTimestamps = [0, 0, 0, 0];
            this.shieldExpireTimestamps[playerId] = Date.now() + 30000;
            
            this.updateCounts();
        });

        EventBus.off('shieldShattered');
        EventBus.on('shieldShattered', (data) => {
            const pid = (data && typeof data === 'object') ? data.playerId : data;
            const pName = this.getVisualName(pid);
            const title = Localization.get('shieldShatteredTitle') || "SHIELD SHATTERED!";
            const logMsg = Localization.get('shieldShatteredLog') || "Combustion Shield shattered and protected them from burning a card!";
            this.showNotification(`${pName}: ${title}`, "var(--error)");
            this.addLog(`<strong>${pName}</strong> ${logMsg}`, 'error');
            
            // Reset expiry timestamp
            if (this.shieldExpireTimestamps) {
                this.shieldExpireTimestamps[pid] = 0;
            }
            
            this.updateCounts();
        });

        EventBus.off('shieldExpired');
        EventBus.on('shieldExpired', (playerId) => {
            const pName = this.getVisualName(playerId);
            const title = Localization.get('shieldExpiredTitle') || "SHIELD EXPIRED!";
            const logMsg = Localization.get('shieldExpiredLog') || "Combustion Shield expired!";
            this.showNotification(`${pName}: ${title}`, "var(--text-secondary)");
            this.addLog(`<strong>${pName}</strong> ${logMsg}`, 'normal');
            
            // Reset expiry timestamp
            if (this.shieldExpireTimestamps) {
                this.shieldExpireTimestamps[playerId] = 0;
            }
            
            this.updateCounts();
        });

        // Input - Use pointerdown instead of click for 0ms latency on mobile tap
        this.centerPile.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            // Record where the human actually tapped/clicked relative to the pile's
            // visual center, so a winning slap can be checked for Perfect Slap precision.
            const pileRect = this.pileEl.getBoundingClientRect();
            const cx = pileRect.left + pileRect.width / 2;
            const cy = pileRect.top + pileRect.height / 2;
            const px = (e.clientX !== undefined) ? e.clientX : cx;
            const py = (e.clientY !== undefined) ? e.clientY : cy;
            this._lastSlapAttempt = { dist: Math.hypot(px - cx, py - cy), t: performance.now() };
            GameManager.slap(0);
        });

        this.deckEls[0].addEventListener('pointerdown', (e) => {
            e.preventDefault();
            GameManager.playCard(0);
        });

        EventBus.off('showEmoji');
        EventBus.on('showEmoji', ({ playerId, emoji }) => {
            if (emoji && emoji.startsWith('qc_')) {
                const key = emoji.substring(3);
                this.showFloatingChat(playerId, key);
            } else {
                this.showFloatingEmoji(playerId, emoji);
            }
        });

        // --- Live language switch: re-render all dynamic in-game text instantly ---
        EventBus.off('languageChanged');
        EventBus.on('languageChanged', () => {
            if (!GameState.gameStarted) return; // Only during an active game

            // Re-render all 4 player name labels
            document.getElementById('player-name-display').innerHTML = this.getVisualNameHTML(0);
            document.getElementById('p1-name').innerHTML = this.getVisualNameHTML(1);
            document.getElementById('p2-name').innerHTML = this.getVisualNameHTML(2);
            document.getElementById('p3-name').innerHTML = this.getVisualNameHTML(3);

            // Refresh the active turn prompt on the human deck
            const promptEl = this.deckEls[0].querySelector('.deck-prompt');
            if (promptEl) {
                const isMyTurn = GameState.activePlayerId === 0;
                promptEl.innerText = isMyTurn ? Localization.get('tapToPlay') : Localization.get('tapToSlap');
            }

            // Refresh quick chat menu items
            const chatMenu = document.getElementById('chat-menu');
            if (chatMenu) {
                chatMenu.querySelectorAll('span[data-i18n]').forEach(span => {
                    const key = span.getAttribute('data-i18n');
                    span.innerText = Localization.get(key);
                });
            }

            // Clear the action log — past entries were in the old language
            // and mixing languages in a log looks broken, so we start fresh
            this.logEl.innerHTML = '';

            // Live refresh challenge banner names if active
            if (this.challengeBannerEl && this.challengeBannerEl.style.display !== 'none') {
                this.updateChallengeBanner(GameState.challenge);
            }
        });
    },

    updateAll(clearLog = false) {
        this.updateCounts();
        if (clearLog) {
            this.logEl.innerHTML = '';
        }

        document.getElementById('player-name-display').innerHTML = this.getVisualNameHTML(0);
        document.getElementById('p1-name').innerHTML = this.getVisualNameHTML(1);
        document.getElementById('p2-name').innerHTML = this.getVisualNameHTML(2);
        document.getElementById('p3-name').innerHTML = this.getVisualNameHTML(3);

        this.startGameTimers();
    },

    handleGameSynced(data) {
        if (data && data.players) {
            data.players.forEach(p => {
                if (!p.uid.startsWith('bot_')) {
                    const prev = this.previousStatuses[p.uid];
                    const currentStatus = p.status || 'online';

                    if (prev === 'online' && currentStatus === 'disconnected') {
                        this.showNotification(`${p.name} disconnected!`, 'var(--error)');
                        this.addLog(`<strong>${p.name}</strong> disconnected.`, 'warning');
                    } else if (prev === 'disconnected' && currentStatus === 'online') {
                        this.showNotification(`${p.name} reconnected!`, 'var(--accent)');
                        this.addLog(`<strong>${p.name}</strong> reconnected.`, 'highlight');
                    }
                    this.previousStatuses[p.uid] = currentStatus;
                }
            });
        }

        this.clearGameTimers();
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

        // Sync Challenge Banner state
        if (GameState.challenge && GameState.challenge.active) {
            this.updateChallengeBanner(GameState.challenge);
        } else {
            if (this.challengeBannerEl) this.challengeBannerEl.style.display = 'none';
        }

        // Sync Burn Pile Count state
        if (GameState.burnPile) {
            const count = GameState.burnPile.length;
            if (this.burnPileCountEl) this.burnPileCountEl.innerText = count;
            if (this.burnPileIndicatorEl) this.burnPileIndicatorEl.style.display = count > 0 ? 'flex' : 'none';
        }
    },

    getVisualName(visualId) {
        if (visualId === -1) return Localization.get('totalDefeat') || 'Total Defeat';
        if (GameManager.activeMode === 'multiplayer' && GameManager.modeInstance.getVisualNames) {
            const names = GameManager.modeInstance.getVisualNames();
            return names[visualId] || (Localization.get('noWinner') || 'No Winner');
        }
        if (visualId === 0) return Settings.config.playerName || Localization.get('you');
        return Localization.get(`bot${visualId}`);
    },

    getVisualNameHTML(visualId) {
        const name = this.getVisualName(visualId);
        const streak = (GameState.streaks && GameState.streaks[visualId]) ? GameState.streaks[visualId] : 0;
        const streakTag = streak >= 2 ? ` <span class="streak-tag">🔥 ${streak}</span>` : '';

        if (GameManager.activeMode === 'multiplayer' && GameManager.modeInstance.getPlayerStatus) {
            const statusObj = GameManager.modeInstance.getPlayerStatus(visualId);

            if (statusObj && statusObj.eliminated) {
                return `
                    <div style="position:relative;">
                        <span style="color:rgba(255,255,255,0.4); filter: grayscale(1);">${name}</span>
                        <div class="eliminated-badge" style="background: var(--error); color: white; border-radius: 4px; padding: 2px 6px; font-size: 0.65rem; font-weight: 900; position: absolute; top: -15px; left: 50%; transform: translateX(-50%); text-transform: uppercase;">
                            ${Localization.get('eliminatedTag') || 'ELIMINATED'}
                        </div>
                    </div>
                `;
            }

            if (statusObj && statusObj.status === 'disconnected') {
                this.timers[visualId] = statusObj.disconnectedAt;

                // Frosted tag aesthetic for the board
                return `
                    <div style="position:relative;">
                        <span style="color:var(--error); text-decoration: line-through; opacity: 0.7;">${name}</span>
                        <div id="game-timer-container-${visualId}" class="slot-timer">
                            ⚡ <span id="game-timer-${visualId}">60</span>s
                        </div>
                    </div>
                `;
            }
        }
        return `<span>${this._personalityIcon(visualId)}${name}${streakTag}</span>`;
    },

    // Small visual reinforcement of the bot personality system (§6.15 in CLAUDE.md) —
    // only ever shown in offline Bot Mode, matching the same scope as BotPersonalities
    // itself in ai.js.
    _personalityIcon(visualId) {
        if (GameManager.activeMode !== 'bots') return '';
        const icons = { 1: '⚡', 2: '🌀', 3: '🐍' };
        if (!icons[visualId]) return '';
        return `<span class="bot-personality-icon">${icons[visualId]}</span> `;
    },

    startGameTimers() {
        if (Object.keys(this.timers).length === 0) return;
        if (!this.timerInterval) {
            this.timerInterval = setInterval(() => {
                const now = Date.now();
                Object.keys(this.timers).forEach(idx => {
                    const elapsed = now - this.timers[idx];
                    const left = Math.max(0, Math.floor((60000 - elapsed) / 1000));

                    // Update board timer
                    const el = document.getElementById(`game-timer-${idx}`);
                    if (el) el.innerText = left;

                    // If it's the local player (idx 0), update the reconnection popup too
                    if (idx == 0) {
                        const popTimer = document.getElementById('reconnect-countdown-text');
                        if (popTimer) popTimer.innerText = left;
                    }
                });
            }, 1000);
        }
    },

    clearGameTimers() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.timers = {};
    },

    updateCounts() {
        for (let i = 0; i < 4; i++) {
            this.countEls[i].innerText = GameState.players[i].length;

            let isEliminated = false;
            if (GameManager.activeMode === 'multiplayer' && GameManager.modeInstance.getPlayerStatus) {
                const status = GameManager.modeInstance.getPlayerStatus(i);
                if (status && status.eliminated) isEliminated = true;
            }

            // Combustion glow handling based on current streak
            const currentStreak = (GameState.streaks && GameState.streaks[i]) ? GameState.streaks[i] : 0;
            if (currentStreak >= 2) {
                this.deckEls[i].classList.add('combustion-glow');
                this.spawnEmbers(i);
            } else {
                this.deckEls[i].classList.remove('combustion-glow');
            }

            // Shield icon management
            let shieldIcon = this.deckEls[i].querySelector('.deck-shield');
            if (currentStreak >= 3) {
                if (!shieldIcon) {
                    shieldIcon = document.createElement('div');
                    shieldIcon.className = 'deck-shield';
                    this.deckEls[i].appendChild(shieldIcon);
                }
                const expireTime = this.shieldExpireTimestamps ? this.shieldExpireTimestamps[i] : 0;
                const now = Date.now();
                if (expireTime > now) {
                    const secsLeft = Math.ceil((expireTime - now) / 1000);
                    shieldIcon.innerHTML = `🛡️ <span class="shield-timer-text">${secsLeft}</span>`;
                } else {
                    shieldIcon.innerHTML = '🛡️';
                }
            } else {
                if (shieldIcon) {
                    shieldIcon.remove();
                }
            }

            if (GameState.players[i].length === 0 || isEliminated) {
                this.deckEls[i].style.opacity = '0.3';
                this.deckEls[i].style.pointerEvents = 'none';
                if (isEliminated) {
                    this.deckEls[i].style.filter = 'grayscale(1)';
                }
            } else {
                this.deckEls[i].style.opacity = '1';
                this.deckEls[i].style.pointerEvents = 'auto';
                this.deckEls[i].style.filter = 'none';
            }

            // --- Danger Zone Tension System (v2.9.0) ---
            // A second, independent visual axis from the shield/streak glow above:
            // this one is driven by CARD COUNT, not slap behavior. Purely reactive
            // to already-synced GameState.players[i].length, so it works
            // identically offline and in multiplayer with no game.js changes.
            const cardCount = GameState.players[i].length;
            const isAlive = cardCount > 0 && !isEliminated;
            let lastCardBadge = this.deckEls[i].querySelector('.deck-lastcard');
            if (isAlive && cardCount === 1) {
                this.deckEls[i].classList.add('danger-critical');
                this.deckEls[i].classList.remove('danger-warning');
                if (!lastCardBadge) {
                    lastCardBadge = document.createElement('div');
                    lastCardBadge.className = 'deck-lastcard';
                    this.deckEls[i].appendChild(lastCardBadge);
                }
                lastCardBadge.textContent = Localization.get('lastCardBadge') || 'LAST CARD!';
            } else if (isAlive && cardCount === 2) {
                this.deckEls[i].classList.add('danger-warning');
                this.deckEls[i].classList.remove('danger-critical');
                if (lastCardBadge) lastCardBadge.remove();
            } else {
                this.deckEls[i].classList.remove('danger-warning', 'danger-critical');
                if (lastCardBadge) lastCardBadge.remove();
            }
        }

        this._updateTensionAudio();
    },

    // Highest tension level currently on the table: 0 = none, 1 = someone at 2
    // cards, 2 = someone at 1 card. Drives the ambient audio layer only —
    // visuals above are per-seat and independent of this aggregate.
    _updateTensionAudio() {
        if (GameState.gameOver) {
            import('./audioManager.js').then(m => m.AudioManager.setTensionLevel && m.AudioManager.setTensionLevel(0));
            return;
        }
        let level = 0;
        for (let i = 0; i < 4; i++) {
            const isEliminated = GameManager.activeMode === 'multiplayer' &&
                GameManager.modeInstance.getPlayerStatus &&
                GameManager.modeInstance.getPlayerStatus(i)?.eliminated;
            if (isEliminated) continue;
            const count = GameState.players[i].length;
            if (count === 1) { level = 2; break; }
            if (count === 2) level = 1;
        }
        import('./audioManager.js').then(m => m.AudioManager.setTensionLevel && m.AudioManager.setTensionLevel(level));
    },

    renderPileCard(card, playerId) {
        const div = this.createCardElement(card);

        // --- Card Skins (v2.9.0, see cardSkins.js / CLAUDE.md §6.28) ---
        // Applied only to cards YOU played (playerId 0) — this is a local
        // rendering preference read from Settings.config, not a synced piece
        // of room state, so it's exactly as safe in multiplayer as it is
        // offline. Other players seeing your skin would need a new synced
        // field (e.g. players[i].cardSkin in the RTDB schema) — a natural
        // next step, deliberately NOT done here to avoid touching the
        // multiplayer schema for a purely decorative feature in this pass.
        if (playerId === 0 && Settings.config.equippedCardSkin && Settings.config.equippedCardSkin !== 'classic') {
            const skinClass = CardSkins.getSkinClass(Settings.config.equippedCardSkin);
            if (skinClass) {
                div.classList.add(skinClass);
                // Inject live visual effects into gameplay cards
                this._injectCardSkinFX(div, Settings.config.equippedCardSkin);
            }
        }

        const rot = (Math.random() - 0.5) * 28; // slight random rotation for naturalness
        div.style.transform = `rotate(${rot}deg)`;
        // The .fly-in class triggers the CSS keyframe animation (0.35s)
        div.classList.add('fly-in');
        this.pileEl.appendChild(div);

        // After the animation ends, clean up the class so stacked cards render normally
        setTimeout(() => {
            if (this.pileEl.contains(div)) {
                div.classList.remove('fly-in');
                div.style.transform = `rotate(${rot}deg) scale(1)`;
            }
        }, 350);
    },

    // Inject shimmer + particles + edge glow into gameplay pile cards
    // Legendary skins get enhanced multi-layer effects (orbiting ring, aura, spark)
    _injectCardSkinFX(cardEl, skinId) {
        const fx = CardSkins.getSkinFX(skinId);
        if (!fx) return;

        // Overlay container
        const overlay = document.createElement('div');
        overlay.className = 'card-skin-overlay';

        // Shimmer sweep
        const shimmer = document.createElement('div');
        shimmer.className = 'card-skin-shimmer';
        overlay.appendChild(shimmer);

        // Floating particles (legendary: multi-color)
        for (let i = 0; i < fx.particleCount; i++) {
            const p = document.createElement('div');
            p.className = 'card-skin-particle';
            const size = 2 + Math.random() * 3;
            let pColor = fx.color;
            if (fx.rarity === 'legendary' && fx.color2 && i % 3 === 1) pColor = fx.color2;
            else if (fx.rarity === 'legendary' && fx.color3 && i % 3 === 2) pColor = fx.color3;
            p.style.width = `${size}px`;
            p.style.height = `${size}px`;
            p.style.left = `${5 + Math.random() * 90}%`;
            p.style.bottom = `${Math.random() * 40}%`;
            p.style.background = `rgba(${pColor}, ${0.6 + Math.random() * 0.4})`;
            p.style.boxShadow = `0 0 ${3 + Math.random() * 5}px rgba(${pColor}, 0.7)`;
            p.style.animationDelay = `${Math.random() * 3}s`;
            p.style.animationDuration = `${2 + Math.random() * 2}s`;
            overlay.appendChild(p);
        }

        cardEl.appendChild(overlay);

        // Edge glow
        const edgeGlow = document.createElement('div');
        edgeGlow.className = 'card-skin-edge-glow';
        cardEl.appendChild(edgeGlow);

        // ─── LEGENDARY-ONLY EFFECTS ───
        if (fx.rarity === 'legendary') {
            // 1. Orbiting energy ring
            const orbitRing = document.createElement('div');
            orbitRing.style.cssText = `
                position: absolute; inset: -4px; border-radius: inherit;
                border: 1px solid rgba(${fx.color}, 0.3);
                pointer-events: none; z-index: 3;
                animation: legendaryOrbit ${skinId === 'holographic' ? '2s' : '3s'} linear infinite;
            `;
            cardEl.appendChild(orbitRing);

            // 2. Pulsing ambient aura
            const aura = document.createElement('div');
            aura.style.cssText = `
                position: absolute; inset: -8px; border-radius: inherit;
                background: radial-gradient(ellipse at 50% 50%,
                    rgba(${fx.color}, 0.08) 0%,
                    rgba(${fx.color2 || fx.color}, 0.04) 40%,
                    transparent 70%);
                pointer-events: none; z-index: 0;
                animation: legendaryAura 2.5s ease-in-out infinite alternate;
            `;
            cardEl.appendChild(aura);

            // 3. Traveling spark along card edge
            const spark = document.createElement('div');
            spark.style.cssText = `
                position: absolute; width: 4px; height: 4px;
                background: rgba(${fx.color2 || fx.color}, 0.9);
                border-radius: 50%;
                box-shadow: 0 0 8px rgba(${fx.color2 || fx.color}, 0.8),
                            0 0 16px rgba(${fx.color}, 0.4);
                pointer-events: none; z-index: 5;
                animation: legendarySpark 4s linear infinite;
            `;
            cardEl.appendChild(spark);

            // 4. Holographic: reverse shimmer
            if (skinId === 'holographic') {
                const shimmer2 = document.createElement('div');
                shimmer2.className = 'card-skin-shimmer';
                shimmer2.style.animation = 'skinShimmerReverse 2.5s linear infinite';
                shimmer2.style.background = `linear-gradient(120deg,
                    transparent 25%, rgba(255,107,107,0.08) 38%,
                    rgba(78,205,196,0.12) 50%, rgba(255,217,61,0.08) 62%, transparent 75%)`;
                overlay.appendChild(shimmer2);
            }

            // Inject keyframes once
            if (!document.getElementById('legendary-fx-keyframes')) {
                const style = document.createElement('style');
                style.id = 'legendary-fx-keyframes';
                style.textContent = `
                    @keyframes legendaryOrbit {
                        0%   { transform: rotate(0deg); border-color: rgba(${fx.color}, 0.3); }
                        50%  { border-color: rgba(${fx.color2 || fx.color}, 0.5); }
                        100% { transform: rotate(360deg); border-color: rgba(${fx.color}, 0.3); }
                    }
                    @keyframes legendaryAura {
                        0%   { opacity: 0.4; transform: scale(1); }
                        100% { opacity: 0.8; transform: scale(1.03); }
                    }
                    @keyframes legendarySpark {
                        0%   { top: 0; left: 10%; opacity: 0; }
                        5%   { opacity: 1; }
                        25%  { top: 0; left: 90%; }
                        50%  { top: 90%; left: 90%; }
                        75%  { top: 90%; left: 10%; }
                        95%  { opacity: 1; }
                        100% { top: 0; left: 10%; opacity: 0; }
                    }
                    @keyframes skinShimmerReverse {
                        0%   { transform: translateX(60%) translateY(20%) rotate(25deg); }
                        100% { transform: translateX(-60%) translateY(-20%) rotate(25deg); }
                    }
                `;
                document.head.appendChild(style);
            }
        }
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

    initEmojiUI() {
        if (document.getElementById('emoji-btn')) return;

        const bottomPlayer = document.getElementById('bottom-player');

        const emojiBtn = document.createElement('div');
        emojiBtn.id = 'emoji-btn';
        emojiBtn.className = 'emoji-btn';
        emojiBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 24px; height: 24px;"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>';
        bottomPlayer.appendChild(emojiBtn);

        const emojiMenu = document.createElement('div');
        emojiMenu.id = 'emoji-menu';
        emojiMenu.className = 'emoji-menu';
        ['😂', '😭', '🔥', '👏', '😱', '😡', '😎', '🤯', '🤔'].forEach(emj => {
            const span = document.createElement('span');
            span.innerText = emj;
            span.onclick = (e) => {
                e.stopPropagation();
                // Close menu
                emojiMenu.classList.remove('active');

                // Throttle check
                if (this.lastEmojiTime && Date.now() - this.lastEmojiTime < 2000) {
                    this.showNotification("Wait a moment!", "var(--error)");
                    return;
                }
                this.lastEmojiTime = Date.now();

                // Emit local
                EventBus.emit('showEmoji', { playerId: 0, emoji: emj });

                // Send to network
                if (GameState.isMultiplayer) {
                    import('./multiplayerMode.js').then(m => m.MultiplayerMode.sendEmoji(emj));
                }
            };
            emojiMenu.appendChild(span);
        });
        bottomPlayer.appendChild(emojiMenu);

        emojiBtn.onclick = (e) => {
            e.stopPropagation();
            emojiMenu.classList.toggle('active');
        };

        // Close when clicking outside
        document.addEventListener('click', () => {
            emojiMenu.classList.remove('active');
        });
    },

    showFloatingEmoji(playerId, emoji) {
        const deck = this.deckEls[playerId];
        if (!deck) return;

        const el = document.createElement('div');
        el.className = 'floating-emoji';
        el.innerText = emoji;
        deck.appendChild(el);

        // Remove after animation (1.5s)
        setTimeout(() => el.remove(), 1500);
    },

    initQuickChatUI() {
        if (document.getElementById('chat-btn')) return;

        const bottomPlayer = document.getElementById('bottom-player');

        const chatBtn = document.createElement('div');
        chatBtn.id = 'chat-btn';
        chatBtn.className = 'chat-btn';
        chatBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
        bottomPlayer.appendChild(chatBtn);

        const chatMenu = document.createElement('div');
        chatMenu.id = 'chat-menu';
        chatMenu.className = 'chat-menu';
        
        ['qc1', 'qc2', 'qc3', 'qc4'].forEach(key => {
            const span = document.createElement('span');
            span.setAttribute('data-i18n', key);
            span.innerText = Localization.get(key);
            span.onclick = (e) => {
                e.stopPropagation();
                chatMenu.classList.remove('active');

                // Throttle check
                if (this.lastEmojiTime && Date.now() - this.lastEmojiTime < 2000) {
                    this.showNotification("Wait a moment!", "var(--error)");
                    return;
                }
                this.lastEmojiTime = Date.now();

                const val = `qc_${key}`;
                // Emit local
                EventBus.emit('showEmoji', { playerId: 0, emoji: val });

                // Send to network
                if (GameState.isMultiplayer) {
                    import('./multiplayerMode.js').then(m => m.MultiplayerMode.sendEmoji(val));
                }
            };
            chatMenu.appendChild(span);
        });
        bottomPlayer.appendChild(chatMenu);

        chatBtn.onclick = (e) => {
            e.stopPropagation();
            chatMenu.classList.toggle('active');
        };

        // Close when clicking outside
        document.addEventListener('click', () => {
            chatMenu.classList.remove('active');
        });
    },

    showFloatingChat(playerId, chatKey) {
        const deck = this.deckEls[playerId];
        if (!deck) return;

        const el = document.createElement('div');
        el.className = 'floating-chat';
        el.innerText = Localization.get(chatKey);
        deck.appendChild(el);

        // Remove after animation (1.8s)
        setTimeout(() => el.remove(), 1800);
    },

    resetOfflineUI() {
        if (this.pileEl) this.pileEl.innerHTML = '';
        if (this.logEl) this.logEl.innerHTML = '';
        
        // Clear burn pile count and hide indicator
        if (this.burnPileCountEl) this.burnPileCountEl.innerText = '0';
        if (this.burnPileIndicatorEl) this.burnPileIndicatorEl.style.display = 'none';
        
        // Hide challenge banner
        if (this.challengeBannerEl) this.challengeBannerEl.style.display = 'none';

        this.deckEls.forEach(el => {
            el.classList.remove('active');
            el.style.filter = 'none';
            el.style.opacity = '1';
            el.style.pointerEvents = 'auto';
        });
        if (this.centerPile) {
            this.centerPile.style.pointerEvents = 'auto';
        }

        // Clear any floating emojis/chats to prevent stuck elements
        document.querySelectorAll('.floating-emoji, .floating-chat').forEach(el => el.remove());

        // Clear shield icons
        document.querySelectorAll('.deck-shield').forEach(el => el.remove());
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
    },

    showDefeatNotice() {
        // Double check: Only show if I am actually the one eliminated
        import('./multiplayerMode.js').then(module => {
            const mm = module.MultiplayerMode;
            const myActualIndex = mm.toActual(0);
            import('./firebaseSync.js').then(sync => {
                const me = sync.FirebaseSync.roomData?.players?.[myActualIndex];
                if (!me || !me.eliminated) return;

                this.showNotification(Localization.get('eliminatedMsg') || "You have been eliminated!", "var(--error)", false);

                // Don't force redirect, the VictoryScreen will handle it
                // if the game eventually ends.
            });
        });
    },

    showConfirmModal(action, opts = {}) {
        const modal = document.getElementById('confirm-modal');
        const btnConfirm = document.getElementById('btn-confirm-leave');
        const btnCancel = document.getElementById('btn-cancel-leave');
        const subtext = modal.querySelector('.modal-subtext');

        if (subtext) {
            let text = Localization.get('confirmLeaveSubtext') || "Your slot will instantly convert to a Bot. Any active slap streaks or score increments for this match will be forfeited!";
            if (typeof opts.coinPenalty === 'number' && opts.coinPenalty !== 0) {
                text += `\n\n🪙 ${opts.coinPenalty} ` + (Localization.get('coinPenaltyWarning') || 'coin will be deducted.');
            }
            subtext.innerText = text;
        }

        modal.classList.add('active');

        const cleanup = () => {
            modal.classList.remove('active');
            btnConfirm.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', onCancel);
        };

        const onConfirm = () => {
            cleanup();
            if (action) action();
        };

        const onCancel = () => {
            cleanup();
        };

        btnConfirm.addEventListener('click', onConfirm);
        btnCancel.addEventListener('click', onCancel);
    },

    triggerShockwave(type) {
        if (!this.centerPile) return;
        const wave = document.createElement('div');
        wave.className = type === 'slap' ? 'slap-shockwave' : 'burn-shockwave';
        this.centerPile.appendChild(wave);
        wave.addEventListener('animationend', () => {
            wave.remove();
        });
    },

    triggerPerfectSlap() {
        if (!this.centerPile) return;

        // Neon star-burst particles
        const burst = document.createElement('div');
        burst.className = 'perfect-slap-burst';
        for (let i = 0; i < 8; i++) {
            const star = document.createElement('span');
            star.className = 'perfect-slap-star';
            star.style.setProperty('--angle', `${i * 45}deg`);
            burst.appendChild(star);
        }
        this.centerPile.appendChild(burst);
        burst.addEventListener('animationend', () => burst.remove());
        setTimeout(() => { if (burst.parentNode) burst.remove(); }, 900);

        // Toast label
        const toast = document.createElement('div');
        toast.className = 'perfect-slap-toast';
        toast.innerHTML = Localization.get('perfectSlapTitle') || '🎯 PERFECT SLAP!';
        this.centerPile.appendChild(toast);
        toast.addEventListener('animationend', () => toast.remove());
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 1200);

        import('./audioManager.js').then(module => {
            if (module.AudioManager && module.AudioManager.playPerfectSlap) {
                module.AudioManager.playPerfectSlap();
            }
        });
    },

    showReflexSpeedometer(winnerId, slapTime) {
        if (!this.centerPile) return;

        let badgeClass = 'reflex-lucky';
        let badgeLabel = 'LUCKY';
        let vignetteColor = 'rgba(128, 128, 128, 0.3)'; // Silver-gray glow

        if (slapTime < 300) {
            badgeClass = 'reflex-godlike';
            badgeLabel = 'GODLIKE';
            vignetteColor = 'rgba(255, 215, 0, 0.4)'; // Gold glow
            
            // Melis's pitch audio feedback
            import('./audioManager.js').then(module => {
                if (module.AudioManager && module.AudioManager.playGodlikeSlap) {
                    module.AudioManager.playGodlikeSlap();
                }
            });
        } else if (slapTime < 500) {
            badgeClass = 'reflex-fast';
            badgeLabel = 'FAST';
            vignetteColor = 'rgba(46, 204, 113, 0.4)'; // Emerald green glow
        } else if (slapTime < 750) {
            badgeClass = 'reflex-good';
            badgeLabel = 'GOOD';
            vignetteColor = 'rgba(52, 152, 219, 0.4)'; // Sapphire blue glow
        }

        const speedometer = document.createElement('div');
        speedometer.className = `reflex-speedometer ${badgeClass}`;
        const name = this.getVisualName(winnerId);
        speedometer.innerHTML = `⚡ ${name}: ${slapTime}ms <span class="badge">${badgeLabel}</span>`;
        this.centerPile.appendChild(speedometer);

        // Vignette pulse
        const vignette = document.createElement('div');
        vignette.className = 'reflex-vignette';
        vignette.style.boxShadow = `inset 0 0 100px ${vignetteColor}`;
        document.body.appendChild(vignette);

        // Clean up
        setTimeout(() => {
            speedometer.remove();
            vignette.remove();
        }, 1200);
    },

    spawnEmbers(visualId) {
        const deck = this.deckEls[visualId];
        if (!deck) return;
        
        const now = Date.now();
        if (!this.lastEmberTime) this.lastEmberTime = {};
        if (this.lastEmberTime[visualId] && now - this.lastEmberTime[visualId] < 300) return;
        this.lastEmberTime[visualId] = now;

        const ember = document.createElement('div');
        ember.className = 'ember-particle';
        
        const rect = deck.getBoundingClientRect();
        const randX = Math.random() * (rect.width - 20) + 10;
        ember.style.left = `${randX}px`;
        ember.style.bottom = `10px`;
        
        const size = Math.random() * 5 + 3;
        ember.style.width = `${size}px`;
        ember.style.height = `${size}px`;
        ember.style.animationDuration = `${Math.random() * 0.8 + 0.6}s`;

        deck.appendChild(ember);
        
        setTimeout(() => {
            ember.remove();
        }, 1400);
    },

    updateChallengeBanner(chal) {
        if (!this.challengeBannerEl) return;
        if (!chal || !chal.active) {
            this.challengeBannerEl.style.display = 'none';
            return;
        }

        const attackerName = this.getVisualName(chal.attackerId);
        const defenderName = this.getVisualName(chal.defenderId);

        if (this.challengeAttackerNameEl) this.challengeAttackerNameEl.innerText = attackerName;
        if (this.challengeDefenderNameEl) this.challengeDefenderNameEl.innerText = defenderName;

        if (this.challengeChancesContainerEl) {
            this.challengeChancesContainerEl.innerHTML = '';
            
            // Jack = 1, Queen = 2, King = 3, Ace = 4
            let totalChances = chal.chancesLeft;
            if (typeof GameState !== 'undefined' && GameState.pile && GameState.pile.length > 0) {
                // find the last face card played
                for (let i = GameState.pile.length - 1; i >= 0; i--) {
                    const c = GameState.pile[i];
                    if (c.rank >= 11) {
                        const faceChances = { 11: 1, 12: 2, 13: 3, 14: 4 };
                        totalChances = faceChances[c.rank] || chal.chancesLeft;
                        break;
                    }
                }
            }

            for (let i = 0; i < totalChances; i++) {
                const dot = document.createElement('div');
                dot.className = `chance-dot ${i < chal.chancesLeft ? 'active' : 'spent'}`;
                this.challengeChancesContainerEl.appendChild(dot);
            }
        }

        this.challengeBannerEl.style.display = 'block';
    }
};
