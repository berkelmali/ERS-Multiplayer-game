/**
 * banStatus.js — "is this account suspended, until when, and why?" (v3.24.0,
 * council ERS-36).
 *
 * The rules are the boundary (firestore.rules block 7: a suspended account
 * cannot open or join a table, write the leaderboard or the Daily board, or
 * move its match record). This module only makes the refusal honest: it reads
 * the player's OWN bans/{uid} — the one ban document a player may read — and
 * says so in the menu, so a suspended player is told what happened instead of
 * meeting unexplained failures.
 *
 * Other modules ask BanStatus.isActive() before a write the rules would refuse
 * anyway (tableManager, scoreSystem, dailyChallenge), so a suspension produces
 * one clear sentence, not a string of PERMISSION_DENIED in the console.
 */
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from './firebaseConfig.js';
import EventBus from './eventbus.js';
import { Localization } from './localization.js?v=3';
import { banActive, toMs } from './moderationCore.js';

const db = getFirestore(app);

export const BanStatus = {
    ban: null,            // { until, reason } while suspended, else null
    _uid: null,

    init() {
        EventBus.on('authStateChanged', (user) => { this.load(user); });
        EventBus.on('languageChanged', () => this.render());
        EventBus.on('gameStateChanged', (st) => { if (st === 'menu') this.render(); });
    },

    async load(user) {
        const uid = user && user.uid ? user.uid : null;
        this._uid = uid;
        this.ban = null;
        if (uid) {
            try {
                const snap = await getDoc(doc(db, 'bans', uid));
                if (this._uid !== uid) return;                  // signed out meanwhile
                const d = snap.exists() ? snap.data() : null;
                if (d && banActive(d)) this.ban = { until: toMs(d.until), reason: String(d.reason || '') };
            } catch (e) { /* offline: the rules still refuse; nothing to say yet */ }
        }
        this.render();
    },

    isActive(now = Date.now()) {
        return !!(this.ban && this.ban.until > now);
    },

    /** The menu line. Text only — the reason was typed by an admin. */
    render() {
        const el = document.getElementById('ban-notice');
        if (!el) return;
        if (!this.isActive()) { el.hidden = true; el.textContent = ''; return; }
        const until = new Date(this.ban.until).toLocaleString(Localization.current() || undefined,
            { dateStyle: 'medium', timeStyle: 'short' });
        // A function replacement: '$&' in an admin-typed reason is not a pattern.
        const reason = this.ban.reason;
        el.textContent = Localization.get('banNotice')
            .replace('{until}', () => until)
            .replace('{reason}', () => reason);
        el.hidden = false;
    }
};
