/**
 * tools/lobby-rule.mjs — the lobbyRooms write rule, as named pieces.
 *
 * Security rules live in JSON, on one line, with no comments the CLI is
 * guaranteed to tolerate. That is a bad place to keep a seven-term boolean
 * whose failure mode is a silently refused write. So the expression is
 * composed here, from pieces named after the sentence each one enforces, and
 * two separate readers consume it:
 *
 *   · tools/rules-test.mjs   runs it against the real emulator, and runs
 *                            deliberately broken versions of it to prove the
 *                            scenarios are load-bearing;
 *   · test_gameLogic.mjs     asserts database.rules.json contains exactly this
 *                            composition, so the file and the tests cannot
 *                            drift — that check runs in every `npm test`,
 *                            with no emulator and no Java.
 *
 * A mutant is one piece swapped for `true`. That is why they are separate
 * strings rather than one template.
 */

/** Each value is a complete RTDB rules expression, true when the sentence holds. */
import { ROOM_PROTOCOL } from '../public/js/slapOutcome.js';

export const LOBBY_PIECES = Object.freeze({
    /** There is a signed-in user at all. */
    signedIn: "auth != null",
    /** On creation: you may only open a table that you host. */
    creatorIsHost: "newData.child('hostId').val() === auth.uid",
    /** Whoever the write names as host must be seated at the table it names. */
    newHostSeated: "newData.child('playerIds').child(newData.child('hostId').val()).exists()",
    /** You are the host the table ALREADY has — read from data, never newData. */
    isHost: "data.child('hostId').val() === auth.uid",
    /** You are already seated at the table — likewise from data. */
    isSeated: "data.child('playerIds').child(auth.uid).exists()",
    /** The table has not started yet, so joining it is still a thing. */
    tableWaiting: "data.child('gameState').child('status').val() === 'waiting'",
    /** The write puts you in the seat list: this is a join, not a takeover. */
    addsSelf: "newData.child('playerIds').child(auth.uid).exists()",
    /** A table keeps its id for life; the id is the invite. */
    keepsTableId: "newData.child('tableId').val() === data.child('tableId').val()"
});

/**
 * Three branches, because a lobby write is three different acts:
 *
 *   CREATE  (no data yet)      you must be the host you are naming
 *   DELETE  (no newData)       the host, or anyone seated, may tidy up
 *   UPDATE  (both)             host, or seated, or a genuine join — and the
 *                              table id and the host's seat must survive it
 *
 * The v3.14.x hole was in the UPDATE branch: it accepted
 * `newData.child('hostId').val() === auth.uid`, so a write that named you host
 * passed the check that decides whether you may write. Here that clause exists
 * only in CREATE, where `data` does not exist and there is nothing to steal.
 */
export function composeLobbyWrite(p = LOBBY_PIECES) {
    return `${p.signedIn} && (!data.exists() ? (${p.creatorIsHost} && ${p.newHostSeated}) : ` +
        `(!newData.exists() ? (${p.isHost} || ${p.isSeated}) : ` +
        `((${p.isHost} || ${p.isSeated} || (${p.tableWaiting} && ${p.addsSelf})) && ` +
        `${p.keepsTableId} && ${p.newHostSeated})))`;
}

// ─── gameRooms (v3.19.0, council ERS-20) ────────────────────────────────────
// The room rule was `signedIn && (creating || seated)` and stays exactly that
// for an ordinary table. A room with a god adds one condition: the writer has
// registered the room protocol that knows about ghost cards
// (public/js/roomProtocol.js). An older tab never registers it, so it cannot
// hand ghosts to a person or count them toward the 52.

export const GAMEROOM_PIECES = Object.freeze({
    /** There is a signed-in user at all. */
    signedIn: "auth != null",
    /** The room is being dealt. */
    creating: "!data.exists()",
    /** You hold a seat in the room — read from data, never newData. */
    isSeated: "data.child('playerIds').child(auth.uid).exists()",
    /** The room has a god, before or after this write. */
    godRoom: "(data.child('god').exists() || newData.child('god').exists())",
    /** The writer's client speaks the ghost-card protocol. */
    speaksProtocol: `root.child('clientVersions').child(auth.uid).val() >= ${ROOM_PROTOCOL}`
});

