/**
 * duat.js — Duat Yolculuğu / The Duat Journey (v3.18.0).
 *
 * Every night Ra's barque crosses the Duat, the underworld, in twelve hours,
 * and rises at dawn. Here the player makes that crossing — and starts it
 * DEAD: no cards, at a table of three shades (Ba, Ka and Akh) who hold all
 * fifty-two.
 *
 * ERS already has the mechanic this is built on, and it is the game's most
 * unusual one: an eliminated player may still slap, and a good slap brings
 * them back with the pile. Here that is not a comeback, it is the way in.
 *
 *   - In the Duat you have TEN ROUNDS to slap your way back to life. A round
 *     is one card from every shade still holding cards. A wrong slap feeds
 *     Ammit, the devourer: it costs a round.
 *   - Every pile you take is a gate passed: one hour of the night.
 *   - At the seventh hour Apep, the serpent, attacks: for that hour the
 *     shades play one difficulty tier faster.
 *   - Run dry again and you are back in the Duat, with ten fresh rounds; the
 *     hours you have passed stay passed.
 *   - Pass the twelfth gate and the sun rises: you win.
 *   - Stay in the Duat for ten rounds and it keeps you: the journey ends there.
 */
import EventBus from './eventbus.js';
import { GameState, createDeck } from './game.js';
import { HouseRules } from './houseRules.js';
import { matchSlap } from './slapRules.js';
import { BotConfig, BotPersonalities, applyPersonality } from './botConfig.js';
import { MatchContext, difficultyInForce } from './matchContext.js';
import { Settings } from './settings.js';
import { Localization } from './localization.js?v=3';
import { godSvg } from './godArt.js';

export const DUAT_ROUNDS = 10;
export const DAWN_HOUR = 12;
export const APEP_HOUR = 7;
export const SHADES = Object.freeze(['Ba', 'Ka', 'Akh']);
const TIERS = ['easy', 'medium', 'hard', 'challenger'];
const STORE_KEY = 'ers_duat_v1';

/** The deal: the living start with nothing; the shades hold every card. */
export function duatScenario() {
    const deck = createDeck();
    const hands = [[], [], [], []];
    let seat = 1;
    while (deck.length) {
        hands[seat].push(deck.pop());
        seat = seat === 3 ? 1 : seat + 1;
    }
    return {
        hands,
        pile: [],
        burnPile: [],
        activePlayerId: 1,
        challenge: { active: false, attackerId: null, defenderId: null, chancesLeft: 0 },
        streaks: [0, 0, 0, 0]
    };
}

/** One card is 1/living of a round: a round is one card from every shade still playing. */
export function roundStep(livingShades) {
    return 1 / Math.max(1, livingShades);
}

/** How dark the scene is: full night in the Duat, then lifting to 0 at dawn. */
export function nightFor(dead, hour) {
    return dead ? 1 : Math.max(0, 0.75 * (1 - hour / DAWN_HOUR));
}

export function nextTier(tier) {
    const i = TIERS.indexOf(tier);
    return TIERS[Math.min(TIERS.length - 1, Math.max(0, i) + 1)];
}

