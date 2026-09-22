/**
 * botConfig.js — every number that decides how a bot behaves.
 *
 * WHY THIS IS ITS OWN FILE. `ai.js` cannot be loaded by plain `node`: it imports
 * gameManager → firebaseSync → the Firebase SDK from a CDN URL, and the ESM
 * loader refuses `https:`. So nothing in ai.js could ever be unit tested, and
 * these numbers were untestable along with it.
 *
 * That mattered more than it looked. The Daily Challenge is deterministic from
 * the date: the same deal, the same bot ROLLS, for every player on earth. But
 * the rolls are only half of a bot's behaviour — the other half is the
 * THRESHOLDS below. `Rng.pick(botId, tick, ROLL.SLAP_ACCURACY) < config.accuracy`
 * gives a stable roll and compares it against a number in this file. Drop
 * `hard.accuracy` from 0.82 to 0.78 and deploy at midday, and two players share
 * a day, a deck and a position while facing measurably different opponents.
 *
 * A frozen-scenario test cannot see that, because none of it lives in
 * `buildScenario`. It lives here. So it lives somewhere a test can read it:
 * this module imports NOTHING, exactly like `dailyScore.js` was split out of
 * `dailyChallenge.js` for the same reason.
 *
 * `test_gameLogic.mjs` freezes a fingerprint over these values together with the
 * day's scenario. Change a number here and the build fails, naming the day it
 * changes and what it changes about it. That is the point: not to stop the
 * change, but to make it impossible to make by accident.
 */

// Purpose tags for deterministic rolls. Each decision a bot makes draws from its
// own coordinate so that seeding one of them can never shift another
// (see rng.js::hashRandom and dailyChallenge.js).
export const ROLL = {
    SLAP_ACCURACY: 1,
    SLAP_DELAY: 2,
    FALSE_SLAP: 3,
    FALSE_SLAP_DELAY: 4,
    PLAY_DELAY: 5
};

export const BotConfig = {
    easy: {
        minReaction: 1300, maxReaction: 2600,
        accuracy: 0.40, falseSlap: 0.075,
        playDelay: 1200, playVariance: 600
    },
    medium: {
        minReaction: 900, maxReaction: 1600,
        accuracy: 0.65, falseSlap: 0.04,
        playDelay: 900, playVariance: 400
    },
    hard: {
        minReaction: 700, maxReaction: 1200,
        accuracy: 0.82, falseSlap: 0.015,
        playDelay: 700, playVariance: 300
    },
    challenger: {
        // Elite Esports difficulty & Multiplayer Bot Takeover level
        // Card play: 600–850ms (challenging gameplay pacing)
        // Slap reaction: 550–950ms (elite human reflexes)
        // Accuracy: 88% (precise but makes human-like mistakes)
        // False slap: 1.5% chance (disciplined reflexes)
        minReaction: 550, maxReaction: 950,
        accuracy: 0.88, falseSlap: 0.015,
        playDelay: 600, playVariance: 250
    }
};

// --- BOT PERSONALITIES (v2.9.0) ---
// Purely additive layer on top of BotConfig: each offline bot seat (1/2/3) gets a
// fixed behavioral archetype that flavors the numbers from the selected difficulty
// tier, without changing BotConfig's own shape. Multiplayer bot takeover reads
// BotConfig.challenger directly (see multiplayerMode.js) and never touches this,
// so personalities only ever apply to offline Bot Mode.
export const BotPersonalities = {
    1: { // Left seat — "Blitz": eager & aggressive, reacts fast, bluffs more, plays quickly
        key: 'blitz',
        reactionMult: 0.90, varianceMult: 0.85,
        accuracyMult: 0.94, falseSlapMult: 1.55,
        playDelayMult: 0.90, playVarianceMult: 0.90
    },
    2: { // Top seat — "Chaos": same average pace as the base difficulty, but wildly inconsistent
        key: 'chaos',
        reactionMult: 1.0, varianceMult: 1.9,
        accuracyMult: 1.0, falseSlapMult: 1.1,
        playDelayMult: 1.0, playVarianceMult: 1.8
    },
    3: { // Right seat — "Viper": patient & precise, slower on average but very consistent, rarely bluffs
        key: 'viper',
        reactionMult: 1.12, varianceMult: 0.8,
        accuracyMult: 1.07, falseSlapMult: 0.4,
        playDelayMult: 1.08, playVarianceMult: 0.8
    }
};

/**
 * Combines a base difficulty config with a personality's modifiers. Moved
 * here from ai.js in v3.18.0 so a mode that builds a seat's config (the
 * Pantheon's gods) uses the one formula instead of a copy — ai.js cannot be
 * loaded outside a browser, this file can.
 *
 * Keeps the midpoint of the reaction window anchored to the difficulty's own
 * pacing and only widens/narrows/shifts it — so personalities add flavor
 * without secretly making the overall difficulty tier easier or harder.
 */
export function applyPersonality(p, baseConfig) {
    if (!p) return baseConfig;
    const mid = (baseConfig.minReaction + baseConfig.maxReaction) / 2;
    const halfWidth = (baseConfig.maxReaction - baseConfig.minReaction) / 2;
    const shiftedMid = mid * (p.reactionMult ?? 1);
    const widenedHalf = halfWidth * (p.varianceMult ?? 1);
    return {
        minReaction: Math.max(150, shiftedMid - widenedHalf),
        maxReaction: shiftedMid + widenedHalf,
        accuracy: Math.min(0.97, baseConfig.accuracy * (p.accuracyMult ?? 1)),
        falseSlap: Math.max(0, baseConfig.falseSlap * (p.falseSlapMult ?? 1)),
        playDelay: baseConfig.playDelay * (p.playDelayMult ?? 1),
        playVariance: baseConfig.playVariance * (p.playVarianceMult ?? 1)
    };
}
