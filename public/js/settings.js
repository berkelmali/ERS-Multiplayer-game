import { Localization } from './localization.js?v=3';

export const Settings = {
    config: {
        theme: 'theme-classic',
        difficulty: 'medium',
        language: 'en',
        playerName: '',
        musicEnabled: true,
        sfxEnabled: true,
        fastAnimations: false,
        reducedMotion: false,
        highLegibility: false,
        largerText: false,
        matchLength: 'full', // 'full' | 'blitz' — see matchTimer.js / CLAUDE.md §6.22
        equippedCardSkin: 'classic' // see cardSkins.js / CLAUDE.md §6.28
    },

    init() {
        this.load();
        this.applyAll();
        this.bindEvents();
    },

    load() {
        const saved = localStorage.getItem('ersSettings');
        if (saved) {
            try {
                this.config = { ...this.config, ...JSON.parse(saved) };
            } catch (e) {
                console.error("Failed parsing settings", e);
            }
        } else if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            // First-ever visit, no saved preference yet: honor the OS-level signal.
            // Any explicit choice the user makes afterwards is saved and always wins from then on.
            this.config.reducedMotion = true;
        }
    },

    save() {
        localStorage.setItem('ersSettings', JSON.stringify(this.config));
    },

    applyAll() {
        // Apply Theme (Preserve screen state classes)
        document.body.className = document.body.className.replace(/\btheme-\S+/g, '').trim();
        if (this.config.theme) {
            document.body.classList.add(this.config.theme);
        }

        // Apply Language
        Localization.init(this.config.language);

        // Update Select Inputs
        document.getElementById('select-theme').value = this.config.theme;
        document.getElementById('select-difficulty').value = this.config.difficulty;
        document.getElementById('select-lang').value = this.config.language;
        document.getElementById('select-match-length').value = this.config.matchLength;

        // Update Name Input
        if (this.config.playerName) {
            document.getElementById('input-username').value = this.config.playerName;
        }

        // Update Audio Controls
        document.getElementById('toggle-music').checked = this.config.musicEnabled;
        document.getElementById('toggle-sfx').checked = this.config.sfxEnabled;

        // Update Fast Animations
        document.getElementById('toggle-fast-anim').checked = this.config.fastAnimations;
        if (this.config.fastAnimations) {
            document.body.classList.add('fast-animations');
        } else {
            document.body.classList.remove('fast-animations');
        }

        // Update Comfort & Accessibility Settings
        document.getElementById('toggle-reduced-motion').checked = this.config.reducedMotion;
        document.body.classList.toggle('reduced-motion', this.config.reducedMotion);

        document.getElementById('toggle-high-legibility').checked = this.config.highLegibility;
        document.body.classList.toggle('high-legibility', this.config.highLegibility);

        document.getElementById('toggle-larger-text').checked = this.config.largerText;
        document.documentElement.style.fontSize = this.config.largerText ? '112.5%' : '';

        this.updateDifficultyDesc();
    },

    updateDifficultyDesc() {
        const diff = this.config.difficulty || 'medium';
        const key = 'diffDesc' + diff.charAt(0).toUpperCase() + diff.slice(1);
        const descEl = document.getElementById('difficulty-desc');
        if (descEl) {
            descEl.innerHTML = Localization.get(key);
        }
    },

    bindEvents() {
        document.getElementById('select-theme').addEventListener('change', (e) => {
            document.body.className = document.body.className.replace(/\btheme-\S+/g, '').trim();
            this.config.theme = e.target.value;
            document.body.classList.add(this.config.theme);
            this.save();

            // Parallax 3D ışık rengini tema ile senkronize et
            import('./parallax3d.js').then(m => m.Parallax3D.setThemeLight(this.config.theme)).catch(() => {});
        });

        document.getElementById('select-difficulty').addEventListener('change', (e) => {
            this.config.difficulty = e.target.value;
            this.updateDifficultyDesc();
            this.save();
        });

        document.getElementById('select-match-length').addEventListener('change', (e) => {
            this.config.matchLength = e.target.value;
            this.save();
        });

        document.getElementById('select-lang').addEventListener('change', (e) => {
            this.config.language = e.target.value;
            Localization.setLanguage(this.config.language);
            this.updateDifficultyDesc();
            this.save();
        });

        document.getElementById('input-username').addEventListener('input', (e) => {
            this.config.playerName = e.target.value.trim();
            this.save();
        });

        document.getElementById('toggle-music').addEventListener('change', (e) => {
            this.config.musicEnabled = e.target.checked;
            this.save();
            // Instantly stop or play BGM
            import('./audioManager.js').then(module => {
                if (!this.config.musicEnabled) {
                    module.AudioManager.stopBGM();
                } else {
                    import('./game.js').then(gameModule => {
                        if (this.config.musicEnabled) {
                            if (gameModule.GameState.gameStarted) {
                                module.AudioManager.playBGM('gameplayBGM');
                            } else {
                                module.AudioManager.playBGM('menuBGM');
                            }
                        }
                    });
                }
            });
            // Keep original event for backward compat
            import('./eventbus.js').then(module => module.default.emit('musicToggled', this.config.musicEnabled));
        });

        document.getElementById('toggle-sfx').addEventListener('change', (e) => {
            this.config.sfxEnabled = e.target.checked;
            this.save();
        });

        document.getElementById('toggle-fast-anim').addEventListener('change', (e) => {
            this.config.fastAnimations = e.target.checked;
            if (this.config.fastAnimations) {
                document.body.classList.add('fast-animations');
            } else {
                document.body.classList.remove('fast-animations');
            }
            this.save();
        });

        document.getElementById('toggle-reduced-motion').addEventListener('change', (e) => {
            this.config.reducedMotion = e.target.checked;
            document.body.classList.toggle('reduced-motion', this.config.reducedMotion);
            this.save();
        });

        document.getElementById('toggle-high-legibility').addEventListener('change', (e) => {
            this.config.highLegibility = e.target.checked;
            document.body.classList.toggle('high-legibility', this.config.highLegibility);
            this.save();
        });

        document.getElementById('toggle-larger-text').addEventListener('change', (e) => {
            this.config.largerText = e.target.checked;
            document.documentElement.style.fontSize = this.config.largerText ? '112.5%' : '';
            this.save();
        });
    }
};
