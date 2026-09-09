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
 * EMPTY BY DESIGN. While this is empty, `ads.js` loads nothing at all: no
 * script tag, no network request, no cookie. That matters for two reasons —
 * a placeholder tag on a live site is a bad look during AdSense review, and an
 * unconfigured ad slot is just an empty box that pushes the layout around.
 */
export const PUBLISHER_ID = '';

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
 * Fill these in after creating the units. Leave a value empty to skip that one.
 */
export const AD_SLOTS = Object.freeze({
    'main-menu': '',
    'about-panel': '',
    'shop-panel': '',
    'rules-panel': '',
    'slapiq-panel': '',
    'leaderboard-panel': '',
    'account-panel': ''
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
