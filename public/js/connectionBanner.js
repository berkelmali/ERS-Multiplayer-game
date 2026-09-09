/**
 * connectionBanner.js — v3.7.0
 *
 * A non-blocking "your connection dropped" strip.
 *
 * ── Why a banner and not the error screen ────────────────────────────────────
 * The player asked for an error screen that names the reason, and for most
 * failures that is right. Connection loss is the exception: it is the one
 * failure that can strike in the middle of a hand, and a modal that takes the
 * board away mid-slap is worse than the silence it replaces — especially since
 * most drops recover on their own within a second or two. So this reports the
 * same fact without stealing the screen, and clears itself the moment the
 * connection returns.
 *
 * ── Why it lives at body level ───────────────────────────────────────────────
 * #notifications spent this project's whole history inside #game-container,
 * which is display:none unless the game board is the active screen. Every
 * message raised from the lobby or the menu was written into a hidden subtree
 * and never seen. Mounting this banner inside any .screen would reproduce
 * exactly that bug, so it is a direct child of <body> and nothing about its
 * visibility depends on which screen is active.
 */

import { Localization } from './localization.js?v=3';

/** Ordinary socket churn recovers in well under a second. Waiting this long
 *  before saying anything keeps the banner from flickering during normal play. */
export const CONNECTION_GRACE_MS = 3000;

const BANNER_ID = 'connection-banner';

export const ConnectionBanner = {
    _timer: null,
    _visible: false,

    _el() {
        return document.getElementById(BANNER_ID);
    },

    /**
     * Arm the banner. Shows after `graceMs`, unless clear() lands first.
     * Pass 0 for a fault we already know is real (a listener error, say) rather
     * than a possible blip.
     */
    armLost(graceMs) {
        const delay = typeof graceMs === 'number' ? graceMs : CONNECTION_GRACE_MS;
        if (this._visible || this._timer !== null) return;
        this._timer = setTimeout(() => {
            this._timer = null;
            this.show(Localization.get('connBannerLost'));
        }, delay);
    },

    show(text) {
        const el = this._el();
        if (!el) return false;
        const t = el.querySelector('#connection-banner-text');
        if (t && text) t.innerText = text;
        el.classList.add('open');
        this._visible = true;
        return true;
    },

    /** Connection is back (or the game ended) — disarm and hide. */
    clear() {
        if (this._timer !== null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        if (!this._visible) return false;
        const el = this._el();
        if (el) el.classList.remove('open');
        this._visible = false;
        return true;
    },

    isVisible() {
        return this._visible;
    }
};
