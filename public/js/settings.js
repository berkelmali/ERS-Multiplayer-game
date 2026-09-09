import { Localization } from './localization.js?v=3';
import { HouseRules } from './houseRules.js';
import { RULE_DEFS, DEFAULT_RULES, normalizeRules } from './slapRules.js';
import { getRankName, getSuitSymbol } from './game.js';
import EventBus from './eventbus.js';

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
        equippedCardSkin: 'classic', // see cardSkins.js / CLAUDE.md §6.28
        slapCoach: true,             // see slapForensics.js / CLAUDE.md §6.34
        houseRules: { ...DEFAULT_RULES } // see houseRules.js / CLAUDE.md §6.33
    },

    init() {
        this.load();
        this.renderHouseRuleRows(); // must precede applyAll/bindEvents — they query these inputs
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

        // --- v3.0.0 ---
        const coachToggle = document.getElementById('toggle-slap-coach');
        if (coachToggle) coachToggle.checked = this.config.slapCoach !== false;

        // Settings OWNS the local rule preference and pushes it into HouseRules.
        // The reverse direction would put settings.js → localization.js → ui.js
        // into an import cycle with the rule engine.
        this.config.houseRules = normalizeRules(this.config.houseRules);
        HouseRules.setLocal(this.config.houseRules);
        this.syncHouseRuleInputs();

        this.updateDifficultyDesc();
    },

    /**
     * Builds one row per rule, straight from the registry — the settings screen
     * can never list a rule the engine does not have, or miss one it does.
     *
     * Each row shows the pattern as actual miniature cards rather than a text
     * hint like "7 · 7". A slap rule is a shape you recognise at speed; showing
     * the shape is closer to what the player has to do at the table than
     * describing it in words, and it needs no translation.
     */
    renderHouseRuleRows() {
        const grid = document.querySelector('.house-rules-grid');
        if (!grid || grid.dataset.built === '1') return;

        grid.innerHTML = RULE_DEFS.map(def => {
            const cards = (def.preview || []).map(c => {
                const red = (c.suit === 'hearts' || c.suit === 'diamonds');
                return `<span class="mini-card${red ? ' red' : ''}${c.key ? '' : ' filler'}">`
                    + `<b>${getRankName(c.rank)}</b><i>${getSuitSymbol(c.suit)}</i></span>`;
            }).join('');

            return `<label class="rule-row${def.optional ? ' optional' : ''}" for="rule-${def.id}">
                <input type="checkbox" id="rule-${def.id}">
                <span class="rule-name" data-i18n="ruleName_${def.id}">${def.id}</span>
                <span class="rule-preview">${cards}</span>
            </label>`;
        }).join('');

        grid.dataset.built = '1';
    },

    /**
     * Rebuilds the House Rules checkbox states from config, and reflects the
     * lock.
     *
     * Reading `HouseRules.local` rather than `this.config.houseRules` while
     * locked is deliberate: during a Daily Challenge run the LIVE set is the
     * classic one, and showing the player their own saved preferences next to
     * dead switches would be a small lie about what they are playing. Their
     * preference is not lost — `DailyChallenge.stop()` puts it back.
     */
    syncHouseRuleInputs() {
        const locked = HouseRules.isLocked();
        const shown = locked ? HouseRules.local : this.config.houseRules;

        for (const def of RULE_DEFS) {
            const el = document.getElementById('rule-' + def.id);
            if (!el) continue;
            el.checked = shown[def.id] === true;
            el.disabled = locked;
        }

        const grid = document.querySelector('.house-rules-grid');
        if (grid) grid.classList.toggle('locked', locked);

        const reset = document.getElementById('btn-rules-reset');
        if (reset) reset.disabled = locked;

        // Say WHY the switches are dead. A disabled control with no explanation
        // reads as a bug.
        const note = document.getElementById('house-rules-lock');
        if (note) {
            if (locked) {
                note.innerText = Localization.get('houseRulesLocked')
                    || 'Locked during the Daily Challenge — everyone plays the classic rules.';
                note.style.display = 'block';
            } else {
                note.style.display = 'none';
            }
        }
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
        // The lock can flip while this panel is open (start a daily, quit a
        // daily), so the switches re-render instead of going stale.
        EventBus.on('houseRulesLockChanged', () => this.syncHouseRuleInputs());

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

        // --- v3.0.0: Slap Coach ---
        const coachToggle = document.getElementById('toggle-slap-coach');
        if (coachToggle) {
            coachToggle.addEventListener('change', (e) => {
                this.config.slapCoach = e.target.checked;
                this.save();
            });
        }

        // --- v3.0.0: House Rules ---
        for (const def of RULE_DEFS) {
            const el = document.getElementById('rule-' + def.id);
            if (!el) continue;
            el.addEventListener('change', (e) => {
                const next = { ...this.config.houseRules, [def.id]: e.target.checked };
                // normalizeRules() enforces the "at least one rule" invariant, so
                // the checkboxes are re-synced from the RESULT rather than from
                // the click — a switch that was refused must visibly bounce back.
                this.config.houseRules = HouseRules.setLocal(next);
                this.syncHouseRuleInputs();
                this.save();
            });
        }

        const resetRules = document.getElementById('btn-rules-reset');
        if (resetRules) {
            resetRules.addEventListener('click', () => {
                this.config.houseRules = HouseRules.setLocal({ ...DEFAULT_RULES });
                this.syncHouseRuleInputs();
                this.save();
            });
        }
    }
};
