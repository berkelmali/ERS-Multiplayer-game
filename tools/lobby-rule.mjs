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

/** Where each user states the protocol their client speaks. Theirs only. */
export const CLIENT_VERSIONS_RULES = Object.freeze({
    $uid: {
        '.read': 'auth != null && auth.uid === $uid',
        '.write': 'auth != null && auth.uid === $uid',
        '.validate': 'newData.isNumber()'
    }
});
