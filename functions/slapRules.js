/**
 * functions/slapRules.js — SERVER-SIDE MIRROR of public/js/slapRules.js.
 *
 * ⚠️ EVERYTHING BELOW THE END OF THIS COMMENT IS BYTE-FOR-BYTE IDENTICAL to
 *    public/js/slapRules.js, and `test_gameLogic.mjs` FAILS THE BUILD if it
 *    ever stops being. Do not hand-edit this file: change the client copy and
 *    re-run `node tools/sync-rules.mjs`.
 *
 * Why a copy at all: Firebase deploys the functions/ directory in isolation and
 * cannot import a module living outside it. Before v3.0.0 this was a manual
 * duplicate kept in sync by a comment asking nicely; the drift test replaces
 * that promise with a check.
 *
 * Rank encoding (matches game.js): 2–10 numeric, 11=J, 12=Q, 13=K, 14=A.
 */


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rankAt = (pile, fromEnd) => pile[pile.length - 1 - fromEnd].rank;

/** True when the last `n` cards form a strictly consecutive run (either direction). */
function isRun(pile, n) {
    if (pile.length < n) return false;
    const slice = pile.slice(pile.length - n).map(c => c.rank);
    const dir = Math.sign(slice[1] - slice[0]);
    if (dir === 0) return false;
    for (let i = 1; i < slice.length; i++) {
        if (slice[i] - slice[i - 1] !== dir) return false;
    }
    return true;
}

const lastIndices = (pile, n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(pile.length - 1 - i);
    return out;
};

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

/**
 * Evaluation order matters: the FIRST matching rule that is enabled names the
 * slap. More specific patterns come first, so the player gets the most
 * informative label.
 *
 * Two tiers, and the split is the whole point:
 *
 *   optional: false — the classic four. On by default. Dropping one is a house
 *                     choice a table makes; the game still recognises the rule.
 *   optional: true  — Triple, Top-Bottom, Four-in-a-Row. OFF by default. These
 *                     three were listed in the README for years without the code
 *                     ever implementing them. Making them default-on would have
 *                     silently rebalanced every existing match, so they are
 *                     opt-in: a table adds them deliberately, or never sees them.
 *
 * That asymmetry is what makes the House Rules panel work in both directions —
 * four rules you can drop, three you can add.
 *
 * Each rule:
 *   id       — stable key, also the i18n key suffix (`ruleName_<id>`)
 *   minPile  — cheap guard, also used by the forensics "pile too small" path
 *   optional — false = classic, on by default; true = opt-in house rule
 *   match    — (pile) => number[] | null   ...the highlighted card indices
 *   nearMiss — (pile) => {code, data} | null
 *              Describes the *interesting* way this rule just failed. Returning
 *              null means "not even close, don't mention it" — the coach stays
 *              quiet rather than listing every rule the player didn't hit.
 *   preview  — the shortest pile that demonstrates the rule, as real cards.
 *              `key: false` marks a card that is present but not part of the
 *              match (the filling in a Sandwich), so the settings screen can
 *              show the pattern instead of describing it. Illustration only —
 *              nothing evaluates it — but it lives here so that adding a rule
 *              stays a one-object change.
 */
