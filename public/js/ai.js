import EventBus from './eventbus.js';
import { GameState } from './game.js';
import { Settings } from './settings.js';
import { GameManager } from './gameManager.js';
import { Rng } from './rng.js';
import { BotConfig, BotPersonalities, ROLL, applyPersonality } from './botConfig.js';
import { MatchContext, difficultyInForce } from './matchContext.js';

// The tuning numbers moved to botConfig.js so a test can read them — ai.js
// itself cannot be loaded outside a browser (Firebase CDN import). Re-exported
// here because multiplayerMode.js imports BotConfig from this module.
export { BotConfig, BotPersonalities };

// The formula lives in botConfig.js (applyPersonality) since v3.18.0, so the
// Pantheon builds its gods from the same one.
function getPersonalityConfig(botId, baseConfig) {
    return applyPersonality(BotPersonalities[botId], baseConfig);
}

// --- BOT TABLE TALK (v2.9.0) ---
// Extends BotPersonalities with an autonomous social dimension: bots
// occasionally react with an emoji via the EXISTING showEmoji/floating-emoji
// system (see ui.js::showFloatingEmoji) — no new UI, no new event, just a new
// trigger. Frequency and emoji choice are personality-flavored: Blitz reacts
// often with cocky/intense emoji, Viper rarely with composed ones, Chaos
// unpredictably. Offline-only, same reasoning as BotPersonalities itself —
// multiplayer bot-takeover has no personality to express (see §6.15).
const BOT_EMOJI_POOLS = {
    blitz: ['🔥', '😎', '🤯'],
    chaos: ['🤯', '😱', '😂'],
    viper: ['😎', '🤔']
};
const BOT_REACTION_CHANCE = { blitz: 0.35, chaos: 0.25, viper: 0.10 };

export const AIController = {
    intervals: {},
    slapTimeouts: {},
    initialized: false,
    /**
     * v3.18.0 — a full config a mode imposes on one seat, or nothing. The
     * Pantheon seats a god at seat 2 with its own speed and discipline; the
     * god is not a Blitz/Chaos/Viper wearing a mask, so the personality
     * layer is skipped for that seat rather than stacked on top of it.
     */
    seatConfig: {},

    configFor(botId, baseConfig) {
        return this.seatConfig[botId] || getPersonalityConfig(botId, baseConfig);
    },

    /**
     * The override moved to `matchContext.js`. It was never only the AI's
     * business: the turn timer needs the same answer, and while it lived here
     * `game.js` could not read it without an import cycle — so it read
     * `Settings.config.difficulty` instead and the two drifted apart for three
     * releases. One source, two consumers.
     */
    currentDifficulty() {
        return difficultyInForce(MatchContext.difficultyOverride, Settings.config.difficulty);
    },

    init() {
        if (this.initialized) return;
        this.initialized = true;

        EventBus.on('pileWon', ({ winnerId, reason }) => {
            if (GameManager.activeMode !== 'bots') return;
            if (reason !== 'slap' || winnerId < 1 || winnerId > 3) return;
            const personality = BotPersonalities[winnerId];
            if (!personality) return;
            if (Math.random() >= (BOT_REACTION_CHANCE[personality.key] ?? 0)) return;

            const pool = BOT_EMOJI_POOLS[personality.key];
            const emoji = pool[Math.floor(Math.random() * pool.length)];
            // Small delay so the reaction doesn't visually collide with the
            // pile-win shockwave/particle burst that fires at the same instant.
            setTimeout(() => {
                EventBus.emit('showEmoji', { playerId: winnerId, emoji });
            }, 550);
        });

        EventBus.on('turnChanged', (activeId) => {
            if (activeId === -1) return; // Güvenlik kilidi
            if (GameManager.activeMode !== 'bots') return;
            if (activeId >= 1 && activeId <= 3) {
                const diff = this.currentDifficulty();
                const baseConfig = BotConfig[diff] || BotConfig.medium;
                const config = this.configFor(activeId, baseConfig);
                const delay = config.playDelay
                    + Rng.pick(activeId, GameState.playCount || 0, ROLL.PLAY_DELAY) * config.playVariance;
                const scheduledTime = Date.now();

                EventBus.emit('syncTurnTimer', { activeId, duration: delay });

                clearTimeout(this.intervals[activeId]);
                this.intervals[activeId] = setTimeout(() => {
                    const drift = Date.now() - scheduledTime - delay;
                    if (drift > 2000 && GameState.activePlayerId === activeId) { GameState.playCard(activeId); return; }
                    if (GameState.activePlayerId === activeId) {
                        GameState.playCard(activeId);
                    }
                }, delay);
            }
        });

        EventBus.on('cardPlayed', () => {
            if (GameManager.activeMode !== 'bots') return;
            const diff = this.currentDifficulty();
            const baseConfig = BotConfig[diff] || BotConfig.medium;
            const tick = GameState.playCount || 0;

            if (GameState.isValidSlap()) {
                [1, 2, 3].forEach(botId => {
                    const config = this.configFor(botId, baseConfig);
                    // Accuracy Hit Check
                    if (Rng.pick(botId, tick, ROLL.SLAP_ACCURACY) < config.accuracy) {
                        const delay = config.minReaction
                            + (Rng.pick(botId, tick, ROLL.SLAP_DELAY) * (config.maxReaction - config.minReaction));
                        const scheduledTime = Date.now();
                        clearTimeout(this.slapTimeouts[botId]);
                        this.slapTimeouts[botId] = setTimeout(() => {
                            const drift = Date.now() - scheduledTime - delay;
                            if (drift > 2000) return; // Ignore stale slap from suspension
                            GameState.slap(botId);
                        }, delay);
                    }
                });
            } else {
                [1, 2, 3].forEach(botId => {
                    const config = this.configFor(botId, baseConfig);
                    // False Slap Hit Check
                    if (Rng.pick(botId, tick, ROLL.FALSE_SLAP) < config.falseSlap && GameState.players[botId].length > 0) {
                        // Small added delay to false slaps so they don't look completely mechanical
                        const delay = config.minReaction
                            + (Rng.pick(botId, tick, ROLL.FALSE_SLAP_DELAY) * (config.maxReaction - config.minReaction)) + 200;
                        const scheduledTime = Date.now();
                        clearTimeout(this.slapTimeouts[botId]);
                        this.slapTimeouts[botId] = setTimeout(() => {
                            const drift = Date.now() - scheduledTime - delay;
                            if (drift > 2000) return; // Ignore stale false slap from suspension
                            GameState.slap(botId);
                        }, delay);
                    }
                });
            }
        });

        EventBus.on('pileWon', () => {
            Object.values(this.slapTimeouts).forEach(clearTimeout);
        });
    },

    clearAllTimeouts() {
        Object.values(this.intervals).forEach(clearTimeout);
        Object.values(this.slapTimeouts).forEach(clearTimeout);
        this.intervals = {};
        this.slapTimeouts = {};
        console.log("[AIController] Cleared all bot timers successfully.");
    }
};
