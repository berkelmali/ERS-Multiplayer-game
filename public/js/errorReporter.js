/**
 * errorReporter.js — page errors a signed-in player hits, for the admin's
 * "Hatalar" tab (v3.24.0, council ERS-36).
 *
 * client_errors/{uid} is a ring of the last five errors: text about code
 * (message, file, line, what the tab was doing), no URLs, no query strings.
 * The rules allow one write per 10 s and one slot per write, so a page stuck
 * in an error loop costs one small write every 11 s, not a flood. The newest
 * error during a quiet period wins; older ones in the same window are dropped.
 *
 * Guests report nothing (there is no uid to file under). Errors from other
 * origins — extensions, "Script error." — are not ours and are not sent.
 */
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from './firebaseConfig.js';
import EventBus from './eventbus.js';
import { sanitizeError, shouldReport, errorSlot, ERR_MIN_GAP_MS } from './moderationCore.js';

const db = getFirestore(app);

export const ErrorReporter = {
    _uid: null,
    _count: null,          // the doc's count, read once per session
    _pending: null,
    _lastWrite: 0,
    _timer: null,
    _sending: false,
    modeOf: () => 'menu',  // main.js hands in the tab's activity word
    version: '',

    init({ modeOf, version } = {}) {
        if (typeof modeOf === 'function') this.modeOf = modeOf;
        this.version = String(version || '').slice(0, 16);
        EventBus.on('authStateChanged', (user) => {
            this._uid = user && user.uid ? user.uid : null;
            this._count = null;
            this._pending = null;
        });
        window.addEventListener('error', (e) => this.capture(e && e.message, e && e.filename, e && e.lineno));
        window.addEventListener('unhandledrejection', (e) => {
            const r = e && e.reason;
            this.capture(r && (r.message || String(r)), r && r.fileName, r && r.lineNumber);
        });
    },

    capture(message, filename, line) {
        if (!this._uid || !shouldReport(message, filename, location.origin)) return;
        this._pending = sanitizeError({ message, filename, line, mode: this.modeOf(), at: Date.now() });
        this._schedule();
    },

    _schedule() {
        if (this._timer || this._sending) return;
        const wait = Math.max(0, this._lastWrite + ERR_MIN_GAP_MS - Date.now());
        this._timer = setTimeout(() => { this._timer = null; this._flush(); }, wait);
    },

    async _flush() {
        const uid = this._uid;
        const entry = this._pending;
        if (!uid || !entry) return;
        this._pending = null;
        this._sending = true;
        try {
            const ref = doc(db, 'client_errors', uid);
            if (this._count === null) {
                const snap = await getDoc(ref).catch(() => null);
                this._count = snap && snap.exists() ? Number(snap.data().count) || 0 : 0;
            }
            const next = this._count + 1;
            const patch = { [errorSlot(next)]: entry, count: next, v: this.version, updatedAt: serverTimestamp() };
            await setDoc(ref, patch, { merge: true });
            this._count = next;
        } catch (e) {
            // Refused (throttle, offline): re-read the count next time.
            this._count = null;
        } finally {
            this._lastWrite = Date.now();
            this._sending = false;
            if (this._pending) this._schedule();
        }
    }
};
