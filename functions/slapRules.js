/**
 * functions/slapRules.js — SERVER-SIDE COPY of public/js/slapRules.js.
 *
 * ⚠️ THIS FILE MUST BE MANUALLY KEPT IN SYNC WITH public/js/slapRules.js. ⚠️
 *
 * Firebase Cloud Functions deploy the functions/ directory in isolation — it
 * cannot import a file that lives outside functions/ at deploy time. So this
 * is a deliberate, manual duplicate, not a shared module. If you ever change
 * a slap rule in public/js/slapRules.js, you MUST make the identical change
 * here, or offline play and multiplayer will apply different rules.
 *
 * (This is the real, hard tradeoff of Firebase's deploy model — CLAUDE.md
 * §6.21 covers it. A build step that copies this automatically is possible
 * but was deliberately not added here, since this project has a stated
 * zero-build-step philosophy for the client; adding one just for functions/
 * is a reasonable future improvement, not done in this pass.)
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
