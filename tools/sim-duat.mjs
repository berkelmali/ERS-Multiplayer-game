#!/usr/bin/env node
/**
 * sim-duat.mjs — how hard is the Duat Journey, measured, not guessed.
 *
 * Runs whole journeys through the REAL engine (game.js), the REAL Duat
 * (duat.js) and the REAL shades (ai.js, AIController) on a fake clock, with a
 * scripted hero whose reflexes are drawn from a model:
 *
 *   slow  slaps a pattern 700–1000 ms after the card, catches 80 %
 *   avg   450–700 ms, catches 90 %   (the smoke run's auto-player)
 *   fast  300–450 ms, catches 95 %
 * Each hero also has an itchy hand in the Duat: after a card that is NOT a
 * pattern it slaps anyway with a small chance (the mistake the tries price).
 *
 *   node tools/sim-duat.mjs [--n 300] [--diff medium,hard] [--heroes slow,avg,fast] [--seed 1] [--json]
 *   --edge 0.7,0.1,1   tuning only: another reaction share, accuracy bonus, tier lift
 *
 * Prints, per difficulty × hero: the share of journeys that rose at least once,
 * reached dawn, ended in the Duat by tries or by rounds, and the average hour.
 */
import * as NodeModule from 'node:module';
import { pathToFileURL } from 'node:url';
if (NodeModule.registerHooks) NodeModule.registerHooks({ resolve: (await import('./fuzz/hooks.mjs')).resolveSync });
else NodeModule.register('./fuzz/hooks.mjs', import.meta.url);

// ── fake clock ────────────────────────────────────────────────────────────────
let NOW = 1_800_000_000_000, tid = 1;
const timers = [];
globalThis.setTimeout = (fn, ms = 0, ...a) => { const id = tid++; timers.push({ id, at: NOW + Math.max(0, Number(ms) || 0), fn, a }); return id; };
globalThis.clearTimeout = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
globalThis.setInterval = () => tid++;
globalThis.clearInterval = () => {};
Date.now = () => NOW;
function runUntil(end, stop) {
    while (!stop()) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift();
        NOW = Math.max(NOW, t.at);
        try { t.fn(...t.a); } catch { /* the sim measures, the fuzzer hunts */ }
    }
}

// ── a browser shaped enough to load ───────────────────────────────────────────
const el = () => ({ classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: { setProperty() {}, removeProperty() {} },
    setAttribute() {}, appendChild() {}, append() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, textContent: '', innerHTML: '' });
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    body: el(), documentElement: el(), addEventListener() {}, hidden: false, visibilityState: 'visible' };
globalThis.localStorage = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; })();
try { globalThis.navigator ??= { onLine: true, userAgent: 'sim' }; } catch { /* read-only */ }
globalThis.addEventListener ??= () => {};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);

let seedState = 1;
Math.random = () => { seedState = (Math.imul(seedState ^ (seedState >>> 15), 2246822519) + 0x9E3779B9) >>> 0; return (seedState >>> 8) / 16777216; };
const rnd = () => Math.random();

const quietLog = console.log, quietWarn = console.warn, quietErr = console.error;
console.log = console.warn = console.error = () => {};
const { GameState } = await import('../public/js/game.js');
const EventBus = (await import('../public/js/eventbus.js')).default;
const D = await import('../public/js/duat.js');
const { AIController } = await import('../public/js/ai.js');
const { GameManager } = await import('../public/js/gameManager.js');
const { Settings } = await import('../public/js/settings.js');
const { MatchContext } = await import('../public/js/matchContext.js');
const { HouseRules } = await import('../public/js/houseRules.js');
const { DEFAULT_RULES } = await import('../public/js/slapRules.js');
const P = await import('../public/js/pantheon.js');
const BOT = await import('../public/js/botConfig.js');
console.log = quietLog; console.warn = quietWarn; console.error = quietErr;

export const HEROES = {
    slow: { min: 700, max: 1000, catch: 0.80, itch: 0.06, play: [900, 1800] },
    avg: { min: 450, max: 700, catch: 0.90, itch: 0.04, play: [600, 1300] },
    fast: { min: 300, max: 450, catch: 0.95, itch: 0.03, play: [400, 900] }
};

let inited = false;
let hero = HEROES.avg;
function init() {
    if (inited) return;
    inited = true;
    console.log = console.warn = () => {};
    D.DuatMode.init();
    AIController.init();
    P.PantheonMode.armed = false;
    // The hero: slaps what it sees, at its own speed; plays its own turns.
    EventBus.on('cardPlayed', () => {
        if (!D.DuatMode.armed || GameState.gameOver) return;
        const pattern = GameState.isValidSlap();
        const dead = GameState.players[0].length === 0;
        if (pattern && rnd() < hero.catch) {
            setTimeout(() => { if (!GameState.gameOver && GameState.isValidSlap()) GameState.slap(0); }, hero.min + rnd() * (hero.max - hero.min));
        } else if (!pattern && dead && rnd() < hero.itch) {
            setTimeout(() => { if (!GameState.gameOver) GameState.slap(0); }, hero.min + rnd() * (hero.max - hero.min));
        }
    });
    EventBus.on('turnChanged', (id) => {
        if (!D.DuatMode.armed || id !== 0 || GameState.gameOver) return;
        setTimeout(() => { if (!GameState.gameOver && GameState.activePlayerId === 0) GameState.playCard(0); }, hero.play[0] + rnd() * (hero.play[1] - hero.play[0]));
    });
    console.log = quietLog; console.warn = quietWarn;
}

