/**
 * onlinePresence.js — "is this account connected right now?" (v3.22.3,
 * council ERS-30). Feeds the admin page's online list, and the lobby cleanup
 * rule: an admin may delete a waiting lobby only when its host has no entry
 * here (database.rules.json, lobbyRooms).
 *
 * online/{uid}/{connectionId} = server time. One entry per open tab, removed
 * BY THE SERVER when that tab's connection drops (onDisconnect), so a crashed
 * tab cleans up too, and closing a second tab never marks a player offline.
 *
 * Deliberately NOT presence/{uid}. tableManager drops a seated player whose
 * presence reads "offline"; if every signed-in tab registered that, closing a
 * spare menu tab would hand a player's seat to a bot mid-match. That node stays
 * tied to joining a table, exactly as before.
 *
 * Costs no extra connection: NetQuality.init() already opens the Realtime
 * Database connection at boot for every visitor.
 */
import { rtdb } from './firebaseConfig.js';
import { ref, push, set, remove, onValue, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

export const OnlinePresence = {
    _uid: null,
    _conn: null,          // this tab's online/{uid}/{id} ref
    _unsubConnected: null,

    /** Called on every auth change: a user → announce, null → withdraw. */
    async setUser(user) {
        const uid = user && user.uid ? user.uid : null;
        if (uid === this._uid) return;
        await this.stop();
        if (!uid) return;
        this._uid = uid;
        // .info/connected flips to true on every (re)connection; each one gets
        // a fresh entry, because the server removed the old one when it dropped.
        this._unsubConnected = onValue(ref(rtdb, '.info/connected'), (snap) => {
            if (snap.val() !== true || this._uid !== uid) return;
            const conn = push(ref(rtdb, `online/${uid}`));
            this._conn = conn;
            onDisconnect(conn).remove()
                .then(() => set(conn, serverTimestamp()))
                .catch((e) => console.warn('[online] marker not written:', e && e.code));
        });
    },

    /** Withdraw this tab's entry — before sign-out, while the write is still ours. */
    async stop() {
        if (this._unsubConnected) { try { this._unsubConnected(); } catch (e) { /* gone */ } }
        this._unsubConnected = null;
        const conn = this._conn;
        this._conn = null;
        this._uid = null;
        if (!conn) return;
        try { await onDisconnect(conn).cancel(); await remove(conn); }
        catch (e) { /* the server removes it when the connection drops anyway */ }
    }
};
