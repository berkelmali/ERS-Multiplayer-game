/**
 * rulesPanel.js — the Rules screen.
 *
 * Most of the page is static markup in index.html. One part is not: the opt-in
 * patterns, which are GENERATED from `RULE_DEFS` (see ruleDoc.js for why). The
 * static half describes the four core patterns that are always on; this half
 * describes the three a table can switch on, and the two halves live in the same
 * section on purpose — an "Extra patterns" heading further down the page would
 * have been the sixteenth top-level section on a page that already has fifteen.
 *
 * Re-renders on `languageChanged`, because the descriptions are localized and
 * `Localization.apply()` only rewrites elements that carry `data-i18n` — which
 * generated content does not, since its keys are decided at render time.
 */

import { optionalRuleDocs } from './ruleDoc.js';
import { Localization } from './localization.js?v=3';
import EventBus from './eventbus.js';

function cardMarkup(cards) {
    return cards.map(c =>
        `<span class="mini-card${c.red ? ' red' : ''}${c.key ? '' : ' filler'}">`
        + `<b>${c.label}</b><i>${c.symbol}</i></span>`
    ).join('');
}

export const RulesPanel = {
    init() {
        this.screenRules = document.getElementById('rules-panel');
        this.screenMenu = document.getElementById('main-menu');

        document.getElementById('btn-rules').addEventListener('click', () => {
            this.screenMenu.classList.remove('active');
            this.screenRules.classList.add('active');
        });

        document.getElementById('btn-rules-back').addEventListener('click', () => {
            this.screenRules.classList.remove('active');
            this.screenMenu.classList.add('active');
        });

        this.renderOptionalRules();
        EventBus.on('languageChanged', () => this.renderOptionalRules());
    },

    /**
     * The opt-in patterns, straight from the registry.
     *
     * Falls back to the rule's id if a description is missing rather than
     * printing an empty row: a rule the player can switch on should never appear
     * here as a blank line, and a visibly untranslated id is a bug report.
     */
    renderOptionalRules() {
        const host = document.getElementById('optional-rules');
        if (!host) return;

        const docs = optionalRuleDocs();
        if (docs.length === 0) {
            host.innerHTML = '';
            return;
        }

        const rows = docs.map(d => {
            const name = Localization.get('ruleName_' + d.id) || d.id;
            const desc = Localization.get('rOptDesc_' + d.id) || d.id;
            return `<li class="opt-rule">
                <span class="opt-rule-head"><strong>${name}</strong>${cardMarkup(d.cards)}</span>
                <span class="opt-rule-desc">${desc}</span>
            </li>`;
        }).join('');

        host.innerHTML = `
            <h4 class="opt-rules-title">★ ${Localization.get('rOptTitle') || 'Extra patterns (off by default)'}</h4>
            <p class="opt-rules-intro">${Localization.get('rOptIntro') || 'These are not part of the classic game. A table can switch them on in Settings → House Rules.'}</p>
            <ul class="opt-rules-list">${rows}</ul>
            <p class="opt-rules-note">${Localization.get('rOptNote') || 'When a table is not playing the classic set, the House Rules badge above the pile shows what changed.'}</p>
        `;
    }
};
