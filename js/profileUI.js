import { AuthSystem } from './auth.js';
import EventBus from './eventbus.js';
import { Localization } from './localization.js?v=2';

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
                const usernameText = this.emailDisplay.innerText;
                this.displayUsername.innerText = `${Localization.get('usernameLabel')}: ${usernameText}`;
            }
            if (this.playerNameDisplay.innerText === 'YOU' || this.playerNameDisplay.innerText === 'SEN' || this.playerNameDisplay.innerText === 'DU' || this.playerNameDisplay.innerText === 'ВЫ') {
                this.playerNameDisplay.innerText = Localization.get('you');
            }
        });
    },

    bindEvents() {
        this.btnProfile.addEventListener('click', () => {
            // Close main menu or settings if open
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            this.panelAccount.classList.add('active');
            document.body.classList.add('menu-screen'); // Ensure background is menu style
            this.clearInputs();
        });

        this.displayUsername.addEventListener('click', () => {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            this.panelAccount.classList.add('active');
            document.body.classList.add('menu-screen');
        });

        document.getElementById('btn-close-account').addEventListener('click', () => {
            this.panelAccount.classList.remove('active');
            document.getElementById('main-menu').classList.add('active');
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
    },

    clearInputs() {
        this.emailInput.value = '';
        this.passwordInput.value = '';
        this.errorMsg.innerText = '';
    }
};
