/**
 * functions/gameLogic.js — pure state-transition logic for attemptSlap/attemptPlayCard.
 *
 * Deliberately has ZERO Firebase SDK dependency — every function here takes a
 * plain `data` object and returns a new one (or `undefined` to signal "abort,
 * no change"). This is what makes it possible to unit-test this logic with
 * plain `node`, without firebase-admin/firebase-functions installed and
 * without a live project. index.js is a thin wrapper that connects this to
 * onCall + a real RTDB transaction.
 */

import { evaluateSlap, keyToRules } from "./slapRules.js";
import { EMPTY_CHALLENGE, getNextPlayer, migrateHostIfNeeded,
         applySlapWin, applySlapBurn } from "./slapOutcome.js";

export const FACE_CHANCES = { 11: 1, 12: 2, 13: 3, 14: 4 };
// Re-exported from the shared outcome module so this file stays the single
// import surface for functions/index.js and the test suite.
export { EMPTY_CHALLENGE, getNextPlayer, migrateHostIfNeeded };

/**
 * Resolves which seat the calling user is actually allowed to act for.
 * - Real player acting for themselves: players[i].uid === callerUid.
 * - Host simulating a bot seat: players[botSeat].uid starts with 'bot_' AND
 *   room.hostId === callerUid (mirrors the client-side `amIHost` gate in
 *   multiplayerMode.js — previously just a client convenience, not enforced;
 *   this makes it a real boundary).
 * Returns a player index (0-3), or null if unauthorized for the requested seat.
 */
export function resolveActingSeat(room, callerUid, actingForBotSeat) {
    if (actingForBotSeat === undefined || actingForBotSeat === null) {
        const idx = room.players.findIndex((p) => p.uid === callerUid);
        return idx === -1 ? null : idx;
    }
    const seat = room.players[actingForBotSeat];
    if (!seat || !seat.uid || !seat.uid.startsWith("bot_")) return null;
    if (room.hostId !== callerUid) return null;
    return actingForBotSeat;
}



/**
 * The Cloud Function's slap entry point: authority, then rules, then outcome.
 *
 * This used to be a hand-written "faithful port" of firebaseSync.js's
 * transaction body — two copies of the game's most consequential logic kept in
 * agreement by that sentence in a comment, with every test pointing at THIS one
 * while `USE_SERVER_VALIDATION: false` meant the OTHER one was what ran. The
 * outcome now lives in slapOutcome.js and both callers delegate to it, so the
 * tested code and the live code are the same code.
 *
 * What stays here is what genuinely differs between the two callers: this one
 * must establish WHO is allowed to act (resolveActingSeat), because it is
 * reachable by any signed-in client.
 *
 * @returns {object|undefined} new data, or undefined to abort (no write).
 */
export function applySlapAttempt(data, callerUid, actingForBotSeat) {
    if (!data || data.gameOver) return;
    if (!data.players) return;

    const playerIndex = resolveActingSeat(data, callerUid, actingForBotSeat);
    if (playerIndex === null) return;
    if (data.players[playerIndex].eliminated) return;

    const pile = data.pile || [];
    const burnPile = data.burnPile || [];
    // v3.0.0: the room carries its own House Rules (`gameRooms/{id}/houseRules`,
    // written once by the host at deal time). The server must judge by the
    // TABLE's rules, not by the classic default, or a table playing with Tens
    // switched off would have its slaps validated differently here than on the
    // clients. Missing/empty falls back to the classic set.
    const rules = keyToRules(data.houseRules || '');
    const isValid = evaluateSlap(pile, rules) !== false;

    if (isValid) {
        applySlapWin(data, playerIndex);
    } else {
        applySlapBurn(data, playerIndex);
    }
    return data;
}

/**
 * Faithful port of firebaseSync.js::pushPlayCard's transaction body.
 * @returns {object|undefined} new data, or undefined to abort (no write).
 */
