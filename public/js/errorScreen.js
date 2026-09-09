/**
 * errorScreen.js — v3.7.0
 *
 * The error screen: what failed, why it failed, and what the player can do.
 *
 * ── Why this is NOT built like the other modals ──────────────────────────────
 * `#confirm-modal` and `#invite-modal` are `class="screen modal-overlay"`.
 * `.modal-overlay` supplies only background/blur/centering/z-index — `display`
 * and `position` come from `.screen`. That coupling has two teeth:
 *
 *   1. A modal that carries `.modal-overlay` WITHOUT `.screen` is `display:block;
 *      position:static` — a permanently visible blurred bar sitting in normal
 *      document flow. (This is how the ERS-08 design was first specified.)
 *   2. A modal that carries `.screen` is erased by four unrelated bulk clears:
 *      lobbyUI.js:215, profileUI.js:124, profileUI.js:148, victoryScreen.js:395
 *      all run `querySelectorAll('.screen').forEach(s => s.classList.remove('active'))`.
 *      An error screen saying "could not join the room" would be silently wiped
 *      by the very navigation its own Retry button triggers.
 *
 * So `#error-modal` follows the `#loading-overlay` / `#reconnect-popup` pattern
 * instead: a body-level element outside the `.screen` system entirely, with its
 * own `position:fixed` and its own `.open` toggle. `tools/check-error-modal.mjs`
 * fails the build if it ever acquires `.screen` or `.modal-overlay`, because
 * four other files can silently break it and nothing else would notice.
 *
 * z-index 10001 is deliberate: ABOVE #loading-overlay (9999), because the most
 * important thing this screen has to do is appear over a stuck spinner.
 */

import { Localization } from './localization.js?v=3';
import { ERR, reasonKeyFor, isKnownCode } from './errorCodes.js';

const MODAL_ID = 'error-modal';

export const ErrorScreen = {
    _lastUnknownAt: 0,
    _unknownCount: 0,
    _building: false,

    /**
     * Build the markup once, lazily, as a direct child of <body>.
     * Built in JS rather than index.html so the structure and the CSS contract
     * live in one file and cannot drift apart.
     */
    _ensure() {
        let el = document.getElementById(MODAL_ID);
        if (el) return el;

        el = document.createElement('div');
        el.id = MODAL_ID;
        el.className = 'ers-error-overlay';
        el.setAttribute('role', 'alertdialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'error-modal-title');
        el.innerHTML = `
            <div class="ers-error-card">
                <div class="ers-error-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                         stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="13"></line>
                        <line x1="12" y1="16.5" x2="12.01" y2="16.5"></line>
                    </svg>
                </div>
                <h3 id="error-modal-title" class="ers-error-title"></h3>
                <p class="ers-error-reason"></p>
                <details class="ers-error-tech">
                    <summary></summary>
                    <code class="ers-error-tech-body"></code>
                </details>
                <div class="ers-error-actions">
                    <button type="button" class="btn primary ers-error-retry"></button>
                    <button type="button" class="btn secondary ers-error-close"></button>
                </div>
            </div>`;
        document.body.appendChild(el);

        el.querySelector('.ers-error-close').addEventListener('click', () => this.hide());
        // Backdrop click closes; a click inside the card must not.
        el.addEventListener('click', (e) => { if (e.target === el) this.hide(); });
        return el;
    },

    /** True while the game board is the active screen. */
    _inPlay() {
        const gc = document.getElementById('game-container');
        return !!(gc && gc.classList.contains('active'));
    },

    /**
     * Show the error screen.
     *
     * @param {object} opts
     * @param {string} opts.code       an ERR code — decides the "why" line
     * @param {string} opts.titleKey   Localization key for the "what" line
     * @param {string} opts.technical  developer-facing detail, never the explanation
     * @param {Function} [opts.onRetry] when given, renders a Retry button
     * @returns {boolean} true if the modal opened, false if it degraded to a toast
     */
    show(opts) {
        const o = opts || {};
        const code = isKnownCode(o.code) ? o.code : ERR.UNKNOWN;
        const title = Localization.get(o.titleKey || 'errTitleGeneric');
        const reason = Localization.get(reasonKeyFor(code));

        // A modal during play steals focus mid-slap, which is worse than the
        // silence it replaces. In-match failures stay as a toast plus the log.
        if (this._inPlay()) {
            this._toast(title + ' — ' + reason);
            return false;
        }

        // A stuck spinner is one of the things this screen exists to rescue the
        // player from, so it always clears first.
        this._hideLoading();
        this._closeOtherModals();

        const el = this._ensure();
        el.querySelector('.ers-error-title').innerText = title;
        el.querySelector('.ers-error-reason').innerText = reason;
        el.querySelector('.ers-error-tech > summary').innerText = Localization.get('errTechDetails');

        const tech = el.querySelector('.ers-error-tech-body');
        tech.innerText = code + (o.technical ? ' · ' + String(o.technical).slice(0, 300) : '');
        el.querySelector('.ers-error-tech').open = false;

        const retryBtn = el.querySelector('.ers-error-retry');
        retryBtn.innerText = Localization.get('errRetry');
        if (typeof o.onRetry === 'function') {
            retryBtn.style.display = '';
            retryBtn.onclick = () => { this.hide(); o.onRetry(); };
        } else {
            retryBtn.style.display = 'none';
            retryBtn.onclick = null;
        }
        el.querySelector('.ers-error-close').innerText = Localization.get('errClose');

        el.classList.add('open');
        return true;
    },

    /**
     * UNKNOWN throttle, for the global handlers only.
     *
     * ~65 dynamic `import()` chains in this codebase have no `.catch`. Almost
     * all target same-origin relative modules, but one flaky fetch should not
     * paint a full-screen error over the main menu. So the first UNKNOWN of a
     * session is a toast; a second within two minutes earns the screen, because
     * a repeat is evidence of a real fault rather than a blip.
     * Classified (non-UNKNOWN) errors are never throttled — we know what they are.
     */
    showThrottled(opts) {
        const o = opts || {};
        if (isKnownCode(o.code) && o.code !== ERR.UNKNOWN) return this.show(o);

        const now = Date.now();
        if (now - this._lastUnknownAt > 120000) this._unknownCount = 0;
        this._lastUnknownAt = now;
        this._unknownCount++;

        if (this._unknownCount < 2) {
            this._toast(Localization.get(reasonKeyFor(ERR.UNKNOWN)));
            return false;
        }
        return this.show(o);
    },

    hide() {
        const el = document.getElementById(MODAL_ID);
        if (el) el.classList.remove('open');
    },

    isOpen() {
        const el = document.getElementById(MODAL_ID);
        return !!(el && el.classList.contains('open'));
    },

    /* ── helpers, kept import-light so a failure here cannot cascade ── */

    _toast(msg) {
        import('./ui.js')
            .then(m => m.UIManager.showNotification(msg, 'var(--error)'))
            .catch(() => { try { console.error('[ERS]', msg); } catch (_) {} });
    },

    _hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';
    },

    /** Never stack on top of another dialog — close them first. */
    _closeOtherModals() {
        ['confirm-modal', 'invite-modal'].forEach(id => {
            const m = document.getElementById(id);
            if (m) m.classList.remove('active');
        });
    }
};
