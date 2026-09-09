import { BotGameMode } from './botGameMode.js';
import { MultiplayerMode } from './multiplayerMode.js?v=6';

export const GameManager = {
    activeMode: null, // 'bots' or 'multiplayer'
    modeInstance: null,

    startBotGame(options = {}) {
        this.activeMode = 'bots';
        this.modeInstance = BotGameMode;
        this.modeInstance.start(options);
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

        // A Daily Challenge run that is abandoned must give the seeded RNG and
        // the forced difficulty back — otherwise the NEXT ordinary match would
        // silently be dealt today's deck against Hard bots. Dynamic import keeps
        // gameManager out of an import cycle with dailyChallenge.
        import('./dailyChallenge.js').then(m => m.DailyChallenge.stop()).catch(() => {});

        // Clean up any stray UI states if possible.
        //
        // This is the mode-INDEPENDENT teardown, and that matters: main.js
        // only calls `UIManager.resetOfflineUI()` when activeMode === 'bots',
        // so a multiplayer match leaving through this path gets nothing else.
        // The permanent winner banner is posted by `gameOver` in BOTH modes.
        import('./ui.js').then(ui => {
            ui.UIManager.hideLoading();
            ui.UIManager.hideNotification();
        });
        // ...and a victory screen that gameOver scheduled but has not shown
        // yet. Leaving the match inside that 1.5s window used to mean the
        // screen arrived anyway, on top of the menu.
        import('./victoryScreen.js').then(vs => vs.VictoryScreen.cancelPendingShow());
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
