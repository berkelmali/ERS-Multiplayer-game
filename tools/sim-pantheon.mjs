#!/usr/bin/env node
/**
 * sim-pantheon.mjs — balance simulation for the Table of the Gods.
 *
 * Plays the offline duel headlessly: four seats, the real slap rules
 * (slapRules.matchSlap), the real god numbers (pantheon.js: life, damage,
 * powers, speed) and the real ghost functions (ghostCards.js). What it
 * models, and what it does not, is stated so the numbers can be read:
 *
 *   modelled  turn order and the 1 s turn hand-over; face-card challenges;
 *             every seat's slap decision and reaction per its config; wrong
 *             slaps burning a card; shields (3 slaps in a row); the Slap
 *             Back In rule; all six gods' powers; ghost cards.
 *   not       the turn timer (bots never time out; the hero is assumed to
 *             play in time); stale slaps landing on the NEXT pile; the 500 ms
 *             slap grace; shield expiry (30 s) — a shield lasts until used.
 *
 * The hero is a model, not a player. Three profiles bracket real play; the
 * comparison that matters is the same profile with and without ghosts.
 *
 *   node tools/sim-pantheon.mjs [--n 1500] [--gods bastet,ra] [--json]
 */
import { matchSlap } from '../public/js/slapRules.js';
import { ghostClones, addGhosts, vaporize, realCount, GHOST_PER_SLAP, GHOST_HELD_MAX } from '../public/js/ghostCards.js';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document ??= { getElementById: () => null, querySelector: () => null, addEventListener: () => {}, body: { classList: { add() {}, remove() {} } } };
globalThis.window ??= globalThis;

const P = await import('../public/js/pantheon.js');
const { BotConfig, BotPersonalities, applyPersonality } = await import('../public/js/botConfig.js');
const { GODS, godRules, godConfig, slapDamage, NINE_LIVES, SET_STEAL, DAMAGE, BOSS_SEAT, HERO_SEAT } = P;

const FACE = { 11: 1, 12: 2, 13: 3, 14: 4 };
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const ONE = DAMAGE.doubles;

export const HEROES = {
    fast: { min: 380, max: 650, acc: 0.93, fals: 0.02, play: [500, 900] },
    avg:  { min: 520, max: 900, acc: 0.85, fals: 0.03, play: [600, 1100] },
    slow: { min: 700, max: 1150, acc: 0.75, fals: 0.04, play: [700, 1300] }
};

// `shipped` is what v3.19.0 plays (council ERS-20): the D1 clone rule, 6 per
// slap, 13 held, on TOP of the god's hand, no echo rule. The others are the
// alternatives the council weighed, kept so the comparison can be re-run.
export const VARIANTS = {
    off:      null,
    shipped:  { clone: 'proposal', perSlap: GHOST_PER_SLAP, held: GHOST_HELD_MAX, place: 'top' },
    bottom:   { clone: 'proposal', perSlap: GHOST_PER_SLAP, held: GHOST_HELD_MAX, place: 'bottom' },
    pattern:  { clone: 'pattern', perSlap: 99, held: GHOST_HELD_MAX, place: 'bottom' },
    whole:    { clone: 'whole', perSlap: 99, held: 26, place: 'bottom' },
    // A slap whose pattern holds a ghost strikes an echo: it wins the pile
    // but deals `echo` of its damage.
    echoHalf: { clone: 'proposal', perSlap: GHOST_PER_SLAP, held: GHOST_HELD_MAX, place: 'bottom', echo: 0.5 },
    topEcho:  { clone: 'proposal', perSlap: GHOST_PER_SLAP, held: GHOST_HELD_MAX, place: 'top', echo: 0.5 }
};

function rng(seed) {
    let x = seed >>> 0;
    return () => ((x = (Math.imul(x ^ (x >>> 15), 2246822519) + 0x9E3779B9) >>> 0), (x >>> 8) / 16777216);
}

function clonesFor(v, pile, indices) {
    if (v.clone === 'proposal') return ghostClones(pile, indices, v.perSlap);
    const real = [];
    for (let i = pile.length - 1; i >= 0; i--) {
        const c = pile[i];
        if (c.ghost) continue;
        if (v.clone === 'whole' || indices.includes(i)) real.push({ rank: c.rank, suit: c.suit, ghost: true });
    }
    return real.slice(0, v.perSlap);
}

