/**
 * onlinePresence.js — "is this account connected right now, and doing what?"
 * (v3.22.3, activity added in v3.22.4; council ERS-30/31). Feeds the admin
 * page's online list, and the lobby cleanup rule: an admin may delete a
 * waiting lobby only when its host has no entry here (database.rules.json).
 *
 * online/{uid}/{connectionId} = { at, t, s }
 *   at  server time this tab connected
 *   t   server time its activity last changed
 *   s   one word from a closed list (ACTIVITIES) — never anything typed
 * One entry per open tab, removed BY THE SERVER when that tab's connection
 * drops (onDisconnect), so a crashed tab cleans up too, and closing a second
 * tab never marks a player offline. `s` is written only on a screen change
 * (a match starts, the menu comes back) — never per move.
 *
 * g (v3.22.5) — during a bot, Daily or Legends match, which run in the browser
 * and leave no table or room, a summary of COUNTS (hand sizes, pile, burn,
 * whose turn, moves, over, page errors) so an admin can see one break. At most
 * one write per 5 s, and none when nothing changed; removed when the match ends.
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
import { ref, push, set, update, remove, onValue, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

/** Mirrors ONLINE_ACTIVITIES in tools/lobby-rule.mjs; the rule refuses anything else. */
export const ACTIVITIES = Object.freeze(['menu', 'bots', 'daily', 'legends', 'match']);
/** Matches that run in the browser only — no table, no room (v3.22.5). */
export const SOLO = Object.freeze(['bots', 'daily', 'legends']);
export const SAMPLE_MS = 5000;

export const OnlinePresence = {
    _uid: null,
    _conn: null,          // this tab's online/{uid}/{id} ref
    _unsubConnected: null,
    _activity: 'menu',
    // v3.22.5 — a solo match, summarised for the admin (SOLO_MATCH_RULES).
    _provider: null,      // () => { h, p, b, a, n, o } | null, set by main.js
    _errors: 0,           // page errors since this solo match began
    _sampleTimer: null,
    _lastKey: null,       // the last summary written, so an unchanged one costs nothing

    /** Called on every auth change: a user → announce, null → withdraw. */
    async setUser(user) {
        const uid = user && user.uid ? user.uid : null;
        if (uid === this._uid) return;
        await this.stop();
        if (!uid) return;
        this._uid = uid;
        if (SOLO.includes(this._activity)) this._startSampling();   // signed in mid-match
        // .info/connected flips to true on every (re)connection; each one gets
        // a fresh entry, because the server removed the old one when it dropped.
        this._unsubConnected = onValue(ref(rtdb, '.info/connected'), (snap) => {
            if (snap.val() !== true || this._uid !== uid) return;
            const conn = push(ref(rtdb, `online/${uid}`));
            this._conn = conn;
            this._lastKey = null;         // a fresh entry: the next sample writes
            onDisconnect(conn).remove()
                .then(() => set(conn, { at: serverTimestamp(), t: serverTimestamp(), s: this._activity }))
                .catch((e) => console.warn('[online] marker not written:', e && e.code));
        });
    },

    /** What this tab is doing now. Unknown words are ignored, repeats cost nothing. */
    setActivity(s) {
        if (!ACTIVITIES.includes(s) || s === this._activity) return;
        const wasSolo = SOLO.includes(this._activity);
        this._activity = s;
        const solo = SOLO.includes(s);
        if (solo && !wasSolo) { this._errors = 0; this._startSampling(); }
        if (!solo) this._stopSampling();
        if (!this._conn) return;          // the next connect writes it
        const patch = { s, t: serverTimestamp() };
        if (!solo && this._lastKey !== null) { patch.g = null; this._lastKey = null; }
        update(this._conn, patch)
            .catch((e) => console.warn('[online] activity not written:', e && e.code));
        if (solo) this._sample();
    },

    /** main.js hands in a function that summarises the running match (counts only). */
    setMatchProvider(fn) { this._provider = typeof fn === 'function' ? fn : null; },

    /** A page error during a solo match — the admin sees the count, never the text. */
    noteError() { if (SOLO.includes(this._activity)) this._errors = Math.min(99, this._errors + 1); },

    _startSampling() {
        this._stopSampling();
        this._sampleTimer = setInterval(() => this._sample(), SAMPLE_MS);
    },
    _stopSampling() {
        if (this._sampleTimer) clearInterval(this._sampleTimer);
        this._sampleTimer = null;
    },
    /** Writes the summary when it changed since the last write; otherwise nothing. */
    _sample() {
        if (!this._conn || !this._provider || !SOLO.includes(this._activity)) return;
        let g;
        try { g = this._provider(); } catch (e) { return; }
        if (!g) return;
        g = { ...g, e: this._errors };
        const key = JSON.stringify(g);
        if (key === this._lastKey) return;
        this._lastKey = key;
        update(this._conn, { g: { ...g, u: serverTimestamp() } })
            .catch((e) => console.warn('[online] match summary not written:', e && e.code));
    },

    /** Withdraw this tab's entry — before sign-out, while the write is still ours. */
    async stop() {
        this._stopSampling();
        this._lastKey = null;
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
