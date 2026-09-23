/**
 * safeText.js — the one place a name another player chose becomes page text.
 *
 * WHY THIS EXISTS (security review, v3.18.0). Display names arrive from other
 * people: the multiplayer room, the waiting room, the leaderboard. They were
 * written into innerHTML in a dozen places — the table log, the seat labels,
 * the photo-finish banner, the lobby list and the leaderboard, which anyone
 * can open without signing in. The CSP stops injected SCRIPT from running, but
 * it does not stop injected HTML: a name like `<a href=…>` or a `<form>` asking
 * for a password renders, on this domain, to every visitor.
 *
 * Two layers, on purpose:
 *   cleanName  — a name is letters, digits, spaces and `_ . -`, at most 24
 *                code points. Anything else is dropped, so the result is safe
 *                in text AND in markup. firestore.rules enforces the same
 *                pattern on the leaderboard, so the two cannot drift apart
 *                (test section 81 compares them).
 *   escapeHtml — for the rare text that is not a name but still reaches markup.
 */
export const NAME_MAX = 24;
export const NAME_PATTERN = '^[\\p{L}\\p{N} _.\\-]{1,24}$';
const NAME_RE = new RegExp(NAME_PATTERN, 'u');
const DISALLOWED = /[^\p{L}\p{N} _.\-]/gu;

export function cleanName(raw, fallback = 'Player') {
    const s = String(raw ?? '').normalize('NFC').replace(DISALLOWED, '').replace(/\s+/g, ' ').trim();
    const cut = [...s].slice(0, NAME_MAX).join('').trim();
    return cut.length ? cut : fallback;
}

export function isValidName(s) {
    return typeof s === 'string' && NAME_RE.test(s);
}

export function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
