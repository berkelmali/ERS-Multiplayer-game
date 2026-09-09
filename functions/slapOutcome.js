/**
 * functions/slapOutcome.js — SERVER-SIDE MIRROR of public/js/slapOutcome.js.
 *
 * ⚠️ EVERYTHING BELOW THE END OF THIS COMMENT IS BYTE-FOR-BYTE IDENTICAL to
 *    public/js/slapOutcome.js, and `test_gameLogic.mjs` FAILS THE BUILD if it
 *    ever stops being. Do not hand-edit this file: change the client copy and
 *    re-run `node tools/sync-rules.mjs`.
 */


export const EMPTY_CHALLENGE = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };

/** The next seat that can actually act: has cards and is not eliminated. */
export function getNextPlayer(players, currentId) {
    let next = (currentId + 1) % 4;
    let count = 0;
    while ((!players[next].cards || players[next].cards.length === 0 || players[next].eliminated) && count < 4) {
        next = (next + 1) % 4;
        count++;
    }
    return count < 4 ? next : null;
}

/** A bot seat is any uid prefixed `bot_`. The single definition of "is a bot". */
export function isBotSeat(p) {
    return !!(p && typeof p.uid === 'string' && p.uid.startsWith('bot_'));
}

/**
 * Real people still in the match — not bots, not eliminated.
 *
 * The live transaction already computed this, as `humansLeft`, right next to a
 * comment reading "End if 1 left OR no HUMANS left" — and then never read the
 * variable. The rule was written down and not applied. Naming and exporting it
 * lets the win condition state its own rule instead of describing one.
 */
export function countLiveHumans(players) {
    return (players || []).filter(p => p && !isBotSeat(p) && !p.eliminated).length;
}

/** Hand the room to a live human if the current host can no longer hold it. */
export function migrateHostIfNeeded(data, players) {
    const currentHost = players.find(p => p.uid === data.hostId);
    if (!currentHost || currentHost.eliminated || currentHost.status === 'disconnected') {
        const nextHost = players.find(p => !isBotSeat(p) && !p.eliminated && p.status !== 'disconnected');
        if (nextHost) {
            data.hostId = nextHost.uid;
            data.hostUsername = nextHost.name;
        }
    }
}

/**
 * A valid slap: the winner takes the burn pile and the played pile, in that
 * order, onto the BOTTOM of their hand.
 */
export function applySlapWin(data, seatIndex) {
    const pile = data.pile || [];
    const burnPile = data.burnPile || [];
    const players = [...data.players];

    const winnerId = seatIndex;
    const playerCards = players[winnerId].cards || [];
    // Recorded BEFORE the pile lands, because after it lands the seat has cards
    // and there is no way left to tell that it was out.
    const wasEliminated = !!players[winnerId].eliminated;
    playerCards.push(...burnPile, ...pile);
    players[winnerId].cards = playerCards;

    // SLAP BACK IN. The rules panel has promised this in four languages since
    // long before any code could do it: "You can still slap the pile even with
    // 0 cards — a successful slap resurrects you with the pile!" and a whole
    // section headed "Spectator Mode & Slap Back".
    //
    // Three modules were already written for the moment: victoryScreen.js tears
    // down the defeat screen on `resurrected`, ui.js announces it, and
    // multiplayerMode.js counts it. The victory screen even shows a "Slap
    // Backs" statistic and awards an MVP badge for two or more. Nothing
    // anywhere emitted the event, and nothing anywhere cleared this flag — so
    // the statistic was pinned at zero by construction and the badge could
    // never be awarded.
    //
    // This is the exact inverse of the rule six lines below it, which puts a
    // seat OUT when it holds nothing. A seat that just took the pile holds
    // something. One line, in the one place both halves of the rule belong.
    players[winnerId].eliminated = false;

    // Streaks: the winner renews at the shield cap rather than climbing past
    // it; everyone below the cap resets, and anyone AT the cap keeps their
    // shield even though they did not win this pile.
    players.forEach((p, i) => {
        if (i === winnerId) {
            p.streak = p.streak >= 3 ? 3 : (p.streak || 0) + 1;
        } else if (p.streak < 3) {
            p.streak = 0;
        }
    });

    // Anyone left holding nothing is out.
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
    data.lastWinReason = 'slap';
    // Written into the room so every client learns about it from the same
    // transaction that caused it, rather than each one guessing from a diff.
    // Cleared on every other win, or the banner would fire again next pile.
    data.lastResurrectedId = wasEliminated ? winnerId : null;

    resolveEndOfMatch(data, players, winnerId, playerCards.length === 52);
    migrateHostIfNeeded(data, players);
    return data;
}

