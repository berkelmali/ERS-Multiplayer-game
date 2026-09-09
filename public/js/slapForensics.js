/**
 * slapForensics.js — the game finally answers "why wasn't that a slap?"
 *
 * COUNCIL.md, Designer, `[Kesin]`: *"Oyuncu neden slap'ının geçersiz olduğunu
 * oyun içinde öğrenemez."* Until now an invalid slap burned a card and said
 * nothing. A new player learned only that they were wrong, never why, so the
 * fastest route to improvement was leaving the table and reading the rules page.
 *
 * This module turns every slap into a one-line coaching moment, and — because it
 * is the same rule registry the game itself evaluates — the explanation can
 * never disagree with the verdict. It reports three different things:
 *
 *   ✅ hit          "Sandwich!"                       — name what you saw
 *   ❌ near miss    "Not a sandwich — 2 cards apart"   — name what you ALMOST saw
 *   🚫 house rule   "Top-Bottom is off at this table"  — you were right, the
 *                                                        table changed the rules
 *
 * The third case matters more than it looks: without it, House Rules would make
 * experienced players feel like the game had started lying to them.
 *
 * On top of the live coaching it keeps a local skill record — hit rate per rule,
 * MISSED chances per rule, reflex distribution — and folds it into a Slap IQ.
 * Missed chances are the half nobody tracks: knowing you slap 92% of the doubles
 * you attempt is useless if you never notice 60% of the sandwiches going past.
 *
 * All storage is local (localStorage). Nothing here is uploaded.
 */

import EventBus from './eventbus.js';
import { GameState } from './game.js';
import { Localization } from './localization.js?v=3';
import { HouseRules } from './houseRules.js';
import { explainSlap, matchSlap, RULE_DEFS } from './slapRules.js';
import { Settings } from './settings.js';
import { reflexDelta } from './reflexDelta.js';

const STORE_KEY = 'ersSlapForensics';
const STORE_VERSION = 1;
const COACH_VISIBLE_MS = 2600;
const REFLEX_HISTORY = 40;

/** Reflex mapping for the speed component of Slap IQ. */
const REFLEX_FLOOR_MS = 260;   // scores 1.0
const REFLEX_CEIL_MS = 900;    // scores 0.0
const MIN_SAMPLE = 10;         // below this, IQ reports "calibrating"

const emptyStats = () => ({
    v: STORE_VERSION,
    totals: { attempts: 0, hits: 0, misses: 0 },
    hits: {},           // ruleId -> successful slaps
    missedChances: {},  // ruleId -> patterns that went past unslapped
    missCodes: {},      // near-miss code -> count (what you get wrong most)
    reflex: []          // recent reaction times in ms
});

