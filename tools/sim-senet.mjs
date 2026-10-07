#!/usr/bin/env node
/**
 * sim-senet.mjs — balance simulation for Senet, the Game of Passing (v3.26.0).
 *
 * Plays the race headlessly: four seats, the real slap rules
 * (slapRules.matchSlap, the classic four the race locks), the real bot numbers
 * (botConfig.js) and the real board (senet.js: throwFor, advance). Every pile a
 * seat takes throws its piece; the first piece past square 30 wins, and 52
 * cards still win too. The same deal is then played WITHOUT the board, so the
 * two lengths compare on identical cards.
 *
 *   modelled  turn order and the 1 s hand-over; face-card challenges; every
 *             seat's slap decision and reaction per its config; wrong slaps
 *             burning a card; shields (3 slaps in a row); Slap Back In.
 *   not       the turn timer; stale slaps landing on the next pile; the 500 ms
 *             grace; shield expiry. The same omissions as sim-pantheon.mjs.
 *
 * The hero is a model, not a player: the three profiles of sim-pantheon.mjs.
 * Council ERS-40 read this table: races of about half a match, the weaker
 * hero's chance up, the stronger hero's unchanged.
 *
 *   node tools/sim-senet.mjs [--n 800] [--tiers medium,hard] [--scale 2] [--no-swap] [--json]
 */
import { pathToFileURL } from 'node:url';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document ??= { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, body: { classList: { add() {}, remove() {} } } };
globalThis.window ??= globalThis;

const { matchSlap } = await import('../public/js/slapRules.js');
const { BotConfig, BotPersonalities, applyPersonality } = await import('../public/js/botConfig.js');
const S = await import('../public/js/senet.js');
const { DAMAGE } = await import('../public/js/pantheon.js');

const FACE = { 11: 1, 12: 2, 13: 3, 14: 4 };
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
export const HEROES = {
    fast: { min: 380, max: 650, acc: 0.93, fals: 0.02, play: [500, 900] },
    avg:  { min: 520, max: 900, acc: 0.85, fals: 0.03, play: [600, 1100] },
    slow: { min: 700, max: 1150, acc: 0.75, fals: 0.04, play: [700, 1300] }
};

function rng(seed) {
    let x = seed >>> 0;
    return () => ((x = (Math.imul(x ^ (x >>> 15), 2246822519) + 0x9E3779B9) >>> 0), (x >>> 8) / 16777216);
}

/** The shipped throw, or the same formula at another scale (--scale probes only). */
function throwAt(scale) {
    if (scale === S.THROW_SCALE) return S.throwFor;
    return (id) => Math.max(1, Math.min(S.THROW_MAX, Math.round(scale * DAMAGE[id] / DAMAGE.doubles)));
}

/**
 * One match. `board` null plays an ordinary table; otherwise
 * { scale, swap } races the pieces. Returns { winner, by, cards, water, swaps }.
 */
