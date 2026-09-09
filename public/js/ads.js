/**
 * ads.js — AdSense units on menu screens, and nowhere near a measured one.
 *
 * WHAT THIS DOES NOT DO, and why each one is deliberate:
 *
 *   • It does not load anything until `PUBLISHER_ID` is set. No script tag, no
 *     request, no cookie. An unconfigured build is byte-for-byte an ad-free
 *     build at runtime.
 *
 *   • It does not use AUTO ADS. Auto ads let Google insert units anywhere on the
 *     page it likes — including over the pile, mid-match. Every protection in
 *     adsConfig.js is bypassed the moment auto ads are switched on in the
 *     AdSense dashboard, and nothing in this codebase can stop it. THIS IS A
 *     DASHBOARD SETTING, NOT A CODE SETTING: turn Auto ads OFF for this site.
 *
 *   • It does not create, destroy and re-create units as screens change.
 *     Churning slots to force fresh impressions is an AdSense policy violation
 *     (artificially inflating impressions), and it is exactly what a naive
 *     "show the ad when the panel opens" implementation does. Each slot here is
 *     filled ONCE per page load, the first time its panel is genuinely opened.
 *
 *   • It does not fill a slot while a match is running. That is the jank rule
 *     from adsConfig.js: an ad may load on a menu, never into a live pile. A
 *     slot whose panel is somehow reached mid-match simply stays empty until the
 *     next time it is opened out of play.
 *
 * HOW A SLOT GETS FILLED. Screens are plain divs that gain and lose an `active`
 * class; there is no "screen shown" event to listen to. Rather than edit every
 * panel's open path — six call sites that would each have to remember this —
 * one MutationObserver watches the class attribute of the allowed screens. The
 * observer is the only wiring, so there is one place to be wrong.
 *
 * SIDE RAILS. The lobby also has two vertical boxes in the gutter either side
 * of the 600px column. They are body-level siblings of #main-menu, not children
 * of it, and CSS alone decides when they are visible — see the long note in
 * adsConfig.js for why both of those are load-bearing. This file's only extra
 * job is to refuse to fill a rail that is not actually on screen.
 */

import { PUBLISHER_ID, AD_SCREENS, RAIL_SIZE, adsEnabled, screenAllowsAd, slotFor, railSlotFor } from './adsConfig.js';
import EventBus from './eventbus.js';

const SCRIPT_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