export function composeGameRoomWrite(p = GAMEROOM_PIECES) {
    return `${p.signedIn} && (${p.creating} || ${p.isSeated}) && (!${p.godRoom} || ${p.speaksProtocol})`;
}

// ─── admin read of game rooms (v3.22.2, approved by the owner) ─────────────
// The admin page shows each live room's state and a feed of what happens in
// it (won, disconnected, slapped). READ ONLY and gameRooms ONLY: no rule here
// lets an admin write anything. An admin is `admins/{uid} === true`, set by
// hand in the Firebase console — `admins` has no client write rule at all.
export const ADMIN_ROOMS_READ = "auth != null && root.child('admins').child(auth.uid).val() === true";

/** Each admin may read their own flag (so the page knows); nobody may write one. */
export const ADMINS_RULES = Object.freeze({
    $uid: {
        '.read': 'auth != null && auth.uid === $uid',
        '.write': false
    }
});

/** Where each user states the protocol their client speaks. Theirs only. */
export const CLIENT_VERSIONS_RULES = Object.freeze({
    $uid: {
        '.read': 'auth != null && auth.uid === $uid',
        '.write': 'auth != null && auth.uid === $uid',
        '.validate': 'newData.isNumber()'
    }
});

// ─── admin cleanup + online list (v3.22.3, council ERS-30) ─────────────────
// Tables and rooms are tidied by the players' own browsers — the host deletes
// both 5 s after a match ends. When every browser is gone first (tab closed,
// connection lost) nothing ever tidies them. There is no server code, so the
// admin page can close them, and the rules below are what keep that from
// becoming "an admin can stop any game": a delete is allowed only when the
// server's own data says the thing is already dead.
//
// Each piece is one sentence; a mutant is one piece swapped for `true`.
export const ROOM_STALE_MS = 15 * 60 * 1000;   // a live room moves every <= 15 s (turn timeout)

const staleRoom = (r) => `(${r}.child('gameOver').val() === true || (${r}.child('lastPlayTime').isNumber() && ${r}.child('lastPlayTime').val() < now - ${ROOM_STALE_MS}))`;
const linkedRoom = "root.child('gameRooms').child(data.child('gameState').child('roomId').val())";

export const CLEANUP_PIECES = Object.freeze({
    /** The writer is an admin: admins/{uid} is exactly true. */
    isAdmin: ADMIN_ROOMS_READ,
    /** The write removes the node; an admin never edits one. */
    deletes: '!newData.exists()',
    /** The room is over, or nobody has moved in it for 15 minutes. */
    roomDead: staleRoom('data'),
    /** The table's room is gone or dead. */
    linkedRoomDead: `(!${linkedRoom}.exists() || ${staleRoom(linkedRoom)})`,
    /** A table that is not mid-match needs its host to be disconnected (online/{host} empty). */
    hostGone: "(data.child('gameState').child('status').val() === 'playing' || !root.child('online').child(data.child('hostId').val()).exists())"
});

export function composeAdminRoomDelete(p = CLEANUP_PIECES) {
    return `${p.isAdmin} && ${p.deletes} && ${p.roomDead}`;
}
export function composeAdminLobbyDelete(p = CLEANUP_PIECES) {
    return `${p.isAdmin} && ${p.deletes} && (data.child('gameState').child('roomId').isString() ? ${p.linkedRoomDead} : true) && ${p.hostGone}`;
}

/** What database.rules.json carries: the player rule, or an admin closing a dead one. */
export function composeLobbyWriteFull() {
    return `(${composeLobbyWrite()}) || (${composeAdminLobbyDelete()})`;
}
export function composeGameRoomWriteFull() {
    return `(${composeGameRoomWrite()}) || (${composeAdminRoomDelete()})`;
}

/**
 * online/{uid}/{connectionId} = server time, removed by the server when that
 * connection drops. One entry per open tab, so closing a second tab never
 * marks a player offline. Deliberately NOT presence/{uid}: tableManager drops
 * a seated player whose presence reads "offline", and that must stay tied to
 * joining a table.
 */
export const ONLINE_RULES = Object.freeze({
    '.read': ADMIN_ROOMS_READ,
    $uid: {
        $conn: {
            '.write': 'auth != null && auth.uid === $uid && $conn.matches(/^[-0-9A-Za-z_]{20}$/)',
            '.validate': 'newData.isNumber() && newData.val() <= now'
        }
    }
});
