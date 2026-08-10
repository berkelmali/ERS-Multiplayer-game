/**
 * functions/index.js — Server-authoritative slap/play validation, thin wrapper.
 *
 * ⚠️ READ CLAUDE.md §6.21 BEFORE DEPLOYING THIS. ⚠️
 * The game-transition logic itself (functions/gameLogic.js) is unit-tested —
 * see the test results in CLAUDE.md §6.21 for exactly what was and wasn't
 * verified. This file's OWN job (auth extraction, roomId validation, wiring
 * into a real RTDB transaction) has NOT been run against a live Firebase
 * project or the emulator suite — no network access in the environment that
 * wrote it. Test with `firebase emulators:start` before trusting this with
 * real players.
 *
 * WHAT THIS FIXES: the client's current pushSlapAttempt/pushPlayCard trust
 * whatever `playerIndex` the caller passes — no check that the calling user
 * actually owns that seat. A modified client (or a raw DevTools call) could
 * act as ANY seat, including another real player's — this was true even
 * before considering pattern-validity forgery. Both functions below derive
 * the acting seat from the caller's verified Firebase Auth UID instead of
 * trusting a client-supplied index — see gameLogic.js::resolveActingSeat().
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { applySlapAttempt, applyPlayCard } from "./gameLogic.js";

admin.initializeApp();

// RTDB keys can't contain . # $ [ ] or /, but we validate defensively here
// rather than trust the client — a roomId containing '/' could otherwise let
// a caller's ref() point at an unrelated path under gameRooms/.
const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function assertValidRoomId(roomId) {
    if (typeof roomId !== "string" || !ROOM_ID_PATTERN.test(roomId)) {
        throw new HttpsError("invalid-argument", "Malformed roomId.");
    }
}

export const attemptSlap = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
    const { roomId, actingForBotSeat } = request.data || {};
    if (!roomId) throw new HttpsError("invalid-argument", "roomId is required.");
    assertValidRoomId(roomId);

    const roomRef = admin.database().ref(`gameRooms/${roomId}`);
    const result = await roomRef.transaction((data) =>
        applySlapAttempt(data, request.auth.uid, actingForBotSeat)
    );

    return { committed: result.committed };
});

export const attemptPlayCard = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
    const { roomId, actingForBotSeat } = request.data || {};
    if (!roomId) throw new HttpsError("invalid-argument", "roomId is required.");
    assertValidRoomId(roomId);

    const roomRef = admin.database().ref(`gameRooms/${roomId}`);
    const result = await roomRef.transaction((data) =>
        applyPlayCard(data, request.auth.uid, actingForBotSeat)
    );

    return { committed: result.committed };
});
