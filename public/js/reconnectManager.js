import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import { TableManager } from "./tableManager.js?v=3";
import { LobbyUI } from "./lobbyUI.js";
import { UIManager } from "./ui.js";
import { Localization } from "./localization.js?v=3";
import { ERR, classifyError, readOnline, withDeadline, createOperationToken, DEFAULT_DEADLINE_MS } from "./errorCodes.js";
import { ErrorScreen } from "./errorScreen.js";

const db = getFirestore(app);

export const ReconnectManager = {
    checkInterval: null,
    timeLeft: 60,

    async checkActiveSession() {
        const tableId = localStorage.getItem('ers_active_table');
        if (!tableId) return;

        try {
            const tableRef = doc(db, "multiplayer_tables", tableId);
            const snap = await getDoc(tableRef);

            if (!snap.exists()) {
                localStorage.removeItem('ers_active_table');
                return;
            }

            const data = snap.data();

            // Only show reconnect if game is actually PLAYING (not in waiting room)
            if (data.gameState?.status !== 'playing') {
                localStorage.removeItem('ers_active_table');
                return;
            }

            const { AuthSystem } = await import('./auth.js');
            if (!AuthSystem.currentUser) return;

            const myUid = AuthSystem.currentUser.uid;
            const me = data.players.find(p => p.uid === myUid);

            const isOnMenu = !document.body.classList.contains('game-screen');
            
            // If we are on the menu but have an active 'playing' table in RTDB/Firestore
            // Show for any non-eliminated player, even if 'online', so they can rejoin or properly leave
            if (me && !me.eliminated && (me.status === 'disconnected' || me.status === 'online' || isOnMenu)) {
                // If the game is strictly 'playing', show it
                if (data.gameState?.status === 'playing') {
                    if (me.disconnectedAt) {
                        const elapsed = Date.now() - me.disconnectedAt;
                        this.timeLeft = Math.max(0, Math.floor((60000 - elapsed) / 1000));
                    } else {
                        this.timeLeft = 60; // Grace period
                    }
                    
                    if (this.timeLeft > 0) {
                        this.showPopup(tableId);
                    } else {
                        localStorage.removeItem('ers_active_table');
                    }
                }
            } else if (!me || me.eliminated) {
                localStorage.removeItem('ers_active_table');
            }
            // If me is found but status is 'online', they're already in — no popup needed

        } catch (error) {
            // Silent before v3.7.0: the reconnect prompt simply never appeared
            // and the player lost a match they were still entitled to rejoin,
            // with nothing on screen to say why. A toast rather than the error
            // screen — this runs unprompted on the menu, so an interruption
            // would be disproportionate, but it must not be nothing.
            console.error("Failed to check active session", error);
            const code = classifyError(error, { online: readOnline() });
            if (code === ERR.OFFLINE || code === ERR.NETWORK || code === ERR.TIMEOUT) {
                UIManager.showNotification(Localization.get('errReconnectCheckFailed'), "var(--error)");
            }
        }
    },

    showPopup(tableId) {
        const popup = document.getElementById('reconnect-popup');
        const countdownText = document.getElementById('reconnect-countdown-text');
        const btnReconnect = document.getElementById('btn-reconnect');
        const btnAbandon = document.getElementById('btn-abandon-reconnect');

        if (!popup) return;

        if (countdownText) countdownText.innerText = this.timeLeft;
        popup.style.display = 'block';

        // Timer is now managed by UIManager globally or locally here for visual sync
        this.checkInterval = setInterval(() => {
            this.timeLeft--;
            if (countdownText) countdownText.innerText = Math.max(0, this.timeLeft);

            if (this.timeLeft <= 0) {
                this.closePopup();
                localStorage.removeItem('ers_active_table');
            }
        }, 1000);

        btnReconnect.onclick = async () => {
            btnReconnect.disabled = true;
            this.closePopup();
            const token = createOperationToken();
            try {
                UIManager.showLoading(Localization.get('reconnecting'));
                const tid = tableId.toUpperCase();
                // Without a deadline this await could never settle: Firestore
                // queues a read across a transport failure and retries forever,
                // so "Reconnecting to Game..." became a permanent full-screen
                // spinner with no way out but a page reload.
                await withDeadline(TableManager.joinTable(tid), DEFAULT_DEADLINE_MS, token);
                if (token.cancelled) return;
                LobbyUI.openLobby();
                LobbyUI.enterWaitingRoom(tid, false);
            } catch (error) {
                console.error("Reconnect Error:", error);
                const code = classifyError(error, { online: readOnline() });
                // Keep the saved table when the failure was transport-level —
                // the match may still be there once the connection returns.
                const transient = (code === ERR.OFFLINE || code === ERR.NETWORK || code === ERR.TIMEOUT);
                if (!transient) localStorage.removeItem('ers_active_table');
                ErrorScreen.show({
                    code,
                    titleKey: 'errTitleReconnect',
                    technical: error && error.message,
                    onRetry: transient ? () => btnReconnect.onclick() : undefined
                });
            } finally {
                btnReconnect.disabled = false;
                UIManager.hideLoading();
            }
        };

        btnAbandon.onclick = async () => {
            this.closePopup();
            localStorage.removeItem('ers_active_table');

            // Immediately convert the leaving player's slot to a bot so the game continues
            try {
                const { FirebaseSync } = await import('./firebaseSync.js?v=7');
                const { AuthSystem } = await import('./auth.js');
                if (FirebaseSync.roomData && FirebaseSync.localPlayerIndex >= 0) {
                    await FirebaseSync.convertToBot(FirebaseSync.localPlayerIndex);
                }
            } catch (e) {
                console.warn('Bot conversion on leave failed:', e);
            }

            TableManager.currentTableId = tableId.toUpperCase();
            TableManager.leaveTable().catch(console.warn);
        };
    },

    closePopup() {
        const popup = document.getElementById('reconnect-popup');
        if (popup) popup.style.display = 'none';
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }
};
