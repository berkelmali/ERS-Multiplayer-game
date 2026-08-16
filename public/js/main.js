import { Settings } from './settings.js';
import { Parallax3D as Spline3D } from './parallax3d.js';
import { GameState } from './game.js';
import { AIController } from './ai.js';
import { UIManager } from './ui.js';
import { RulesPanel } from './rulesPanel.js';
import { VictoryScreen } from './victoryScreen.js';
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
import { ReconnectManager } from './reconnectManager.js';
import { StreakTracker } from './streakTracker.js';
import { TutorialMode } from './tutorialMode.js';
import { BotNemesis } from './botNemesis.js';
import { CardSkins } from './cardSkins.js';
import { ShopUI } from './shopUI.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Settings & Localization First
    Settings.init();

    // 2. Initialize Subsystems
    UIManager.init();
    AIController.init();
    RulesPanel.init();
    VictoryScreen.init();

    // 2b. Initialize Spline 3D (no-op on mobile)
    Spline3D.init();
    AudioManager.init();
    AuthSystem.init();
    UserProfile.init();
    ProfileUI.init();
    ScoreSystem.init();
    Leaderboard.init();
    LobbyUI.init();
    StreakTracker.init();
    TutorialMode.init();
    BotNemesis.init();
    CardSkins.init();
    ShopUI.init();

    // 3. UI Screen Flow Controls
    const screenMenu = document.getElementById('main-menu');
    const screenSettings = document.getElementById('settings-panel');
    const screenGame = document.getElementById('game-container');

    EventBus.on('restartGame', () => {
        if (GameManager.activeMode === 'bots') {
            GameManager.startBotGame();
        }
    });

    // --- Spline 3D Hover Bindings (only on main play buttons) ---
    const btnBots = document.getElementById('btn-play-bots');
    const btnMulti = document.getElementById('btn-play-multi');

    [btnBots, btnMulti].forEach(btn => {
        btn.addEventListener('mouseenter', () => Spline3D.onHoverStart());
        btn.addEventListener('mouseleave', () => Spline3D.onHoverEnd());
    });

    // --- Play Button Click Handlers ---
    btnBots.addEventListener('click', async () => {
        await Spline3D.onPlayClicked(); // Kart dağılım animasyonu (~1s)
        Spline3D.dispose();             // GPU belleğini serbest bırak

        document.body.classList.remove('menu-screen');
        document.body.classList.add('game-screen');
        screenMenu.classList.remove('active');
        screenGame.classList.add('active');
        UIManager.resetOfflineUI();
        GameManager.startBotGame();
        EventBus.emit('gameStateChanged', 'gameplay');
    });

    btnMulti.addEventListener('click', () => {
        Spline3D.onPlayClicked(); // Fire-and-forget (lobi paneli kapatır)
        LobbyUI.openLobby();
    });

    document.getElementById('btn-practice').addEventListener('click', () => {
        Spline3D.dispose();
        TutorialMode.start();
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
        const isLiveGame = GameManager.activeMode === 'bots' || GameManager.activeMode === 'multiplayer';
        UIManager.showConfirmModal(() => {
            if (isLiveGame) {
                CardSkins.applyQuitPenalty();
            }
            // Stop logic
            if (GameManager.activeMode === 'bots') {
                UIManager.resetOfflineUI();
            }
            GameManager.quitGame();

            document.body.classList.remove('game-screen');
            document.body.classList.add('menu-screen');
            screenGame.classList.remove('active');
            screenMenu.classList.add('active');
            EventBus.emit('gameStateChanged', 'menu');

            // Menüye dönüldüğünde 3D sahneyi yeniden yükle
            Spline3D.resume();
        }, isLiveGame ? { coinPenalty: CardSkins.QUIT_PENALTY } : {});
    });

    // 4. Spline 3D Lifecycle via EventBus (handles multiplayer & victory screen transitions)
    EventBus.on('gameStateChanged', (state) => {
        if (state === 'gameplay') {
            // Multiplayer oyun başladığında da 3D sahneyi kapat
            Spline3D.dispose();
        } else if (state === 'menu') {
            // Herhangi bir yerden menüye dönüldüğünde 3D sahneyi yeniden yükle
            Spline3D.resume();
        }
    });

    // 5. Initial Reconnect Check if already authed
    if (AuthSystem.currentUser) {
        ReconnectManager.checkActiveSession();
    }

    EventBus.on('authStateChanged', (user) => {
        if (user) {
            ReconnectManager.checkActiveSession();
        }
    });

    // 5. Initial BGM Autoplay Bypass
    // Browsers block autoplay until the user interacts with the document.
    const startAudioContext = () => {
        if (!GameState.gameStarted) {
            AudioManager.playBGM('menuBGM');
        }
        document.removeEventListener('click', startAudioContext);
        document.removeEventListener('touchstart', startAudioContext);
    };
    document.addEventListener('click', startAudioContext);
    document.addEventListener('touchstart', startAudioContext);
});
