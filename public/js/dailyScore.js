/**
 * dailyScore.js — the pure half of the Daily Challenge.
 *
 * Split out from dailyChallenge.js on purpose: that module imports the Firebase
 * SDK from a CDN URL, which plain `node` cannot resolve, so anything living
 * there is untestable outside a browser. The day key, the seed derivation and
 * the scoring formula are exactly the parts that MUST be tested — a silent
 * change to any of them makes yesterday's leaderboard incomparable with
 * today's — so they live here instead, with zero imports.
 */

import { hashStringToSeed } from './rng.js';
import { handicapMultiplier } from './dailyScenario.js';

/** UTC, so the day flips at the same instant for every player on earth. */
export function todayKey(now = new Date()) {
    return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function seedForDate(dateKey) {
    return hashStringToSeed('ERS-DAILY-' + dateKey);
}

/**
 * Rewards what skill controls, punishes what carelessness controls.
 *
 * The reflex term is CAPPED at 520 on purpose: without a cap, one lucky 180ms
 * slap in an otherwise lost match could outrank a clean, patient win, and the
 * board would stop measuring play and start measuring best-single-moment.
 *
 * SINCE THE SCENARIO UPDATE the position you inherit is part of the score. A
 * `finisher` day hands you 28 cards and asks you not to fumble; a `comeback` day
 * hands you 7 and asks for the improbable. Paying both the same would make a
 * personal best a record of which profile the seed picked, not of how anyone
 * played — so the whole score is multiplied by a handicap derived from the
 * starting hand (see dailyScenario.js::handicapMultiplier). A normal 13-card
 * start is ×1.
 *
 * TO BE PRECISE ABOUT WHAT THAT BUYS: everyone gets the same profile on a given
 * day, so the multiplier is the same for everyone on that day and changes
 * nothing about TODAY'S ordering. It buys comparability across days, and
 * nothing else. `handicapMultiplier`'s own docstring has the full argument.
 *
 * @param {{won:boolean, cardsWon:number, bestReflex:number, burns:number,
 *          durationMs:number, startingCards?:number}} r
 * @returns {number} score, never negative
 */
export function computeScore({ won, cardsWon, bestReflex, burns, durationMs, startingCards }) {
    const base = won ? 1000 : 400;
    const cardBonus = Math.max(0, Math.round((cardsWon || 0) * 4));
    const reflex = (bestReflex && bestReflex < 9999) ? bestReflex : 900;
    const reflexBonus = Math.min(520, Math.max(0, Math.round((900 - reflex) * 0.8)));
    const burnPenalty = Math.max(0, (burns || 0) * 25);
    const durationSec = Math.max(0, Math.round((durationMs || 0) / 1000));
    // Speed bonus only for a win: rewarding a fast LOSS would reward quitting.
    const timeBonus = won ? Math.max(0, 300 - durationSec) : 0;

    const raw = base + cardBonus + reflexBonus + timeBonus - burnPenalty;
    // Omitting startingCards (a normal match, or an old saved record) is ×1, so
    // this stays backwards compatible with anything scored before scenarios.
    const handicap = startingCards ? handicapMultiplier(startingCards) : 1;
    return Math.max(0, Math.round(raw * handicap));
}

/* -------------------------------------------------------------------------
 * Board payload shape — MIRRORED IN firestore.rules
 *
 * Read this before changing a number below. The daily board is written
 * straight from the client, so `firestore.rules` is the only thing standing
 * between the board and a browser console. These bounds are that wall, and
 * they exist in two places: here, and in the `daily_challenges` match block of
 * firestore.rules. `npm run check:score-bounds` fails the build if the two
 * drift apart — the same guard pattern as `sync:rules`.
 *
 * BE HONEST ABOUT WHAT THIS IS. Bounds validate SHAPE, not truth. A client
 * that submits a well-formed lie — `won:true, score:4900` after losing —
 * passes every check here, because nothing server-side ever saw the match.
 * That is why `DailyChallenge.VERIFIED_BOARD` is false and the panel says so.
 * What these bounds do buy: the trivial attack (`setDoc(ref,{score:5000})`)
 * now fails on shape, scores can never be silently downgraded, and a stale or
 * backdated write is rejected outright. That is a smaller claim than
 * "verified", and it is the one the code can actually keep.
 * ---------------------------------------------------------------------- */

export const BOARD_PROFILES = Object.freeze(['comeback', 'knifeEdge', 'finisher']);

export const SCORE_BOUNDS = Object.freeze({
    scoreMin: 0,
    scoreMax: 5000,
    reflexMin: 80,        // sub-80ms is not a human reaction; see fairSlap.js
    reflexMax: 60000,
    durationMin: 0,       // an abandoned run can be settled almost instantly
    durationMax: 3600000, // one hour; anything longer is a tab left open
    usernameMax: 24,
    startingCardsMin: 1,
    startingCardsMax: 52,
    clockSkewMs: 300000   // how far `at` may sit from server time
});

/** Exactly the keys firestore.rules allows — no more, no fewer. */
export const SCORE_FIELDS = Object.freeze([
    'uid', 'username', 'score', 'reflex', 'won',
    'durationMs', 'profile', 'startingCards', 'at'
]);

const isInt = (v) => Number.isInteger(v);

/**
 * Client-side twin of the Firestore rule. Called before submitting so a
 * malformed record is caught with a readable reason here, instead of coming
 * back as an opaque PERMISSION_DENIED from the server.
 *
 * @returns {string|null} the reason it would be rejected, or null if it is fine
 */
export function validateScorePayload(rec) {
    if (!rec || typeof rec !== 'object') return 'payload is not an object';

    const keys = Object.keys(rec);
    const extra = keys.filter(k => !SCORE_FIELDS.includes(k));
    if (extra.length) return `unexpected field(s): ${extra.join(', ')}`;
    const missing = SCORE_FIELDS.filter(k => !keys.includes(k));
    if (missing.length) return `missing field(s): ${missing.join(', ')}`;

    const B = SCORE_BOUNDS;
    if (typeof rec.uid !== 'string' || !rec.uid) return 'uid must be a non-empty string';
    if (typeof rec.username !== 'string' || !rec.username) return 'username must be a non-empty string';
    if (rec.username.length > B.usernameMax) return `username longer than ${B.usernameMax}`;
    if (typeof rec.won !== 'boolean') return 'won must be a boolean';
    if (!isInt(rec.score) || rec.score < B.scoreMin || rec.score > B.scoreMax) return 'score out of range';
    if (!isInt(rec.reflex) || rec.reflex < B.reflexMin || rec.reflex > B.reflexMax) return 'reflex out of range';
    if (!isInt(rec.durationMs) || rec.durationMs < B.durationMin || rec.durationMs > B.durationMax) return 'durationMs out of range';
    if (!isInt(rec.startingCards) || rec.startingCards < B.startingCardsMin || rec.startingCards > B.startingCardsMax) return 'startingCards out of range';
    if (rec.profile !== null && !BOARD_PROFILES.includes(rec.profile)) return 'unknown profile';
    if (!isInt(rec.at)) return 'at must be an integer timestamp';

    return null;
}

/**
 * Clamps a finished run into a payload the rules will accept.
 *
 * Clamping rather than rejecting is deliberate: a player whose reflex reading
 * came back as 60001ms should get a recorded score, not a silent failure. The
 * only value never fabricated is `score` — if that is out of range something is
 * wrong with the formula, and `validateScorePayload` should say so out loud.
 */
export function toBoardPayload(rec, user) {
    const B = SCORE_BOUNDS;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
    const name = String(user.displayName || user.email || 'Player').split('@')[0] || 'Player';
    return {
        uid: user.uid,
        username: name.slice(0, B.usernameMax),
        score: Math.round(rec.score),
        reflex: clamp(rec.reflex, B.reflexMin, B.reflexMax),
        won: !!rec.won,
        durationMs: clamp(rec.durationMs, B.durationMin, B.durationMax),
        profile: BOARD_PROFILES.includes(rec.profile) ? rec.profile : null,
        startingCards: clamp(rec.startingCards || 13, B.startingCardsMin, B.startingCardsMax),
        at: Math.round(rec.at)
    };
}