export const RULE_DEFS = [
    {
        id: 'triple',
        optional: true,
        preview: [{ rank: 9, suit: 'clubs', key: true }, { rank: 9, suit: 'hearts', key: true }, { rank: 9, suit: 'diamonds', key: true }],
        minPile: 3,
        match: (p) => (p.length >= 3 && rankAt(p, 0) === rankAt(p, 1) && rankAt(p, 1) === rankAt(p, 2))
            ? lastIndices(p, 3) : null,
        nearMiss: (p) => (p.length >= 3 && rankAt(p, 0) === rankAt(p, 1) && rankAt(p, 1) !== rankAt(p, 2))
            ? { code: 'tripleOnlyTwo', data: {} } : null
    },
    {
        id: 'doubles',
        optional: false,
        preview: [{ rank: 7, suit: 'clubs', key: true }, { rank: 7, suit: 'hearts', key: true }],
        minPile: 2,
        match: (p) => (p.length >= 2 && rankAt(p, 0) === rankAt(p, 1)) ? lastIndices(p, 2) : null,
        nearMiss: (p) => {
            if (p.length < 2) return null;
            const diff = Math.abs(rankAt(p, 0) - rankAt(p, 1));
            return diff === 1 ? { code: 'doublesOffByOne', data: {} } : null;
        }
    },
    {
        id: 'fourInRow',
        optional: true,
        preview: [{ rank: 2, suit: 'clubs', key: true }, { rank: 3, suit: 'hearts', key: true }, { rank: 4, suit: 'spades', key: true }, { rank: 5, suit: 'diamonds', key: true }],
        minPile: 4,
        match: (p) => isRun(p, 4) ? lastIndices(p, 4) : null,
        nearMiss: (p) => (!isRun(p, 4) && isRun(p, 3)) ? { code: 'runOnlyThree', data: {} } : null
    },
    {
        id: 'sandwich',
        optional: false,
        preview: [{ rank: 9, suit: 'clubs', key: true }, { rank: 3, suit: 'hearts', key: false }, { rank: 9, suit: 'diamonds', key: true }],
        minPile: 3,
        match: (p) => (p.length >= 3 && rankAt(p, 0) === rankAt(p, 2))
            ? [p.length - 1, p.length - 3] : null,
        nearMiss: (p) => (p.length >= 4 && rankAt(p, 0) !== rankAt(p, 2) && rankAt(p, 0) === rankAt(p, 3))
            ? { code: 'sandwichGapTooWide', data: {} } : null
    },
    {
        id: 'tens',
        optional: false,
        preview: [{ rank: 4, suit: 'clubs', key: true }, { rank: 6, suit: 'hearts', key: true }],
        minPile: 2,
        match: (p) => {
            if (p.length < 2) return null;
            const a = rankAt(p, 0), b = rankAt(p, 1);
            return (a <= 10 && b <= 10 && a + b === 10) ? lastIndices(p, 2) : null;
        },
        nearMiss: (p) => {
            if (p.length < 2) return null;
            const a = rankAt(p, 0), b = rankAt(p, 1);
            if (a > 10 || b > 10) return null;
            const sum = a + b;
            return (sum === 9 || sum === 11) ? { code: 'tensSumOff', data: { sum } } : null;
        }
    },
    {
        id: 'marriage',
        optional: false,
        preview: [{ rank: 13, suit: 'spades', key: true }, { rank: 12, suit: 'hearts', key: true }],
        minPile: 2,
        match: (p) => {
            if (p.length < 2) return null;
            const a = rankAt(p, 0), b = rankAt(p, 1);
            return ((a === 12 && b === 13) || (a === 13 && b === 12)) ? lastIndices(p, 2) : null;
        },
        nearMiss: (p) => {
            if (p.length < 2) return null;
            const a = rankAt(p, 0), b = rankAt(p, 1);
            const isKQ = (r) => r === 12 || r === 13;
            const isFace = (r) => r >= 11;
            // One half of a marriage sitting next to some *other* face card.
            return ((isKQ(a) && isFace(b)) || (isKQ(b) && isFace(a)))
                ? { code: 'marriageWrongPair', data: {} } : null;
        }
    },
    {
        id: 'topBottom',
        optional: true,
        preview: [{ rank: 14, suit: 'spades', key: true }, { rank: 5, suit: 'hearts', key: false }, { rank: 14, suit: 'diamonds', key: true }],
        minPile: 2,
        match: (p) => (p.length >= 2 && p[0].rank === rankAt(p, 0)) ? [0, p.length - 1] : null,
        nearMiss: (p) => (p.length >= 3 && p[0].rank !== rankAt(p, 0) && p[0].rank === rankAt(p, 1))
            ? { code: 'topBottomOneLate', data: {} } : null
    }
];

export const ALL_RULE_IDS = RULE_DEFS.map(r => r.id);
export const CORE_RULE_IDS = RULE_DEFS.filter(r => !r.optional).map(r => r.id);
export const OPTIONAL_RULE_IDS = RULE_DEFS.filter(r => r.optional).map(r => r.id);

/** The classic set: every core rule on, every opt-in rule off. */
export const DEFAULT_RULES = Object.freeze(
    RULE_DEFS.reduce((acc, r) => { acc[r.id] = !r.optional; return acc; }, {})
);

/**
 * Backwards-compatible predicate map (`SLAP_RULES.doubles(pile) -> boolean`).
 * Kept because it was the file's original public shape; new code should use
 * `matchSlap()` / `explainSlap()` instead.
 */
export const SLAP_RULES = RULE_DEFS.reduce((acc, r) => {
    acc[r.id] = (pile) => r.match(pile) !== null;
    return acc;
}, {});