/**
 * An invalid slap. Three outcomes, in priority order:
 *   1. a live shield absorbs it and shatters,
 *   2. otherwise a card burns off the top of the hand,
 *   3. and if there was no card to burn, the seat is out.
 */
export function applySlapBurn(data, seatIndex, now) {
    const stamp = typeof now === 'number' ? now : Date.now();
    const players = [...data.players];
    const burnerId = seatIndex;
    const p = players[burnerId];

    if (p.streak && p.streak >= 3) {
        p.streak = 0;
        data.players = players;
        data.lastShieldShatterId = burnerId;
        data.lastShieldShatterTime = stamp;
        return data;
    }

    if (p.cards && p.cards.length > 0) {
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
                // Burning the last card mid-challenge hands the pile to the attacker.
                const winnerId = challenge.attackerId;
                players[winnerId].cards = players[winnerId].cards || [];
                players[winnerId].cards.push(...currentBurnPile, ...(data.pile || []));

                players.forEach((px, i) => {
                    if (i === winnerId) px.streak = px.streak || 0;
                    else if (px.streak < 3) px.streak = 0;
                });
                players.forEach((px, i) => {
                    if (i !== winnerId && (!px.cards || px.cards.length === 0)) px.eliminated = true;
                });

                data.pile = [];
                data.burnPile = [];
                data.players = players;
                data.challenge = { ...EMPTY_CHALLENGE };
                data.activePlayerId = winnerId;
                data.lastWinReason = 'challenge';

                resolveEndOfMatch(data, players, winnerId, players[winnerId].cards.length === 52);
            } else if (data.activePlayerId === burnerId) {
                data.activePlayerId = getNextPlayer(players, burnerId);
                data.challenge = { ...EMPTY_CHALLENGE };
            }
        }
        return data;
    }

    // Dead slap: no cards left and the slap was wrong.
    p.eliminated = true;
    p.streak = 0;
    data.players = players;

    if (!resolveEndOfMatch(data, players, -1, false) && data.activePlayerId === burnerId) {
        data.activePlayerId = getNextPlayer(players, burnerId);
        data.challenge = { ...EMPTY_CHALLENGE };
    }

    migrateHostIfNeeded(data, players);
    return data;
}

/**
 * The single place that decides a match is over, and who won.
 *
 * Ends on any of: one seat holds all 52 cards; one seat is left standing; or no
 * live humans remain. The third arrived in v3.7.4, after the extraction had
 * been proven behaviour-identical — deliberately not smuggled in under the
 * refactor, because a rule change hidden inside a "no behaviour change" commit
 * is unreviewable.
 *
 * When the match ends with nobody left to play for, there is no winner
 * (`winnerId = -1`) rather than a bot being crowned.
 *
 * @returns {boolean} true if the match ended here.
 */
export function resolveEndOfMatch(data, players, winnerId, tookWholeDeck) {
    const nonEliminated = players.filter(p => !p.eliminated);

    // Three ways a match ends. The third is new in v3.7.4 and is the rule the
    // live copy described in a comment and never applied: once no real person
    // is still in it, a table of bots playing on is not a match anybody is in.
    // `convertToBot` rewrites a departed player's uid to `bot_`, so a room the
    // humans left becomes all bots, and before this it could reach no terminal
    // condition at all.
    //
    // Scope, stated honestly: this ends the match at the next slap outcome, so
    // it catches the case that actually strands people — the last human is
    // ELIMINATED while bots keep playing. A room abandoned with no slap in
    // flight is not swept by this; nothing calls into here, because with no
    // human client left nothing drives the bots either. That room is inert
    // rather than finished, and reaping it belongs to `convertToBot` or a
    // server-side sweep, not to the slap outcome.
    //
    // Multiplayer only, by construction: `firebaseSync.js` is the sole importer
    // (single player runs `game.js`, which has its own end conditions), which is
    // what keeps this from ending a solo practice match the moment the player
    // is eliminated.
    const lastOneStanding = nonEliminated.length <= 1;
    const nobodyLeftToPlayFor = countLiveHumans(players) === 0;

    if (!tookWholeDeck && !lastOneStanding && !nobodyLeftToPlayFor) return false;

    data.gameOver = true;
    data.status = 'finished';

    if (nonEliminated.length === 1) {
        data.winnerId = players.findIndex(p => !p.eliminated);
    } else if (tookWholeDeck && winnerId >= 0) {
        data.winnerId = winnerId;
    } else {
        data.winnerId = -1;
    }
    return true;
}