/** One duel. Returns { heroWon, by, cards, ghostsAdded, ghostsVanished, hpLeft, piles }. */
export function duel(godId, hero, variant, seed, priestTier = 'medium', probe = null) {
    const R = rng(seed);
    const U = (a, b) => a + R() * (b - a);
    const g = GODS.find(x => x.id === godId);
    const rules = godRules(godId);
    const priest = (seat) => applyPersonality(BotPersonalities[seat], BotConfig[priestTier]);
    const cfg = { 1: priest(1), 3: priest(3), 2: godConfig(godId) };

    const deck = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ rank: r, suit: s });
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const hands = [0, 1, 2, 3].map(i => deck.slice(i * 13, i * 13 + 13));
    let pile = [], burn = [];
    let ch = null; // { attacker, defender, left }
    let active = Math.floor(R() * 4);
    const streak = [0, 0, 0, 0];
    let hp = g.hp, heals = 0, noon = false;
    const st = { cards: 0, ghostsAdded: 0, ghostsVanished: 0, piles: 0, godChallengeWins: 0, echoSlaps: 0, sideSlaps: 0, ghostsPlayed: 0, perSlapCapHits: 0, heldCapHits: 0 };

    // A hand of ghosts only is empty (council ERS-20, condition 2).
    const hollow = (i) => { if (hands[i].length && realCount(hands[i]) === 0) { st.ghostsVanished += hands[i].length; hands[i] = []; } };
    const next = (id) => { for (let k = 1; k <= 4; k++) { const n = (id + k) % 4; if (hands[n].length) return n; } return null; };
    const over = () => {
        for (let i = 0; i < 4; i++) if (realCount(hands[i]) === 52) return i;
        const alive = [0, 1, 2, 3].filter(i => hands[i].length > 0);
        return alive.length <= 1 ? (alive[0] ?? -1) : null;
    };

    const award = (winner, reason, match) => {
        st.piles++;
        const taken = [...burn, ...pile];
        const slapped = pile;
        let kept = taken;
        if (variant) { const v = vaporize(taken); kept = v.kept; st.ghostsVanished += v.vanished; }
        hands[winner].push(...kept);
        for (let i = 0; i < 4; i++) hollow(i);
        pile = []; burn = []; ch = null; active = winner;
        if (probe) probe({ hands, pile, burn, at: 'award' });
        if (reason === 'slap') streak[winner] = Math.min(3, streak[winner] + 1);
        for (let i = 0; i < 4; i++) if (i !== winner && streak[i] < 3) streak[i] = 0;
        if (winner === BOSS_SEAT) {
            if (reason === 'challenge') st.godChallengeWins++;
            if (reason !== 'slap') return;
            if (g.power === 'nineLives' && heals < NINE_LIVES) { heals++; hp = Math.min(g.hp, hp + ONE); }
            else if (g.power === 'love' && match && match.id === 'marriage') hp = Math.min(g.hp, hp + 2 * ONE);
            else if (g.power === 'sandstorm') {
                let from = -1;
                for (const s of [0, 1, 3]) if (from === -1 || hands[s].length > hands[from].length) from = s;
                const n = Math.min(SET_STEAL, Math.max(0, hands[from].length - 1));
                if (n > 0) hands[BOSS_SEAT].push(...hands[from].splice(0, n));
            }
            return;
        }
        if (reason !== 'slap') return;
        let dmg = slapDamage(godId, match.id, winner);
        const echoed = match.indices.some(i => slapped[i] && slapped[i].ghost);
        if (echoed) { st.echoSlaps++; if (variant && variant.echo !== undefined) dmg = Math.round(dmg * variant.echo); }
        st.sideSlaps++;
        hp = Math.max(0, hp - dmg);
        if (g.power === 'noon' && !noon && hp > 0 && hp <= g.hp / 2) {
            noon = true; cfg[2] = godConfig(godId, { noon: true });
            hp = Math.min(g.hp, hp + Math.round(1.5 * ONE));
        }
        if (variant && hp > 0) {
            const clones = clonesFor(variant, slapped, match.indices);
            const uncapped = clonesFor({ ...variant, perSlap: 99 }, slapped, match.indices).length;
            if (uncapped > variant.perSlap) st.perSlapCapHits++;
            const n = addGhosts(hands[BOSS_SEAT], clones, variant.held, variant.place);
            if (realCount(hands[BOSS_SEAT]) > 0 && n < clones.length) st.heldCapHits++;
            st.ghostsAdded += n;
            if (probe) probe({ hands, pile, burn, at: 'haunt' });
        }
    };

    const wrong = (seat) => {
        if (streak[seat] >= 3) { streak[seat] = 0; return; }
        streak[seat] = 0;
        if (!hands[seat].length) return;
        burn.push(hands[seat].shift());
        if (g.power === 'weighing' && seat !== BOSS_SEAT && hands[seat].length >= 2) burn.push(hands[seat].shift());
        hollow(seat);
    };

    /** Slaps after a card lands, inside `window` ms. Returns true if the pile was won. */
    const slapRound = (window) => {
        const m = matchSlap(pile, rules);
        let best = null;
        for (let s = 0; s < 4; s++) {
            const c = s === HERO_SEAT ? null : cfg[s];
            if (m) {
                const acc = c ? c.accuracy : hero.acc;
                if (R() >= acc) continue;
                const t = c ? U(c.minReaction, c.maxReaction) : U(hero.min, hero.max);
                if (t < window && (!best || t < best.t)) best = { s, t };
            } else {
                const f = c ? c.falseSlap : hero.fals;
                if (R() < f) {
                    const t = (c ? U(c.minReaction, c.maxReaction) + 200 : U(hero.min, hero.max));
                    if (t < window) wrong(s);
                }
            }
        }
        if (m && best) { award(best.s, 'slap', m); return true; }
        return false;
    };

    for (let guard = 0; guard < 4000; guard++) {
        if (hp <= 0) return { heroWon: true, by: 'life', hpLeft: 0, ...st };
        const end = over();
        if (end !== null) return { heroWon: end === HERO_SEAT, by: 'cards', winner: end, hpLeft: hp, ...st };
        const p = active;
        if (!hands[p].length) {
            if (ch && ch.defender === p) { award(ch.attacker, 'challenge'); continue; }
            const n = next(p); if (n === null) return { heroWon: false, by: 'dead', hpLeft: hp, ...st };
            active = n; continue;
        }
        const card = hands[p].shift();
        pile.push(card); st.cards++;
        hollow(p);
        if (probe) probe({ hands, pile, burn, at: 'play' });
        if (card.ghost) st.ghostsPlayed++;
        const c = p === HERO_SEAT ? null : cfg[p];
        const nextDelay = 1000 + (c ? c.playDelay + R() * c.playVariance : U(...hero.play));
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
    return { heroWon: false, by: 'stall', hpLeft: hp, ...st };
}

