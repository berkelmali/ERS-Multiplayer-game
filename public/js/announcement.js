/**
 * announcement.js — the admin's menu announcement (v3.24.0, council ERS-36).
 *
 * config/announcement is public (guests read it too), written only with an
 * admin action record, plain text with no links, live at most 7 days
 * (firestore.rules block 7). Shown ONLY in the main menu — never over a match:
 * the project's rule since v3.4.0 is that nothing third-party or distracting
 * sits next to anything that is measured.
 *
 * Text goes in with textContent. A dismissal is remembered per announcement
 * (ers_ann_dismissed holds the announcement's id), so a new one shows again.
 */
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from './firebaseConfig.js';
import EventBus from './eventbus.js';
import { Localization } from './localization.js?v=3';
import { pickAnnouncement } from './moderationCore.js';

const db = getFirestore(app);
const DISMISS_KEY = 'ers_ann_dismissed';

export const Announcement = {
    data: null,
    _expiry: null,

    init() {
        try {
            onSnapshot(doc(db, 'config', 'announcement'),
                (snap) => { this.data = snap && snap.exists() ? snap.data() : null; this.render(); },
                () => { /* offline or refused: no announcement is the safe default */ });
        } catch (e) { /* the SDK failed to start; the menu simply has no notice */ }
        EventBus.on('languageChanged', () => this.render());
        const close = document.getElementById('site-notice-close');
        if (close) close.addEventListener('click', () => {
            const a = this.current();
            if (a) { try { localStorage.setItem(DISMISS_KEY, a.id); } catch (e) { /* private mode */ } }
            this.render();
        });
    },

    current(now = Date.now()) {
        return pickAnnouncement(this.data, Localization.current(), now);
    },

    render() {
        const box = document.getElementById('site-notice');
        const text = document.getElementById('site-notice-text');
        if (!box || !text) return;
        const a = this.current();
        let dismissed = null;
        try { dismissed = localStorage.getItem(DISMISS_KEY); } catch (e) { /* private mode */ }
        clearTimeout(this._expiry);
        if (!a || dismissed === a.id) { box.hidden = true; text.textContent = ''; return; }
        text.textContent = a.text;
        box.dataset.level = a.level;
        box.hidden = false;
        // Take it down on time even if nothing else changes.
        const until = this.data && this.data.until && typeof this.data.until.toMillis === 'function' ? this.data.until.toMillis() : null;
        if (until) this._expiry = setTimeout(() => this.render(), Math.max(1000, Math.min(until - Date.now() + 500, 2 ** 31 - 1)));
    }
};
