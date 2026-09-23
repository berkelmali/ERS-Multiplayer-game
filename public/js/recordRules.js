/**
 * recordRules.js — the pure half of playerRecord.js, importable by the test
 * suite (playerRecord.js loads the Firebase SDK from its CDN; this does not).
 * Every rule here has a twin in firestore.rules, block 1 and 2.
 */
import { cleanName } from "./safeText.js";

export const RECORD_COOLDOWN_S = 10;
export const REFLEX_MIN = 80;
export const REFLEX_MAX = 60000;
/** Every field a player's private record may hold. Mirrored in firestore.rules. */
export const USER_FIELDS = ['username', 'totalScore', 'gamesPlayed', 'gamesWon', 'bestReflex', 'updatedAt'];
export const LEADERBOARD_FIELDS = ['username', 'totalScore', 'updatedAt'];

/**
 * Pure: the counters one finished match moves. `cur` is the stored record.
 * Mirrors the rule: each counter +0/+1, score only with a win, a win only with
 * a game, a best reflex only if it is a real reading and better.
 */
export function matchUpdate(cur, { won, reflex } = {}) {
    const c = cur || {};
    const n = (k) => (Number.isInteger(c[k]) ? c[k] : 0);
    const upd = {
        gamesPlayed: n('gamesPlayed') + 1,
        gamesWon: n('gamesWon') + (won ? 1 : 0),
        totalScore: n('totalScore') + (won ? 1 : 0)
    };
    const r = Math.round(Number(reflex));
    if (Number.isFinite(r) && r >= REFLEX_MIN && r <= REFLEX_MAX && (!Number.isInteger(c.bestReflex) || r < c.bestReflex)) {
        upd.bestReflex = r;
    }
    return upd;
}

export function leaderboardEntry(username, totalScore) {
    return { username: cleanName(username), totalScore: Number.isInteger(totalScore) ? totalScore : 0 };
}
