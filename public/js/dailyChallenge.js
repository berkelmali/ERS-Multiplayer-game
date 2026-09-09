/**
 * dailyChallenge.js — one deal, one day, everybody.
 *
 * Every ERS match so far has been unrepeatable: your deck, your bots, your luck.
 * That makes "I got 2400" meaningless as a comparison and gives nobody a reason
 * to come back tomorrow. The Daily Challenge removes luck from the comparison by
 * removing luck from the deal.
 *
 * WHAT IS ACTUALLY DETERMINISTIC — stated precisely, because a leaderboard that
 * overclaims fairness is worse than no leaderboard:
 *
 *   ✅ The deck. Seeded from the UTC date, so every player on earth is dealt the
 *      identical 52 cards in the identical order.
 *   ✅ The bots' DECISIONS. Each roll is counter-based — `hashRandom(seed, botId,
 *      playCount, purpose)` — so "bot 2's slap roll on the 17th card" is the same
 *      number for everyone, no matter how their run reached that point. A
 *      streaming PRNG could not promise this: two players consume draws at
 *      different rates, so their streams desynchronise after the first
 *      divergence. See rng.js.
 *   ✅ The rule set. ALWAYS the classic four, and LOCKED for the duration of
 *      the run (`HouseRules.lock('daily')`). Everyone is judged by the same
 *      patterns or the comparison is meaningless. The lock is defence in depth,
 *      not a UI fix — see houseRules.js::lockedBy for exactly what it does and
 *      does not close.
 *   ✅ Difficulty. Also seeded from the date, so everyone faces the same bots
 *      today — but it MOVES between medium and hard from day to day rather than
 *      being permanently hard (see dailyScenario.js::pickDifficulty). Nobody
 *      farms an easier table; the table is simply not the same table all year.
 *
 *   ⚠️ NOT deterministic: the bots' wall-clock timing still runs on real
 *      `setTimeout`s, and your own reactions obviously vary. Two players with
 *      identical inputs get identical outcomes; two players with different
 *      reflexes do not. That is the point — reflex and judgement are the only
 *      variables left.
 *
 * Scored once per UTC day. Replays are allowed and clearly marked as practice;
 * they never overwrite the day's score. Starting a scored run and walking out
 * of it counts as a loss — see `stop()`.
 *
 * ⚠️ THE GLOBAL BOARD IS NOT VERIFIED. Scores are computed on the client and
 * written straight to Firestore; `firestore.rules` validates their shape, never
 * their truth. `VERIFIED_BOARD` below is false, and the panel says so in the
 * player's language. Flip it only when a Cloud Function actually recomputes the
 * score server-side — not when one is planned. `USE_SERVER_VALIDATION` has been
 * "one function away" since v2.9.0, which is exactly the reason for this note.
 */