export const DuatMode = {
    armed: false,
    dead: true,
    hour: 0,
    progress: 0,          // rounds spent in the Duat this time, fractional
    store: { bestHour: 0, dawns: 0 },
    _initialized: false,

    init() {
        if (this._initialized) return;
        this._initialized = true;
        this.hud = document.getElementById('duat-hud');
        this._load();
        const start = document.getElementById('btn-duat-start');
        if (start) start.addEventListener('click', () => this.begin());

        EventBus.on('gameStarted', () => { if (this.armed) this.resetJourney(); });
        EventBus.on('cardPlayed', () => this.onCardPlayed());
        EventBus.on('slapAttempt', (seat) => this.onSlapAttempt(seat));
        EventBus.on('resurrected', (seat) => { if (this.armed && seat === 0) this.onRisen(); });
        EventBus.on('humanEliminated', (seat) => { if (this.armed && seat === 0) this.onFallen(); });
        EventBus.on('pileWon', ({ winnerId }) => { if (this.armed && winnerId === 0) this.onGatePassed(); });
        EventBus.on('languageChanged', () => { this.renderHub(); if (this.armed) this.renderHud(); });
        this.renderHub();
    },

    renderHub() {
        const emblem = document.getElementById('duat-emblem');
        if (emblem && !emblem.firstChild) emblem.innerHTML = godSvg('duat');
        const best = document.getElementById('duat-best');
        if (!best) return;
        const L = (k, f) => Localization.get(k) || f;
        const bits = [];
        if (this.store.bestHour > 0) bits.push(L('duatBest', 'Furthest: hour {n}').replace('{n}', this.store.bestHour));
        if (this.store.dawns > 0) bits.push(L('duatDawns', '☀ Dawns seen: {n}').replace('{n}', this.store.dawns));
        best.textContent = bits.join(' · ');
    },

    async begin() {
        const [{ GameManager }, { UIManager }, { AIController }] = await Promise.all([
            import('./gameManager.js'), import('./ui.js'), import('./ai.js')
        ]);
        this.armed = true;
        this._gm = GameManager;
        this._ai = AIController;
        MatchContext.seatNames = [null, SHADES[0], SHADES[1], SHADES[2]];
        MatchContext.ownsElimination = true;
        // v3.19.2: the Duat prices a wrong slap itself (Ammit takes a round),
        // so the engine's empty-hand slap lock (ERS-22) stands aside here.
        MatchContext.pricesWrongSlaps = true;
        document.getElementById('legends-panel').classList.remove('active');
        document.body.classList.remove('menu-screen');
        document.body.classList.add('game-screen');
        document.getElementById('game-container').classList.add('active');
        UIManager.resetOfflineUI();
        GameManager.rematchOptions = () => ({ untimed: true, scenario: duatScenario() });
        GameManager.startBotGame({ untimed: true, scenario: duatScenario() });
        EventBus.emit('gameStateChanged', 'gameplay');
    },

    resetJourney() {
        this._entered = false;
        this.hour = 0;
        this.progress = 0;
        this.dead = true;
        this._apep(false);
        // The seat starts empty, so it starts in the Duat. Marking it
        // eliminated is what lets the engine count the first good slap as a
        // resurrection (game.js winPile) — the one path ERS already has.
        GameState.humanEliminated = true;
        document.body.classList.add('duat-journey');
        if (this.hud) this.hud.hidden = false;
        this.renderHud();
        this._say(Localization.get('duatStartLine') || 'You wake in the Duat. Slap your way back within ten rounds.');
    },

    onCardPlayed() {
        if (!this.armed || !this.dead || GameState.gameOver) return;
        const living = [1, 2, 3].filter(s => GameState.players[s].length > 0).length;
        this.progress += roundStep(living);
        this._checkClaimed();
        this.renderHud();
    },

    /** A wrong slap from the Duat feeds Ammit. Read BEFORE the engine judges. */
    onSlapAttempt(seat) {
        if (!this.armed || !this.dead || seat !== 0 || GameState.gameOver) return;
        if (GameState.pile.length === 0) return;
        if (matchSlap(GameState.pile, HouseRules.active())) return;
        this.progress += 1;
        this._say(Localization.get('duatAmmit') || 'Ammit feeds on a wrong slap: one round lost.');
        this._checkClaimed();
        this.renderHud();
    },

    onRisen() {
        // ERS-18 fix 5: the first rise is the journey's entry, not a comeback.
        // game.js counted it as a resurrection; the end screen's "comeback"
        // line must count only the rises after a fall, so take the entry back.
        if (!this._entered) {
            this._entered = true;
            if (GameState.stats && GameState.stats.resurrections > 0) GameState.stats.resurrections--;
        }
        this.dead = false;
        this.progress = 0;
        this._say(Localization.get('duatRisen') || 'You rise! The journey goes on.');
        this.renderHud();
    },

    onFallen() {
        this.dead = true;
        this.progress = 0;
        this._say(Localization.get('duatFallen') || 'Back into the Duat: ten rounds to return.');
        this.renderHud();
    },

    onGatePassed() {
        if (GameState.gameOver) return;
        this.hour = Math.min(DAWN_HOUR, this.hour + 1);
        if (this.hour > this.store.bestHour) { this.store.bestHour = this.hour; this._save(); }
        this._apep(this.hour === APEP_HOUR);
        if (this.hour === APEP_HOUR) this._say(Localization.get('duatApep') || 'Apep strikes: the shades quicken for this hour.');
        else this._say(this._hourLine());
        this.renderHud();
        if (this.hour >= DAWN_HOUR) {
            this.store.dawns++;
            this._save();
            this._say(Localization.get('duatDawn') || 'The sun rises. You have crossed the Duat.');
            GameState.endMatch(0);
        }
    },

    _checkClaimed() {
        if (Math.floor(this.progress) < DUAT_ROUNDS || GameState.gameOver) return;
        this._say(Localization.get('duatClaimed') || 'The Duat keeps you.');
        let winner = 1;
        for (const s of [1, 2, 3]) if (GameState.players[s].length > GameState.players[winner].length) winner = s;
        GameState.endMatch(winner);
    },

    /** Apep's hour: the shades play one tier faster, each in their own style. */
    _apep(on) {
        if (!this._ai) return;
        for (const s of [1, 2, 3]) delete this._ai.seatConfig[s];
        if (!on) return;
        const tier = nextTier(difficultyInForce(MatchContext.difficultyOverride, Settings.config.difficulty));
        for (const s of [1, 2, 3]) this._ai.seatConfig[s] = applyPersonality(BotPersonalities[s], BotConfig[tier]);
    },

    stop() {
        if (!this.armed) return;
        this.armed = false;
        this._apep(false);
        if (this._gm) this._gm.rematchOptions = null;
        MatchContext.seatNames = null;
        MatchContext.ownsElimination = false;
        MatchContext.pricesWrongSlaps = false;
        document.body.classList.remove('duat-journey');
        if (this.hud) this.hud.hidden = true;
        document.body.style.removeProperty('--duat-night');
        this.renderHub();
    },

    _hourLine() {
        return (Localization.get('duatHourLine') || 'Hour {n} — {name}')
            .replace('{n}', this.hour)
            .replace('{name}', Localization.get('duatHour' + this.hour) || '');
    },

    renderHud() {
        if (!this.hud || !this.armed) return;
        const L = (k, f) => Localization.get(k) || f;
        const title = document.getElementById('duat-title');
        const pips = document.getElementById('duat-pips');
        const rounds = Math.min(DUAT_ROUNDS, Math.floor(this.progress));
        this.hud.classList.toggle('dead', this.dead);
        if (title) {
            title.textContent = this.dead
                ? L('duatInDuat', '☾ In the Duat — round {r}/{max}').replace('{r}', rounds).replace('{max}', DUAT_ROUNDS)
                : '☥ ' + (this.hour > 0 ? this._hourLine() : L('duatRisen', 'You rise!'));
        }
        if (pips) {
            pips.innerHTML = '';
            const total = this.dead ? DUAT_ROUNDS : DAWN_HOUR;
            const filled = this.dead ? rounds : this.hour;
            for (let i = 0; i < total; i++) {
                const p = document.createElement('span');
                p.className = 'duat-pip' + (i < filled ? ' on' : '');
                pips.appendChild(p);
            }
        }
        // Night lifts hour by hour; the Duat itself is darkest.
        document.body.style.setProperty('--duat-night', String(nightFor(this.dead, this.hour)));
    },

    _say(text) {
        const line = document.getElementById('duat-line');
        if (line) line.textContent = text;
        import('./ui.js').then(({ UIManager }) => UIManager.addLog(`☥ ${text}`, 'highlight')).catch(() => {});
    },

    _load() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (raw) this.store = { bestHour: 0, dawns: 0, ...JSON.parse(raw) };
        } catch { /* private window */ }
    },

    _save() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(this.store)); } catch { /* see _load */ }
    }
};
