/**
 * adsConfig.js — where ads may appear, and where they may never.
 *
 * Zero imports on purpose: this is the file a test reads to prove the rules
 * below hold, and the file a human edits to switch ads on.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THERE IS A LIST OF SCREENS AT ALL
 *
 * This game measures reaction time in milliseconds and writes it to a shared
 * board. Measured on the real scoring function: 50 ms of jank during a slap is
 * worth 72 points. A third-party iframe that loads while the pile is live does
 * not slow the player down — it changes what "the player's reflex" even means,
 * and it does so differently on every machine.
 *
 * Multiplayer is worse: `fairSlap.js` decides who won a pile by comparing two
 * players' reaction times. Jank there does not cost points, it takes the pile.
 *
 * So ads are confined to screens where nothing is being measured. This is not a
 * preference that can be relaxed later without re-opening the same hole council
 * ERS-06 closed for personal settings.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Your AdSense publisher id, e.g. 'ca-pub-1234567890123456'.
 *
 * Enabled since v3.14.0. Enabling requests does not mean the site is approved:
 * on 2026-09-10 the owner reported AdSense status "Getting ready" and live
 * units returned "unfilled". It was empty through six
 * releases on purpose: while empty, `ads.js` loads nothing at all — no script
 * tag, no network request, no cookie — because a placeholder tag on a live
 * site is a bad look during AdSense review, and an unconfigured slot is just
 * an empty box that pushes the layout around.
 *
 * Setting it back to '' is still the whole off switch, and every test that
 * proved the empty case still runs.
 *
 * This must stay identical to the <meta name="google-adsense-account"> tag in
 * index.html and to public/ads.txt; a test compares all three.
 */
export const PUBLISHER_ID = 'ca-pub-7456321071922775';

/**
 * Screens an ad unit may live on. Every one of these is a menu or a reading
 * panel: nothing on them is timed, and leaving one is always a deliberate click.
 */
export const AD_SCREENS = Object.freeze([
    'main-menu',
    'about-panel',
    'shop-panel',
    'rules-panel',
    'slapiq-panel',
    'leaderboard-panel',
    'account-panel'
]);

/**
 * Screens an ad unit may NEVER live on. Kept as an explicit list rather than
 * "everything else", because the reason differs per screen and the reasons are
 * the point:
 *
 *   game-container      the pile is live; this is the whole argument above
 *   daily-panel         the screen you are on one click before a SCORED run —
 *                       an iframe warming up here is warming up into that run
 *   tutorial-screen     practice is a timed reflex lesson, same measurement
 *   lobby-panel         matchmaking; latency-sensitive
 *   waiting-room-panel  same
 *   victory-screen      appears the instant a match ends, while the result is
 *                       still being written and submitted
 *   settings-panel      short, dense, and the one place a player goes to fix
 *                       something that is bothering them
 *   confirm-modal       a modal asking for a decision
 *   privacy-panel       an ad next to the page that explains the ads is absurd
 *   invite-modal        sits over the waiting room one click from a latency-sensitive match
 */
export const NEVER_AD_SCREENS = Object.freeze([
    'game-container',
    'daily-panel',
    'tutorial-screen',
    'lobby-panel',
    'waiting-room-panel',
    'victory-screen',
    'settings-panel',
    'confirm-modal',
    'privacy-panel',
    'invite-modal'
]);

/**
 * The ad unit slot ids from your AdSense dashboard, keyed by screen. A screen
 * with no entry here simply gets no ad, even if it is listed above.
 *
 * One unit ('Frame', responsive display) serves all of them. Separate units
 * per screen would give better reporting; that is a dashboard decision and can
 * be made later by editing this object alone — nothing else in the codebase
 * knows these numbers.
 *
 * 'main-menu' carries a banner too, but ONLY on a narrow window. The lobby
 * gets exactly one ad at any width: the side rails above RAIL_MIN_WIDTH, this
 * banner below it. Never both — a rail plus a banner puts two units around
 * artwork the whole design is built on. The stylesheet enforces the swap by
 * hiding whichever one does not belong at that width, and ads.js refuses to
 * fill a box that is not actually on screen, so the hidden one is never
 * requested either.
 */
export const AD_SLOTS = Object.freeze({
    'main-menu': '7107476549',
    'about-panel': '7107476549',
    'shop-panel': '7107476549',
    'rules-panel': '7107476549',
    'slapiq-panel': '7107476549',
    'leaderboard-panel': '7107476549',
    'account-panel': '7107476549'
});

/** True only when there is a real publisher id to load. */
export function adsEnabled(publisherId = PUBLISHER_ID) {
    return typeof publisherId === 'string' && /^ca-pub-\d{10,}$/.test(publisherId.trim());
}

/**
 * @returns {boolean} may this screen carry an ad unit?
 *
 * Deny-list first, then allow-list. A screen that somehow appears on both is
 * denied — the failure mode of a mistake should be "no ad", never "ad on the
 * game screen".
 */
