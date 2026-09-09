/**
 * botTell.js — giving the three bots a visible temperament, WITHOUT telling you
 * what they are about to do.
 *
 * THE FEATURE THAT WAS REJECTED, and why this one is not it. The original
 * proposal was a ring around each bot that counted down to its slap. Council
 * ERS-04 killed it on a fact from `ai.js`: a bot only schedules a slap timeout
 * if it has already PASSED its accuracy roll
 * (`Rng.pick(botId, tick, ROLL.SLAP_ACCURACY) < config.accuracy`). A ring driven
 * by that scheduling is a perfect oracle — its mere appearance means "this bot
 * has committed", its length is the exact millisecond, and `pileWon` clearing
 * the timeouts means its disappearance is information too. The Daily Challenge
 * is scored onto a shared board that already admits it is unverified
 * (`VERIFIED_BOARD: false`). Shipping that would have handed every player a
 * legal aimbot for it.
 *
 * The proposed rescue — "switch it off for scored runs" — failed too:
 * `scored = !hasPlayedToday()`, so practice runs of the SAME seed would still
 * have shown it, and an oracle available in practice is an oracle for the scored
 * attempt one try later.
 *
 * SO THIS MODULE CANNOT SEE THE GAME. It is a pure function of a seat number.
 * It reads `BotPersonalities`, which is a fixed per-seat archetype — seat 1 is
 * always Blitz, seat 3 is always Viper, in every match, at every difficulty, on
 * every date. It does not import `ai.js`, cannot reach `slapTimeouts`, does not
 * know `ROLL` exists, and takes no argument that varies within a match. The
 * cadence it returns for seat 2 today is the cadence it returned yesterday.
 *
 * WHAT THAT LEAVES. Not a warning — a temperament. Blitz fidgets fast and tight,
 * Chaos drifts wide and irregular, Viper barely moves. It tells you who you are
 * sitting with, which the game currently only says in the Bot Nemesis panel
 * after the fact. It cannot tell you what is about to happen, which is the
 * entire design constraint and is enforced by a test.
 *
 * NOTE ON THE DAILY FINGERPRINT: this module only READS `BotPersonalities`. The
 * numbers are unchanged, so `dailyFingerprint.js` and the frozen days are
 * untouched — verified by the suite.
 */

import { BotPersonalities } from './botConfig.js';

/**
 * The resting period of the idle animation, before personality is applied.
 * Slow on purpose: this is ambience at the edge of vision, not a metronome to
 * play against. Anything under a second reads as a countdown, which is exactly
 * the impression this feature must not give.
 */
export const TELL_BASE_MS = 2800;

/** Clamped so no personality multiplier can push the cadence into "urgent". */
export const TELL_MIN_MS = 1800;
export const TELL_MAX_MS = 4200;

/**
 * @param {number|string} botId seat 1, 2 or 3
 * @returns {{key: string, periodMs: number, swayPct: number}|null}
 *          null for the human seat, an unknown seat, or multiplayer bot takeover
 *          (which reads BotConfig.challenger and carries no personality at all).
 *
 * `reactionMult` sets the tempo and `varianceMult` sets how far the movement
 * travels — the same two numbers that make Blitz feel eager and Viper feel
 * patient at the table. Reusing them means the tell and the behaviour cannot
 * describe different bots, which a separately-tuned constant would eventually do.
 */
export function tellCadence(botId) {
    const p = BotPersonalities[botId];
    if (!p) return null;

    const raw = TELL_BASE_MS * (p.reactionMult ?? 1);
    return {
        key: p.key,
        periodMs: Math.round(Math.max(TELL_MIN_MS, Math.min(TELL_MAX_MS, raw))),
        // 100 = the baseline sway. Chaos (1.9) swings nearly twice as far;
        // Viper (0.8) is almost still.
        swayPct: Math.round(100 * (p.varianceMult ?? 1))
    };
}

/** Every seat that has a tell, ready to apply in one pass. */
export function allTells() {
    return Object.keys(BotPersonalities)
        .map(id => ({ botId: Number(id), ...tellCadence(id) }))
        .filter(t => t.key);
}
