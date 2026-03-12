import { BotGameMode } from './botGameMode.js';
import { MultiplayerMode } from './multiplayerMode.js?v=6';

export const GameManager = {
    activeMode: null, // 'bots' or 'multiplayer'
    modeInstance: null,

    startBotGame() {
        this.activeMode = 'bots';
        this.modeInstance = BotGameMode;
        this.modeInstance.start();
    },

    startMultiplayerGame(roomId, playerIndex) {
        this.activeMode = 'multiplayer';
        this.modeInstance = MultiplayerMode;
        this.modeInstance.start(roomId, playerIndex);
    },

    quitGame() {
        if (this.modeInstance) {
            this.modeInstance.quit();
        }
        this.activeMode = null;
        this.modeInstance = null;
    },

    playCard(playerId) {
        if (this.modeInstance) {
            this.modeInstance.playCard(playerId);
        }
    },

    slap(playerId) {
        if (this.modeInstance) {
            this.modeInstance.slap(playerId);
        }
    }
};
