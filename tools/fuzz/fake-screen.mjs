// tools/fuzz/fake-screen.mjs — TEST-ONLY stand-in for ui.js and victoryScreen.js
// when the multiplayer client imports them (see hooks.mjs). It records what the
// client asked the screen to do, so the fuzzer can check it.
export const screenLog = { notifications: [], shows: [], updates: 0 };
export const UIManager = {
    updateAll() { screenLog.updates++; },
    showNotification(msg) { screenLog.notifications.push(String(msg)); }
};
export const VictoryScreen = {
    show(code) { screenLog.shows.push(code); }
};
