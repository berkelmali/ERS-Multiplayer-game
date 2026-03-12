import { Settings } from './settings.js';
import { GameState } from './game.js';
import { AIController } from './ai.js';
import { UIManager } from './ui.js';
import { RulesPanel } from './rulesPanel.js';
import { VictoryScreen } from './victoryScreen.js?v=4';
import { AudioManager } from './audioManager.js';
import { AuthSystem } from './auth.js';
import { ProfileUI } from './profileUI.js';
import { ScoreSystem } from './scoreSystem.js';
import { UserProfile } from './userProfile.js';
import EventBus from './eventbus.js';
import { GameManager } from './gameManager.js';
import { Matchmaking } from './matchmaking.js';
import { Leaderboard } from './leaderboard.js';
import { LobbyUI } from './lobbyUI.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Settings & Localization First
    Settings.init();

    // 2. Initialize Subsystems
    UIManager.init();
    AIController.init();
    RulesPanel.init();
    VictoryScreen.init();
    AudioManager.init();
    AuthSystem.init();
    UserProfile.init();
    ProfileUI.init();
    ScoreSystem.init();
    Leaderboard.init();
    LobbyUI.init();

    // 3. UI Screen Flow Controls
    const screenMenu = document.getElementById('main-menu');
    const screenSettings = document.getElementById('settings-panel');
    const screenGame = document.getElementById('game-container');

    EventBus.on('restartGame', () => {
        if (GameManager.activeMode === 'bots') {
            GameManager.startBotGame();
        }
    });

    document.getElementById('btn-play-bots').addEventListener('click', () => {
        document.body.classList.remove('menu-screen');
        document.body.classList.add('game-screen');
        screenMenu.classList.remove('active');
        screenGame.classList.add('active');
        GameManager.startBotGame();
        EventBus.emit('gameStateChanged', 'gameplay');
    });

    document.getElementById('btn-play-multi').addEventListener('click', () => {
        LobbyUI.openLobby();
    });

    document.getElementById('btn-settings').addEventListener('click', () => {
        screenMenu.classList.remove('active');
        screenSettings.classList.add('active');
    });

    document.getElementById('btn-back').addEventListener('click', () => {
        screenSettings.classList.remove('active');
        screenMenu.classList.add('active');
    });

    document.getElementById('btn-quit').addEventListener('click', () => {
        // Stop logic
        GameManager.quitGame();

        document.body.classList.remove('game-screen');
        document.body.classList.add('menu-screen');
        screenGame.classList.remove('active');
        screenMenu.classList.add('active');
        EventBus.emit('gameStateChanged', 'menu');
    });
});
