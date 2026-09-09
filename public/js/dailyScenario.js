/**
 * dailyScenario.js — the Daily Challenge deals a POSITION, not a fresh hand.
 *
 * A shared shuffle already made the daily comparable. It did not make it
 * interesting: every run still opened on the same blank 13/13/13/13, and the
 * first ninety seconds were identical filler before anything was at stake.
 *
 * So the day's seed now authors a match already in progress. Cards have been
 * played, hands are uneven, there is a pile on the table with history in it —
 * and every player on earth inherits that same position, at the same moment,
 * without ever being told how it was built.
 *
 * THREE PROFILES, chosen by the seed, so the week has a shape:
 *
 *   comeback   — you are behind. 6–9 cards against three fat bot hands. The
 *                hardest profile and the one worth bragging about.
 *   knifeEdge  — near-even hands, and the pile's top two cards are ONE RANK
 *                APART. The coach would call it a near miss; what it really is
 *                is a loaded gun. The next card played is a live chance and
 *                everyone is staring at it.
 *   finisher   — you are close to winning, 26–32 cards, and the only way to
 *                lose it is to get sloppy. Easiest to win — and, since everyone
 *                gets the same profile on the same day, nobody gains anything
 *                from that. (The handicap multiplier does NOT police this; see
 *                `handicapMultiplier` below for what it actually does.)
 *
 * A SECOND AXIS, also chosen by the seed: the bots' difficulty moves between
 * `medium` and `hard` from day to day (see `pickDifficulty`). Six kinds of day
 * instead of three, and a permanent Hard table no longer makes `comeback` days
 * a foregone loss. The rule set does NOT move — it is the classic set every
 * day, locked while the run is live, because that is what makes two scores
 * comparable at all.
 *
 * TWO INVARIANTS the generator will not ship a scenario without:
 *
 *   1. Nobody starts with an empty hand. An empty hand is an eliminated player
 *      before the first tap.
 *   2. The opening pile is NEVER already slappable. Otherwise the match begins
 *      with a free pile that goes to whoever happened to be looking at the
 *      screen — reflex measured before the player has even oriented.
 *
 * Pure and deterministic: same seed and rule set in, byte-identical scenario
 * out, on every device, forever. No DOM, no imports beyond the rule registry
 * and the PRNG, so `test_gameLogic.mjs` can hammer it.
 */

import { makeRng, hashRandom } from './rng.js';
import { matchSlap, DEFAULT_RULES } from './slapRules.js';

const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const DECK_SIZE = 52;

export const PROFILES = ['comeback', 'knifeEdge', 'finisher'];

/**
 * How many cards the human holds, per profile. The bots split what is left.
 * Ranges rather than fixed numbers so two consecutive comeback days do not
 * feel like the same day.
 */
const HUMAN_CARDS = {
    comeback: [6, 9],
    knifeEdge: [12, 14],
    finisher: [26, 32]
};

const PILE_SIZE = [3, 6];

function shuffled(rng) {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

const intBetween = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

/** Deterministic profile for a seed. */
export function pickProfile(seed) {
    return PROFILES[Math.abs(seed | 0) % PROFILES.length];
}

/**
 * How sharp the bots are today. Two tiers only, and neither is a pushover:
 * `medium` is the difficulty most people actually play at, `hard` is the one the
 * Daily Challenge used to force on everybody every single day.
 *
 * WHY IT VARIES: a permanent Hard table meant a `comeback` day — seven cards
 * against three fat hands and bots that barely miss — was close to unwinnable,
 * so the day's real content was "how badly did you lose". Letting the tier move
 * gives the week a second axis: a medium `comeback` is a genuine fight you can
 * win, a hard `finisher` is a nerve test.
 *
 * DERIVED FROM ITS OWN COORDINATE, not from `seed % 2`. The profile already
 * consumes the seed's low bits (`seed % 3`); reusing them here would tie
 * difficulty to profile — every `knifeEdge` day landing on the same tier —
 * and the year would have three kinds of day instead of six. `hashRandom` with
 * a private coordinate is independent of anything else drawn from this seed.
 *
 * SAME FOR EVERYONE, SAME AS ALWAYS: this is a pure function of the date, so
 * every player on earth faces the same bots today. Within a day it changes
 * nothing about who ranks where. ACROSS days it does make scores less
 * comparable — a medium day is easier, so scores run higher — and nothing here
 * corrects for that. Said plainly rather than papered over with a multiplier
 * nobody calibrated; see handicapMultiplier for what happens when a correction
 * claims more than it delivers.
 */
export const DIFFICULTIES = ['medium', 'hard'];

export function pickDifficulty(seed) {
    return hashRandom(seed, 0, 0, 77) < 0.5 ? 'medium' : 'hard';
}

/**
 * Splits `total` cards among `n` bots: near-even, mildly uneven, never empty.
 *
 * The obvious greedy version — hand each bot a random slice of what is left —
 * is badly wrong here. It produced splits like 1 / 34 / 1, which is not a
 * scenario, it is a bot one pile away from winning and two bots eliminated on
 * their first turn. So: start from the even share and apply BOUNDED jitter, so
 * the hands look hand-dealt without any of them being decisive on their own.
 */
function splitAmongBots(rng, total, n, spread = 0.25) {
    const base = Math.floor(total / n);
    const out = new Array(n).fill(base);
    for (let i = 0; i < total - base * n; i++) out[i]++; // remainder

    const maxMove = Math.max(0, Math.floor(base * spread));
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const move = Math.min(Math.floor(rng() * (maxMove + 1)), out[i] - 1);
        out[i] -= move;
        out[j] += move;
    }
    return out;
}

