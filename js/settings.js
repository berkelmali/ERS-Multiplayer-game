import { Localization } from './localization.js?v=2';

export const Settings = {
    config: {
        theme: 'theme-classic',
        difficulty: 'medium',
        language: 'en',
        playerName: '',
        musicEnabled: true,
        sfxEnabled: true
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
        }
    },

    save() {
        localStorage.setItem('ersSettings', JSON.stringify(this.config));
    },

    applyAll() {
        // Apply Theme (Preserve screen state classes)
        document.body.classList.forEach(c => {
            if (c.startsWith('theme-')) document.body.classList.remove(c);
        });
        document.body.classList.add(this.config.theme);

        // Apply Language
        Localization.init(this.config.language);

        // Update Select Inputs
        document.getElementById('select-theme').value = this.config.theme;
        document.getElementById('select-difficulty').value = this.config.difficulty;
        document.getElementById('select-lang').value = this.config.language;

        // Update Name Input
        if (this.config.playerName) {
            document.getElementById('input-username').value = this.config.playerName;
        }

        // Update Audio Controls
        document.getElementById('toggle-music').checked = this.config.musicEnabled;
        document.getElementById('toggle-sfx').checked = this.config.sfxEnabled;
    },

    bindEvents() {
        document.getElementById('select-theme').addEventListener('change', (e) => {
            document.body.classList.forEach(c => {
                if (c.startsWith('theme-')) document.body.classList.remove(c);
            });
            this.config.theme = e.target.value;
            document.body.classList.add(this.config.theme);
            this.save();
        });

        document.getElementById('select-difficulty').addEventListener('change', (e) => {
            this.config.difficulty = e.target.value;
            this.save();
        });

        document.getElementById('select-lang').addEventListener('change', (e) => {
            this.config.language = e.target.value;
            Localization.setLanguage(this.config.language);
            this.save();
        });

        document.getElementById('input-username').addEventListener('input', (e) => {
            this.config.playerName = e.target.value.trim();
            this.save();
        });

        document.getElementById('toggle-music').addEventListener('change', (e) => {
            this.config.musicEnabled = e.target.checked;
            this.save();
            // We'll emit an event to the audio manager, since we don't directly import it here
            import('./eventbus.js').then(module => module.default.emit('musicToggled', this.config.musicEnabled));
        });

        document.getElementById('toggle-sfx').addEventListener('change', (e) => {
            this.config.sfxEnabled = e.target.checked;
            this.save();
        });
    }
};