export function race(hero, tier, seed, board = { scale: S.THROW_SCALE, swap: true }) {
    const R = rng(seed);
    const U = (a, b) => a + R() * (b - a);
    const bot = (s) => applyPersonality(BotPersonalities[s], BotConfig[tier]);
    const seats = [null, bot(1), bot(2), bot(3)];
    const deck = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ rank: r, suit: s });
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const hands = [0, 1, 2, 3].map(i => deck.slice(i * 13, i * 13 + 13));
    const throwOf = board ? throwAt(board.scale) : null;
    let pos = S.startPositions();
    let pile = [], burn = [], ch = null, active = Math.floor(R() * 4), cards = 0, passed = -1;
    const streak = [0, 0, 0, 0];
    const st = { water: 0, swaps: 0 };
    const next = (id) => { for (let k = 1; k <= 4; k++) { const n = (id + k) % 4; if (hands[n].length) return n; } return null; };
    const award = (winner, reason, m) => {
        hands[winner].push(...burn, ...pile);
        pile = []; burn = []; ch = null; active = winner;
        if (reason === 'slap') streak[winner] = Math.min(3, streak[winner] + 1);
        for (let i = 0; i < 4; i++) if (i !== winner && streak[i] < 3) streak[i] = 0;
        if (!board) return;
        const steps = reason === 'slap' ? throwOf(m.id) : S.CHALLENGE_THROW;
        let mv = S.advance(pos, winner, steps);
        if (!board.swap && mv.swappedWith !== null) {
            // probe only: the same move without the capture rule
            mv = { ...mv, positions: pos.map((p, i) => (i === winner ? mv.to : p)), swappedWith: null };
        }
        pos = mv.positions;
        if (mv.water) st.water++;
        if (mv.swappedWith !== null) st.swaps++;
        if (mv.bornOff) passed = winner;
    };
    const wrong = (seat) => {
        if (streak[seat] >= 3) { streak[seat] = 0; return; }
        streak[seat] = 0;
        if (!hands[seat].length) return;
        burn.push(hands[seat].shift());
    };
    const slapRound = (window) => {
        const m = matchSlap(pile, S.SENET_RULES);
        let best = null;
        for (let s = 0; s < 4; s++) {
            const c = seats[s];
            const isHero = c === null;
            if (m) {
                if (R() >= (isHero ? hero.acc : c.accuracy)) continue;
                const t = isHero ? U(hero.min, hero.max) : U(c.minReaction, c.maxReaction);
                if (t < window && (!best || t < best.t)) best = { s, t };
            } else if (R() < (isHero ? hero.fals : c.falseSlap)) {
                const t = isHero ? U(hero.min, hero.max) : U(c.minReaction, c.maxReaction) + 200;
                if (t < window) wrong(s);
            }
        }
        if (m && best) { award(best.s, 'slap', m); return true; }
        return false;
    };
    for (let guard = 0; guard < 4000; guard++) {
        if (passed >= 0) return { winner: passed, by: 'senet', cards, ...st };
        for (let i = 0; i < 4; i++) if (hands[i].length === 52) return { winner: i, by: 'cards', cards, ...st };
        const alive = [0, 1, 2, 3].filter(i => hands[i].length > 0);
        if (alive.length <= 1) return { winner: alive[0] ?? -1, by: 'cards', cards, ...st };
        const p = active;
        if (!hands[p].length) {
            if (ch && ch.defender === p) { award(ch.attacker, 'challenge'); continue; }
            const n = next(p); if (n === null) return { winner: -1, by: 'dead', cards, ...st };
            active = n; continue;
        }
        const card = hands[p].shift();
        pile.push(card); cards++;
        const c = seats[p];
        const nextDelay = 1000 + (c === null ? U(...hero.play) : c.playDelay + R() * c.playVariance);
        const face = card.rank >= 11;
        let resolve = false;
        if (ch) {
            if (face) { ch = { attacker: p, defender: next(p), left: FACE[card.rank] }; active = ch.defender; }
            else { ch.left--; if (ch.left <= 0 || !hands[p].length) resolve = true; }
        } else if (face) { ch = { attacker: p, defender: next(p), left: FACE[card.rank] }; active = ch.defender; }
        else active = next(p) ?? p;
        const won = slapRound(resolve ? 1000 : nextDelay);
        if (!won && resolve) award(ch.attacker, 'challenge');
    }
    return { winner: -2, by: 'stall', cards, ...st };
}

export function run({ n = 800, tiers = ['medium', 'hard'], heroes = Object.keys(HEROES), scale = S.THROW_SCALE, swap = true } = {}) {
    const rows = [];
    for (const tier of tiers) for (const h of heroes) {
        const a = { win: 0, plainWin: 0, cards: 0, plainCards: 0, senet: 0, water: 0, swaps: 0 };
        for (let i = 0; i < n; i++) {
            const seed = 0x5E7E7000 + i * 7919;
            const r = race(HEROES[h], tier, seed, { scale, swap });
            const p = race(HEROES[h], tier, seed, null);
            if (r.winner === 0) a.win++;
            if (p.winner === 0) a.plainWin++;
            if (r.by === 'senet') a.senet++;
            a.cards += r.cards; a.plainCards += p.cards; a.water += r.water; a.swaps += r.swaps;
        }
        rows.push({ tier, hero: h, n, win: a.win / n, plainWin: a.plainWin / n, cards: a.cards / n,
            plainCards: a.plainCards / n, bearOff: a.senet / n, water: a.water / n, swaps: a.swaps / n });
    }
    return rows;
}

if ((process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) || process.argv[1]?.endsWith('sim-senet.mjs')) {
    const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
    const rows = run({
        n: Number(arg('--n', 800)),
        tiers: arg('--tiers', 'medium,hard').split(','),
        heroes: arg('--heroes', Object.keys(HEROES).join(',')).split(','),
        scale: Number(arg('--scale', S.THROW_SCALE)),
        swap: !process.argv.includes('--no-swap')
    });
    if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
    else for (const r of rows) console.log(
        `${r.tier.padEnd(7)} ${r.hero.padEnd(5)} race-win ${(100 * r.win).toFixed(1).padStart(5)}% (no board ${(100 * r.plainWin).toFixed(1).padStart(5)}%)`
        + `  cards ${r.cards.toFixed(0).padStart(4)} vs ${r.plainCards.toFixed(0).padStart(4)}`
        + `  bear-off ${(100 * r.bearOff).toFixed(0).padStart(3)}%  water ${r.water.toFixed(2)}  swaps ${r.swaps.toFixed(2)}`);
}
