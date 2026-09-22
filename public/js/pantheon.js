/**
 * pantheon.js — Tanrıların Masası / Table of the Gods (v3.18.0).
 *
 * A god takes the top seat (seat 2). It plays and slaps like a bot, but it
 * has LIFE: every valid slap by your side of the table — you, and the two
 * priests beside you (seats 1 and 3) — takes some of it. Bring it to zero and
 * the match ends in your favour, whoever holds the cards. Let the god gather
 * the cards and the match ends the ordinary way.
 *
 * Each god's power is a real rule or a real ERS effect, never decoration:
 *   Bastet  — nine lives: each pile she takes heals her, nine times at most.
 *   Thoth   — perfect reckoning: never slaps wrong; Four-in-a-Row is live.
 *   Hathor  — love: a Marriage deals triple; her own Marriage heals her.
 *   Anubis  — the weighing of the heart: a wrong slap burns a SECOND card;
 *             Triple is live.
 *   Set     — the sandstorm: each pile he takes steals two cards from the
 *             seat holding the most; Top-Bottom is live.
 *   Ra      — every rule live; at half life, noon: he heals once and plays
 *             at Blitz pace.
 *
 * Numbers are derived, not typed where a source exists:
 *   - damage per pattern: 10 × √(how much rarer than a Double), measured
 *     through the real matchSlap (gate 76 re-measures);
 *   - a god's speed: an existing difficulty tier, shaped by an existing bot
 *     personality through the one formula (botConfig.applyPersonality).
 */
import EventBus from './eventbus.js';
import { GameState } from './game.js';
import { HouseRules } from './houseRules.js';
import { matchSlap, normalizeRules, RULE_DEFS, DEFAULT_RULES } from './slapRules.js';
import { BotConfig, BotPersonalities, applyPersonality } from './botConfig.js';
import { MatchContext } from './matchContext.js';
import { Localization } from './localization.js?v=3';
import { godSvg } from './godArt.js';

export const BOSS_SEAT = 2;
export const HERO_SEAT = 0;
/** A priest's slap deals half — you are the hero of the table, not a spectator. */
export const ALLY_SHARE = 0.5;
/**
 * Damage by pattern: 10 × √(frequency of Doubles / frequency of the pattern),
 * measured on 600 000 random cards with every rule live (first match wins,
 * exactly as the table judges). Triple can never be the FIRST match (its
 * last two cards are already a Double), so it takes the cap, like
 * Four-in-a-Row whose measured rarity exceeds it.
 */
export const DAMAGE_CAP = 30;
export const DAMAGE = Object.freeze({
    doubles: 10, sandwich: 11, topBottom: 12, tens: 13, marriage: 23, fourInRow: DAMAGE_CAP, triple: DAMAGE_CAP
});
/** Heal amounts are measured in the same unit: one Double's worth. */
const ONE_SLAP = DAMAGE.doubles;
const STORE_KEY = 'ers_pantheon_v1';
const CLASSIC = Object.keys(DEFAULT_RULES).filter(id => DEFAULT_RULES[id]);

/** The six gods, in the order they must be faced. */
export const GODS = Object.freeze([
    { id: 'bastet', hp: 8 * ONE_SLAP,  tier: 'easy',       personality: 1, extraRules: [],            power: 'nineLives' },
    { id: 'thoth',  hp: 10 * ONE_SLAP, tier: 'medium',     personality: 3, extraRules: ['fourInRow'], power: 'reckoning' },
    { id: 'hathor', hp: 11 * ONE_SLAP, tier: 'medium',     personality: 1, extraRules: [],            power: 'love' },
    { id: 'anubis', hp: 12 * ONE_SLAP, tier: 'hard',       personality: 3, extraRules: ['triple'],    power: 'weighing' },
    { id: 'set',    hp: 13 * ONE_SLAP, tier: 'hard',       personality: 2, extraRules: ['topBottom'], power: 'sandstorm' },
    { id: 'ra',     hp: 16 * ONE_SLAP, tier: 'challenger', personality: null,
      extraRules: RULE_DEFS.filter(d => d.optional).map(d => d.id), power: 'noon' }
]);
export const NINE_LIVES = 9;
export const SET_STEAL = 2;