/**
 * Builds the opening pile.
 *
 * `wantNearMiss` asks for a top pair one rank apart — the knifeEdge hook. It is
 * a preference, not a guarantee: if the remaining deck holds no adjacent rank
 * the pile is simply built plain. Falling back beats looping, and the invariant
 * that actually matters (not slappable) is enforced either way.
 *
 * @returns {{pile: Array, rest: Array}}
 */
function buildPile(rng, deck, size, rules, wantNearMiss) {
    const rest = [...deck];
    const pile = [];

    for (let i = 0; i < size; i++) {
        let idx = 0;

        if (wantNearMiss && i === size - 1 && pile.length > 0) {
            const belowRank = pile[pile.length - 1].rank;
            const found = rest.findIndex(c => Math.abs(c.rank - belowRank) === 1);
            if (found >= 0) idx = found;
        }

        // Never leave the pile in a state that is already a valid slap.
        let guard = 0;
        while (guard < rest.length) {
            const candidate = rest[idx];
            if (matchSlap([...pile, candidate], rules) === null) break;
            idx = (idx + 1) % rest.length;
            guard++;
        }

        pile.push(rest.splice(idx, 1)[0]);
    }

    return { pile, rest };
}

/**
 * @param {number} seed
 * @param {object} [rules] rule set the scenario must not open slappable under
 * @returns {{
 *   profile: string, difficulty: string, hands: Array<Array>, pile: Array,
 *   burnPile: Array,
 *   activePlayerId: number, challenge: object, streaks: number[],
 *   humanStart: number, botStarts: number[]
 * }}
 */
export function buildScenario(seed, rules = DEFAULT_RULES) {
    const rng = makeRng(seed >>> 0);
    const profile = pickProfile(seed);

    const deck = shuffled(rng);
    const pileSize = intBetween(rng, PILE_SIZE[0], PILE_SIZE[1]);
    const { pile, rest } = buildPile(rng, deck, pileSize, rules, profile === 'knifeEdge');

    const [lo, hi] = HUMAN_CARDS[profile];
    // Clamped so three bots can still hold at least one card each.
    const humanStart = Math.min(intBetween(rng, lo, hi), rest.length - 3);
    const botCounts = splitAmongBots(rng, rest.length - humanStart, 3);

    const hands = [[], [], [], []];
    let k = 0;
    for (let i = 0; i < humanStart; i++) hands[0].push(rest[k++]);
    for (let b = 0; b < 3; b++) {
        for (let i = 0; i < botCounts[b]; i++) hands[b + 1].push(rest[k++]);
    }

    const scenario = {
        profile,
        difficulty: pickDifficulty(seed),
        hands,
        pile,
        burnPile: [],
        // The human always acts first: inheriting a position AND being told to
        // wait would be two unexplained things at once.
        activePlayerId: 0,
        challenge: { active: false, attackerId: null, defenderId: null, chancesLeft: 0 },
        streaks: [0, 0, 0, 0],
        humanStart: hands[0].length,
        botStarts: [hands[1].length, hands[2].length, hands[3].length]
    };

    const problem = validateScenario(scenario, rules);
    if (problem) {
        // Should be unreachable — the construction enforces every invariant. If
        // it ever fires, a plain deal is a playable day, and a silent wrong
        // scenario is not.
        console.warn('[DailyScenario] invalid scenario, falling back to a normal deal:', problem);
        return null;
    }
    return scenario;
}

/**
 * @returns {string|null} the reason it is unplayable, or null if it is fine.
 * Exported so the tests assert against the same rules the generator does.
 */
export function validateScenario(sc, rules = DEFAULT_RULES) {
    if (!sc || !Array.isArray(sc.hands) || sc.hands.length !== 4) return 'hands missing';

    const all = [...sc.hands.flat(), ...sc.pile, ...(sc.burnPile || [])];
    if (all.length !== DECK_SIZE) return `card count is ${all.length}, not ${DECK_SIZE}`;

    const seen = new Set(all.map(c => `${c.rank}-${c.suit}`));
    if (seen.size !== DECK_SIZE) return 'duplicate or missing cards';

    const empty = sc.hands.findIndex(h => h.length === 0);
    if (empty >= 0) return `seat ${empty} starts with no cards`;

    if (matchSlap(sc.pile, rules) !== null) return 'the opening pile is already slappable';

    if (sc.challenge && sc.challenge.active) {
        const d = sc.challenge.defenderId;
        if (typeof d !== 'number' || !sc.hands[d] || sc.hands[d].length === 0) {
            return 'active challenge with no defender who can play';
        }
    }
    return null;
}

/**
 * How much harder this position is than a normal 13-card deal.
 *
 * WHAT IT DOES NOT DO — corrected 2026-08-28, after a review caught the old
 * docstring claiming the opposite. `pickProfile()` is a pure function of the
 * date, so on any given day EVERY player inherits the same `humanStart` and
 * therefore the same multiplier. Multiplying every score on one board by the
 * same constant does not reorder them. For today's ranking this term is
 * provably a no-op, and it cannot be made otherwise without dealing different
 * players different hands — which would destroy the single property the Daily
 * Challenge exists to have.
 *
 * WHAT IT ACTUALLY DOES: makes scores comparable ACROSS days. 2400 on a
 * `comeback` day (7 cards, ×1.8) and 2400 on a `finisher` day (28 cards, ×0.6)
 * describe very different play; without this term a personal best would record
 * which profile the seed picked rather than how anyone played. Every real
 * consumer of this value is cross-day: your local record, your history, and any
 * all-time board.
 */
export function handicapMultiplier(humanStart) {
    const n = Number(humanStart);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.max(0.6, Math.min(1.8, 13 / n));
}
