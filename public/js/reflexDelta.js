/**
 * reflexDelta.js — "was that fast FOR YOU?"
 *
 * The reflex speedometer already reports a number and an absolute grade:
 * 280 ms is GODLIKE, 620 ms is GOOD, and those thresholds are the same for a
 * player on their first match as for one with a thousand slaps behind them. That
 * is useful and it is also the only feedback the game gives — so a player who
 * improves from 700 ms to 560 ms over a week sees "GOOD" both times and is told
 * nothing about the only thing that actually changed.
 *
 * This module answers the other question: not "is that fast", but "is that fast
 * compared to your other slaps". `slapForensics.js` has kept the last forty
 * reaction times all along; nothing ever compared the newest one against them
 * outside the Slap IQ panel, which you have to leave the table to look at.
 *
 * WHAT THE HISTORY ACTUALLY IS — and it is NOT "how you normally slap".
 * `stats.reflex` only accepts a time when `explainSlap()` reports the pile
 * valid. A slap that arrives after a bot has taken the pile is either swallowed
 * by game.js's 500 ms post-win grace period or lands on an empty pile and is
 * recorded as a miss, not a time. So the history is STRUCTURALLY TRUNCATED AT
 * THE SLOW END: it holds the slaps you were quick enough to land, not all the
 * slaps you made. Worse, the cut moves — sharper bots take the pile sooner, so
 * a harder table truncates more.
 *
 * The consequence, stated rather than corrected: the comparison is biased
 * pessimistic — you will read "slower" more often than "faster", and more often
 * after moving to a harder table. This is REASONED FROM THE MECHANISM, not
 * measured; the project has no telemetry and inventing a correction factor
 * nobody calibrated is the mistake §15 already refused to make with the
 * difficulty multiplier. So the wording says what it compares — your recorded
 * slaps — instead of implying a complete record.
 *
 * WHY THE HISTORY IS PASSED IN, and passed in WITHOUT the current slap.
 * `SlapForensics.judgeLocalAttempt()` pushes the new reaction time into
 * `stats.reflex` as part of recording it. Comparing the new slap against a median
 * that already contains it makes every result drift toward "on par" — worst on a
 * short history, which is exactly when a player is most likely to be watching.
 * So the caller computes this BEFORE the push, and this module never touches
 * storage or knows where the numbers came from.
 *
 * WHY THERE IS A DEAD BAND. Reaction times are noisy; a 3% difference is not a
 * fact about the player, it is a fact about that particular pile. Anything inside
 * ±8% reports `onPar` rather than inventing a direction, so the badge stays quiet
 * unless something real happened.
 *
 * Zero imports. Pure. Same reasoning as dailyScore.js and botConfig.js.
 */

/**
 * Below this many previous samples, no comparison is made at all — a "12% faster
 * than usual" built on three data points is a claim the data cannot support, and
 * the first slaps of a player's life are precisely where it would appear.
 */
export const DELTA_MIN_SAMPLE = 8;

/** Percentage points around the median that count as no change. */
export const DELTA_BAND_PCT = 8;

/** @returns {number|null} */
export function median(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const clean = values.filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    if (clean.length === 0) return null;
    const mid = Math.floor(clean.length / 2);
    return clean.length % 2 === 1
        ? clean[mid]
        : Math.round((clean[mid - 1] + clean[mid]) / 2);
}

/**
 * @param {number} slapTime  this slap's reaction time in ms
 * @param {number[]} history previous reaction times, NOT including slapTime
 * @returns {{pct: number, tier: 'faster'|'onPar'|'slower', median: number}|null}
 *          null when there is not enough history to say anything honest.
 *
 * `pct` is signed the way the underlying number is: negative means fewer
 * milliseconds, which means faster. The renderer decides how to phrase that; a
 * "faster" tier with a positive number would be a bug waiting to happen.
 */
export function reflexDelta(slapTime, history) {
    if (!Number.isFinite(slapTime) || slapTime <= 0) return null;
    if (!Array.isArray(history) || history.length < DELTA_MIN_SAMPLE) return null;

    const med = median(history);
    if (med === null || med <= 0) return null;

    const pct = Math.round(((slapTime - med) / med) * 100);
    let tier = 'onPar';
    if (pct <= -DELTA_BAND_PCT) tier = 'faster';
    else if (pct >= DELTA_BAND_PCT) tier = 'slower';

    return { pct, tier, median: med };
}