export const Ads = {
    _initialized: false,
    /** Slots already filled this page load; a slot appears here exactly once. */
    _filled: new Set(),
    /** True from the moment a match starts until the player is back on a menu. */
    _inPlay: false,
    _observer: null,

    init() {
        if (this._initialized) return;
        this._initialized = true;

        // The single most important line in the file: with no publisher id,
        // nothing below ever runs and the page makes no third-party request.
        if (!adsEnabled(PUBLISHER_ID)) return;

        // A match is in play from 'gameplay' until we are back at a menu. Both
        // edges matter: the first stops a slot filling mid-match, the second
        // lets a panel opened afterwards fill normally.
        EventBus.on('gameStateChanged', (state) => {
            if (state === 'gameplay') this._inPlay = true;
            else if (state === 'menu') this._inPlay = false;
        });

        this._loadScriptOnce();
        this._watchScreens();
        // The menu is already on screen at boot, so it never fires a mutation.
        this._maybeFill('main-menu');
    },

    _loadScriptOnce() {
        if (document.querySelector(`script[src^="${SCRIPT_SRC}"]`)) return;
        const s = document.createElement('script');
        s.async = true;
        s.crossOrigin = 'anonymous';
        s.src = `${SCRIPT_SRC}?client=${encodeURIComponent(PUBLISHER_ID)}`;
        document.head.appendChild(s);
    },

    _watchScreens() {
        this._observer = new MutationObserver((records) => {
            for (const r of records) {
                const el = r.target;
                if (el instanceof HTMLElement && el.classList.contains('active')) {
                    this._maybeFill(el.id);
                }
            }
        });
        for (const id of AD_SCREENS) {
            const el = document.getElementById(id);
            if (el) this._observer.observe(el, { attributes: true, attributeFilter: ['class'] });
        }
    },

    /**
     * Fills one screen's slot, if every condition holds. Written as a list of
     * refusals rather than one condition so that a failure is readable: the
     * reason an ad did not appear is the line that returned.
     */
    _maybeFill(screenId) {
        if (!adsEnabled(PUBLISHER_ID)) return 'no publisher id';
        if (this._inPlay) return 'a match is running';
        if (!screenAllowsAd(screenId)) return 'screen is not an ad screen';

        const slot = slotFor(screenId);
        const railSlot = railSlotFor(screenId);
        if (!slot && !railSlot) return 'no slot configured';
        if (this._filled.has(screenId)) return 'already filled';

        // ON SCREEN, MEASURED — one predicate, every box, no exceptions.
        //
        // The lobby carries two kinds of box and shows exactly one of them: the
        // side rails on a wide window, its in-column banner on a narrow one.
        // Which is which lives in the stylesheet, and this asks the stylesheet
        // rather than repeating RAIL_MIN_WIDTH here — a number written twice is
        // a number that drifts, and the drift would show up as an ad request
        // for a box no player can see, which is an invisible impression.
        //
        // It is also why this is applied to the banner and not only to the
        // rails: `display: none` on the banner above the breakpoint would
        // otherwise hide it from the player and not from AdSense.
        const onScreen = el => el.getClientRects().length > 0;

        const jobs = [];
        if (slot) {
            const host = document.querySelector(`#${screenId} .ad-slot`);
            if (host && onScreen(host)) jobs.push({ host, slot });
        }
        if (railSlot) {
            for (const host of document.querySelectorAll(`.ad-rail-slot[data-ad-screen="${screenId}"]`)) {
                if (onScreen(host)) jobs.push({ host, slot: railSlot, fixed: RAIL_SIZE });
            }
        }
        // Deliberate: this is decided ONCE, at the moment the screen is first
        // opened. Widening the window afterwards does not add rails, because
        // re-running fills to chase a resize is impression churn — the same
        // AdSense policy line this file refuses to cross for screen changes.
        if (jobs.length === 0) return 'no container in the markup';

        this._filled.add(screenId);
        for (const job of jobs) {
            job.host.innerHTML = '';
            const ins = document.createElement('ins');
            ins.className = 'adsbygoogle';
            ins.setAttribute('data-ad-client', PUBLISHER_ID);
            ins.setAttribute('data-ad-slot', job.slot);
            if (job.fixed) {
                // FIXED SIZE, and no data-ad-format at all. A responsive unit
                // takes its size from the container's WIDTH, which is exactly
                // wrong for a 160px box that must be 600px tall: it would ask
                // for whatever fits 160px and leave the rest of the rail empty,
                // or stretch and leave the gutter. The classic fixed-size tag
                // states both dimensions and asks for that one shape.
                // data-full-width-responsive is meaningless here and omitted
                // rather than set to 'false', because a rail that could go
                // full width is a rail that has left the gutter.
                ins.style.display = 'inline-block';
                ins.style.width = job.fixed.w + 'px';
                ins.style.height = job.fixed.h + 'px';
            } else {
                ins.style.display = 'block';
                ins.setAttribute('data-ad-format', 'auto');
                ins.setAttribute('data-full-width-responsive', 'true');
            }
            job.host.appendChild(ins);
            job.host.classList.add('filled');

            try {
                (window.adsbygoogle = window.adsbygoogle || []).push({});
            } catch (e) {
                // A blocked or failed ad is never worth breaking a menu over.
                console.warn('[Ads] slot could not be filled', e);
            }
        }
        return 'filled';
    }
};
