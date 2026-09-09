/**
 * matchContext.js — what the MATCH imposes, over what the player prefers.
 *
 * THE BUG CLASS THIS EXISTS TO CLOSE. The Daily Challenge is scored onto a
 * shared board, so any personal setting that changes what happens during the run
 * is a silent advantage. The project already knew this: `botGameMode.js` stops
 * the Blitz timer for a daily and says why in a comment —
 * "a Blitz timer would make the scored deal depend on a personal setting."
 *
 * That reasoning was applied in exactly one place. Two more instances were live
 * for three releases:
 *
 *   1. THE TURN TIMER. `GameState.getTimeoutDuration()` read
 *      `Settings.config.difficulty` directly, while the daily set the bots'
 *      difficulty through `AIController.difficultyOverride` — a different
 *      variable the timer never consulted. So on the same scored seed a player
 *      set to Easy had 20 000 ms to play a card and a player set to Hard had
 *      10 000 ms. Measured cost of one timeout burn on a comeback day: 45 points.
 *
 *   2. THE TRANSITION PACING. `Settings.config.fastAnimations` shortened the gap
 *      after a won pile from 1000 ms to 700 ms. `computeScore` pays 1 point per
 *      second saved, so measured: +7 points over 15 piles, +22 over 40. Small,
 *      and it still reorders adjacent entries on a sorted board.
 *
 * WHY A MODULE AND NOT A FIELD ON GameState. `game.js` needs the difficulty in
 * force and so does `ai.js`, and they cannot import each other. It also has to
 * be loadable by plain `node`, because the whole point is that the next leak
 * fails a test rather than a player's run. Same reasoning as `botConfig.js`.
 *
 * WHERE THE LINE IS — and it is a real line, not a slogan. A scored run
 * overrides the settings that change WHAT HAPPENS. It deliberately leaves alone:
 *
 *   • accessibility — `highLegibility`, `largerText`, `reducedMotion`. Forcing
 *     these off to "level the field" would be indefensible.
 *   • cosmetics — `equippedCardSkin`, `theme`, `playerName`.
 *   • audio — `musicEnabled`, `sfxEnabled`.
 *   • post-hoc coaching — `slapCoach`. It fires on `slapAttempt`, after the
 *     player has committed, and describes a pile that is already gone. It cannot
 *     say what is coming. A learning aid, not a scoring advantage. (Verified: the
 *     unclaimed-pattern tracker `_pending` is only counted, never rendered.)
 *
 * The decision table for every settings key lives in `test_gameLogic.mjs`, and a
 * key with no verdict fails the build.
 */

/** Per-difficulty turn timeout. The bots' tier and the player's clock, together. */
export const DIFFICULTY_TIMEOUT_MS = Object.freeze({
    easy: 20000,
    medium: 15000,
    hard: 10000,
    challenger: 10000
});

export const MULTIPLAYER_TIMEOUT_MS = 15000; // competitive standard, never personal
export const DEFAULT_TIMEOUT_MS = 15000;

/** Pacing after a pile is claimed. `fast` is a personal setting; `scored` bans it. */
export const TRANSITION_MS = Object.freeze({
    slap: 1000,
    slapFast: 700,
    challenge: 400   // a challenge sweep is animation-bound, not a preference
});

/**
 * Mutable, and deliberately the ONLY mutable thing here: the two facts a run
 * imposes on the player. `dailyChallenge.js` sets them in `startRun()` and
 * clears them in `stop()`; nothing else writes.
 */
export const MatchContext = {
    /** Difficulty the match forces, or null to use the player's setting. */
    difficultyOverride: null,
    /** True while a run's result will be written to a shared board. */
    scored: false,

    reset() {
        this.difficultyOverride = null;
        this.scored = false;
    }
};

/**
 * The difficulty actually in force. An override always beats the setting —
 * that is the whole contract, and it is one line so that both the bot tuning
 * and the turn timer can read the same answer instead of two variables that
 * drifted apart.
 */
export function difficultyInForce(override, setting) {
    return override || setting || 'medium';
}

/** @param {boolean} isMultiplayer the room's clock, not anybody's preference */
export function turnTimeoutMs(difficulty, isMultiplayer = false) {
    if (isMultiplayer) return MULTIPLAYER_TIMEOUT_MS;
    return DIFFICULTY_TIMEOUT_MS[difficulty] ?? DEFAULT_TIMEOUT_MS;
}

/**
 * @param {string} reason  'slap' | 'challenge' | anything else
 * @param {boolean} fastAnimations the player's setting
 * @param {boolean} scored          true suppresses the setting
 *
 * A scored run gets the same pacing for everyone. Not because 700 ms is wrong,
 * but because the daily is the one mode whose product is sameness.
 */
export function transitionDelayMs(reason, fastAnimations, scored = false) {
    if (reason === 'challenge') return TRANSITION_MS.challenge;
    if (reason !== 'slap') return TRANSITION_MS.slap;
    return (fastAnimations && !scored) ? TRANSITION_MS.slapFast : TRANSITION_MS.slap;
}