import { getFirestore, doc, setDoc, getDoc, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import { hashRandom, Rng } from './rng.js';
import { todayKey, seedForDate, computeScore, toBoardPayload, validateScorePayload } from './dailyScore.js';
import { buildScenario } from './dailyScenario.js';
import { Localization } from './localization.js?v=3';
import { HouseRules } from './houseRules.js';
import { DEFAULT_RULES } from './slapRules.js';
import { GameState } from './game.js';
import { GameManager } from './gameManager.js';
import { MatchContext } from './matchContext.js';
import { AuthSystem } from './auth.js';
import { UIManager } from './ui.js';
import EventBus from './eventbus.js';

const db = getFirestore(app);
const STORE_KEY = 'ersDailyChallenge';
const LEADERBOARD_SIZE = 20;

// The pure, testable half lives in dailyScore.js — re-exported so callers
// (and the tests) have one obvious place to import from.
export { todayKey, seedForDate, computeScore };

export const DailyChallenge = {
    /**
     * Does a server independently recompute submitted scores? No. Until one
     * does, the panel carries a warning and this stays false. One constant, one
     * banner, one honest claim — see the module header.
     */
    VERIFIED_BOARD: false,

    active: false,
    scored: false,        // is THIS run the day's scored attempt?
    _settled: false,      // has THIS run already been written down?
    startedAt: 0,
    dateKey: null,
    seed: 0,
    record: null,         // { date, score, reflex, won, at }
    scenario: null,       // today's inherited position (see dailyScenario.js)
    _initialized: false,

    init() {
        if (this._initialized) return;
        this._initialized = true;

        this.dateKey = todayKey();
        this.seed = seedForDate(this.dateKey);
        this.scenario = buildScenario(this.seed);
        this.panel = document.getElementById('daily-panel');
        this.mainMenu = document.getElementById('main-menu');
        this.gameScreen = document.getElementById('game-container');
        this.loadRecord();
        this.bindEvents();
    },

    // -----------------------------------------------------------------------
    // Local record
    // -----------------------------------------------------------------------

    loadRecord() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            // A record from a previous day is simply not today's record.
            if (parsed && parsed.date === this.dateKey) this.record = parsed;
        } catch (e) {
            console.warn('[DailyChallenge] could not read local record', e);
        }
    },

    saveRecord(rec) {
        this.record = rec;
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(rec));
        } catch (e) {
            console.warn('[DailyChallenge] could not persist local record', e);
        }
    },

    hasPlayedToday() {
        return !!(this.record && this.record.date === this.dateKey);
    },

    // -----------------------------------------------------------------------
    // UI wiring
    // -----------------------------------------------------------------------

    bindEvents() {
        const open = document.getElementById('btn-daily');
        if (open) {
            open.addEventListener('click', () => this.openPanel());
        }
        const back = document.getElementById('btn-daily-back');
        if (back) {
            back.addEventListener('click', () => {
                this.panel.classList.remove('active');
                this.mainMenu.classList.add('active');
            });
        }
        const play = document.getElementById('btn-daily-play');
        if (play) {
            play.addEventListener('click', () => this.startRun());
        }

        EventBus.on('gameOver', (winnerId) => {
            if (!this.active) return;
            this.finishRun(winnerId);
        });
    },

    openPanel() {
        // Crossing midnight UTC with the tab open must not serve a stale day.
        this.refreshDate();
        this.mainMenu.classList.remove('active');
        this.panel.classList.add('active');
        this.renderPanel();
        this.loadLeaderboard();
    },

    refreshDate() {
        const key = todayKey();
        if (key !== this.dateKey) {
            this.dateKey = key;
            this.seed = seedForDate(key);
            this.scenario = buildScenario(this.seed);
            this.record = null;
            this.loadRecord();
        }
    },

    /**
     * A small mark generated from today's seed. Purely decorative, but it does
     * one real job: it makes "today's deal" feel like an object rather than a
     * date string, and two players comparing screens can see at a glance that
     * they are looking at the same deal.
     *
     * Mirrored 5x5 grid, so it reads as a symbol instead of noise, drawn from
     * the same counter-based generator as the bots — the mark for a given day is
     * the same on every device, forever.
     */
    renderSigil() {
        const host = document.getElementById('daily-sigil');
        if (!host) return;

        const CELL = 15, GAP = 3, COLS = 5, ROWS = 5;
        const size = COLS * (CELL + GAP) - GAP;
        // Hue from the seed, but kept out of the muddy 40-90 band so the mark
        // never collides with the panel's gold accents.
        const hue = Math.floor(hashRandom(this.seed, 0, 0, 99) * 300) + 20;
        let cells = '';

        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < 3; x++) { // left half + centre column, then mirror
                const on = hashRandom(this.seed, x, y, 7) > 0.45;
                if (!on) continue;
                const strong = hashRandom(this.seed, x, y, 8) > 0.6;
                const xs = x === 2 ? [2] : [x, COLS - 1 - x];
                for (const cx of xs) {
                    cells += `<rect x="${cx * (CELL + GAP)}" y="${y * (CELL + GAP)}" `
                        + `width="${CELL}" height="${CELL}" rx="3" `
                        + `fill="hsl(${hue} 70% ${strong ? 62 : 44}%)" `
                        + `opacity="${strong ? 1 : 0.65}" />`;
                }
            }
        }

        host.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${cells}</svg>`;
    },

    renderPanel() {
        this.renderSigil();
        const dateEl = document.getElementById('daily-date');
        const seedEl = document.getElementById('daily-seed');
        const bestEl = document.getElementById('daily-your-best');
        const playBtn = document.getElementById('btn-daily-play');

        if (dateEl) dateEl.innerText = this.dateKey;
        if (seedEl) seedEl.innerText = '#' + this.seed.toString(36).toUpperCase();

        if (bestEl) {
            if (this.hasPlayedToday()) {
                const r = this.record;
                bestEl.innerHTML = `<strong>${r.score}</strong> · ${r.won
                    ? (Localization.get('dailyWon') || 'Won')
                    : (Localization.get('dailyLost') || 'Lost')} · ${r.reflex}ms`;
            } else {
                bestEl.innerText = Localization.get('dailyNotPlayed') || 'Not played yet today';
            }
        }

        if (playBtn) {
            playBtn.innerText = this.hasPlayedToday()
                ? (Localization.get('dailyPlayAgain') || 'Play again (practice)')
                : (Localization.get('dailyPlay') || "Play today's deal");
        }

        this.renderScenarioBrief();
    },

    /**
     * Tells the player WHAT they are walking into, and nothing more.
     *
     * The profile name and their own starting hand are fair to show — they will
     * see both within a second of starting anyway, and hiding them just makes
     * the first moments confusing. The bots' hands stay hidden: that is the
     * information the position is actually built around.
     */
    renderScenarioBrief() {
        const el = document.getElementById('daily-scenario');
        if (!el) return;
        if (!this.scenario) {
            el.style.display = 'none';
            return;
        }

        const p = this.scenario.profile;
        const name = Localization.get('dailyProfile_' + p) || p;
        const desc = Localization.get('dailyProfileDesc_' + p) || '';
        const cardsLabel = Localization.get('dailyYourCards') || 'You start with';

        // The difficulty tier is fair to show for the same reason the profile
        // is: it is the same for every player today, and hiding it would only
        // make the first minute confusing.
        const diff = this.scenario.difficulty || 'hard';
        const diffName = Localization.get('dailyDiff_' + diff) || diff;
        const diffLabel = Localization.get('dailyBots') || 'Bots';

        el.innerHTML = `
            <div class="ds-head">
                <span class="ds-tag ds-${p}">${name}</span>
                <span class="ds-cards">${cardsLabel} <strong>${this.scenario.humanStart}</strong></span>
            </div>
            <p class="ds-desc">${desc}</p>
            <div class="ds-foot">
                <span class="ds-diff ds-diff-${diff}">${diffLabel}: <strong>${diffName}</strong></span>
                <span class="ds-rules">${Localization.get('dailyClassicRules') || 'Classic rules, locked'}</span>
            </div>`;
        el.style.display = 'block';
    },

    // -----------------------------------------------------------------------
    // Running
    // -----------------------------------------------------------------------

    startRun() {
        this.refreshDate();
        this.active = true;
        this.scored = !this.hasPlayedToday();
        this._settled = false;
        this.startedAt = Date.now();

        // Determinism switches, ALL of them reverted in `stop()`. The saved
        // rule set matters: without restoring it, a player who runs the Daily
        // Challenge would silently lose their own House Rules for the rest of
        // the session, because the scored run forces the classic set.
        this._savedRules = { ...HouseRules.local };
        Rng.seed(this.seed);
        Rng.setCoordSource((...coords) => hashRandom(this.seed, ...coords));
        // ONE place now sets the difficulty in force, and BOTH the bot tuning and
        // the turn timer read it. Before this, the timer read the player's own
        // setting: Easy gave 20 s per turn and Hard 10 s, on the same scored seed.
        MatchContext.difficultyOverride = this.scenario ? this.scenario.difficulty : 'hard';
        // Suppresses the personal settings that would otherwise buy score —
        // today that is `fastAnimations`. See matchContext.js for where the line
        // is drawn and what is deliberately left alone.
        MatchContext.scored = true;
        // force:true — we are the lock holder, and the lock is taken immediately
        // after so nothing else can move the set until stop().
        HouseRules.setLocal({ ...DEFAULT_RULES }, { force: true });
        HouseRules.lock('daily');

        this.panel.classList.remove('active');
        this.gameScreen.classList.add('active');
        document.body.classList.remove('menu-screen');
        document.body.classList.add('game-screen');

        UIManager.resetOfflineUI();
        GameManager.startBotGame({ daily: true, scenario: this.scenario });
        EventBus.emit('gameStateChanged', 'gameplay');

        UIManager.showNotification(
            this.scored
                ? (Localization.get('dailyScoredRun') || 'Scored run — good luck!')
                : (Localization.get('dailyPracticeRun') || 'Practice run — not scored'),
            this.scored ? 'gold' : 'var(--primary)'
        );
    },

    /**
     * Always safe to call; used by gameOver, quit, and mode changes.
     *
     * ABANDONING A SCORED RUN COUNTS AS A LOSS. It has to. Without this, the
     * dominant strategy on a bad `comeback` day is to quit the moment it turns
     * sour and try again — which makes the day's score a best-of-N over as many
     * attempts as you have patience for, while the player next to you, who
     * played their one run out to the end, is measured on it. This is the same
     * loophole CLAUDE.md §6.32 closed for coins; the Daily Challenge reopened it
     * by settling only on `gameOver`, and a review caught it.
     *
     * `finishRun()` marks `_settled` before it calls in here, so a normal
     * game-over is never double-recorded. Practice runs settle nothing.
     */
    stop() {
        if (!this.active) return;

        const abandonedScoredRun = this.scored && !this._settled;
        const durationMs = Date.now() - this.startedAt;

        this.active = false;
        this.scored = false;
        Rng.clear();
        Rng.setCoordSource(null);
        // Both switches go back together — the difficulty the match imposed and
        // the ban on settings that buy score. Leaving either set would carry a
        // scored run's rules into an ordinary bot match.
        MatchContext.reset();
        HouseRules.unlock();
        if (this._savedRules) {
            HouseRules.setLocal(this._savedRules, { force: true });
            this._savedRules = null;
        }

        if (!abandonedScoredRun) return;
        this._settled = true;

        // Whatever you actually earned before walking out still counts. Quitting
        // costs you the win, not the cards you had already taken.
        const rec = this.buildRecord(false, durationMs, { abandoned: true });
        this.saveRecord(rec);
        EventBus.emit('dailyScoreRecorded', rec);
        UIManager.showNotification(
            Localization.get('dailyAbandoned') || 'Daily run abandoned — recorded as a loss.',
            'var(--error)'
        );
        // Deliberately not awaited: `stop()` is sync and sits on the quit path.
        // `submitScore` already swallows its own failures; the local record is
        // written above either way.
        this.submitScore(rec).catch(() => {});
    },

    /**
     * Turns the live match state into the day's record. One place, so an
     * abandoned run and a played-out run are scored by identical arithmetic
     * rather than by two functions that drift.
     */
    buildRecord(won, durationMs, extra = {}) {
        const stats = GameState.stats || {};
        const bestReflex = (stats.bestReflex && stats.bestReflex < 9999) ? stats.bestReflex : 900;

        const score = computeScore({
            won,
            cardsWon: stats.cardsWon || 0,
            bestReflex,
            burns: stats.burns || 0,
            durationMs,
            // What the position asked of you is part of what the score means.
            startingCards: this.scenario ? this.scenario.humanStart : undefined
        });

        return {
            date: this.dateKey,
            score,
            reflex: Math.round(bestReflex),
            won,
            durationMs,
            profile: this.scenario ? this.scenario.profile : null,
            startingCards: this.scenario ? this.scenario.humanStart : 13,
            at: Date.now(),
            ...extra
        };
    },

    async finishRun(winnerId) {
        const wasScored = this.scored && !this._settled;
        const durationMs = Date.now() - this.startedAt;
        const won = winnerId === 0;

        // Claimed BEFORE stop(), so stop() does not also record this run as an
        // abandonment. Order matters here.
        this._settled = true;
        const rec = wasScored ? this.buildRecord(won, durationMs) : null;

        this.stop();
        if (!rec) return;

        this.saveRecord(rec);
        EventBus.emit('dailyScoreRecorded', rec);

        await this.submitScore(rec);
    },

    // -----------------------------------------------------------------------
    // Global board
    // -----------------------------------------------------------------------

    /**
     * WHAT "ONE ATTEMPT PER DAY" ACTUALLY MEANS — stated precisely, because the
     * comment that used to sit here said something the code does not do.
     *
     * The one-attempt rule is enforced by the LOCAL record: `startRun()` sets
     * `scored = !hasPlayedToday()`, so a replay is practice and never reaches
     * this function at all. The `>=` check below is not that rule; it is the
     * fallback for when the local record is gone — cleared storage, a second
     * device, a private window. In that situation the day degrades to
     * best-of-N, and this check at least stops a later run from DOWNGRADING an
     * existing entry.
     *
     * That is a real, if narrow, hole, and it is a client-side one: a player who
     * clears localStorage between runs gets extra attempts. It is not worth
     * closing on the client (any check there is as clearable as the record it
     * guards) and it cannot be closed in security rules without server-side
     * scoring. Listed here rather than papered over.
     */
    async submitScore(rec) {
        const user = AuthSystem.currentUser;
        if (!user) return; // Local-only for signed-out players. Still scored locally.

        const payload = toBoardPayload(rec, user);
        const bad = validateScorePayload(payload);
        if (bad) {
            // Fail loudly here rather than as an opaque PERMISSION_DENIED: if
            // this ever fires, the score formula and firestore.rules disagree.
            console.warn('[DailyChallenge] refusing to submit malformed score:', bad, payload);
            return;
        }

        try {
            const ref = doc(db, 'daily_challenges', rec.date, 'scores', user.uid);
            const existing = await getDoc(ref);
            if (existing.exists() && (existing.data().score || 0) >= payload.score) return;
            await setDoc(ref, payload);
        } catch (e) {
            // A rules/permission/network failure must never break the game loop.
            console.warn('[DailyChallenge] score submit failed (local record kept)', e);
        }
    },

    /**
     * The warning that has to be there while `VERIFIED_BOARD` is false.
     *
     * Placed ABOVE the board, not in a footnote: a ranking presented without
     * qualification is read as a ranking, and this one has not earned that. It
     * disappears on its own the day the flag flips.
     */
    renderBoardTrust() {
        const el = document.getElementById('daily-board-trust');
        if (!el) return;
        if (this.VERIFIED_BOARD) {
            el.style.display = 'none';
            el.innerHTML = '';
            return;
        }
        const title = Localization.get('dailyUnverifiedTitle') || 'Unverified board';
        const body = Localization.get('dailyUnverifiedBody')
            || 'Scores are calculated in the browser and no server checks them, so these rankings can be faked. Your own score is real — the ranking is for fun until server-side scoring ships.';
        el.innerHTML = `<span class="dbt-badge">⚠ ${escapeHtml(title)}</span><span class="dbt-body">${escapeHtml(body)}</span>`;
        el.style.display = 'flex';
    },

    async loadLeaderboard() {
        this.renderBoardTrust();
        const el = document.getElementById('daily-leaderboard');
        if (!el) return;
        el.innerHTML = `<p style="text-align:center;">${Localization.get('loading') || 'Loading...'}</p>`;
        try {
            const scoresRef = collection(db, 'daily_challenges', this.dateKey, 'scores');
            const snap = await getDocs(query(scoresRef, orderBy('score', 'desc'), limit(LEADERBOARD_SIZE)));

            if (snap.empty) {
                el.innerHTML = `<p style="text-align:center; opacity:0.7;">${Localization.get('dailyNoScores') || 'No scores yet today — be the first.'}</p>`;
                return;
            }

            const myUid = AuthSystem.currentUser ? AuthSystem.currentUser.uid : null;
            let rank = 1;
            let html = '<ul class="daily-board">';
            snap.forEach((d) => {
                const s = d.data();
                const mine = myUid && d.id === myUid;
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
                html += `<li class="${mine ? 'me' : ''}">
                    <span class="rk">${medal}</span>
                    <span class="nm">${escapeHtml(s.username || 'Player')}</span>
                    <span class="rx">${s.reflex ?? '—'}ms</span>
                    <span class="sc">${s.score ?? 0}</span>
                </li>`;
                rank++;
            });
            html += '</ul>';
            el.innerHTML = html;
        } catch (e) {
            console.warn('[DailyChallenge] leaderboard load failed', e);
            el.innerHTML = `<p style="text-align:center; color:var(--error);">${Localization.get('failedLoad') || 'Failed to load.'}</p>`;
        }
    }
};

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
