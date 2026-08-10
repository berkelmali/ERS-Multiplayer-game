import EventBus from './eventbus.js';
import { GameState } from './game.js';
import { Settings } from './settings.js';
import { GameManager } from './gameManager.js';

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

// Combines a base difficulty config with a bot's personality modifiers.
// Keeps the midpoint of the reaction window anchored to the difficulty's own pacing
// and only widens/narrows/shifts it — so personalities add flavor without secretly
// making the overall difficulty tier easier or harder than what the player picked.
function getPersonalityConfig(botId, baseConfig) {
    const p = BotPersonalities[botId];
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
                const diff = Settings.config.difficulty;
                const baseConfig = BotConfig[diff] || BotConfig.medium;
                const config = getPersonalityConfig(activeId, baseConfig);
                const delay = config.playDelay + Math.random() * config.playVariance;
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
            const diff = Settings.config.difficulty;
            const baseConfig = BotConfig[diff] || BotConfig.medium;

            if (GameState.isValidSlap()) {
                [1, 2, 3].forEach(botId => {
                    const config = getPersonalityConfig(botId, baseConfig);
                    // Accuracy Hit Check
                    if (Math.random() < config.accuracy) {
                        const delay = config.minReaction + (Math.random() * (config.maxReaction - config.minReaction));
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
                    const config = getPersonalityConfig(botId, baseConfig);
                    // False Slap Hit Check
                    if (Math.random() < config.falseSlap && GameState.players[botId].length > 0) {
                        // Small added delay to false slaps so they don't look completely mechanical
                        const delay = config.minReaction + (Math.random() * (config.maxReaction - config.minReaction)) + 200;
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
