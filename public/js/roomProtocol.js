/**
 * roomProtocol.js — tells the database which room protocol this client speaks.
 *
 * v3.19.0 (council ERS-20, condition 1). Ghost cards changed how a pile is
 * handed over: an older client, still open in a tab from before a deploy,
 * would hand ghosts to a person and count them toward the 52. A flag in the
 * room cannot stop it — an old client does not know to read one — so the gate
 * is in database.rules.json: a room with a god accepts writes only from users
 * whose `clientVersions/{uid}` is ROOM_PROTOCOL or later. This module writes
 * that value. An old tab never does, so its writes to a god room are refused.
 *
 * Ordering is what makes this safe without an await on the hot path: writes
 * from one client reach the database in the order they were issued, so the
 * registration lands before the room writes that follow it.
 */
import { ref, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { rtdb } from "./firebaseConfig.js";
import { ROOM_PROTOCOL } from "./slapOutcome.js";

export function registerProtocol(uid) {
    if (!uid) return Promise.resolve(false);
    return set(ref(rtdb, `clientVersions/${uid}`), ROOM_PROTOCOL)
        .then(() => true)
        .catch((e) => { console.warn('room protocol registration failed:', e); return false; });
}
