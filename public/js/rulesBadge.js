/**
 * rulesBadge.js — renders "this table is not playing the classic rules".
 *
 * Shown in exactly two places: the waiting room (so a joiner sees the host's set
 * BEFORE committing) and the game screen (so nobody has to remember). It stays
 * hidden for a classic table — a badge that is always on is a badge nobody
 * reads, and the whole value here is that its presence means something.
 */

import { RULE_DEFS, keyToRules, normalizeRules, isDefaultRuleSet } from './slapRules.js';
import { Localization } from './localization.js?v=3';

function ruleLabel(id) {
    return Localization.get('ruleName_' + id) || id;
}

/**
 * @param {string} elementId
 * @param {object|string} rules  rule object or the compact wire key
 */
export function renderRulesBadge(elementId, rules) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (rules === null || rules === undefined || rules === '') {
        el.style.display = 'none';
        return;
    }

    const set = typeof rules === 'string' ? keyToRules(rules) : normalizeRules(rules);
    if (isDefaultRuleSet(set)) {
        el.style.display = 'none';
        return;
    }

    // A non-classic table differs in one or both directions: opt-in rules it
    // switched ON, classic rules it switched OFF. Showing them as + and − says
    // more in less space than listing the whole active set would.
    const added = RULE_DEFS.filter(d => d.optional && set[d.id]).map(d => d.id);
    const removed = RULE_DEFS.filter(d => !d.optional && !set[d.id]).map(d => d.id);
    if (added.length === 0 && removed.length === 0) {
        el.style.display = 'none';
        return;
    }

    const parts = [];
    if (added.length) parts.push(`<span class="rb-on">+ ${added.map(ruleLabel).join(', ')}</span>`);
    if (removed.length) parts.push(`<span class="rb-off">− ${removed.map(ruleLabel).join(', ')}</span>`);

    el.innerHTML = `<span class="rb-title">🎲 ${Localization.get('houseRulesBadge') || 'House Rules'}</span>${parts.join('')}`;
    el.style.display = 'flex';
}
