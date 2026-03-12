import { GameState } from './game.js';
import { AIController } from './ai.js';
import EventBus from './eventbus.js';

export const BotGameMode = {
    start() {
        console.log("Starting Bot Game Mode");
        GameState.init();
        AIController.init();
    },

    quit() {
        GameState.quitGame();
        AIController.intervals = {};
        AIController.slapTimeouts = {};
    },

    playCard(playerId) {
        GameState.playCard(playerId);
    },

    slap(playerId) {
        GameState.slap(playerId);
    }
};
