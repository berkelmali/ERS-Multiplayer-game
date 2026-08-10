import { AuthSystem } from './auth.js';
import EventBus from './eventbus.js';
import { Localization } from './localization.js?v=3';

export const ProfileUI = {
    init() {
        this.btnProfile = document.getElementById('user-profile-btn');
        this.btnProfileText = document.getElementById('profile-btn-text');
        this.panelAccount = document.getElementById('account-panel');

        this.loggedOutSection = document.getElementById('account-logged-out');
        this.loggedInSection = document.getElementById('account-logged-in');

        this.emailInput = document.getElementById('auth-email');
        this.emailGroup = document.getElementById('auth-email-group');
        this.usernameInput = document.getElementById('auth-username');
        this.usernameGroup = document.getElementById('auth-username-group');
        this.passwordInput = document.getElementById('auth-password');
        this.errorMsg = document.getElementById('auth-error');
        this.emailDisplay = document.getElementById('account-email-display');
        this.scoreDisplay = document.getElementById('display-score');

        // New persistent elements
        this.topLeftCorner = document.getElementById('top-left-corner');
        this.displayUsername = document.getElementById('display-username');
        this.topRightScore = document.getElementById('top-right-score');

        // Registration toggles
        this.btnToggleRegister = document.getElementById('btn-toggle-register');
        this.registerActions = document.getElementById('register-actions');
        this.btnSignIn = document.getElementById('btn-signin');
        this.btnToggleLogin = document.getElementById('btn-toggle-login');

        this.isRegisterMode = false;

        this.playerNameDisplay = document.getElementById('player-name-display');

        this.bindEvents();

        EventBus.on('profileLoaded', (profile) => {
            this.updateUI(profile);
            if (profile && profile.username) {
                this.playerNameDisplay.innerText = profile.username;
            } else {
                this.playerNameDisplay.innerText = 'YOU';
            }
        });

        EventBus.on('scoreUpdated', (newScore) => {
            this.scoreDisplay.innerText = newScore;
        });

        EventBus.on('languageChanged', () => {
            if (this.loggedInSection.style.display === 'block') {
                const usernameText = document.getElementById('account-username-display').innerText;
                this.displayUsername.innerText = `${Localization.get('usernameLabel')}: ${usernameText}`;
            }
            if (this.playerNameDisplay.innerText === 'YOU' || this.playerNameDisplay.innerText === 'SEN' || this.playerNameDisplay.innerText === 'DU' || this.playerNameDisplay.innerText === 'ВЫ') {
                this.playerNameDisplay.innerText = Localization.get('you');
            }
        });

        EventBus.on('gameOver', (winnerId) => {
            import('./game.js').then(module => {
                const GameState = module.GameState;
                if (!GameState) return;

                const isWin = (winnerId === 0);
                const bestReflex = (GameState.stats && GameState.stats.bestReflex < 9999) ? GameState.stats.bestReflex : null;
                const cardsWon = GameState.stats ? GameState.stats.cardsWon : 0;
                const isMulti = GameState.isMultiplayer;

                let opponents = ['Bot 1', 'Bot 2', 'Bot 3'];
                if (isMulti) {
                    import('./firebaseSync.js').then(sync => {
                        const FirebaseSync = sync.FirebaseSync;
                        if (FirebaseSync.roomData && FirebaseSync.roomData.players) {
                            opponents = FirebaseSync.roomData.players
                                .filter((p, idx) => idx !== FirebaseSync.localPlayerIndex)
                                .map(p => p.name);
                        }
                        this.saveMatchToHistory({
                            date: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
                            result: isWin ? 'WIN' : 'DEFEAT',
                            bestReflex,
                            cardsWon,
                            opponents: opponents.join(', '),
                            mode: isMulti ? 'Multiplayer' : 'Offline'
                        });
                    });
                } else {
                    this.saveMatchToHistory({
                        date: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
                        result: isWin ? 'WIN' : 'DEFEAT',
                        bestReflex,
                        cardsWon,
                        opponents: opponents.join(', '),
                        mode: 'Offline'
                    });
                }
            });
        });
    },

    bindEvents() {
        this.btnProfile.addEventListener('click', () => {
            const activeScreen = document.querySelector('.screen.active');
            if (activeScreen && activeScreen.id !== 'account-panel') {
                this.previousScreenId = activeScreen.id;
            } else {
                this.previousScreenId = 'main-menu';
            }
            this.wasGameScreen = document.body.classList.contains('game-screen');

            // Parallax'ı geçici olarak gizle (body class değişimi çakışmasını önle)
            this._parallaxWasActive = document.body.classList.contains('parallax-active');
            if (this._parallaxWasActive) {
                document.body.classList.remove('parallax-active');
                const scene = document.getElementById('parallax-scene');
                if (scene) scene.classList.add('parallax-hidden');
            }

            // Close main menu or settings if open
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            this.panelAccount.classList.add('active');
            document.body.classList.add('menu-screen'); // Ensure background is menu style
            document.body.classList.remove('game-screen');
            this.clearInputs();
        });

        this.displayUsername.addEventListener('click', () => {
            const activeScreen = document.querySelector('.screen.active');
            if (activeScreen && activeScreen.id !== 'account-panel') {
                this.previousScreenId = activeScreen.id;
            } else {
                this.previousScreenId = 'main-menu';
            }
            this.wasGameScreen = document.body.classList.contains('game-screen');

            // Parallax'ı geçici olarak gizle
            this._parallaxWasActive = document.body.classList.contains('parallax-active');
            if (this._parallaxWasActive) {
                document.body.classList.remove('parallax-active');
                const scene = document.getElementById('parallax-scene');
                if (scene) scene.classList.add('parallax-hidden');
            }

            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            this.panelAccount.classList.add('active');
            document.body.classList.add('menu-screen');
            document.body.classList.remove('game-screen');
        });

        document.getElementById('btn-close-account').addEventListener('click', () => {
            this.panelAccount.classList.remove('active');
            
            const targetScreenId = this.previousScreenId || 'main-menu';
            const targetScreen = document.getElementById(targetScreenId);
            if (targetScreen) {
                targetScreen.classList.add('active');
            }
            
            if (this.wasGameScreen) {
                document.body.classList.add('game-screen');
                document.body.classList.remove('menu-screen');
            } else {
                document.body.classList.add('menu-screen');
                document.body.classList.remove('game-screen');

                // Menüye dönüyorsak parallax'ı geri aç
                if (this._parallaxWasActive) {
                    document.body.classList.add('parallax-active');
                    const scene = document.getElementById('parallax-scene');
                    if (scene) scene.classList.remove('parallax-hidden');
                }
            }
        });

        document.getElementById('btn-signin').addEventListener('click', async () => {
            await this.handleAuthAction('signin');
        });

        document.getElementById('btn-signup').addEventListener('click', async () => {
            await this.handleAuthAction('register');
        });

        this.btnToggleRegister.addEventListener('click', () => {
            this.isRegisterMode = true;
            this.usernameGroup.style.display = 'flex';
            this.btnSignIn.style.display = 'none';
            this.btnToggleRegister.style.display = 'none';
            this.registerActions.style.display = 'flex';
            this.errorMsg.innerText = '';
        });

        this.btnToggleLogin.addEventListener('click', () => {
            this.isRegisterMode = false;
            this.usernameGroup.style.display = 'none';
            this.btnSignIn.style.display = 'block';
            this.btnToggleRegister.style.display = 'block';
            this.registerActions.style.display = 'none';
            this.errorMsg.innerText = '';
        });

        document.getElementById('btn-signout').addEventListener('click', async () => {
            localStorage.removeItem('ers_active_table');
            await AuthSystem.logout();
        });
    },

    async handleAuthAction(action) {
        this.errorMsg.innerText = '';
        const email = this.emailInput.value.trim();
        const password = this.passwordInput.value;
        const username = this.usernameInput.value.trim();

        if (action === 'register' && (!username || !email || !password)) {
            this.errorMsg.innerText = 'Username, email, and password are required.';
            return;
        }

        if (action === 'signin' && (!email || !password)) {
            this.errorMsg.innerText = 'Email and password are required.';
            return;
        }

        let result;
        if (action === 'signin') {
            result = await AuthSystem.signIn(email, password);
        } else {
            result = await AuthSystem.register(username, email, password);
        }

        if (!result.success) {
            this.errorMsg.innerText = result.message;
        } else {
            this.clearInputs();
        }
    },

    updateUI(profile) {
        if (profile) {
            this.loggedOutSection.style.display = 'none';
            this.loggedInSection.style.display = 'block';

            // Insert new layout data
            this.emailDisplay.innerText = profile.email;
            document.getElementById('account-username-display').innerText = profile.username;
            if (this.scoreDisplay.innerText === '0') this.scoreDisplay.innerText = profile.score;
            document.getElementById('account-score-display').innerText = profile.score;
            
            const reflexEl = document.getElementById('account-reflex-display');
            if (reflexEl) {
                reflexEl.innerText = profile.bestReflex ? `${profile.bestReflex}ms` : '---';
            }

            // Toggle persistent corners
            this.btnProfile.style.display = 'none';
            this.displayUsername.style.display = 'block';
            this.displayUsername.innerText = `${Localization.get('usernameLabel')}: ${profile.username}`;
            this.displayUsername.style.cursor = 'pointer'; // Show it's clickable
            this.topRightScore.style.display = 'block';

            // Auto close modal if logged in and direct to main menu
            if (this.panelAccount.classList.contains('active')) {
                this.panelAccount.classList.remove('active');
                if (!document.querySelector('.screen.active')) {
                    document.getElementById('main-menu').classList.add('active');
                }
            }

            if (this.scoreDisplay.innerText === '0') this.scoreDisplay.innerText = profile.score;

            // Sync Main Menu Player Name
            import('./settings.js').then(module => {
                module.Settings.config.playerName = profile.username;
                module.Settings.save();
                const userNameGroup = document.getElementById('main-menu-username-group');
                if (userNameGroup) userNameGroup.style.display = 'none';
            });
        } else {
            this.loggedOutSection.style.display = 'block';
            this.loggedInSection.style.display = 'none';

            // Reset register mode
            this.isRegisterMode = false;
            this.usernameGroup.style.display = 'none';
            this.btnSignIn.style.display = 'block';
            this.btnToggleRegister.style.display = 'block';
            this.registerActions.style.display = 'none';

            // Toggle persistent corners
            this.btnProfile.style.display = 'flex';
            this.displayUsername.style.display = 'none';
            this.topRightScore.style.display = 'none';

            this.scoreDisplay.innerText = '0';

            import('./settings.js').then(module => {
                const userNameGroup = document.getElementById('main-menu-username-group');
                if (userNameGroup) userNameGroup.style.display = 'flex';

                const inputPlayerName = document.getElementById('input-username');
                if (inputPlayerName) {
                    inputPlayerName.disabled = false;
                    inputPlayerName.style.opacity = '1';
                    inputPlayerName.style.cursor = 'text';
                }
            });
        }

        // Render match history on UI update
        this.renderMatchHistory();
    },

    clearInputs() {
        this.emailInput.value = '';
        this.passwordInput.value = '';
        this.errorMsg.innerText = '';
    },

    saveMatchToHistory(record) {
        try {
            const history = JSON.parse(localStorage.getItem('ers_match_history') || '[]');
            history.unshift(record);
            if (history.length > 5) history.pop();
            localStorage.setItem('ers_match_history', JSON.stringify(history));
            this.renderMatchHistory();
        } catch (e) {
            console.error("Failed to save match history:", e);
        }
    },

    renderMatchHistory() {
        const listEl = document.getElementById('match-history-list');
        const graphEl = document.getElementById('reflex-graph-wrapper');
        if (!listEl || !graphEl) return;

        listEl.innerHTML = '';
        graphEl.innerHTML = '';

        let history = [];
        try {
            history = JSON.parse(localStorage.getItem('ers_match_history') || '[]');
        } catch (e) {
            console.error("Failed to parse history", e);
        }

        if (history.length === 0) {
            listEl.innerHTML = `<div style="color: rgba(255,255,255,0.4); text-align: center; font-size: 0.8rem; padding: 10px;" data-i18n="noHistory">No matches played yet.</div>`;
            graphEl.innerHTML = `<div style="color: rgba(255,255,255,0.3); text-align: center; font-size: 0.75rem; padding-top: 40px;" data-i18n="noTrend">Reflex trend curve will appear here.</div>`;
            return;
        }

        history.forEach(m => {
            const card = document.createElement('div');
            card.style.background = m.result === 'WIN' ? 'rgba(46, 204, 113, 0.12)' : 'rgba(231, 76, 60, 0.12)';
            card.style.border = m.result === 'WIN' ? '1px solid rgba(46, 204, 113, 0.25)' : '1px solid rgba(231, 76, 60, 0.25)';
            card.style.borderRadius = '8px';
            card.style.padding = '8px 10px';
            card.style.display = 'flex';
            card.style.justifyContent = 'space-between';
            card.style.alignItems = 'center';
            card.style.fontSize = '0.78rem';

            const reflexStr = m.bestReflex ? `${m.bestReflex}ms` : '---';

            card.innerHTML = `
                <div>
                    <div style="font-weight: 700; color: ${m.result === 'WIN' ? '#2ecc71' : '#e74c3c'}; display:flex; align-items:center; gap:6px;">
                        <span>${m.result === 'WIN' ? '🏆 WIN' : '💀 DEFEAT'}</span>
                        <span style="font-size: 0.65rem; background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 4px; color: rgba(255,255,255,0.6);">${m.mode}</span>
                    </div>
                    <div style="font-size: 0.68rem; color: rgba(255,255,255,0.4); margin-top: 3px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        vs ${m.opponents}
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 700; color: #58a6ff;">⚡ ${reflexStr}</div>
                    <div style="font-size: 0.68rem; color: rgba(255,255,255,0.4); margin-top: 3px;">🎴 ${m.cardsWon} ${Localization.get('cardsLabel') || 'cards'}</div>
                </div>
            `;
            listEl.appendChild(card);
        });

        const matchesForGraph = [...history].reverse();
        const width = 280;
        const height = 100;
        const paddingLeft = 25;
        const paddingRight = 10;
        const paddingTop = 15;
        const paddingBottom = 15;

        const reflexValues = matchesForGraph.map(m => m.bestReflex).filter(v => v !== null && v > 0);
        let minVal = reflexValues.length > 0 ? Math.min(...reflexValues, 200) : 200;
        let maxVal = reflexValues.length > 0 ? Math.max(...reflexValues, 800) : 800;
        
        minVal = Math.max(50, minVal - 50);
        maxVal = maxVal + 50;

        const valRange = maxVal - minVal;

        const getX = (index) => {
            if (matchesForGraph.length <= 1) return paddingLeft + (width - paddingLeft - paddingRight) / 2;
            return paddingLeft + (index / (matchesForGraph.length - 1)) * (width - paddingLeft - paddingRight);
        };

        const getY = (val) => {
            if (val === null || val === undefined) return paddingTop + (height - paddingTop - paddingBottom) / 2;
            const pct = (val - minVal) / valRange;
            return height - paddingBottom - pct * (height - paddingTop - paddingBottom);
        };

        let svgHtml = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" style="display:block;">`;
        svgHtml += `<line x1="${paddingLeft}" y1="${paddingTop}" x2="${width - paddingRight}" y2="${paddingTop}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="2,2"/>`;
        svgHtml += `<line x1="${paddingLeft}" y1="${height - paddingBottom}" x2="${width - paddingRight}" y2="${height - paddingBottom}" stroke="rgba(255,255,255,0.08)"/>`;
        
        svgHtml += `<text x="2" y="${paddingTop + 3}" fill="rgba(255,255,255,0.3)" font-size="7" font-family="monospace">${Math.round(maxVal)}ms</text>`;
        svgHtml += `<text x="2" y="${height - paddingBottom + 3}" fill="rgba(255,255,255,0.3)" font-size="7" font-family="monospace">${Math.round(minVal)}ms</text>`;

        const points = [];
        matchesForGraph.forEach((m, idx) => {
            if (m.bestReflex !== null) {
                points.push({ x: getX(idx), y: getY(m.bestReflex), val: m.bestReflex, idx });
            }
        });

        if (points.length > 1) {
            let areaPath = `M ${points[0].x} ${height - paddingBottom} `;
            points.forEach(p => {
                areaPath += `L ${p.x} ${p.y} `;
            });
            areaPath += `L ${points[points.length - 1].x} ${height - paddingBottom} Z`;

            svgHtml += `
                <defs>
                    <linearGradient id="graphGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#58a6ff" stop-opacity="0.25"/>
                        <stop offset="100%" stop-color="#58a6ff" stop-opacity="0.0"/>
                    </linearGradient>
                </defs>
                <path d="${areaPath}" fill="url(#graphGradient)"/>
            `;

            let linePath = `M ${points[0].x} ${points[0].y} `;
            for (let i = 1; i < points.length; i++) {
                linePath += `L ${points[i].x} ${points[i].y} `;
            }
            svgHtml += `<path d="${linePath}" fill="none" stroke="#58a6ff" stroke-width="2" filter="drop-shadow(0 0 3px rgba(88,166,255,0.5))"/>`;
        }

        points.forEach(p => {
            svgHtml += `
                <circle cx="${p.x}" cy="${p.y}" r="3" fill="#58a6ff" stroke="#fff" stroke-width="1"/>
                <text x="${p.x}" y="${p.y - 6}" fill="rgba(255,255,255,0.85)" font-size="6.5" font-weight="700" text-anchor="middle" font-family="sans-serif">${p.val}ms</text>
            `;
        });

        svgHtml += `</svg>`;
        graphEl.innerHTML = svgHtml;
    }
};