/** One journey. Returns how it ended. */
export function journey(diff, heroKey, seed) {
    init();
    seedState = (seed * 2654435761) >>> 0;
    hero = HEROES[heroKey];
    Settings.config.difficulty = diff;
    MatchContext.difficultyOverride = null;
    HouseRules.setLocal({ ...DEFAULT_RULES }, { force: true });
    GameManager.activeMode = 'bots';
    const DM = D.DuatMode;
    Object.assign(DM, { armed: true, _ai: AIController, hud: null, _gm: null });
    MatchContext.ownsElimination = true;
    MatchContext.pricesWrongSlaps = true;
    timers.length = 0;
    AIController.intervals = {}; AIController.slapTimeouts = {};
    let rose = 0, winner = null;
    const onRes = (s) => { if (s === 0) rose = 1; };
    const onOver = (w) => { if (winner === null) winner = w; };
    EventBus.on('resurrected', onRes); EventBus.on('gameOver', onOver);
    console.log = console.warn = () => {};
    try {
        GameState.gameOver = true;
        GameState.init(D.duatScenario());
        runUntil(NOW + 60 * 60 * 1000, () => GameState.gameOver);
    } finally {
        console.log = quietLog; console.warn = quietWarn;
        EventBus.off('resurrected', onRes); EventBus.off('gameOver', onOver);
    }
    const out = { rose, dawn: winner === 0 ? 1 : 0, hour: DM.hour, tries: DM.tries, byTries: DM.lostBy === 'tries' ? 1 : 0, byRounds: DM.lostBy === 'rounds' || (winner !== 0 && DM.lostBy !== 'tries' && DM.dead) ? 1 : 0, cap: GameState.gameOver ? 0 : 1 };
    DM.stop && (() => { console.log = () => {}; try { DM.stop(); } catch { /* DOM */ } console.log = quietLog; })();
    GameState.gameOver = true; timers.length = 0;
    return out;
}

/**
 * Tuning only: play the shades with another edge (reaction share, accuracy
 * bonus) and tier lift instead of the shipped SHADE_EDGE, to scan the space.
 */
export function withEdge(edge) {
    const DM = D.DuatMode;
    if (!DM._shippedApep) DM._shippedApep = DM._apep;
    if (!edge) { DM._apep = DM._shippedApep; return; }
    const { BotConfig, BotPersonalities, applyPersonality } = BOT;
    DM._apep = function (on) {
        if (!this._ai) return;
        for (const s of [1, 2, 3]) delete this._ai.seatConfig[s];
        if (!this.armed) return;
        let t = Settings.config.difficulty;
        for (let k = 0; k < edge.lift + (on ? 1 : 0); k++) t = D.nextTier(t);
        for (const s of [1, 2, 3]) {
            const c = applyPersonality(BotPersonalities[s], BotConfig[t]);
            this._ai.seatConfig[s] = { ...c, minReaction: Math.max(150, c.minReaction * edge.r), maxReaction: Math.max(200, c.maxReaction * edge.r), accuracy: Math.min(0.97, c.accuracy + edge.a) };
        }
    };
}

export function run({ n = 300, diffs = ['medium', 'hard'], heroes = ['slow', 'avg', 'fast'], seed0 = 1 } = {}) {
    const rows = [];
    for (const diff of diffs) for (const h of heroes) {
        const agg = { n: 0, rose: 0, dawn: 0, hour: 0, byTries: 0, byRounds: 0, cap: 0 };
        for (let i = 0; i < n; i++) {
            const r = journey(diff, h, seed0 + i);
            agg.n++; for (const k of ['rose', 'dawn', 'hour', 'byTries', 'byRounds', 'cap']) agg[k] += r[k];
        }
        rows.push({ diff, hero: h, ...agg });
    }
    return rows;
}

// pathToFileURL, not `file://${argv[1]}`: on Windows argv[1] is D:\..., and the
// string version never matches, so the CLI printed nothing (the verify gate read NaN).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
    const e = arg('--edge', null);   // r,a,lift  e.g. 0.7,0.1,1
    if (e) { const [r, a, lift] = e.split(',').map(Number); withEdge({ r, a, lift }); }
    const rows = run({ n: Number(arg('--n', 300)), diffs: arg('--diff', 'easy,medium,hard').split(','), heroes: arg('--heroes', 'slow,avg,fast').split(','), seed0: Number(arg('--seed', 1)) });
    if (process.argv.includes('--json')) { console.log(JSON.stringify(rows)); process.exit(0); }
    const pct = (a, n) => `${(100 * a / n).toFixed(1)}%`.padStart(6);
    console.log('diff    hero   rose   dawn   lost:tries  lost:rounds  avg hour  unfinished');
    for (const r of rows) console.log(`${r.diff.padEnd(7)} ${r.hero.padEnd(5)} ${pct(r.rose, r.n)} ${pct(r.dawn, r.n)}   ${pct(r.byTries, r.n)}      ${pct(r.byRounds, r.n)}     ${(r.hour / r.n).toFixed(1).padStart(5)}    ${r.cap}`);
}
