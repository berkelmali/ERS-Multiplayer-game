import { GameState } from './game.js';
import { AIController } from './ai.js';
import EventBus from './eventbus.js';
import { Settings } from './settings.js';
import { MatchTimer } from './matchTimer.js';

export const BotGameMode = {
    start(options = {}) {
        console.log("Starting Bot Game Mode", options.daily ? "(Daily Challenge)" : "");
        // A Daily Challenge hands us a position to resume; everything else deals fresh.
        GameState.init(options.scenario || null);
        GameState.isMultiplayer = false;
        AIController.init();

        // The Daily Challenge is always a full match: a Blitz timer would make
        // the scored deal depend on a personal setting.
        // A Pantheon duel ends on the god's life, not a clock (`untimed`).
        if (options.daily || options.untimed) {
            MatchTimer.stop();
        } else if (Settings.config.matchLength === 'blitz') {
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
