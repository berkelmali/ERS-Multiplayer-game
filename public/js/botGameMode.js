import { GameState } from './game.js';
import { AIController } from './ai.js';
import EventBus from './eventbus.js';
import { Settings } from './settings.js';
import { MatchTimer } from './matchTimer.js';

export const BotGameMode = {
    start() {
        console.log("Starting Bot Game Mode");
        GameState.init();
        GameState.isMultiplayer = false;
        AIController.init();

        if (Settings.config.matchLength === 'blitz') {
            MatchTimer.start(300); // 5-minute Blitz Mode (v2.9.0, see CLAUDE.md §6.22)
        } else {
            MatchTimer.stop();
        }
    },

    quit() {
        GameState.quitGame();
        AIController.clearAllTimeouts();
        MatchTimer.stop();
    },

    playCard(playerId) {
        GameState.playCard(playerId);
    },

    slap(playerId) {
        GameState.slap(playerId);
    }
};
