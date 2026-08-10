/**
 * slapRules.js — Single-source-of-truth for ERS slap evaluation.
 *
 * IMPORTANT: This is the ONLY place slap rules should be defined.
 * Both game.js (offline) and firebaseSync.js (multiplayer transactions) must
 * import from here. Never duplicate this logic elsewhere.
 *
 * evaluateSlap(pile) returns the matching rule label string, or false.
 * Labels: 'doubles' | 'tens' | 'marriage' | 'sandwich' | false
 */

export const SLAP_RULES = {
    doubles: (pile) =>
        pile.length >= 2 &&
        pile[pile.length - 1].rank === pile[pile.length - 2].rank,

    tens: (pile) =>
        pile.length >= 2 &&
        pile[pile.length - 1].rank <= 10 &&
        pile[pile.length - 2].rank <= 10 &&
        pile[pile.length - 1].rank + pile[pile.length - 2].rank === 10,

    marriage: (pile) =>
        pile.length >= 2 &&
        ((pile[pile.length - 1].rank === 12 && pile[pile.length - 2].rank === 13) ||
         (pile[pile.length - 1].rank === 13 && pile[pile.length - 2].rank === 12)),

    sandwich: (pile) =>
        pile.length >= 3 &&
        pile[pile.length - 1].rank === pile[pile.length - 3].rank,
};

/**
 * Evaluates whether the current pile is a valid slap.
 * @param {Array} pile - Array of card objects with .rank and .suit
 * @returns {string|false} Rule label if valid, false otherwise
 */
export function evaluateSlap(pile) {
    if (!pile || pile.length < 2) return false;
    for (const [label, fn] of Object.entries(SLAP_RULES)) {
        if (fn(pile)) return label;
    }
    return false;
}

/**
 * Returns matching card indices for highlight animation.
 * Only used by game.js (offline UI). Not needed in firebaseSync transactions.
 * @param {Array} pile
 * @param {string} label - result from evaluateSlap()
 * @returns {number[]} pile indices that triggered the slap
 */
export function getSlapIndices(pile, label) {
    const len = pile.length;
    switch (label) {
        case 'doubles':
        case 'tens':
        case 'marriage':
            return [len - 1, len - 2];
        case 'sandwich':
            return [len - 1, len - 3];
        default:
            return [];
    }
}
