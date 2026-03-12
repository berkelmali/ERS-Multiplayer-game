import EventBus from './eventbus.js';
import { GameState } from './game.js';
import { Settings } from './settings.js';
import { GameManager } from './gameManager.js';

export const BotConfig = {
    easy: {
        minReaction: 700, maxReaction: 1100,
        accuracy: 0.50, falseSlap: 0.02,
        playDelay: 900, playVariance: 400
    },
    medium: {
        minReaction: 500, maxReaction: 750,
        accuracy: 0.75, falseSlap: 0.03,
        playDelay: 650, playVariance: 300
    },
    hard: {
        minReaction: 350, maxReaction: 550,
        accuracy: 0.90, falseSlap: 0.01,
        playDelay: 500, playVariance: 200
    },
    challenger: {
        // Multiplayer default mode / expert mode
        minReaction: 300, maxReaction: 450,
        accuracy: 0.98, falseSlap: 0.005,
        playDelay: 400, playVariance: 150
    }
};

export const AIController = {
    intervals: {},
    slapTimeouts: {},

    init() {
        EventBus.on('turnChanged', (activeId) => {
            if (GameManager.activeMode !== 'bots') return;
            if (activeId >= 1 && activeId <= 3) {
                const diff = Settings.config.difficulty;
                const config = BotConfig[diff] || BotConfig.medium;
                const delay = config.playDelay + Math.random() * config.playVariance;

                clearTimeout(this.intervals[activeId]);
                this.intervals[activeId] = setTimeout(() => {
                    GameState.playCard(activeId);
                }, delay);
            }
        });

        EventBus.on('cardPlayed', () => {
            if (GameManager.activeMode !== 'bots') return;
            const diff = Settings.config.difficulty;
            const config = BotConfig[diff] || BotConfig.medium;

            if (GameState.isValidSlap()) {
                [1, 2, 3].forEach(botId => {
                    // Accuracy Hit Check
                    if (Math.random() < config.accuracy) {
                        const delay = config.minReaction + (Math.random() * (config.maxReaction - config.minReaction));
                        clearTimeout(this.slapTimeouts[botId]);
                        this.slapTimeouts[botId] = setTimeout(() => {
                            GameState.slap(botId);
                        }, delay);
                    }
                });
            } else {
                [1, 2, 3].forEach(botId => {
                    // False Slap Hit Check
                    if (Math.random() < config.falseSlap && GameState.players[botId].length > 0) {
                        // Small added delay to false slaps so they don't look completely mechanical
                        const delay = config.minReaction + (Math.random() * (config.maxReaction - config.minReaction)) + 200;
                        clearTimeout(this.slapTimeouts[botId]);
                        this.slapTimeouts[botId] = setTimeout(() => {
                            GameState.slap(botId);
                        }, delay);
                    }
                });
            }
        });

        EventBus.on('pileWon', () => {
            Object.values(this.slapTimeouts).forEach(clearTimeout);
        });
    }
};