// ---------------------------------------------------------------------------
// Rule-set handling
// ---------------------------------------------------------------------------

/**
 * Coerces anything (undefined, a partial object, data straight off the wire)
 * into a complete, safe rule set.
 *
 * The one hard invariant: a table can never end up with EVERY rule off. That
 * would produce a game with no way to win a pile by slapping — every slap burns,
 * and the match can only end by challenge or elimination. If a caller manages
 * to switch everything off, Doubles is forced back on.
 */
export function normalizeRules(input) {
    const out = {};
    let anyOn = false;
    for (const def of RULE_DEFS) {
        const v = input && Object.prototype.hasOwnProperty.call(input, def.id)
            ? input[def.id] === true
            : DEFAULT_RULES[def.id];
        out[def.id] = v;
        if (v) anyOn = true;
    }
    if (!anyOn) out.doubles = true;
    return out;
}

/** Compact wire form: "doubles,sandwich,tens" — what gets stored on the room. */
export function rulesToKey(rules) {
    const r = normalizeRules(rules);
    return ALL_RULE_IDS.filter(id => r[id]).join(',');
}

export function keyToRules(key) {
    if (typeof key !== 'string' || key.length === 0) return { ...DEFAULT_RULES };
    const on = new Set(key.split(',').map(s => s.trim()).filter(Boolean));
    const out = {};
    for (const def of RULE_DEFS) out[def.id] = on.has(def.id);
    return normalizeRules(out);
}

/** True when `rules` is exactly the classic set (used to hide the lobby badge). */
export function isDefaultRuleSet(rules) {
    const r = normalizeRules(rules);
    return ALL_RULE_IDS.every(id => r[id] === DEFAULT_RULES[id]);
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Full match result.
 * @returns {{id: string, indices: number[]}|null}
 */
export function matchSlap(pile, rules) {
    if (!pile || pile.length < 2) return null;
    const active = normalizeRules(rules);
    for (const def of RULE_DEFS) {
        if (!active[def.id]) continue;
        if (pile.length < def.minPile) continue;
        const indices = def.match(pile);
        if (indices) return { id: def.id, indices };
    }
    return null;
}

/**
 * Original public API, unchanged in shape: rule id string, or `false`.
 * Called with one argument it uses the classic rule set, so `tutorialMode.js`
 * and `functions/gameLogic.js` keep behaving exactly as they did.
 */
export function evaluateSlap(pile, rules) {
    const m = matchSlap(pile, rules);
    return m ? m.id : false;
}

/** Highlight indices for a known rule id. Kept for backwards compatibility. */
export function getSlapIndices(pile, label) {
    if (!pile || !label) return [];
    const def = RULE_DEFS.find(r => r.id === label);
    if (!def || pile.length < def.minPile) return [];
    return def.match(pile) || [];
}

/**
 * FORENSICS — the "why?" behind a slap. Pure: no DOM, no i18n, no side effects,
 * so it can be unit-tested and reused by the UI, the stats tracker and tests.
 *
 * @returns {{
 *   valid: boolean,
 *   ruleId: string|null,
 *   indices: number[],
 *   pileSize: number,
 *   nearMisses: Array<{ruleId: string, code: string, data: object}>,
 *   blockedBy: string[]   // rules that WOULD have matched but are off at this table
 * }}
 */
export function explainSlap(pile, rules) {
    const active = normalizeRules(rules);
    const safePile = Array.isArray(pile) ? pile : [];
    const match = matchSlap(safePile, active);

    const result = {
        valid: match !== null,
        ruleId: match ? match.id : null,
        indices: match ? match.indices : [],
        pileSize: safePile.length,
        nearMisses: [],
        blockedBy: []
    };

    if (result.valid) return result;

    if (safePile.length < 2) {
        result.nearMisses.push({ ruleId: null, code: 'pileTooSmall', data: { size: safePile.length } });
        return result;
    }

    for (const def of RULE_DEFS) {
        // A disabled rule that would have matched is the single most useful
        // thing to tell a player — it means their instinct was right and the
        // TABLE is what changed, not them.
        if (!active[def.id]) {
            if (safePile.length >= def.minPile && def.match(safePile)) {
                result.blockedBy.push(def.id);
            }
            continue;
        }
        if (safePile.length < def.minPile) continue;
        const miss = def.nearMiss(safePile);
        if (miss) result.nearMisses.push({ ruleId: def.id, code: miss.code, data: miss.data });
    }

    return result;
}
