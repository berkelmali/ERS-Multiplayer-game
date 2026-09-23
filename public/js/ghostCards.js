/**
 * ghostCards.js — the Table of the Gods' ghost cards (v3.19.0).
 *
 * When your side of the table lands a slap on a god, the god keeps an echo of
 * the cards that hurt it: clones, marked `ghost: true`, laid on TOP of its
 * hand, so they come back at you at once. The god plays them like any card — they count for every
 * slap pattern and a ghost face card opens a challenge — but a ghost belongs
 * to no one. Whoever wins a pile that holds ghosts takes only the real cards;
 * the ghosts vaporize.
 *
 * So a ghost is a card the god can bet with and never lose. That is the whole
 * of the difficulty it adds: the god's real cards drain more slowly, and a
 * ghost face card can win it a real pile by challenge.
 *
 * Pure functions on plain arrays: the offline engine, the Pantheon, the RTDB
 * transaction and the balance simulation (tools/sim-pantheon.mjs) all call
 * these same ones. `isGhost`, `realCount` and `vaporize` live in
 * slapOutcome.js — that module must stay import-free because it is mirrored
 * into functions/ — and are re-exported here, so there is one definition.
 *
 * Invariants (pinned by the suite):
 *   - ghosts exist only in the god's hand, the pile and the burn pile; no
 *     other seat ever holds one, because every path that hands a pile to a
 *     seat drops them (game.js::winPile offline, slapOutcome.awardPile online);
 *   - a hand with no real card left is empty: ghosts never keep a seat in.
 *
 * Numbers and placement: council ERS-20 (COUNCIL-v3.19.0-ghosts.md). Top of
 * the hand, not the bottom — at the bottom most ghosts were never played
 * before the duel ended (Bastet 72%), so the effect asked for was invisible.
 */
import { isGhost, realCount, vaporize } from './slapOutcome.js';

export { isGhost, realCount, vaporize };

/** Clones from one slap: the pattern's cards, plus half of the rest. */
export const GHOST_PER_SLAP = 6;
/** The most ghosts a god can hold at once — a quarter of the deck. */
export const GHOST_HELD_MAX = 13;

/** How many ghosts a hand or pile holds. */
export function ghostCount(cards) {
    let n = 0;
    for (const c of cards || []) if (isGhost(c)) n++;
    return n;
}

/**
 * The clones a slap earns the god, in the order they go under its hand.
 *
 * `pile` is the pile as it stood when the slap landed; `indices` are the
 * pattern's positions in it (matchSlap's own). Only real cards are cloned —
 * an echo of an echo would let ghosts breed. The pattern's cards come first;
 * then half of the other real cards (rounded down), taken from the top of
 * the pile down, because those are the cards the table just saw. At most
 * `perSlap` in all.
 */
export function ghostClones(pile, indices, perSlap = GHOST_PER_SLAP) {
    const cards = Array.isArray(pile) ? pile : [];
    const inPattern = new Set((indices || []).filter(i => Number.isInteger(i) && i >= 0 && i < cards.length));
    const pattern = [];
    const rest = [];
    for (let i = cards.length - 1; i >= 0; i--) {
        const c = cards[i];
        if (!c || typeof c !== 'object' || isGhost(c)) continue;
        (inPattern.has(i) ? pattern : rest).push(c);
    }
    const chosen = [...pattern, ...rest.slice(0, Math.floor(rest.length / 2))];
    return chosen.slice(0, Math.max(0, perSlap)).map(c => ({ rank: c.rank, suit: c.suit, ghost: true }));
}

/**
 * Lays clones on `hand` (mutates it), up to the held limit — on top by
 * default (`hand[0]` is the next card played), or under it with 'bottom'
 * (kept for the simulation's comparison). A hand with no real card left gets
 * nothing: ghosts never bring a seat back into the match. Returns how many
 * were added.
 */
export function addGhosts(hand, clones, heldMax = GHOST_HELD_MAX, where = 'top') {
    if (!Array.isArray(hand) || realCount(hand) === 0) return 0;
    const room = Math.max(0, heldMax - ghostCount(hand));
    const add = (clones || []).slice(0, room);
    if (where === 'bottom') hand.push(...add);
    else hand.unshift(...add);
    return add.length;
}
