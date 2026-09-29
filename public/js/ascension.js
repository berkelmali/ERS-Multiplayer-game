/**
 * ascension.js — Tanrı Yükselişi / Ascension at the Table of the Gods
 * (v3.23.0, council ERS-32). Pure and import-free, so the duel, the hall and
 * the balance simulation (tools/sim-pantheon.mjs) read one table.
 *
 * Once a god has fallen it can be faced again three times over. Each level
 * makes the god LIVE longer and PLAY faster — the two levers the simulation
 * showed to move a duel. (Two others were tried and dropped: opening the duel
 * with ghost cards and shrinking the priests' blows changed the win rate by
 * under three points. A flat "at least this tier" floor was tried too: it
 * jumped from a walkover to a wall.)
 *
 *   level   life       pace: how far the god has climbed toward Challenger
 *   1       +25 %      40 %
 *   2       +50 %      75 %
 *   3       +75 %      100 %, with the Blitz temperament — exactly Ra at
 *                      noon, and nothing faster exists in the game
 *
 * The bound the council set (pinned by the suite): a twist never changes what
 * a slap is, and the god is never faster than Ra at noon. Solo (bots) only —
 * the multiplayer table carries none of this, so pantheonRoom.js is untouched.
 *
 * Reward: a gilded rim on the god's card and its amulet. No coins of its own
 * (DESIGN G3): a win pays what any bot match pays, capped per day by the server.
 */

export const MAX_LEVEL = 3;

/** Cumulative effect of each level; index = level. Level 0 is the plain duel. */
export const ASCENSION = Object.freeze([
    Object.freeze({ level: 0, hpMult: 1,    pace: 0,    blitz: false }),
    Object.freeze({ level: 1, hpMult: 1.25, pace: 0.4,  blitz: false }),
    Object.freeze({ level: 2, hpMult: 1.5,  pace: 0.75, blitz: false }),
    Object.freeze({ level: 3, hpMult: 1.75, pace: 1,    blitz: true })
]);

/**
 * The effect of `level`, clamped to the table; a plain duel for anything else.
 * An OBJECT is a tuning probe (tools/sim-pantheon.mjs --probe): its fields lie
 * over the plain duel. The game itself only ever passes integers.
 */
export function ascensionFor(level) {
    if (level && typeof level === 'object') return { ...ASCENSION[0], ...level };
    const n = Number.isInteger(level) ? Math.max(0, Math.min(MAX_LEVEL, level)) : 0;
    return ASCENSION[n];
}

/** A god's life at `level`, rounded to a whole point. */
export function ascendedHp(baseHp, level) {
    return Math.round(baseHp * ascensionFor(level).hpMult);
}

/**
 * `from` moved `f` (0..1) of the way to `to`, field by field. Both are bot
 * configs (botConfig.js); every field is a number, and the result stays
 * between the two — so a god blended toward Challenger is never faster than
 * Challenger.
 */
export function blendConfig(from, to, f) {
    const t = Math.max(0, Math.min(1, Number(f) || 0));
    const out = {};
    for (const k of Object.keys(from)) out[k] = from[k] + (Number(to[k]) - from[k]) * t;
    return out;
}

/**
 * May `level` be faced now? Level 0 is the god itself (unlocked by the god
 * before it, decided in pantheon.js); level n needs the god beaten and
 * level n-1 cleared.
 */
export function canAscend(level, defeated, ascended) {
    if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return false;
    if (!defeated) return false;
    return clearedLevel(ascended) >= level - 1;
}

/** The highest level a god's store entry says was cleared (0 when none). */
export function clearedLevel(ascended) {
    const n = Number(ascended);
    return Number.isInteger(n) ? Math.max(0, Math.min(MAX_LEVEL, n)) : 0;
}
