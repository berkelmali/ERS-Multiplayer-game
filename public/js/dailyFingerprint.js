/**
 * dailyFingerprint.js — what a given day's challenge actually IS, in one line.
 *
 * THE PROBLEM. The Daily Challenge is generated, not stored. There is no server,
 * no cron, no "today's deal" row in a database — every player's browser derives
 * the whole day from the UTC date. That is the feature. The cost is that the
 * GENERATOR is unversioned: change it and redeploy at midday, and the player who
 * loaded the page at 09:00 and the one who loaded at 15:00 play different games
 * on the same date, scored onto the same board, with nothing anywhere recording
 * that they were not the same challenge.
 *
 * WHAT THIS FILE IS FOR. Not to prevent that change — it should stay possible —
 * but to make it impossible to make WITHOUT NOTICING. `test_gameLogic.mjs`
 * freezes the fingerprints of a handful of dates. Touch anything that moves a
 * day, and the build fails naming the date and what moved.
 *
 * WHAT GOES INTO IT, and why each piece had to be argued for:
 *
 *   1. The scenario — hands, pile, burn pile, whose turn, the challenge state.
 *      The obvious half. Covered by hashing the scenario JSON, so even a suit
 *      permutation that leaves every hand size identical still trips it.
 *
 *   2. The bots' TUNING (`BotConfig[difficulty]`, `BotPersonalities`, `ROLL`).
 *      The half that was nearly missed, and the likelier one to change. Nobody
 *      edits `buildScenario` casually; "the bots feel too sharp, drop accuracy
 *      to 0.78" is the most natural change in this codebase. The bots' ROLLS are
 *      seed-derived and stable — but a roll is compared against a threshold in
 *      botConfig.js, so the threshold is part of the day just as much as the
 *      cards are. `ROLL` is in here too: renumber a purpose tag and every bot
 *      decision for every past day shifts.
 *
 *   3. The rule set. `buildScenario(seed, rules)` builds the opening pile with
 *      `matchSlap(..., rules)` so it is never already slappable — which means
 *      the DEFAULT rule set is an input to the deal. Promote an optional rule
 *      (Triple, Four-in-a-Row, Top-Bottom) to core and every daily deal in
 *      history changes. Included so that failure is loud instead of invisible.
 *
 * WHAT IS DELIBERATELY NOT IN IT: wall-clock timing. `setTimeout` drift is not
 * reproducible and never was; dailyChallenge.js is explicit that reflex and
 * judgement are the variables left in play.
 *
 * Zero imports beyond the pure modules it summarises, so `node` can run it.
 */

import { buildScenario } from './dailyScenario.js';
import { BotConfig, BotPersonalities, ROLL } from './botConfig.js';
import { DEFAULT_RULES, rulesToKey } from './slapRules.js';

/**
 * FNV-1a over the canonical string. Not a security hash — a change detector.
 * Deliberately the same family as rng.js::hashStringToSeed so the project has
 * one hashing idea rather than two.
 */
function hash16(str) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
        h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Stable key order, so a formatting change never looks like a content change. */
function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') {
        return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
}

/**
 * The one line a human reads when the build breaks. Not a hash — a description.
 * "comeback hard 7/15/13/14 pile3" says more in a glance than any digest.
 */
export function summarize(sc) {
    return [
        sc.profile,
        sc.difficulty,
        sc.humanStart + '/' + sc.botStarts.join('/'),
        'pile' + sc.pile.length
    ].join(' ');
}

/**
 * @param {number} seed        from dailyScore.js::seedForDate
 * @param {object} [rules]     the rule set the deal is built against
 * @returns {{hash: string, summary: string, rules: string}}
 */
export function fingerprint(seed, rules = DEFAULT_RULES) {
    const sc = buildScenario(seed, rules);
    const tuning = {
        tier: BotConfig[sc.difficulty] || null,
        personalities: BotPersonalities,
        roll: ROLL
    };
    return {
        hash: hash16(canonical(sc) + '|' + canonical(tuning) + '|' + rulesToKey(rules)),
        summary: summarize(sc),
        rules: rulesToKey(rules)
    };
}

/**
 * The message the failing test prints. Its job is to answer, in one screen,
 * "what did I just do?" — so it names the three things that could have caused
 * it, in the order they are likely.
 */
export function explainDrift(dateKey, expected, actual) {
    return [
        `The Daily Challenge for ${dateKey} is no longer the one that shipped.`,
        `  was:  ${expected.summary}   [${expected.hash}]  rules: ${expected.rules}`,
        `  now:  ${actual.summary}   [${actual.hash}]  rules: ${actual.rules}`,
        '',
        'Every player who loads the app after this deploys gets the new version;',
        'anyone already on the old one keeps playing the old — same date, same',
        'board, different game. Stored records for this day describe a position',
        'that no longer exists (the handicap multiplier reads startingCards).',
        '',
        'Three things change a day. In order of likelihood:',
        '  1. a bot tuning number in botConfig.js (accuracy, reaction, personality)',
        '  2. the generator in dailyScenario.js (shuffle, hand sizes, pile builder)',
        '  3. an optional slap rule promoted to core in slapRules.js',
        '',
        'If you meant it: deploy at a low-traffic hour, then update the frozen',
        'values in test_gameLogic.mjs in the SAME commit. If you did not mean it,',
        'this is the bug.'
    ].join('\n');
}
