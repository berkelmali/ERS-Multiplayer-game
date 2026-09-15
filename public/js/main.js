import { Settings } from './settings.js';
import { Localization } from './localization.js?v=3';
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
import { Leaderboard } from './leaderboard.js';
import { LobbyUI } from './lobbyUI.js';
import { ReconnectManager } from './reconnectManager.js';
import { StreakTracker } from './streakTracker.js';
import { TutorialMode } from './tutorialMode.js';
import { BotNemesis } from './botNemesis.js';
import { CardSkins } from './cardSkins.js';
import { DailySpin } from './dailySpin.js';
import { ShopUI } from './shopUI.js';
// --- v3.0.0 ---
import { HouseRules } from './houseRules.js';
import { SlapForensics } from './slapForensics.js';
import { DailyChallenge } from './dailyChallenge.js';
import { NetQuality } from './netQuality.js';
import { renderRulesBadge } from './rulesBadge.js';
import { Ads } from './ads.js';
import { parseInviteCode, savePendingInvite, consumePendingInvite, peekPendingInvite, clearPendingInvite } from './inviteLink.js';
import { ERR, classifyError, readOnline } from './errorCodes.js';
import { ErrorScreen } from './errorScreen.js';
import { ConnectionBanner } from './connectionBanner.js';

document.addEventListener('DOMContentLoaded', () => {
    // 0. The module graph resolved and this file is executing, so the inline
    //    boot net in <head> has done its job. Hand over: from here on a failure
    //    is a runtime fault with a localized screen, not a failure to start.
    window.__ersBooted = true;

    installGlobalErrorHandlers();

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
    DailySpin.init();
    ShopUI.init();

    // v3.0.0 subsystems. Order matters only for NetQuality, which must be able
    // to answer serverNow() before the first multiplayer transaction is built.
    NetQuality.init();
    SlapForensics.init();
    DailyChallenge.init();
    // Exposed for the same reason as window.GameState: the smoke test and the
    // browser console need to inspect the live rule set and its lock.
    window.HouseRules = HouseRules;
    // Same reason again. The bot-tell generation guard protects a race between
    // an awaited apply and a synchronous clear; no gameplay sequence drives
    // those back to back reliably, so the smoke test drives them directly.
    window.UI = UIManager;
    // Ads last, and inert until a publisher id is set: with none, this call
    // makes no request at all. See adsConfig.js for where ads may appear.
    Ads.init();
    renderRulesBadge('rules-badge', HouseRules.active());

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
        // Only warn/penalize when quitting an ACTUAL in-progress match — this
        // is what closes the "quit early to dodge the loss penalty" loophole
        // (see cardSkins.js::applyQuitPenalty). Not shown for e.g. an already-
        // finished game the UI hasn't transitioned away from yet.
        const isActiveMatch = GameState.gameStarted && !GameState.gameOver &&
            (GameManager.activeMode === 'bots' || GameManager.activeMode === 'multiplayer');

        let confirmMessage = null;
        if (isActiveMatch) {
            const penalty = Math.abs(CardSkins.computeReward(1));
            const coinWarning = (Localization.get('confirmQuitCoinWarning') || 'Quitting now will cost you {n} coins.').replace('{n}', penalty);
            confirmMessage = GameManager.activeMode === 'multiplayer'
                ? `${coinWarning} ${Localization.get('confirmLeaveSubtext') || ''}`
                : coinWarning;
        }

        UIManager.showConfirmModal(() => {
            // Stop logic
            if (GameManager.activeMode === 'bots') {
                UIManager.resetOfflineUI();
            }
            if (isActiveMatch) {
                CardSkins.applyQuitPenalty();
            }
            GameManager.quitGame(); // also releases a Daily Challenge run

            document.body.classList.remove('game-screen');
            document.body.classList.add('menu-screen');
            screenGame.classList.remove('active');
            screenMenu.classList.add('active');
            EventBus.emit('gameStateChanged', 'menu');

            // Menüye dönüldüğünde 3D sahneyi yeniden yükle
            Spline3D.resume();
        }, confirmMessage);
    });

    // About panel. Sits beside the privacy link in the version footer: both are
    // publisher-accountability pages rather than features, so neither belongs in
    // the menu list. Unlike the privacy panel this one MAY carry an ad — nothing
    // on it is timed and leaving it is always a deliberate click.
    const btnAbout = document.getElementById('btn-about');
    const screenAbout = document.getElementById('about-panel');
    if (btnAbout && screenAbout) {
        // v3.16.1 — this control is an <a href="/en/about"> now, not a <button>.
        // preventDefault is what keeps it a panel: without it the click opens
        // the panel AND navigates, so the player is thrown out of the app by the
        // one element whose job is to keep them in it. The href is there for
        // whatever does not run JavaScript; the handler is there for people.
        btnAbout.addEventListener('click', (e) => {
            e.preventDefault();
            screenMenu.classList.remove('active');
            screenAbout.classList.add('active');
        });
        document.getElementById('btn-about-back').addEventListener('click', () => {
            screenAbout.classList.remove('active');
            screenMenu.classList.add('active');
        });
    }

    // Privacy panel. Same open/close shape as the Rules panel; the link lives
    // next to the version label rather than in the menu list, because it is a
    // legal footer, not a feature.
    const btnPrivacy = document.getElementById('btn-privacy');
    const screenPrivacy = document.getElementById('privacy-panel');
    if (btnPrivacy && screenPrivacy) {
        // v3.16.1 — an <a href="/en/privacy">, same as About above. Same reason
        // for the same preventDefault.
        btnPrivacy.addEventListener('click', (e) => {
            e.preventDefault();
            screenMenu.classList.remove('active');
            screenPrivacy.classList.add('active');
        });
        document.getElementById('btn-privacy-back').addEventListener('click', () => {
            screenPrivacy.classList.remove('active');
            screenMenu.classList.add('active');
        });
    }

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

    // 5. Deep Link / Room Invite & Session Reconnect Coordination (Council ERS-07)
    let isJoiningInvite = false;

    // Capture invite code from URL if present on boot, save to storage with timestamp,
    // and clean the hash so refresh/history navigation doesn't loop.
    // Crucially: DO NOT branch or decide here synchronously! Wait for auth state to resolve (F1).
    const bootCode = parseInviteCode(window.location);
    if (bootCode) {
        savePendingInvite(bootCode, sessionStorage);
        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname);
        }
    }

    const processPendingInviteOrPrompt = (user) => {
        // PEEK, never consume-and-re-save.
        //
        // The first fix for F9 read the code with consumePendingInvite() and, in
        // the no-user branch, wrote it straight back with savePendingInvite().
        // That default-stamps a NEW timestamp, so the 15-minute expiry measured
        // "time since the last auth event" rather than "time since the link was
        // clicked" — and every sign-out silently renewed it. The TTL test still
        // passed, because it exercises the storage helper and not this caller.
        //
        // Peeking leaves the original `at` untouched; only an actual join
        // consumes the entry, and only a rejected entry is cleared.
        const pendingCode = peekPendingInvite(sessionStorage);
        if (!pendingCode) {
            // Expired or corrupt: peek reports nothing but leaves the blob, so
            // drop it here rather than let it sit for the life of the tab.
            clearPendingInvite(sessionStorage);
            return false;
        }

        if (user) {
            // Player is authenticated: join directly without error toast or forced login modal (F1)
            consumePendingInvite(sessionStorage); // claimed exactly once
            isJoiningInvite = true;
            LobbyUI.openLobby();
            LobbyUI.joinTableDirect(pendingCode).finally(() => {
                isJoiningInvite = false;
            });
            return true;
        } else {
            // Arrived via invite link and Firebase confirmed NOT logged in.
            // The entry stays in storage exactly as it was — same code, same
            // original timestamp — so signing in later still joins, and the
            // 15-minute window keeps counting from the click.
            UIManager.showNotification(Localization.get('loginRequired') || "Please log in to play multiplayer.", "var(--error)");
            const userBtn = document.getElementById('display-username');
            if (userBtn) userBtn.click();
            return false;
        }
    };

    // Listen to hashchange for live tabs (F2: Discord click when tab is already open)
    window.addEventListener('hashchange', () => {
        if (isJoiningInvite) return;
        const newCode = parseInviteCode(window.location);
        if (!newCode) return;

        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname);
        }

        savePendingInvite(newCode, sessionStorage);
        processPendingInviteOrPrompt(AuthSystem.currentUser);
    });

    // Coordination on authStateChanged (F1, F8)
    EventBus.on('authStateChanged', (user) => {
        if (user) {
            // If there's an explicit pending room invite, prioritize joining friend's room
            const handledInvite = processPendingInviteOrPrompt(user);
            if (!handledInvite) {
                // Otherwise resume normal active reconnect check
                ReconnectManager.checkActiveSession();
            }
        } else {
            // Auth resolved to null: if an invite was pending on boot, prompt now!
            processPendingInviteOrPrompt(null);
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


/**
 * Last-resort handlers for anything that escapes a try/catch.
 *
 * Deliberately conservative. Roughly 65 dynamic import() chains in this codebase
 * have no .catch, almost all of them pointing at same-origin modules; one flaky
 * fetch on a phone should not paint a full-screen error over the main menu. So
 * an unclassifiable failure gets a toast the first time and the error screen
 * only if it repeats — a repeat is evidence of a real fault rather than a blip.
 * Failures we CAN classify skip the throttle, because we know what they are and
 * can say so.
 *
 * The reentrancy guard matters: if rendering the error screen throws, the throw
 * would land back here and recurse until the tab dies.
 */
let handlingGlobalError = false;

function installGlobalErrorHandlers() {
    const report = (raw, source) => {
        if (handlingGlobalError) return;
        handlingGlobalError = true;
        try {
            const code = classifyError(raw, { online: readOnline() });
            ErrorScreen.showThrottled({
                code,
                titleKey: 'errTitleGeneric',
                technical: source + ': ' + ((raw && raw.message) || String(raw || ''))
            });
        } catch (_) {
            // Never let the reporter become the fault.
        } finally {
            handlingGlobalError = false;
        }
    };

    window.addEventListener('error', (e) => {
        // Resource load failures (an <img> 404) are not application faults.
        if (e && e.target && e.target !== window && e.target.tagName) return;
        report(e && (e.error || e.message), 'error');
    });

    window.addEventListener('unhandledrejection', (e) => {
        report(e && e.reason, 'unhandledrejection');
    });

    // The browser's own connectivity signal, available on every screen — unlike
    // RTDB's .info/connected, which only exists inside an active match. This is
    // what covers "the connection dropped while I was sitting in the waiting
    // room", which had no detection path at all before v3.7.0.
    window.addEventListener('offline', () => ConnectionBanner.armLost(0));
    window.addEventListener('online', () => ConnectionBanner.clear());
}