export function applyPlayCard(data, callerUid, actingForBotSeat) {
    if (!data || data.gameOver || !data.gameStarted) return;
    if (!data.players) return;

    const playerIndex = resolveActingSeat(data, callerUid, actingForBotSeat);
    if (playerIndex === null) return;
    if (data.activePlayerId !== playerIndex) return;
    if (data.players[playerIndex].eliminated) return;

    const players = [...data.players];
    let challenge = data.challenge || { ...EMPTY_CHALLENGE };

    if (!players[playerIndex].cards || players[playerIndex].cards.length === 0) {
        if (challenge.active && challenge.defenderId === playerIndex) {
            const winnerId = challenge.attackerId;
            const currentBurnPile = data.burnPile || [];
            const pile = data.pile || [];
            players[winnerId].cards = players[winnerId].cards || [];
            players[winnerId].cards.push(...currentBurnPile, ...pile);

            players.forEach((p, i) => {
                if (i === winnerId) {
                    p.streak = p.streak || 0;
                } else if (p.streak < 3) {
                    p.streak = 0;
                }
            });
            players.forEach((p, i) => {
                if (i !== winnerId && (!p.cards || p.cards.length === 0)) {
                    p.eliminated = true;
                }
            });

            data.pile = [];
            data.burnPile = [];
            data.players = players;
            data.challenge = { ...EMPTY_CHALLENGE };
            data.activePlayerId = winnerId;
            data.lastWinReason = "challenge";

            const nonEliminated = players.filter((p) => !p.eliminated);
            if (players[winnerId].cards.length === 52 || nonEliminated.length <= 1) {
                data.gameOver = true;
                data.status = "finished";
                data.winnerId = nonEliminated.length === 1
                    ? players.findIndex((p) => !p.eliminated)
                    : winnerId;
            }
        }
        return data;
    }

    const pile = data.pile || [];
    const card = players[playerIndex].cards.shift();
    pile.push(card);

    const isFaceCard = card.rank >= 11;
    let nextActiveId = playerIndex;

    if (challenge.active) {
        if (isFaceCard) {
            challenge.attackerId = playerIndex;
            challenge.defenderId = getNextPlayer(players, playerIndex);
            challenge.chancesLeft = FACE_CHANCES[card.rank];
            nextActiveId = challenge.defenderId;
        } else {
            challenge.chancesLeft = (challenge.chancesLeft || 1) - 1;
            if (challenge.chancesLeft <= 0 || players[playerIndex].cards.length === 0) {
                const winnerId = challenge.attackerId;
                const currentBurnPile = data.burnPile || [];
                players[winnerId].cards.push(...currentBurnPile, ...pile);

                players.forEach((p, i) => {
                    if (i === winnerId) {
                        p.streak = p.streak || 0;
                    } else if (p.streak < 3) {
                        p.streak = 0;
                    }
                });
                players.forEach((p, i) => {
                    if (i !== winnerId && (!p.cards || p.cards.length === 0)) {
                        p.eliminated = true;
                    }
                });

                data.pile = [];
                data.burnPile = [];
                data.players = players;
                data.challenge = { ...EMPTY_CHALLENGE };
                data.activePlayerId = winnerId;
                data.lastWinReason = "challenge";

                const nonEliminated = players.filter((p) => !p.eliminated);
                if (players[winnerId].cards.length === 52 || nonEliminated.length <= 1) {
                    data.gameOver = true;
                    data.status = "finished";
                    if (nonEliminated.length === 1) {
                        data.winnerId = players.findIndex((p) => !p.eliminated);
                    } else if (players[winnerId].cards.length === 52) {
                        data.winnerId = winnerId;
                    } else {
                        data.winnerId = -1;
                    }
                }

                migrateHostIfNeeded(data, players);
                return data;
            }
            nextActiveId = playerIndex;
        }
    } else if (isFaceCard) {
        challenge.active = true;
        challenge.attackerId = playerIndex;
        challenge.defenderId = getNextPlayer(players, playerIndex);
        challenge.chancesLeft = FACE_CHANCES[card.rank];
        nextActiveId = challenge.defenderId;
    } else {
        nextActiveId = getNextPlayer(players, playerIndex);
    }

    data.players = players;
    data.pile = pile;
    data.activePlayerId = nextActiveId;

    if (nextActiveId === null && !data.gameOver) {
        data.gameOver = true;
        data.status = "finished";
        data.winnerId = -1;
    }

    data.challenge = challenge;
    data.lastPlayTime = Date.now();
    return data;
}