export const SlapForensics = {
    stats: emptyStats(),
    _initialized: false,
    _pending: null,     // the rule currently sitting on the table, unclaimed
    _coachTimer: null,

    /**
     * The most recent slap measured against this player's own history, or null.
     * Read by ui.js when it draws the reflex speedometer; see reflexDelta.js.
     * Deliberately NOT persisted — it describes one slap, not a record.
     */
    lastDelta: null,

    init() {
        if (this._initialized) return;
        this._initialized = true;

        this.coachEl = document.getElementById('slap-coach');
        this.panel = document.getElementById('slapiq-panel');
        this.mainMenu = document.getElementById('main-menu');
        this.load();
        this.bindEvents();
        this.bindPanel();
    },

    // -----------------------------------------------------------------------
    // Slap IQ panel
    // -----------------------------------------------------------------------

    bindPanel() {
        const open = document.getElementById('btn-slapiq');
        if (open) {
            open.addEventListener('click', () => {
                this.mainMenu.classList.remove('active');
                this.panel.classList.add('active');
                this.renderPanel();
            });
        }
        const back = document.getElementById('btn-slapiq-back');
        if (back) {
            back.addEventListener('click', () => {
                this.panel.classList.remove('active');
                this.mainMenu.classList.add('active');
            });
        }
        const reset = document.getElementById('btn-slapiq-reset');
        if (reset) {
            reset.addEventListener('click', () => {
                this.reset();
                this.renderPanel();
            });
        }
    },

    renderPanel() {
        const body = document.getElementById('slapiq-body');
        if (!body) return;

        const iq = this.slapIQ();
        const t = this.stats.totals;

        const pct = (v) => `${Math.round(v * 100)}%`;

        // A dial rather than a bare number: the score only means something
        // relative to 100, and an arc shows that relationship without the reader
        // having to hold the scale in their head. While calibrating, the arc is
        // drawn from the SAMPLE progress instead — so the panel still shows
        // movement on the very first match, when the score itself cannot.
        const R = 54;
        const CIRC = 2 * Math.PI * R;
        const frac = iq.ready
            ? Math.max(0, Math.min(1, iq.score / 100))
            : Math.max(0, Math.min(1, iq.sample / MIN_SAMPLE));
        const dash = (CIRC * frac).toFixed(1);

        const scoreBlock = `
            <div class="iq-gauge ${iq.ready ? 'grade-' + iq.grade : 'calibrating'}">
                <svg viewBox="0 0 140 140" role="img"
                     aria-label="${iq.ready ? `Slap IQ ${iq.score} / 100, ${iq.grade}` : (Localization.get('slapIqCalibrating') || 'Calibrating')}">
                    <circle class="iq-track" cx="70" cy="70" r="${R}" />
                    ${frac > 0 ? `<circle class="iq-arc" cx="70" cy="70" r="${R}"
                            stroke-dasharray="${dash} ${(CIRC - dash).toFixed(1)}"
                            transform="rotate(-90 70 70)" />` : ''}
                </svg>
                <div class="iq-readout">
                    <span class="iq-num">${iq.ready ? iq.score : '—'}</span>
                    <span class="iq-grade">${iq.ready ? iq.grade : (Localization.get('slapIqCalibrating') || 'Calibrating')}</span>
                </div>
            </div>`;

        const need = Math.max(0, MIN_SAMPLE - iq.sample);
        const subtitle = iq.ready
            ? (Localization.get('slapIqSubtitle') || 'Precision, coverage and speed, combined.')
            : (Localization.get('slapIqNeedMore') || 'Play {n} more slap situations to get a score.').replace('{n}', need);

        const rows = this.ruleBreakdown().map(r => {
            const rate = r.rate === null ? '—' : pct(r.rate);
            const width = r.rate === null ? 0 : Math.round(r.rate * 100);
            return `<li class="iq-rule">
                <span class="nm">${r.name}</span>
                <span class="bar"><i style="width:${width}%"></i></span>
                <span class="vl">${rate}</span>
                <span class="ct">${r.hit}/${r.seen}</span>
            </li>`;
        }).join('');

        const mistake = this.topMistake();
        const mistakeLine = mistake
            ? `<p class="iq-advice">🎯 ${Localization.get('slapIqTopMistake') || 'Most common mistake'}:
                   <strong>${(Localization.get('coach_' + mistake.code) || mistake.code).replace(/\{\w+\}/g, '…')}</strong>
                   (${mistake.count}×)</p>`
            : '';

        body.innerHTML = `
            ${scoreBlock}
            <p class="iq-subtitle">${subtitle}</p>
            <div class="iq-metrics">
                <div><span>${Localization.get('slapIqPrecision') || 'Precision'}</span><strong>${pct(iq.precision)}</strong></div>
                <div><span>${Localization.get('slapIqRecall') || 'Coverage'}</span><strong>${pct(iq.recall)}</strong></div>
                <div><span>${Localization.get('slapIqSpeed') || 'Reflex'}</span><strong>${iq.medianReflex === null ? '—' : iq.medianReflex + 'ms'}</strong></div>
            </div>
            <p class="iq-totals">${Localization.get('slapIqAttempts') || 'Slaps attempted'}: <strong>${t.attempts}</strong>
               · ${Localization.get('slapIqHits') || 'landed'}: <strong>${t.hits}</strong>
               · ${Localization.get('slapIqBurns') || 'burned'}: <strong>${t.misses}</strong></p>
            ${mistakeLine}
            <h3 class="iq-h3">${Localization.get('slapIqByRule') || 'Hit rate by pattern'}</h3>
            <ul class="iq-rules">${rows}</ul>
            <p class="iq-note">${Localization.get('slapIqNote') || 'Coverage counts the patterns that appeared and went past you — not just the ones you tried.'}</p>
        `;
    },

    // -----------------------------------------------------------------------
    // Persistence
    // -----------------------------------------------------------------------

    load() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && parsed.v === STORE_VERSION) {
                this.stats = { ...emptyStats(), ...parsed };
            }
        } catch (e) {
            console.warn('[SlapForensics] could not read saved stats, starting fresh', e);
        }
    },

    save() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(this.stats));
        } catch (e) {
            // Private-mode / quota. Coaching still works, only the record is lost.
            console.warn('[SlapForensics] could not persist stats', e);
        }
    },

    reset() {
        this.stats = emptyStats();
        this.save();
        EventBus.emit('slapStatsChanged', this.stats);
    },

    // -----------------------------------------------------------------------
    // Event wiring
    // -----------------------------------------------------------------------

    /**
     * NOTE: no `EventBus.off()` calls here on purpose. `off(event)` without a
     * callback wipes EVERY listener for that event (see eventbus.js), and
     * `gameStarted` / `slapAttempt` / `cardPlayed` / `pileWon` are all owned by
     * ui.js as well — clearing them would silently kill the game's rendering.
     * `init()` is idempotent via `_initialized`, so each handler is attached
     * exactly once for the lifetime of the page and cannot accumulate.
     */
    bindEvents() {
        EventBus.on('gameStarted', () => {
            this._pending = null;
            this.lastDelta = null;
            this.hideCoach();
        });

        // A slap ATTEMPT is the only honest moment to judge: the pile is exactly
        // what the player was looking at, and game.js has already passed its own
        // guards, so this fires once per real evaluation.
        EventBus.on('slapAttempt', (playerId) => {
            if (playerId !== 0) return;
            this.judgeLocalAttempt();
        });

        // Track what is currently slappable so an unclaimed pattern can be
        // counted as a missed chance when it disappears.
        EventBus.on('cardPlayed', () => {
            const m = matchSlap(GameState.pile, HouseRules.active());
            if (this._pending && (!m || m.id !== this._pending)) {
                this.recordMissedChance(this._pending);
            }
            this._pending = m ? m.id : null;
        });

        EventBus.on('pileWon', ({ winnerId, reason }) => {
            if (this._pending && reason === 'slap' && winnerId !== 0) {
                this.recordMissedChance(this._pending);
            }
            this._pending = null;
        });

        EventBus.on('gameOver', () => {
            this._pending = null;
            this.lastDelta = null;
            this.hideCoach();
        });
    },

    // -----------------------------------------------------------------------
    // Judging
    // -----------------------------------------------------------------------

    judgeLocalAttempt() {
        // Cleared up front so a burned slap can never leave the previous slap's
        // comparison lying around for the next speedometer to pick up.
        this.lastDelta = null;

        const rules = HouseRules.active();
        const pile = GameState.pile ? [...GameState.pile] : [];
        const report = explainSlap(pile, rules);
        const reactionMs = GameState.lastPlayTime ? (Date.now() - GameState.lastPlayTime) : null;

        this.stats.totals.attempts++;
        if (report.valid) {
            this.stats.totals.hits++;
            this.stats.hits[report.ruleId] = (this.stats.hits[report.ruleId] || 0) + 1;
            if (reactionMs !== null && reactionMs > 0 && reactionMs < 5000) {
                // ORDER IS LOAD-BEARING: the comparison is taken against the
                // history as it stands BEFORE this slap joins it. Push first and
                // every result drifts toward "on par" — see reflexDelta.js.
                this.lastDelta = reflexDelta(Math.round(reactionMs), this.stats.reflex);
                this.stats.reflex.push(Math.round(reactionMs));
                if (this.stats.reflex.length > REFLEX_HISTORY) this.stats.reflex.shift();
            }
            this._pending = null;
        } else {
            this.stats.totals.misses++;
            const primary = report.nearMisses[0];
            if (primary) {
                this.stats.missCodes[primary.code] = (this.stats.missCodes[primary.code] || 0) + 1;
            }
        }
        this.save();

        const message = this.describe(report);
        this.showCoach(message, report.valid);
        EventBus.emit('slapExplained', { report, reactionMs, message });
        EventBus.emit('slapStatsChanged', this.stats);
        return report;
    },

    recordMissedChance(ruleId) {
        if (!ruleId) return;
        this.stats.missedChances[ruleId] = (this.stats.missedChances[ruleId] || 0) + 1;
        this.save();
    },

    // -----------------------------------------------------------------------
    // Wording
    // -----------------------------------------------------------------------

    ruleName(id) {
        return Localization.get('ruleName_' + id) || id;
    },

    /**
     * Turns a forensics report into one short line.
     * Priority: a house-rule block beats a near miss, because "you were right,
     * the table is different" is more useful than "you were nearly right".
     */
    describe(report) {
        if (report.valid) {
            return `✅ ${this.ruleName(report.ruleId)}`;
        }
        if (report.blockedBy.length > 0) {
            const tpl = Localization.get('coachRuleOff') || '{rule} is switched off at this table';
            return `🚫 ${tpl.replace('{rule}', this.ruleName(report.blockedBy[0]))}`;
        }
        const primary = report.nearMisses[0];
        if (primary) {
            const tpl = Localization.get('coach_' + primary.code);
            if (tpl) {
                let text = tpl;
                for (const [k, v] of Object.entries(primary.data || {})) {
                    text = text.replace('{' + k + '}', v);
                }
                return `❌ ${text}`;
            }
        }
        return `❌ ${Localization.get('coachNoPattern') || 'No slappable pattern on the pile'}`;
    },

    // -----------------------------------------------------------------------
    // Coach chip
    // -----------------------------------------------------------------------

    showCoach(message, isGood) {
        if (Settings.config.slapCoach === false) return;
        if (!this.coachEl) this.coachEl = document.getElementById('slap-coach');
        if (!this.coachEl) return;

        this.coachEl.textContent = message;
        this.coachEl.className = 'slap-coach ' + (isGood ? 'good' : 'bad');
        // Restart the entry animation even when a second slap lands immediately.
        void this.coachEl.offsetWidth;
        this.coachEl.classList.add('visible');

        clearTimeout(this._coachTimer);
        this._coachTimer = setTimeout(() => this.hideCoach(), COACH_VISIBLE_MS);
    },

    hideCoach() {
        clearTimeout(this._coachTimer);
        if (!this.coachEl) this.coachEl = document.getElementById('slap-coach');
        if (this.coachEl) this.coachEl.classList.remove('visible');
    },

    // -----------------------------------------------------------------------
    // Slap IQ
    // -----------------------------------------------------------------------

    medianReflex() {
        if (this.stats.reflex.length === 0) return null;
        const s = [...this.stats.reflex].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
    },

    /**
     * @returns {{
     *   ready: boolean, score: number|null, grade: string,
     *   precision: number, recall: number, speed: number,
     *   medianReflex: number|null, sample: number
     * }}
     */
    slapIQ() {
        const t = this.stats.totals;
        const totalHits = t.hits;
        const totalMissedChances = Object.values(this.stats.missedChances)
            .reduce((a, b) => a + b, 0);
        const sample = t.attempts + totalMissedChances;

        const precision = t.attempts > 0 ? totalHits / t.attempts : 0;
        const chanceBase = totalHits + totalMissedChances;
        const recall = chanceBase > 0 ? totalHits / chanceBase : 0;

        const med = this.medianReflex();
        const speed = med === null ? 0 : Math.max(0, Math.min(1,
            (REFLEX_CEIL_MS - med) / (REFLEX_CEIL_MS - REFLEX_FLOOR_MS)
        ));

        if (sample < MIN_SAMPLE) {
            return {
                ready: false, score: null, grade: '—',
                precision, recall, speed, medianReflex: med, sample
            };
        }

        const score = Math.round(100 * (0.40 * precision + 0.35 * recall + 0.25 * speed));
        return {
            ready: true, score, grade: this.gradeFor(score),
            precision, recall, speed, medianReflex: med, sample
        };
    },

    gradeFor(score) {
        if (score >= 85) return 'S';
        if (score >= 70) return 'A';
        if (score >= 55) return 'B';
        if (score >= 40) return 'C';
        return 'D';
    },

    /** Per-rule breakdown, sorted worst-first — the practice list. */
    ruleBreakdown() {
        const rules = HouseRules.active();
        return RULE_DEFS
            .filter(def => rules[def.id])
            .map(def => {
                const hit = this.stats.hits[def.id] || 0;
                const missed = this.stats.missedChances[def.id] || 0;
                const seen = hit + missed;
                return {
                    id: def.id,
                    name: this.ruleName(def.id),
                    hit,
                    missed,
                    seen,
                    rate: seen > 0 ? hit / seen : null
                };
            })
            .sort((a, b) => {
                if (a.rate === null) return 1;
                if (b.rate === null) return -1;
                return a.rate - b.rate;
            });
    },

    /** The single most common mistake, for the headline advice line. */
    topMistake() {
        const entries = Object.entries(this.stats.missCodes);
        if (entries.length === 0) return null;
        entries.sort((a, b) => b[1] - a[1]);
        return { code: entries[0][0], count: entries[0][1] };
    }
};