export function god(id) {
    return GODS.find(g => g.id === id) || null;
}

export function godRules(id) {
    const g = god(id);
    const on = {};
    for (const r of RULE_DEFS) on[r.id] = CLASSIC.includes(r.id) || (g ? g.extraRules.includes(r.id) : false);
    return normalizeRules(on);
}

/** The god's seat config: a tier, shaped by a personality (Ra at noon: Blitz). */
export function godConfig(id, { noon = false } = {}) {
    const g = god(id);
    if (!g) return null;
    const base = BotConfig[g.tier];
    const pKey = noon ? 1 : g.personality;
    const cfg = applyPersonality(pKey ? BotPersonalities[pKey] : null, base);
    // Thoth's power IS his discipline: the numbers say so, not a flavour line.
    if (g.power === 'reckoning') return { ...cfg, accuracy: 1, falseSlap: 0 };
    return cfg;
}

/** Life a slap takes from god `id`: by pattern, full for you, half for a priest. */
export function slapDamage(id, ruleId, seat) {
    if (seat === BOSS_SEAT) return 0;
    const g = god(id);
    let dmg = DAMAGE[ruleId] ?? ONE_SLAP;
    if (g && g.power === 'love' && ruleId === 'marriage') dmg *= 3;
    return seat === HERO_SEAT ? dmg : Math.round(dmg * ALLY_SHARE);
}

/** A god can be challenged once every god before it has fallen. */
export function isUnlocked(id, defeated) {
    const i = GODS.findIndex(g => g.id === id);
    return i === 0 || (i > 0 && !!(defeated && defeated[GODS[i - 1].id]));
}

