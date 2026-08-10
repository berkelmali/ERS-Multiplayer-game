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

import { evaluateSlap } from "./slapRules.js";

export const FACE_CHANCES = { 11: 1, 12: 2, 13: 3, 14: 4 };
export const EMPTY_CHALLENGE = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };

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

export function getNextPlayer(players, currentId) {
    let next = (currentId + 1) % 4;
    let count = 0;
    while ((!players[next].cards || players[next].cards.length === 0 || players[next].eliminated) && count < 4) {
        next = (next + 1) % 4;
        count++;
    }
    return count < 4 ? next : null;
}

export function migrateHostIfNeeded(data, players) {
    const currentHost = players.find((p) => p.uid === data.hostId);
    if (!currentHost || currentHost.eliminated || currentHost.status === "disconnected") {
        const nextHost = players.find((p) => !p.uid.startsWith("bot_") && !p.eliminated && p.status !== "disconnected");
        if (nextHost) {
            data.hostId = nextHost.uid;
            data.hostUsername = nextHost.name;
        }
    }
}

/**
 * Faithful port of firebaseSync.js::pushSlapAttempt's transaction body.
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
    const isValid = evaluateSlap(pile) !== false;

    const players = [...data.players];
    if (isValid) {
        const winnerId = playerIndex;
        const playerCards = players[winnerId].cards || [];
        playerCards.push(...burnPile, ...pile);
        players[winnerId].cards = playerCards;

        players.forEach((p, i) => {
            if (i === winnerId) {
                p.streak = p.streak >= 3 ? 3 : (p.streak || 0) + 1;
            } else if (p.streak < 3) {
                p.streak = 0;
            }
        });

        players.forEach((p, i) => {
            if (i !== winnerId && (!p.cards || p.cards.length === 0)) {
                p.eliminated = true;
            }
        });

        data.players = players;
        data.pile = [];
        data.burnPile = [];
        data.activePlayerId = winnerId;
        data.challenge = { ...EMPTY_CHALLENGE };
        data.lastWinReason = "slap";

        const nonEliminated = players.filter((p) => !p.eliminated);
        if (playerCards.length === 52 || nonEliminated.length <= 1) {
            data.gameOver = true;
            data.status = "finished";
            if (nonEliminated.length === 1) {
                data.winnerId = players.findIndex((p) => !p.eliminated);
            } else if (playerCards.length === 52) {
                data.winnerId = winnerId;
            } else {
                data.winnerId = -1;
            }
        }

        migrateHostIfNeeded(data, players);
    } else {
        const burnerId = playerIndex;
        const p = players[burnerId];
        if (p.streak && p.streak >= 3) {
            p.streak = 0;
            data.players = players;
            data.lastShieldShatterId = burnerId;
            data.lastShieldShatterTime = Date.now();
        } else if (p.cards && p.cards.length > 0) {
            const cards = [...p.cards];
            const burned = cards.shift();
            const currentBurnPile = [...(data.burnPile || []), burned];

            players[burnerId].cards = cards;
            p.streak = 0;
            data.players = players;
            data.burnPile = currentBurnPile;

            if (cards.length === 0) {
                const challenge = data.challenge || { ...EMPTY_CHALLENGE };
                if (challenge.active && challenge.defenderId === burnerId) {
                    const winnerId = challenge.attackerId;
                    players[winnerId].cards = players[winnerId].cards || [];
                    players[winnerId].cards.push(...currentBurnPile, ...(data.pile || []));

                    players.forEach((px, i) => {
                        if (i === winnerId) {
                            px.streak = px.streak || 0;
                        } else if (px.streak < 3) {
                            px.streak = 0;
                        }
                    });
                    players.forEach((px, i) => {
                        if (i !== winnerId && (!px.cards || px.cards.length === 0)) {
                            px.eliminated = true;
                        }
                    });

                    data.pile = [];
                    data.burnPile = [];
                    data.players = players;
                    data.challenge = { ...EMPTY_CHALLENGE };
                    data.activePlayerId = winnerId;
                    data.lastWinReason = "challenge";

                    const nonEliminated = players.filter((px) => !px.eliminated);
                    if (players[winnerId].cards.length === 52 || nonEliminated.length <= 1) {
                        data.gameOver = true;
                        data.status = "finished";
                        data.winnerId = nonEliminated.length === 1
                            ? players.findIndex((px) => !px.eliminated)
                            : winnerId;
                    }
                } else if (data.activePlayerId === burnerId) {
                    const next = getNextPlayer(players, burnerId);
                    data.activePlayerId = next;
                    data.challenge = { ...EMPTY_CHALLENGE };
                }
            }
        } else {
            // Dead slap: 0 cards and failed slap = eliminated.
            p.eliminated = true;
            p.streak = 0;
            data.players = players;

            const nonEliminated = players.filter((px) => !px.eliminated);
            if (nonEliminated.length <= 1) {
                data.gameOver = true;
                data.status = "finished";
                data.winnerId = nonEliminated.length === 1
                    ? players.findIndex((px) => !px.eliminated)
                    : -1;
            } else if (data.activePlayerId === burnerId) {
                const next = getNextPlayer(players, burnerId);
                data.activePlayerId = next;
                data.challenge = { ...EMPTY_CHALLENGE };
            }

            migrateHostIfNeeded(data, players);
        }
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
