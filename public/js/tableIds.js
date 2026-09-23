// tableIds.js — pure, no imports: shared by tableManager.js and firebaseSync.js
// without either importing the other (they load under different ?v= URLs).
/**
 * The seated PEOPLE of a table as a map, the shape firestore.rules can test
 * with `in` (it cannot look inside the players array). Written on every change
 * to `players`, the same way the RTDB lobby mirror already carries it.
 */
export function playerIdsOf(players) {
    const ids = {};
    (players || []).forEach(p => { if (p && p.uid && !String(p.uid).startsWith('bot_')) ids[p.uid] = true; });
    return ids;
}
