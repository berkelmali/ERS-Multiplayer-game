import EventBus from './eventbus.js';
import { Settings } from './settings.js';

export const AudioManager = {
    sounds: {
        cardPlace: 'audio/card_place.mp3?v=2',
        slap: 'audio/slap.mp3?v=2',
        invalidSlap: 'audio/invalid_slap.mp3?v=2',
        win: 'audio/win.mp3?v=2',
        menuBGM: 'audio/menu_music.mp3?v=2',
        gameplayBGM: 'audio/gameplay_music.mp3?v=2'
    },
    audioElements: {},
    enabled: true,
    currentBGM: null,
    currentTrackKey: null,
    lastPlayTarget: {},
    initialized: false,
    audioCtx: null,
    pannerNodes: {},

    init() {
        if (this.initialized) return;
        this.initialized = true;
        // Pre-create a single Audio element for each sound to prevent "two voices" echoing overlap
        for (const [key, path] of Object.entries(this.sounds)) {
            const audio = new Audio(path);
            this.audioElements[key] = audio;
        }

        // Wire up EventBus listeners
        EventBus.on('cardPlayed', (data) => this.playSFX('cardPlace', data?.playerId));
        EventBus.on('invalidSlap', (data) => this.playSFX('invalidSlap', data?.playerId));
        EventBus.on('shieldEarned', (playerId) => this.playShieldEarned(playerId));
        EventBus.on('shieldShattered', (data) => {
            const pid = (data && typeof data === 'object') ? data.playerId : data;
            this.playShieldShatter(pid);
        });
        EventBus.on('pileWon', (data) => {
            if (data && data.reason && data.reason.toLowerCase() === 'slap') {
                this.playSFX('slap', data?.winnerId);
            }
        });

        EventBus.on('gameOver', () => {
            this.stopBGM();
            this.playSFX('win');
            this.stopTensionCompletely();
        });

        EventBus.on('gameStarted', () => {
            this.playBGM('gameplayBGM');
            this.stopTensionCompletely(); // Defensive reset in case the previous game ended abruptly (quit mid-match).
        });

        EventBus.on('gameStateChanged', (state) => {
            if (state === 'menu') {
                this.playBGM('menuBGM');
            } else if (state === 'gameplay') {
                this.playBGM('gameplayBGM');
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (this.currentBGM) this.currentBGM.pause();
            } else {
                if (this.audioCtx && this.audioCtx.state === 'suspended') {
                    this.audioCtx.resume();
                }
                if (this.currentBGM && this.enabled) {
                    this.currentBGM.play().catch(() => { });
                }
            }
        });
    },

    initAudioContext() {
        if (this.audioCtx) return;
        
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;
            
            this.audioCtx = new AudioContextClass();
            
            const pannableSFX = ['cardPlace', 'slap', 'invalidSlap'];
            pannableSFX.forEach(key => {
                const audio = this.audioElements[key];
                if (audio) {
                    const source = this.audioCtx.createMediaElementSource(audio);
                    const panner = this.audioCtx.createStereoPanner();
                    
                    source.connect(panner);
                    panner.connect(this.audioCtx.destination);
                    
                    this.pannerNodes[key] = panner;
                }
            });
            console.log("[AudioManager] Web Audio Spatial Context initialized successfully.");
        } catch (e) {
            console.warn("[AudioManager] Spatial Audio failed to initialize:", e);
        }
    },

    playSFX(soundKey, playerId = null) {
        if (!this.enabled || !this.audioElements[soundKey] || !Settings.config.sfxEnabled) return;

        // Lazily resume or initialize the audio context
        this.initAudioContext();
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        // Prevent double-play overlapping from quick duplicate event syncs
        const now = Date.now();
        if (this.lastPlayTarget[soundKey] && now - this.lastPlayTarget[soundKey] < 50) return;
        this.lastPlayTarget[soundKey] = now;

        const audio = this.audioElements[soundKey];
        const panner = this.pannerNodes[soundKey];

        // Apply spatial panning based on player position
        if (panner && playerId !== null && playerId !== undefined) {
            let panValue = 0.0;
            if (playerId === 1) panValue = -0.75; // Left Bot
            else if (playerId === 3) panValue = 0.75; // Right Bot
            // Player (0) and Top Bot (2) remain in the center (0.0)
            panner.pan.setValueAtTime(panValue, this.audioCtx.currentTime);
        } else if (panner) {
            panner.pan.setValueAtTime(0.0, this.audioCtx.currentTime);
        }

        // Reuse the exact same audio node, resetting it to 0. 
        // This guarantees NO overlapping echos (no "two voices" playing at once).
        audio.currentTime = 0;
        audio.volume = 1.0; 

        audio.play().catch(err => {
            console.warn(`[AudioManager] Failed to play SFX ${soundKey}:`, err);
        });
    },

    playBGM(soundKey) {
        if (!this.enabled || !this.audioElements[soundKey] || !Settings.config.musicEnabled) return;

        if (this.currentTrackKey === soundKey && this.currentBGM && !this.currentBGM.paused) {
            return; 
        }

        this.stopBGM();

        this.currentBGM = this.audioElements[soundKey];
        this.currentBGM.loop = true;
        this.currentBGM.volume = 0.10; // User requested 10% BGM volume

        this.currentBGM.play().catch(err => {
            console.warn(`[AudioManager] Autoplay blocked for BGM ${soundKey} until user interacts.`);
        });

        this.currentTrackKey = soundKey;
    },

    stopBGM() {
        if (this.currentBGM) {
            this.currentBGM.pause();
            this.currentBGM.currentTime = 0;
            this.currentBGM = null;
            this.currentTrackKey = null;
        }
    },

    playGodlikeSlap() {
        if (!this.enabled || !Settings.config.sfxEnabled) return;
        this.initAudioContext();
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, this.audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1600, this.audioCtx.currentTime + 0.12);

        gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.35);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.35);
    },

    playPerfectSlap() {
        if (!this.enabled || !Settings.config.sfxEnabled) return;
        this.initAudioContext();
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        // Bright ascending 3-note chime (C6 -> E6 -> G6), distinct from the
        // godlike-slap pitch sweep, to sonically brand the precision-tap bonus.
        const notes = [1046.5, 1318.5, 1568.0];
        const start = this.audioCtx.currentTime;

        notes.forEach((freq, i) => {
            const t = start + i * 0.07;
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t);

            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.22, t + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

            osc.connect(gain);
            gain.connect(this.audioCtx.destination);

            osc.start(t);
            osc.stop(t + 0.24);
        });
    },

    playStreakBreak() {
        if (!this.enabled || !Settings.config.sfxEnabled) return;
        this.initAudioContext();
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        const osc1 = this.audioCtx.createOscillator();
        const osc2 = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(300, this.audioCtx.currentTime);
        osc1.frequency.exponentialRampToValueAtTime(80, this.audioCtx.currentTime + 0.25);

        osc2.type = 'square';
        osc2.frequency.setValueAtTime(320, this.audioCtx.currentTime);
        osc2.frequency.exponentialRampToValueAtTime(60, this.audioCtx.currentTime + 0.25);

        gain.gain.setValueAtTime(0.25, this.audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.3);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc1.start();
        osc2.start();
        osc1.stop(this.audioCtx.currentTime + 0.3);
        osc2.stop(this.audioCtx.currentTime + 0.3);
    },

    // --- Danger Zone ambient tension layer (v2.9.0) ---
    // A single persistent low drone, created lazily on first real use and
    // reused for the rest of the match — gain is ramped, never abruptly cut,
    // to avoid clicks. Distinct from every other sound here: those are all
    // one-shot triggered effects; this is the one continuous/looping layer,
    // so it gets its own lifecycle (start once, ramp gain, explicitly torn
    // down between games) instead of the play-and-forget pattern above.
    _tensionOsc: null,
    _tensionGain: null,

    setTensionLevel(level) {
        if (!this._tensionOsc && level === 0) return; // Nothing playing, nothing to do.
        if (!this.enabled || !Settings.config.musicEnabled) {
            this._rampTensionTo(0);
            return;
        }
        this.initAudioContext();
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        if (!this._tensionOsc) {
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 55; // Low A — felt more than heard at these gains.
            gain.gain.value = 0;
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            osc.start();
            this._tensionOsc = osc;
            this._tensionGain = gain;
        }

        const targetGain = level === 2 ? 0.05 : level === 1 ? 0.02 : 0;
        this._rampTensionTo(targetGain);
    },

    _rampTensionTo(targetGain) {
        if (!this._tensionGain || !this.audioCtx) return;
        this._tensionGain.gain.cancelScheduledValues(this.audioCtx.currentTime);
        this._tensionGain.gain.linearRampToValueAtTime(targetGain, this.audioCtx.currentTime + 1.2);
    },

    stopTensionCompletely() {
        if (this._tensionOsc && this.audioCtx) {
            try {
                this._tensionGain.gain.cancelScheduledValues(this.audioCtx.currentTime);
                this._tensionGain.gain.setValueAtTime(0, this.audioCtx.currentTime);
                this._tensionOsc.stop(this.audioCtx.currentTime + 0.1);
            } catch (e) { /* already stopped — ignore */ }
        }
        this._tensionOsc = null;
        this._tensionGain = null;
    },

    playShieldEarned(playerId = null) {
        if (!this.enabled || !Settings.config.sfxEnabled) return;
        this.initAudioContext();
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        const now = this.audioCtx.currentTime;
        const osc1 = this.audioCtx.createOscillator();
        const osc2 = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        // Spatial panning
        if (playerId !== null && playerId !== undefined) {
            const panner = this.audioCtx.createStereoPanner ? this.audioCtx.createStereoPanner() : null;
            if (panner) {
                let panValue = 0.0;
                if (playerId === 1) panValue = -0.75;
                else if (playerId === 3) panValue = 0.75;
                panner.pan.setValueAtTime(panValue, now);
                osc1.connect(panner);
                osc2.connect(panner);
                panner.connect(gain);
            } else {
                osc1.connect(gain);
                osc2.connect(gain);
            }
        } else {
            osc1.connect(gain);
            osc2.connect(gain);
        }

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(440, now);
        osc1.frequency.exponentialRampToValueAtTime(1200, now + 0.35);

        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(550, now);
        osc2.frequency.exponentialRampToValueAtTime(1500, now + 0.4);

        gain.gain.setValueAtTime(0.01, now);
        gain.gain.exponentialRampToValueAtTime(0.2, now + 0.1);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.45);

        gain.connect(this.audioCtx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.45);
        osc2.stop(now + 0.45);
    },

    playShieldShatter(playerId = null) {
        if (!this.enabled || !Settings.config.sfxEnabled) return;
        this.initAudioContext();
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        const now = this.audioCtx.currentTime;
        const oscs = [];
        const gain = this.audioCtx.createGain();

        // 4 metallic glass-like high frequency oscillators decaying rapidly
        const freqs = [2000, 2400, 2900, 3400];
        freqs.forEach((freq, idx) => {
            const osc = this.audioCtx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, now);
            osc.frequency.exponentialRampToValueAtTime(100 + Math.random() * 50, now + 0.35 + idx * 0.05);
            
            // Spatial panning
            if (playerId !== null && playerId !== undefined) {
                const panner = this.audioCtx.createStereoPanner ? this.audioCtx.createStereoPanner() : null;
                if (panner) {
                    let panValue = 0.0;
                    if (playerId === 1) panValue = -0.75;
                    else if (playerId === 3) panValue = 0.75;
                    panner.pan.setValueAtTime(panValue, now);
                    osc.connect(panner);
                    panner.connect(gain);
                } else {
                    osc.connect(gain);
                }
            } else {
                osc.connect(gain);
            }
            
            osc.start(now);
            osc.stop(now + 0.4 + idx * 0.05);
            oscs.push(osc);
        });

        // Add a low frequency impact for weight
        const bassOsc = this.audioCtx.createOscillator();
        bassOsc.type = 'triangle';
        bassOsc.frequency.setValueAtTime(150, now);
        bassOsc.frequency.linearRampToValueAtTime(40, now + 0.3);
        
        if (playerId !== null && playerId !== undefined) {
            const panner = this.audioCtx.createStereoPanner ? this.audioCtx.createStereoPanner() : null;
            if (panner) {
                let panValue = 0.0;
                if (playerId === 1) panValue = -0.75;
                else if (playerId === 3) panValue = 0.75;
                panner.pan.setValueAtTime(panValue, now);
                bassOsc.connect(panner);
                panner.connect(gain);
            } else {
                bassOsc.connect(gain);
            }
        } else {
            bassOsc.connect(gain);
        }
        
        bassOsc.start(now);
        bassOsc.stop(now + 0.3);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        gain.connect(this.audioCtx.destination);
    },

    // --- Shop sounds (v2.9.0) --- 
    // Found missing during a review pass: unlocking/equipping a skin was
    // completely silent despite every other notable moment in the game
    // (perfect slap, shield, streak break) having a synthesized SFX. These
    // follow the exact same oscillator-based pattern as the rest of this file.
    playSkinUnlock(rarity = 'epic') {
        if (!this.enabled || !Settings.config.sfxEnabled) return;
        this.initAudioContext();
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

        // Legendary unlocks get a richer, 4-note arpeggio; epic/rare get 3.
        const notes = rarity === 'legendary'
            ? [523.25, 659.25, 783.99, 1046.5]   // C5 E5 G5 C6
            : [523.25, 659.25, 783.99];          // C5 E5 G5
        const start = this.audioCtx.currentTime;

        notes.forEach((freq, i) => {
            const t = start + i * 0.09;
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, t);
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            osc.start(t);
            osc.stop(t + 0.32);
        });
    },

    playSkinEquip() {
        if (!this.enabled || !Settings.config.sfxEnabled) return;
        this.initAudioContext();
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, this.audioCtx.currentTime);
        gain.gain.setValueAtTime(0.18, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.12);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.14);
    },

    toggleMute() {
        this.enabled = !this.enabled;
        if (!this.enabled) {
            this.stopBGM();
        } else {
            import('./game.js').then(module => {
                const { GameState } = module;
                if (!GameState.gameStarted) {
                    this.playBGM('menuBGM');
                } else if (!GameState.gameOver) {
                    this.playBGM('gameplayBGM');
                }
            });
        }
        return this.enabled;
    }
};