export const PantheonMode = {
    armed: false,
    godId: null,
    hp: 0,
    maxHp: 0,
    heals: 0,
    noon: false,
    lastRule: [null, null, null, null],
    damage: [0, 0, 0, 0],
    store: { defeated: {} },
    _initialized: false,

    init() {
        if (this._initialized) return;
        this._initialized = true;
        this.panel = document.getElementById('legends-panel');
        this.grid = document.getElementById('pantheon-grid');
        this.hud = document.getElementById('boss-hud');
        this.topZone = document.getElementById('top-player');
        this._load();

        const open = document.getElementById('btn-legends');
        if (open) open.addEventListener('click', () => this.openHall());
        const back = document.getElementById('btn-legends-back');
        if (back) back.addEventListener('click', () => this.closeHall());
        if (this.grid) {
            this.grid.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-god]');
                if (btn && !btn.disabled) this.challenge(btn.getAttribute('data-god'));
            });
        }

        EventBus.on('gameStarted', () => { if (this.armed) this.resetFight(); });
        // The pile is still on the table when a slap is attempted, and gone by
        // the time pileWon fires — so the pattern is read here.
        EventBus.on('slapAttempt', (seat) => {
            if (!this.armed) return;
            const m = matchSlap(GameState.pile, HouseRules.active());
            this.lastRule[seat] = m ? m.id : null;
        });
        EventBus.on('pileWon', (e) => this.onPileWon(e));
        EventBus.on('invalidSlap', (e) => this.onInvalidSlap(e));
        EventBus.on('gameOver', (winnerId) => this.onGameOver(winnerId));
        EventBus.on('languageChanged', () => {
            if (this.panel && this.panel.classList.contains('active')) this.renderHall();
            if (this.armed) { this._applySeatName(); this.renderHud(); }
        });
    },

    // ── the hall ───────────────────────────────────────────────────────────
    openHall() {
        document.getElementById('main-menu').classList.remove('active');
        this.panel.classList.add('active');
        this.renderHall();
    },

    closeHall() {
        this.panel.classList.remove('active');
        document.getElementById('main-menu').classList.add('active');
    },

    renderHall() {
        if (!this.grid) return;
        const L = (k, f) => Localization.get(k) || f;
        this.grid.innerHTML = '';
        GODS.forEach((g, i) => {
            const card = document.createElement('article');
            const beaten = !!this.store.defeated[g.id];
            const open = isUnlocked(g.id, this.store.defeated);
            card.className = 'god-card' + (beaten ? ' beaten' : '') + (open ? '' : ' locked');
            const portrait = document.createElement('div');
            portrait.className = 'god-portrait';
            portrait.innerHTML = godSvg(g.id);
            const body = document.createElement('div');
            body.className = 'god-body';
            const h = document.createElement('h3');
            h.className = 'god-name';
            h.textContent = L(`god_${g.id}_name`, g.id);
            const ep = document.createElement('p');
            ep.className = 'god-epithet';
            ep.textContent = L(`god_${g.id}_epithet`, '');
            const pw = document.createElement('p');
            pw.className = 'god-power';
            pw.textContent = L(`god_${g.id}_power`, '');
            const meta = document.createElement('p');
            meta.className = 'god-meta';
            meta.textContent = `${L('pantheonLife', 'Life')} ${g.hp} · ${L('diff' + g.tier[0].toUpperCase() + g.tier.slice(1), g.tier)}`;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('data-god', g.id);
            if (!open) {
                btn.className = 'btn secondary';
                btn.disabled = true;
                btn.textContent = L('pantheonLocked', '🔒 First defeat {god}')
                    .replace('{god}', L(`god_${GODS[i - 1].id}_name`, GODS[i - 1].id));
            } else {
                btn.className = beaten ? 'btn secondary' : 'btn primary';
                btn.textContent = beaten ? L('pantheonRematch', 'Challenge again') : L('pantheonChallenge', 'Challenge');
            }
            body.append(h, ep, pw, meta, btn);
            if (beaten) {
                const amulet = document.createElement('span');
                amulet.className = 'god-amulet';
                amulet.textContent = '☥';
                amulet.title = L('pantheonAmulet', 'Amulet won');
                card.appendChild(amulet);
            }
            card.append(portrait, body);
            this.grid.appendChild(card);
        });
    },

    // ── the duel ───────────────────────────────────────────────────────────
    async challenge(godId) {
        const g = god(godId);
        if (!g || !isUnlocked(godId, this.store.defeated)) return;
        const [{ AIController }, { GameManager }, { UIManager }] = await Promise.all([
            import('./ai.js'), import('./gameManager.js'), import('./ui.js')
        ]);
        this.armed = true;
        this.godId = godId;
        this.noon = false;
        this._savedRules = { ...HouseRules.local };
        HouseRules.setLocal(godRules(godId), { force: true });
        HouseRules.lock('pantheon');
        AIController.seatConfig[BOSS_SEAT] = godConfig(godId);
        this._ai = AIController;
        this._applySeatName();

        this.panel.classList.remove('active');
        document.body.classList.remove('menu-screen');
        document.body.classList.add('game-screen');
        document.getElementById('game-container').classList.add('active');
        UIManager.resetOfflineUI();
        this._gm = GameManager;
        GameManager.rematchOptions = () => ({ untimed: true });
        GameManager.startBotGame({ untimed: true });
        EventBus.emit('gameStateChanged', 'gameplay');
    },

    _applySeatName() {
        MatchContext.seatNames = [null, null, Localization.get(`god_${this.godId}_name`) || this.godId, null];
    },

    resetFight() {
        const g = god(this.godId);
        this.maxHp = g.hp;
        this.hp = g.hp;
        this.heals = 0;
        this.noon = false;
        if (this._ai) this._ai.seatConfig[BOSS_SEAT] = godConfig(this.godId);
        this.lastRule = [null, null, null, null];
        this.damage = [0, 0, 0, 0];
        if (this.topZone) this.topZone.classList.add('has-boss');
        if (this.hud) {
            this.hud.hidden = false;
            this.hud.setAttribute('data-god', this.godId);
            const portrait = document.getElementById('boss-portrait');
            if (portrait) portrait.innerHTML = godSvg(this.godId);
        }
        this.renderHud();
        this._say(Localization.get(`god_${this.godId}_power`) || '');
    },

    onPileWon({ winnerId, reason }) {
        if (!this.armed || this.hp <= 0) return;
        const g = god(this.godId);
        const rule = this.lastRule[winnerId];
        this.lastRule = [null, null, null, null];

        if (winnerId === BOSS_SEAT) {
            // Powers answer the god's SLAPS — the same rule the multiplayer
            // table applies inside its transaction (pantheonRoom.js).
            if (reason !== 'slap') return;
            if (g.power === 'nineLives' && this.heals < NINE_LIVES) {
                this.heals++;
                this._heal(ONE_SLAP);
            } else if (g.power === 'love' && reason === 'slap' && rule === 'marriage') {
                this._heal(2 * ONE_SLAP);
            } else if (g.power === 'sandstorm') {
                this._sandstorm();
            }
            return;
        }
        if (reason !== 'slap') return;
        const dmg = slapDamage(this.godId, rule, winnerId);
        if (dmg <= 0) return;
        this.damage[winnerId] += dmg;
        this.hp = Math.max(0, this.hp - dmg);
        this._float(`−${dmg}`, 'hit');
        if (g.power === 'noon' && !this.noon && this.hp > 0 && this.hp <= this.maxHp / 2) {
            this.noon = true;
            if (this._ai) this._ai.seatConfig[BOSS_SEAT] = godConfig(this.godId, { noon: true });
            this._heal(Math.round(1.5 * ONE_SLAP));
            this._say(Localization.get('pantheonNoon') || 'Noon! Ra blazes and quickens.');
        }
        this.renderHud();
        if (this.hp <= 0) this._fall();
    },

    onInvalidSlap({ playerId, reason } = {}) {
        if (!this.armed || god(this.godId).power !== 'weighing') return;
        if (reason === 'timeout' || playerId === BOSS_SEAT) return;
        const hand = GameState.players[playerId];
        // Never empties a hand: that path belongs to the engine (challenge
        // failure, turn hand-over), and a power must not reach around it.
        if (!hand || hand.length < 2) return;
        GameState.burnPile.push(hand.shift());
        if (playerId === HERO_SEAT && GameState.stats) GameState.stats.burns++;
        this._refreshCounts();
        if (playerId === HERO_SEAT) this._say(Localization.get('pantheonWeighed') || '⚖ The heart is weighed: a second card burns.');
    },

    _sandstorm() {
        let from = -1;
        for (const s of [0, 1, 3]) {
            if (from === -1 || GameState.players[s].length > GameState.players[from].length) from = s;
        }
        const hand = GameState.players[from];
        const n = Math.min(SET_STEAL, Math.max(0, hand.length - 1));
        if (n <= 0) return;
        GameState.players[BOSS_SEAT].push(...hand.splice(0, n));
        this._refreshCounts();
        this._float(`🌪 ${n}`, 'steal');
    },

    _heal(n) {
        this.hp = Math.min(this.maxHp, this.hp + n);
        this._float(`+${n}`, 'heal');
        this.renderHud();
    },

    _fall() {
        this._recordFall();
        // Ends in your favour whoever holds the cards: the table fought as one.
        GameState.endMatch(HERO_SEAT);
    },

    /**
     * ERS-18 fix 1: the other way a god falls. Win every card the ordinary
     * way while it still has life and the amulet is just as earned — the
     * match was already won, so this only records it. A fall by life has
     * already recorded itself (hp is 0 by then), so it is not counted twice.
     */
    onGameOver(winnerId) {
        if (!this.armed || this.hp <= 0 || winnerId !== HERO_SEAT) return;
        this._recordFall();
    },

    _recordFall() {
        this.store.defeated[this.godId] = Date.now();
        this._save();
        const name = Localization.get(`god_${this.godId}_name`) || this.godId;
        this._say((Localization.get('pantheonFallen') || '{god} has fallen!').replace('{god}', name));
    },

    /**
     * Multiplayer: the room carries the god (pantheonRoom.js). This client
     * only draws it — the life, the hits and the heals all arrive in the
     * room, written by the transaction that caused them.
     */
    syncRoom(data) {
        if (!this.hud) return;
        if (!data || !data.god) {
            if (this.roomGod) { this.roomGod = null; this.hud.hidden = true; if (this.topZone) this.topZone.classList.remove('has-boss'); }
            return;
        }
        if (this.roomGod !== data.god) {
            this.roomGod = data.god;
            this._lastHitAt = null;
            const portrait = document.getElementById('boss-portrait');
            if (portrait) portrait.innerHTML = godSvg(data.god);
            this.hud.hidden = false;
            this.hud.setAttribute('data-god', data.god);
            if (this.topZone) this.topZone.classList.add('has-boss');
            this._say(Localization.get(`god_${data.god}_power`) || '');
        }
        this.godId = data.god;
        this.hp = data.godHp ?? 0;
        this.maxHp = data.godMaxHp ?? 0;
        this.heals = data.godHeals || 0;
        this.noon = !!data.godNoon;
        const hit = data.godLastHit;
        if (hit && hit.at !== this._lastHitAt) {
            this._lastHitAt = hit.at;
            if (hit.stolen) this._float(`🌪 ${hit.stolen}`, 'steal');
            else if (hit.amount < 0) this._float(`−${-hit.amount}`, 'hit');
            else if (hit.amount > 0) this._float(`+${hit.amount}`, 'heal');
        }
        const wasArmed = this.armed;
        this.armed = true;            // renderHud draws only while armed
        this.renderHud();
        this.armed = wasArmed;
        if (data.godFallen && !this._fallSaid) {
            this._fallSaid = true;
            this._say((Localization.get('pantheonFallen') || '{god} has fallen!').replace('{god}', Localization.get(`god_${data.god}_name`) || data.god));
        }
        if (!data.godFallen) this._fallSaid = false;
    },

    stop() {
        if (this.roomGod) {
            this.roomGod = null;
            if (this.hud) this.hud.hidden = true;
            if (this.topZone) this.topZone.classList.remove('has-boss');
        }
        if (!this.armed) return;
        this.armed = false;
        if (this._ai) delete this._ai.seatConfig[BOSS_SEAT];
        if (this._gm) this._gm.rematchOptions = null;
        MatchContext.seatNames = null;
        HouseRules.unlock();
        if (this._savedRules) {
            HouseRules.setLocal(this._savedRules, { force: true });
            this._savedRules = null;
        }
        if (this.hud) this.hud.hidden = true;
        if (this.topZone) this.topZone.classList.remove('has-boss');
    },

    renderHud() {
        if (!this.hud || !this.armed) return;
        const name = Localization.get(`god_${this.godId}_name`) || this.godId;
        const nameEl = document.getElementById('boss-name');
        if (nameEl) nameEl.textContent = name;
        const pct = this.maxHp ? Math.max(0, Math.round(100 * this.hp / this.maxHp)) : 0;
        const fill = document.getElementById('boss-bar-fill');
        if (fill) fill.style.width = pct + '%';
        const bar = document.getElementById('boss-bar');
        if (bar) {
            bar.setAttribute('aria-valuenow', String(this.hp));
            bar.setAttribute('aria-valuemax', String(this.maxHp));
            bar.classList.toggle('low', pct <= 25);
        }
        const hpEl = document.getElementById('boss-hp');
        if (hpEl) hpEl.textContent = `${this.hp} / ${this.maxHp}`;
        const extra = document.getElementById('boss-extra');
        if (extra) {
            const g = god(this.godId);
            extra.textContent = g.power === 'nineLives'
                ? (Localization.get('pantheonLivesLeft') || '🐾 {n} lives left').replace('{n}', NINE_LIVES - this.heals)
                : (g.power === 'noon' && this.noon ? '☀ ' + (Localization.get('pantheonNoonTag') || 'Noon') : '');
        }
    },

    _say(text) {
        if (!text) return;
        import('./ui.js').then(({ UIManager }) => UIManager.addLog(`☥ ${text}`, 'highlight')).catch(() => {});
        const line = document.getElementById('boss-power');
        if (line) line.textContent = text;
    },

    _float(text, kind) {
        if (!this.hud) return;
        const el = document.createElement('span');
        el.className = `boss-float boss-float-${kind}`;
        el.textContent = text;
        this.hud.appendChild(el);
        setTimeout(() => el.remove(), 1100);
    },

    _refreshCounts() {
        import('./ui.js').then(({ UIManager }) => UIManager.updateCounts && UIManager.updateCounts()).catch(() => {});
    },

    _load() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (raw) this.store = { defeated: {}, ...JSON.parse(raw) };
        } catch { /* private window: the hall starts fresh */ }
    },

    _save() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(this.store)); } catch { /* see _load */ }
    }
};