export function run({ n = 1500, gods = GODS.map(g => g.id), heroes = Object.keys(HEROES), variants = Object.keys(VARIANTS) } = {}) {
    const rows = [];
    for (const godId of gods) for (const h of heroes) for (const vk of variants) {
        const acc = { win: 0, life: 0, cards: 0, ghostsAdded: 0, ghostsVanished: 0, len: 0, stall: 0, godCh: 0, echo: 0, side: 0, gp: 0, capS: 0, capH: 0 };
        for (let i = 0; i < n; i++) {
            const r = duel(godId, HEROES[h], VARIANTS[vk], 0x5EED0000 + i * 7919);
            if (r.heroWon) { acc.win++; if (r.by === 'life') acc.life++; else acc.cards++; }
            if (r.by === 'stall') acc.stall++;
            acc.ghostsAdded += r.ghostsAdded; acc.ghostsVanished += r.ghostsVanished; acc.len += r.cards; acc.godCh += r.godChallengeWins; acc.echo += r.echoSlaps; acc.side += r.sideSlaps; acc.gp += r.ghostsPlayed; acc.capS += r.perSlapCapHits; acc.capH += r.heldCapHits;
        }
        rows.push({ god: godId, hero: h, variant: vk, n,
            win: acc.win / n, byLife: acc.life / n, byCards: acc.cards / n,
            cardsPlayed: acc.len / n, ghostsAdded: acc.ghostsAdded / n, ghostsVanished: acc.ghostsVanished / n,
            godChallengeWins: acc.godCh / n, stall: acc.stall / n, echoShare: acc.side ? acc.echo / acc.side : 0, sideSlaps: acc.side / n, ghostsPlayed: acc.gp / n, perSlapCapHits: acc.capS / n, heldCapHits: acc.capH / n });
    }
    return rows;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sim-pantheon.mjs')) {
    const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
    const rows = run({
        n: Number(arg('--n', 1500)),
        gods: arg('--gods', GODS.map(g => g.id).join(',')).split(','),
        heroes: arg('--heroes', Object.keys(HEROES).join(',')).split(','),
        variants: arg('--variants', Object.keys(VARIANTS).join(',')).split(',')
    });
    if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
    else for (const r of rows) console.log(
        `${r.god.padEnd(7)} ${r.hero.padEnd(5)} ${r.variant.padEnd(9)} win ${(100 * r.win).toFixed(1).padStart(5)}%  len ${r.cardsPlayed.toFixed(0).padStart(4)}`
        + `  ghosts +${r.ghostsAdded.toFixed(1).padStart(4)} played ${r.ghostsPlayed.toFixed(1).padStart(4)}`
        + `  caps 6/slap ${r.perSlapCapHits.toFixed(2)} 13/held ${r.heldCapHits.toFixed(2)}  stall ${(100 * r.stall).toFixed(1)}%`);
}