export function screenAllowsAd(screenId) {
    if (!screenId) return false;
    if (NEVER_AD_SCREENS.includes(screenId)) return false;
    return AD_SCREENS.includes(screenId);
}

/** @returns {string} the slot id configured for a screen, or '' if none. */
export function slotFor(screenId) {
    if (!screenAllowsAd(screenId)) return '';
    const slot = AD_SLOTS[screenId];
    return typeof slot === 'string' ? slot.trim() : '';
}

/* ─────────────────────────────────────────────────────────────────────────
 * SIDE RAILS (v3.14.0)
 *
 * Two vertical units flanking the lobby, in the empty gutter either side of
 * the 600px content column. Why they are a separate concept and not just
 * "two more .ad-slot divs":
 *
 *   1. THEY CANNOT LIVE INSIDE THE SCREEN. `.screen` is 600px wide and
 *      `#main-menu` carries `overflow-y: auto`, which makes it a clipping box
 *      on BOTH axes — a child positioned into the gutter would be cut off at
 *      the column edge. So the rails are body-level siblings that follow
 *      `#main-menu` in the markup, and CSS shows them only while that screen
 *      is `.active` (`#main-menu.active ~ .ad-rail`). No JS toggles them: a
 *      rail cannot be left on screen during a match, because the rule that
 *      reveals it stops matching the moment the menu stops being active.
 *      That is the same class of defect as the stranded "KAOS KAZANDI!"
 *      banner this project shipped in v3.12.0 — a match-scoped visual with no
 *      owner to retire it. This one has no owner because it needs none.
 *
 *   2. THEY ARE DESKTOP-ONLY. Below RAIL_MIN_WIDTH the gutter does not exist,
 *      and forcing rails into it is how a page gets a horizontal scrollbar
 *      back. CSS hides them; `ads.js` refuses to FILL a rail box that is not
 *      actually on screen, measured rather than re-derived from this number,
 *      so an invisible box never buys an impression.
 *
 *   3. THEY ARE A DIFFERENT SHAPE. A 160x600 skyscraper is its own ad unit in
 *      the dashboard, not the responsive banner `AD_SLOTS['main-menu']` names.
 *
 * The lobby artwork is the reason the rails sit in the gutter rather than at
 * the window edges: assets/menu.jpg anchors on the two painted cards near the
 * left and right margins, and covering them is what "reklamlar sağda solda"
 * must NOT mean.
 * ───────────────────────────────────────────────────────────────────────── */

/** The only screen that gets side rails. */
export const AD_RAIL_SCREEN = 'main-menu';

/**
 * The ad unit id for the rails. Empty means no rail is ever filled and the two
 * rail boxes stay zero-height and invisible — that was the shipped state until
 * the site was approved, and it is still the off switch for the rails alone.
 *
 * The same unit as AD_SLOTS above, requested in FIXED SIZE rather than
 * responsive: see the comment in ads.js for why a 160x600 box must state both
 * dimensions instead of letting a responsive unit read its width.
 */
export const AD_RAIL_SLOT = '7107476549';

/**
 * The shape a rail asks for. 160x600 is the standard wide skyscraper, and it
 * is the same 160 the stylesheet gives `.ad-rail` and the same 600 it reserves
 * on `.ad-rail-slot.filled` — a test holds all three together, because a unit
 * that asks for a taller ad than its box reserves is how a rail ends up
 * clipped by its own `overflow: hidden`.
 */
export const RAIL_SIZE = Object.freeze({ w: 160, h: 600 });

/**
 * Below this width there is no gutter to put a rail in. This number is also
 * written in style.css as a `min-width` media query, and a test asserts the
 * two agree — one number in two languages is exactly how a rail ends up
 * filled and invisible.
 */
export const RAIL_MIN_WIDTH = 1200;

/**
 * @returns {boolean} may this screen carry side rails?
 *
 * Separate from railSlotFor on purpose, and the reason is a defect this
 * project has shipped before: while AD_RAIL_SLOT is empty, railSlotFor returns
 * '' for EVERY screen, so a test that only checks its return value cannot tell
 * a working deny list from a deleted one. Mutating the guards away was caught
 * by nothing until this predicate existed. A rule you cannot observe while the
 * feature is off is a rule that quietly stops existing.
 *
 * Note the second condition: even AD_RAIL_SCREEN itself has to pass the
 * deny list, so pointing this file's rail screen at `game-container` gives no
 * rail rather than a rail on the pile.
 */
export function screenHasRail(screenId) {
    return screenId === AD_RAIL_SCREEN && screenAllowsAd(screenId);
}

/** @returns {string} the rail slot id for a screen, or '' if it has no rails. */
export function railSlotFor(screenId) {
    if (!screenHasRail(screenId)) return '';
    return typeof AD_RAIL_SLOT === 'string' ? AD_RAIL_SLOT.trim() : '';
}
