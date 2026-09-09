/**
 * ruleDoc.js — how a slap rule is DESCRIBED, as opposed to how it is evaluated.
 *
 * WHY IT EXISTS. `rulesBadge.js` will happily tell a player joining a table
 * "+ Top-Bottom", and until now the Rules page had no entry for Top-Bottom,
 * Triple or Four-in-a-Row. The game named a rule and then refused to define it.
 * The three opt-in rules were reachable from Settings, announced in the lobby,
 * enforced by the engine — and documented nowhere.
 *
 * WHY IT IS GENERATED RATHER THAN WRITTEN. `settings.js` already builds its rule
 * rows from `RULE_DEFS`, previews included, "so the settings screen can never
 * list a rule the engine does not have, or miss one it does". Hand-writing the
 * same three patterns into index.html would have created a second, drifting
 * description of the same registry — the mirror-drift class that `sync-rules.mjs`
 * and `check-score-bounds.mjs` exist to catch. Add a fourth opt-in rule tomorrow
 * and it appears on the Rules page by itself.
 *
 * WHAT IS STILL HAND-WRITTEN, said plainly: the explanatory sentence per rule,
 * per language. `RULE_DEFS` carries `id`, `preview`, `minPile` and `match` — no
 * prose. `check-locales.mjs` verifies those strings EXIST in all four languages;
 * nothing verifies they are correct. Generating the section prevents the card
 * previews and the list membership from drifting, and nothing more than that.
 *
 * Zero imports beyond the rule registry, so `node` can test it. The two card
 * formatters live here rather than in `game.js` for the same reason `botConfig.js`
 * was split out of `ai.js`: game.js re-exports them, so there is still exactly one
 * definition of what a "Q" or a "♠" looks like.
 */

import { RULE_DEFS } from './slapRules.js';

export function getRankName(rank) {
    if (rank <= 10) return rank.toString();
    if (rank === 11) return 'J';
    if (rank === 12) return 'Q';
    if (rank === 13) return 'K';
    if (rank === 14) return 'A';
}

export function getSuitSymbol(suit) {
    switch (suit) {
        case 'hearts': return '♥';
        case 'diamonds': return '♦';
        case 'clubs': return '♣';
        case 'spades': return '♠';
    }
}

export function isRedSuit(suit) {
    return suit === 'hearts' || suit === 'diamonds';
}

/**
 * One rule's preview as display-ready cards.
 *
 * `key: false` marks a card that is part of the SHAPE but not part of the match —
 * the filling in a Sandwich, the middle card in a Top-Bottom. The renderer dims
 * those, which is the whole reason the flag is carried through instead of being
 * flattened away here.
 *
 * @returns {Array<{label: string, symbol: string, red: boolean, key: boolean}>}
 */
export function ruleCards(def) {
    return (def && Array.isArray(def.preview) ? def.preview : []).map(c => ({
        label: getRankName(c.rank),
        symbol: getSuitSymbol(c.suit),
        red: isRedSuit(c.suit),
        key: c.key === true
    }));
}

/**
 * The opt-in rules, in registry order, ready to render.
 *
 * Order matters and is deliberately NOT sorted here: `RULE_DEFS` order is the
 * order `matchSlap` evaluates in, and the order Settings lists them in. Three
 * screens agreeing on one order is worth more than any alphabetisation.
 *
 * @returns {Array<{id: string, minPile: number, cards: Array}>}
 */
export function optionalRuleDocs() {
    return RULE_DEFS
        .filter(d => d.optional)
        .map(d => ({ id: d.id, minPile: d.minPile, cards: ruleCards(d) }));
}
