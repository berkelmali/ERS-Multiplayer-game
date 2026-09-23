/**
 * playerRecord.js — a signed-in player's stored record, and its public mirror.
 *
 * SECURITY REVIEW (v3.18.0) changed three things, and firestore.rules enforces
 * each of them server-side — this file only writes what those rules accept:
 *
 *  1. `users/{uid}` is PRIVATE now. It used to be world-readable AND to hold the
 *     player's email, so anyone could list every account's address without
 *     signing in. The email already lives in Firebase Authentication; it is no
 *     longer written here, and an old copy is removed at the next sign-in.
 *  2. The leaderboard reads `leaderboard/{uid}`: a name and a score, nothing
 *     else. The rules accept an entry only if its score equals the private
 *     record's score in the same commit (getAfter), so the public number cannot
 *     be typed in — it can only follow the record.
 *  3. The record moves one match at a time: every counter rises by at most one,
 *     score only with a win, a win only with a game, and not more often than
 *     once every RECORD_COOLDOWN_S. A forged record still takes one real-time
 *     "match" per write — it cannot jump to 99 999 in one request.
 *
 * What this does NOT do, stated plainly: the browser still decides who won.
 * Rules can bound how a record changes; only a server that referees the match
 * can prove a win happened. That is a separate decision (see SECURITY.md).
 */
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteField, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import { matchUpdate, leaderboardEntry } from "./recordRules.js";
import { cleanName } from "./safeText.js";

const db = getFirestore(app);

/** One match, one atomic commit: the private record and its public mirror. */
export async function recordMatch(user, outcome) {
    const userRef = doc(db, 'users', user.uid);
    const boardRef = doc(db, 'leaderboard', user.uid);
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(userRef);
        const cur = snap.exists() ? snap.data() : null;
        const upd = matchUpdate(cur, outcome);
        const username = cleanName((cur && cur.username) || user.displayName || 'Player');
        if (cur) tx.update(userRef, { ...upd, updatedAt: serverTimestamp() });
        else tx.set(userRef, { username, totalScore: 0, gamesPlayed: 0, gamesWon: 0 });
        if (cur) tx.set(boardRef, { ...leaderboardEntry(username, upd.totalScore), updatedAt: serverTimestamp() });
        return { ...(cur || {}), ...upd, username };
    });
}

/** At sign-in: drop an old email copy, then (re)publish the leaderboard entry. */
export async function tidyRecord(user, record) {
    const userRef = doc(db, 'users', user.uid);
    if (record && Object.prototype.hasOwnProperty.call(record, 'email')) {
        try { await updateDoc(userRef, { email: deleteField() }); } catch (e) { console.warn('[record] email scrub failed', e && e.code); }
    }
    try {
        const entry = leaderboardEntry(record && record.username, record && record.totalScore);
        await setDoc(doc(db, 'leaderboard', user.uid), { ...entry, updatedAt: serverTimestamp() });
    } catch (e) { console.warn('[record] leaderboard mirror failed', e && e.code); }
}

/** A brand-new account's record: no email, counters at zero. */
export async function createRecord(user, username) {
    const name = cleanName(username || user.displayName || 'Player');
    await setDoc(doc(db, 'users', user.uid), { username: name, totalScore: 0, gamesPlayed: 0, gamesWon: 0 }, { merge: true });
    return name;
}

export async function readRecord(user) {
    const snap = await getDoc(doc(db, 'users', user.uid));
    return snap.exists() ? snap.data() : null;
}
