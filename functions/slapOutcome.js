/**
 * functions/slapOutcome.js — SERVER-SIDE MIRROR of public/js/slapOutcome.js.
 *
 * ⚠️ EVERYTHING BELOW THE END OF THIS COMMENT IS BYTE-FOR-BYTE IDENTICAL to
 *    public/js/slapOutcome.js, and `test_gameLogic.mjs` FAILS THE BUILD if it
 *    ever stops being. Do not hand-edit this file: change the client copy and
 *    re-run `node tools/sync-rules.mjs`.
 */


export const EMPTY_CHALLENGE = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };

/**
 * The room protocol this client speaks. v3.19.0 (ghost cards) is protocol 2:
 * a pile is handed over only through `awardPile`, which drops ghosts and
 * stamps the winner. `database.rules.json` refuses a write to a room with a
 * god from any user who has not registered protocol 2 or later under
 * `clientVersions/{uid}` — an older tab would hand ghosts to a person and
 * count them toward the 52 (council ERS-20, condition 1).
 */
export const ROOM_PROTOCOL = 2;

// ── Ghost cards (v3.19.0, the Table of the Gods) ────────────────────────────
// Defined HERE, not in ghostCards.js, because this module must stay free of
// imports (it is mirrored into functions/). ghostCards.js re-exports them, so
// there is one definition.

/** True for a ghost card. Tolerates anything a hand might hold. */
export function isGhost(card) {
    return !!(card && typeof card === 'object' && card.ghost === true);
}

/** How many real (non-ghost) cards a hand or pile holds. */
export function realCount(cards) {
    let n = 0;
    for (const c of cards || []) if (!isGhost(c)) n++;
    return n;
}

/** Splits cards being handed to a winner: the real ones stay, ghosts vanish. */
export function vaporize(cards) {
    const kept = [];
    let vanished = 0;
    for (const c of cards || []) {
        if (isGhost(c)) vanished++;
        else kept.push(c);
    }
    return { kept, vanished };
}

/**
 * THE one way a pile reaches a seat in a multiplayer room.
 *
 * Burn pile then played pile go under the winner's hand, real cards only:
 * ghosts vaporize. A seat left holding nothing but ghosts is out of cards —
 * ghosts never keep a seat in the match. The room is stamped with who won
 * and how many ghosts vanished, so clients read the winner instead of
 * inferring it from card counts (a vaporized ghost, or clones reaching the
 * god in the same write, would make that guess name the wrong seat).
 *
 * Mutates `players` (the caller's working copy) and `data`. Returns the
 * number of ghosts that vanished.
 */
export function awardPile(data, players, winnerId) {
    const { kept, vanished } = vaporize([...(data.burnPile || []), ...(data.pile || [])]);
    const winner = players[winnerId];
    const wasEliminated = !!winner.eliminated;
    const hand = winner.cards || [];
    hand.push(...kept);
    winner.cards = hand;
    // v3.19.1 — a seat that takes a pile is back in, on EVERY award path, not
    // only a slap. Found by tools/fuzz-pantheon.mjs: an attacker plays its last
    // card (a face card), slaps wrong with an empty hand (dead slap: out), then
    // wins the challenge — and sat on 7 cards, eliminated, holding the turn.
    // Every write refused it and the table froze. A pile of ghosts only brings
    // nothing, so it brings nobody back either.
    if (hand.length > 0) winner.eliminated = false;
    data.lastResurrectedId = wasEliminated && hand.length > 0 ? winnerId : null;
    let gone = vanished;
    for (const p of players) {
        if (p && Array.isArray(p.cards) && p.cards.length > 0 && realCount(p.cards) === 0) {
            gone += p.cards.length;
            p.cards = [];
        }
    }
    data.pile = [];
    data.burnPile = [];
    data.lastPile = { winner: winnerId, vanished: gone, seq: ((data.lastPile && data.lastPile.seq) || 0) + 1 };
    return gone;
}

/**
 * Who leads after a pile is won: the winner — unless the pile left it nothing
 * to lead with (a pile of ghosts only), in which case the next seat that can.
 */
export function leaderAfterAward(players, winnerId) {
    return (players[winnerId].cards || []).length > 0 ? winnerId : getNextPlayer(players, winnerId);
}

/**
 * A challenge is won: the attacker takes the table. THE one copy (v3.19.1).
 * firebaseSync.js carried three hand-written ones (defender out of cards,
 * chances spent, defender timed out) and the burn branch below a fourth; they
 * had drifted — the timeout copy never checked for the end of the match and
 * none of them brought an eliminated attacker back in.
 */
export function awardChallenge(data, players, winnerId) {
    awardPile(data, players, winnerId);
    players.forEach((p, i) => {
        if (i === winnerId) p.streak = p.streak || 0;
        else if (p.streak < 3) p.streak = 0;
    });
    players.forEach((p, i) => {
        if (i !== winnerId && (!p.cards || p.cards.length === 0)) p.eliminated = true;
    });
    data.players = players;
    data.challenge = { ...EMPTY_CHALLENGE };
    data.activePlayerId = leaderAfterAward(players, winnerId);
    data.lastWinReason = 'challenge';
    resolveEndOfMatch(data, players, winnerId, realCount(players[winnerId].cards) === 52);
    migrateHostIfNeeded(data, players);
    return data;
}

/** After a card leaves a hand: a hand of ghosts only is empty. Returns how many vanished. */
export function dropHollowHand(p) {
    if (!p || !Array.isArray(p.cards) || p.cards.length === 0 || realCount(p.cards) > 0) return 0;
    const n = p.cards.length;
    p.cards = [];
    return n;
}

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
 * order, onto the BOTTOM of their hand (through `awardPile`: real cards only).
 */
export function applySlapWin(data, seatIndex) {
    const players = [...data.players];

    const winnerId = seatIndex;
    // Whether the seat was out, and whether taking this pile brought it back,
    // is decided (and stamped as lastResurrectedId) inside awardPile.
    awardPile(data, players, winnerId);
    const playerCards = players[winnerId].cards;

    // SLAP BACK IN. The rules panel has promised it in four languages since
    // long before any code could do it; the flag is cleared in awardPile (the
    // v3.19.1 move: it used to be cleared here only, so a pile won by
    // CHALLENGE left an eliminated seat eliminated with cards in hand).

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
    data.activePlayerId = leaderAfterAward(players, winnerId);
    data.challenge = { ...EMPTY_CHALLENGE };
    data.lastWinReason = 'slap';

    resolveEndOfMatch(data, players, winnerId, realCount(playerCards) === 52);
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
        // Burning the last REAL card leaves a hand of ghosts: that is no hand.
        dropHollowHand(players[burnerId]);
        p.streak = 0;
        data.players = players;
        data.burnPile = currentBurnPile;

        if (players[burnerId].cards.length === 0) {
            const challenge = data.challenge || { ...EMPTY_CHALLENGE };
            if (challenge.active && challenge.defenderId === burnerId) {
                // Burning the last card mid-challenge hands the pile to the attacker.
                awardChallenge(data, players, challenge.attackerId);
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
