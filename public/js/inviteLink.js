/**
 * inviteLink.js — Pure helpers for room invite links, deep-link parsing,
 * and pending-join persistence with explicit expiry.
 *
 * Zero imports on purpose: pure logic that can be loaded in Node.js
 * by test_gameLogic.mjs without pulling in DOM or Firebase SDK.
 */

export const INVITE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
export const INVITE_CODE_REGEX = /^[A-Z0-9]{6}$/;

/**
 * Parses a 6-character room code from a URL hash (#join=CODE) or query (?join=CODE).
 * @param {{ hash?: string, search?: string }} locationLike
 * @returns {string|null} 6-character uppercase code, or null if missing/invalid
 */
export function parseInviteCode(locationLike) {
    if (!locationLike) return null;
    const hash = typeof locationLike.hash === 'string' ? locationLike.hash : '';
    const search = typeof locationLike.search === 'string' ? locationLike.search : '';

    const hashMatch = hash.match(/#join=([A-Za-z0-9]{6})(?:[^A-Za-z0-9]|$)/i);
    if (hashMatch) return hashMatch[1].toUpperCase();

    const searchMatch = search.match(/[?&]join=([A-Za-z0-9]{6})(?:[^A-Za-z0-9]|$)/i);
    if (searchMatch) return searchMatch[1].toUpperCase();

    return null;
}

/**
 * Builds a canonical invite URL for a given table ID.
 * @param {string} tableId
 * @param {string} origin e.g. "https://ers-card-game.web.app"
 * @param {string} pathname e.g. "/"
 * @returns {string}
 */
export function formatInviteUrl(tableId, origin = '', pathname = '/') {
    const code = (tableId || '').trim().toUpperCase();
    if (!INVITE_CODE_REGEX.test(code)) return '';
    const base = (origin || '') + (pathname || '/');
    return `${base}#join=${code}`;
}

/**
 * Stores a pending join code with a creation timestamp into storage.
 * @param {string} code
 * @param {Storage} storage default sessionStorage
 * @param {number} now default Date.now()
 * @returns {boolean} true if stored
 */
export function savePendingInvite(code, storage, now = Date.now()) {
    if (!storage || !code) return false;
    const clean = code.trim().toUpperCase();
    if (!INVITE_CODE_REGEX.test(clean)) return false;

    try {
        storage.setItem('ers_pending_invite', JSON.stringify({
            code: clean,
            at: typeof now === 'number' ? now : Date.now()
        }));
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Reads and removes a pending join code from storage, returning the code only
 * if it has not expired.
 * @param {Storage} storage default sessionStorage
 * @param {number} maxAgeMs default INVITE_EXPIRY_MS
 * @param {number} now default Date.now()
 * @returns {string|null}
 */
export function consumePendingInvite(storage, maxAgeMs = INVITE_EXPIRY_MS, now = Date.now()) {
    if (!storage) return null;
    try {
        const raw = storage.getItem('ers_pending_invite');
        if (!raw) return null;
        storage.removeItem('ers_pending_invite');

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.code !== 'string' || typeof parsed.at !== 'number') {
            return null;
        }

        if (!INVITE_CODE_REGEX.test(parsed.code)) {
            return null;
        }

        const age = now - parsed.at;
        if (age < 0 || age > maxAgeMs) {
            return null; // Expired or future timestamp
        }

        return parsed.code.toUpperCase();
    } catch (_) {
        return null;
    }
}

/**
 * Removes a pending invite unconditionally, valid or not.
 *
 * peekPendingInvite() deliberately leaves an expired or corrupt entry in place
 * (it only reports), so something has to be able to drop it. Without this, a
 * blob that can never be consumed sits in storage for the life of the tab.
 *
 * @param {Storage} storage
 * @returns {boolean} true if the call completed without throwing
 */
export function clearPendingInvite(storage) {
    if (!storage) return false;
    try {
        storage.removeItem('ers_pending_invite');
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Peek at pending invite without consuming/deleting it.
 * @param {Storage} storage
 * @param {number} maxAgeMs
 * @param {number} now
 * @returns {string|null}
 */
export function peekPendingInvite(storage, maxAgeMs = INVITE_EXPIRY_MS, now = Date.now()) {
    if (!storage) return null;
    try {
        const raw = storage.getItem('ers_pending_invite');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.code !== 'string' || typeof parsed.at !== 'number') {
            return null;
        }
        if (!INVITE_CODE_REGEX.test(parsed.code)) return null;
        const age = now - parsed.at;
        if (age < 0 || age > maxAgeMs) return null;
        return parsed.code.toUpperCase();
    } catch (_) {
        return null;
    }
}
