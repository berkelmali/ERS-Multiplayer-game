import { Settings } from './settings.js';
import EventBus from './eventbus.js';

export const AudioManager = {
    sfx: {},
    music: {},
    currentMusic: null,
    musicVolume: 0.3,

    init() {
        // Setup SFX Objects
        this.sfx = {
            cardPlace: this.createAudio('audio/card_place.mp3'),
            slap: this.createAudio('audio/slap.mp3'),
            win: this.createAudio('audio/win.mp3'),
            invalidSlap: this.createAudio('audio/invalid_slap.mp3')
        };

        // Setup Music Objects
        this.music = {
            menu: this.createAudio('audio/menu_music.mp3', true),
            gameplay: this.createAudio('audio/gameplay_music.mp3', true)
        };

        EventBus.on('musicToggled', (isOn) => {
            if (isOn) {
                if (this.currentMusic) {
                    this.currentMusic.play().catch(e => console.warn('Play prevented', e));
                }
            } else {
                this.stopMusic();
            }
        });

        // Wire game events to SFX
        EventBus.on('cardPlayed', () => this.playCardSound());
        EventBus.on('slapAttempt', () => this.playSlapSound());
        EventBus.on('pileWon', () => this.playWinSound());
        EventBus.on('invalidSlap', () => this.playInvalidSlapSound());

        // Wire state changes to Music logic
        EventBus.on('gameStateChanged', (state) => {
            if (state === 'menu') {
                this.playMenuMusic();
            } else if (state === 'gameplay') {
                this.playGameplayMusic();
            }
        });

        // Initialize Audio context on first user interaction to satisfy browser policies
        const startInitMusic = () => {
            if (Settings.config.musicEnabled) {
                this.playMenuMusic();
            }
            ['click', 'touchstart', 'keydown'].forEach(evt => document.removeEventListener(evt, startInitMusic));
        };
        ['click', 'touchstart', 'keydown'].forEach(evt => document.addEventListener(evt, startInitMusic, { once: true }));
    },

    createAudio(src, loop = false) {
        const a = new Audio(src);
        a.loop = loop;
        if (loop) a.volume = this.musicVolume;
        a.onerror = () => console.warn(`Missing audio asset: ${src}`);
        return a;
    },

    playSound(audioElement) {
        if (!Settings.config.sfxEnabled) return;

        // Clone the node so multiple of the same sound can play instantly over each other
        const a = audioElement.cloneNode();
        a.volume = 0.6; // Slightly louder than music
        a.play().catch(e => console.warn(`SFX Error`, e));
    },

    playCardSound() { this.playSound(this.sfx.cardPlace); },
    playSlapSound() { this.playSound(this.sfx.slap); },
    playWinSound() { this.playSound(this.sfx.win); },
    playInvalidSlapSound() { this.playSound(this.sfx.invalidSlap); },

    // --- MUSIC CONTROLS ---

    playMenuMusic() {
        if (this.currentMusic === this.music.menu) return; // already playing

        this.fadeOutMusic(this.currentMusic, () => {
            this.currentMusic = this.music.menu;
            if (Settings.config.musicEnabled) {
                this.currentMusic.volume = this.musicVolume;
                this.currentMusic.play().catch(e => console.warn(`Music Error:`, e));
            }
        });
    },

    playGameplayMusic() {
        if (this.currentMusic === this.music.gameplay) return; // already playing

        this.fadeOutMusic(this.currentMusic, () => {
            this.currentMusic = this.music.gameplay;
            if (Settings.config.musicEnabled) {
                this.currentMusic.volume = this.musicVolume;
                this.currentMusic.play().catch(e => console.warn(`Music Error:`, e));
            }
        });
    },

    fadeOutMusic(audioElement, callback) {
        if (!audioElement) {
            if (callback) callback();
            return;
        }

        let vol = audioElement.volume;
        const fadeAudio = setInterval(() => {
            if (vol > 0.05) {
                vol -= 0.05;
                audioElement.volume = vol;
            } else {
                clearInterval(fadeAudio);
                audioElement.pause();
                audioElement.currentTime = 0; // Reset
                audioElement.volume = this.musicVolume; // Restore original volume reference
                if (callback) callback();
            }
        }, 80); // Fades completely over ~800ms
    },

    stopMusic() {
        if (this.currentMusic) {
            this.currentMusic.pause();
        }
    }
};
