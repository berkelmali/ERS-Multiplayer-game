// Ra's Wheel of Fortune — the daily spin.
//
// Ported from ers-revamp in v3.13.0. The wheel itself, its three tiers and
// the canvas renderer are the original work; three things changed on the way
// in, and each of them is a defect this project has a recorded name for:
//
//   1. COINS GO THROUGH CardSkins, NOT THROUGH localStorage.
//      The original wrote localStorage['ers_coins'] directly and then
//      repainted the balance itself. `cardSkins.js` owns that key, is the
//      only writer, and emits `coinsUpdated` on every save — an event
//      `shopUI.js` already listens to. Writing behind it meant no event, a
//      race with CardSkins' own writes, and a balance painted as a bare
//      number where the shop renders it with its coin glyph. One call to
//      `CardSkins.addCoins()` removes all three.
//
//   2. NO SELECTOR THAT MATCHES NOTHING.
//      The repaint targeted `.user-coin-balance, #shop-coin-balance,
//      #banner-coins`. `.user-coin-balance` exists nowhere in this codebase.
//      Code that renders and does nothing is this project's most expensive
//      recurring defect; the repaint is gone entirely, and `#banner-coins`
//      now follows `coinsUpdated` like every other balance on screen.
//
//   3. FOUR LANGUAGES.
//      Every string here was Turkish, in a game that ships in four
//      languages — including the segment labels drawn onto the canvas. The
//      file imported `Localization` and never called it. It does now, and
//      `check-locales` covers all 22 keys.

import { AudioManager } from './audioManager.js';
import { Localization } from './localization.js?v=3';
import { CardSkins } from './cardSkins.js';
import EventBus from './eventbus.js';
import { todayKey } from './dailyScore.js';
import { Settings } from './settings.js';

const LAST_SPIN_KEY = 'ers_last_spin_date';
/** The tier reached today, kept so closing the modal cannot revoke it. */
const TIER_KEY = 'ers_spin_tier';

/* ─────────────────────────────────────────────────────────────────────────
 * WHERE THE POINTER IS, AND WHY IT IS A NUMBER IN THIS FILE
 *
 * `.wheel-pointer` is `top: -12px; left: 50%` — it hangs over the TOP of the
 * wheel. Canvas angles start at 3 o'clock and grow clockwise, so the top edge
 * is 270°, and `drawWheel` puts segment i's middle at `i*arc + arc/2` in that
 * same system.
 *
 * The version this was ported from computed the landing angle as if the
 * pointer were at 0° — the RIGHT edge. 270° / 45° is six segments, so every
 * spin on an eight-segment wheel stopped six places away from the reward it
 * paid out. Not sometimes: measured in a browser, all 8 of 8 indices were off
 * by exactly 6. A wheel that pays a prize other than the one it stops on is
 * worse than a broken wheel, because the player can see it lying.
 *
 * The two functions below are exported so a test can prove the round trip
 * without a browser: put a segment under the pointer, then read back which
 * segment is under the pointer, and get the same index. `indexUnderPointer`
 * derives that from `drawWheel`'s convention alone — it never consults
 * `landingRotation` — so the pair cannot agree by sharing a mistake.
 * ───────────────────────────────────────────────────────────────────────── */

/** Screen angle the pointer occupies, in canvas degrees (0° = 3 o'clock). */
export const POINTER_DEG = 270;

/**
 * The absolute `rotate()` value that parks `winningIndex` under the pointer.
 *
 * ABSOLUTE, not additive. `currentRotation` accumulates across a session, so
 * adding an offset to it lands correctly only on the first spin; every later
 * spin inherits the previous one's remainder. This takes the next whole turn
 * past where the wheel already is, adds five more for the animation, and then
 * the one landing angle that is correct on its own.
 */
export function landingRotation(currentRotation, winningIndex, segmentCount, pointerDeg = POINTER_DEG) {
    const arcDeg = 360 / segmentCount;
    const midDeg = winningIndex * arcDeg + arcDeg / 2;
    const landing = (((pointerDeg - midDeg) % 360) + 360) % 360;
    const turns = Math.ceil(currentRotation / 360) + 5;
    return turns * 360 + landing;
}

/** Which segment a viewer sees under the pointer at a given rotation. */
export function indexUnderPointer(rotation, segmentCount, pointerDeg = POINTER_DEG) {
    const arcDeg = 360 / segmentCount;
    // Rotating the wheel clockwise by `rotation` moves the segment that was at
    // canvas angle θ to θ + rotation, so the pointer reads θ = pointer − rotation.
    const local = (((pointerDeg - rotation) % 360) + 360) % 360;
    return Math.floor(local / arcDeg) % segmentCount;
}

/* ─────────────────────────────────────────────────────────────────────────
 * HOW AN ANCIENT WHEEL TURNS (v3.17.0, DESIGN.md §4)
 *
 * The wheel used to glide: a 4s CSS cubic-bezier with no mass, the motion of a
 * settings toggle. A bronze wheel on a pivot does three things a glide does
 * not, and each one is a piece of the model below:
 *
 *   1. FRICTION.  It starts hard and loses speed on a long heavy tail — an
 *      ease-out with a steep exponent, not a symmetric curve.
 *   2. PEGS.      Studs sit on the rim at every segment boundary and a bronze
 *      pawl rides over them. Each crossing is a click and a flick of the
 *      pointer; fast at first, then countable, then one at a time.
 *   3. THE CATCH. The last peg stops it past centre and it rocks back into the
 *      segment — one damped return, no second swing.
 *
 * The catch is where this could lie, so it is bounded: the wheel overshoots by
 * SETTLE_OVERSHOOT of a segment, which is LESS THAN HALF, so the pointer never
 * leaves the winning segment during the rock-back. The player never sees the
 * wheel rest, even for a frame, on a prize it is not going to pay. A test walks
 * the whole settle and asserts exactly that, using `indexUnderPointer` — which
 * never consults this function — so the two cannot agree by sharing a mistake.
 *
 * ONE clock. The result is applied when THIS animation resolves, not on a
 * separate setTimeout. The old code had `transition: 4s` and `setTimeout(4100)`
 * — two numbers that had to agree, which is this project's most repeated
 * defect wearing a new hat.
 * ───────────────────────────────────────────────────────────────────────── */

/** Total length of a full-motion spin. Heavier than the old 4s glide on purpose. */
export const SPIN_MS = 4800;
/** Fraction of the spin at which the pawl catches and the rock-back begins. */
export const SETTLE_START = 0.86;
/** How far past centre the catch carries the wheel, as a fraction of one segment. */
export const SETTLE_OVERSHOOT = 0.3;
/** Clicks closer together than this merge into one — a buzz is not a tick. */
export const TICK_MIN_GAP_MS = 38;

/**
 * Rotation at progress `t` ∈ [0,1] of a spin from `from` to `to`.
 * Exactly `from` at 0 and exactly `to` at 1 — the landing is never approximate.
 */
export function ancientSpinAngle(t, from, to, segmentCount) {
    if (t <= 0) return from;
    if (t >= 1) return to;
    const over = (360 / segmentCount) * SETTLE_OVERSHOOT;
    const peak = to + over;
    if (t < SETTLE_START) {
        const u = t / SETTLE_START;
        return from + (peak - from) * (1 - Math.pow(1 - u, 3.4));
    }
    const v = (t - SETTLE_START) / (1 - SETTLE_START);
    return peak - over * (1 - Math.pow(1 - v, 2));
}

/** How many rim pegs passed under the pointer between two rotations. */
export function pegsCrossed(a, b, segmentCount, pointerDeg = POINTER_DEG) {
    const arcDeg = 360 / segmentCount;
    const slot = (r) => Math.floor((pointerDeg - r) / arcDeg);
    return Math.abs(slot(a) - slot(b));
}

/* Deterministic speckle for the painted-stone texture. Math.random would make
   every redraw — a language change, a tier change — reshuffle the grain, which
   reads as flicker rather than as stone. */
function lcg(seed) {
    let x = seed >>> 0;
    return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/* Metal per tier: highlight, body, shadow. The tier is told apart by the RIM,
   the way a bronze, silver or gold object is — not by a neon glow. */
const RIM_METAL = [
    ['#f0c27a', '#c07a3a', '#6b3d18'],   // bronze
    ['#f7f7fa', '#c3c3cc', '#6c6c78'],   // silver
    ['#fff2b0', '#dcb440', '#7d5c12']    // gold
];

/* The faces are painted, not dark: faience turquoise and terracotta, the two
   colours an Egyptian workshop actually had in a pot. Warm and readable at a
   glance — the wheel is a daily gift, so it should look like one. */
const FACE = {
    a: '#1f6b68',        // faience
    b: '#9a4a2c',        // terracotta
    empty: '#433a33',    // unpainted stone: an Empty reads as "nothing here"
    label: '#fff3d6',    // chalk cream, on both faces
    emptyLabel: '#d9c9b4'
};

export const DailySpin = {
    modal: null,
    wheelCanvas: null,
    spinBtn: null,
    statusText: null,
    countdownEl: null,
    closeBtn: null,
    footerCloseBtn: null,
    isSpinning: false,
    actionState: 'ready', // 'ready' | 'spinning' | 'won' | 'empty' | 'claimed' | 'tier-up'
    countdownTimer: null,
    currentRotation: 0,
    currentTier: 0, // 0 = bronze, 1 = silver, 2 = gold

    // Three tiers. `coins` is the reward; `type` is what the segment does.
    // Labels are BUILT at draw time from localization keys — the wheel is
    // drawn on a canvas, so a label baked in here would be untranslatable
    // in a way no gate could see.
    //
    // TIER FLOOR (v3.17.0, DESIGN.md §3.2) — "a climber does not come back
    // empty". Silver and Gold carry NO empty segment. Reaching Gold is a 1/64
    // event (two 1-in-8 climbs in a row); landing on "Empty" there turned the
    // rarest moment the wheel has into a punishment. The risk lives on Bronze,
    // and that is where the ladder gets its meaning from.
    //
    // The replacement values are not new numbers: each former Empty now pays
    // the LOWEST prize that tier already had (Silver 25, Gold 50). The tier's
    // floor becomes the floor; its top prizes are untouched, so the ladder's
    // aspiration is not inflated. The economy effect is DERIVED by the test
    // suite from this table, never typed: daily expected value from Bronze
    // 11.68 -> 12.66 coins, and it must stay under a third of one win (40/3).
    tiers: [
        {
            key: 'spinTierBronze', icon: '🥉', ringColor: '#cd7f32',
            segments: [
                { coins: 10, color: '#cd7f32', type: 'coin' },
                { coins: 0,  color: '#3d2a1a', type: 'empty' },
                { coins: 15, color: '#b87333', type: 'coin' },
                { coins: 0,  color: '#c0c0c0', type: 'tier-up' },
                { coins: 5,  color: '#a0622e', type: 'coin' },
                { coins: 0,  color: '#3d2a1a', type: 'empty' },
                { coins: 20, color: '#cd7f32', type: 'coin' },
                { coins: 10, color: '#a0622e', type: 'coin' }
            ]
        },
        {
            key: 'spinTierSilver', icon: '🥈', ringColor: '#c0c0c0',
            segments: [
                { coins: 30, color: '#a8a8a8', type: 'coin' },
                { coins: 25, color: '#969696', type: 'coin' },   // was Boş — see TIER FLOOR above
                { coins: 50, color: '#c0c0c0', type: 'coin' },
                { coins: 0,  color: '#ffd700', type: 'tier-up' },
                { coins: 25, color: '#969696', type: 'coin' },
                { coins: 40, color: '#b0b0b0', type: 'coin' },
                { coins: 25, color: '#969696', type: 'coin' },   // was Boş — see TIER FLOOR above; moved one slot so two 25s never sit side by side
                { coins: 35, color: '#a8a8a8', type: 'coin' }
            ]
        },
        {
            key: 'spinTierGold', icon: '🥇', ringColor: '#ffd700',
            segments: [
                { coins: 100, color: '#ffd700', type: 'coin' },
                { coins: 50,  color: '#c49b00', type: 'coin' },  // was Boş — see TIER FLOOR above
                { coins: 150, color: '#eab308', type: 'coin' },
                { coins: 200, color: '#f59e0b', type: 'coin' },
                { coins: 75,  color: '#d4a017', type: 'coin' },
                { coins: 50,  color: '#c49b00', type: 'coin' },  // was Boş — see TIER FLOOR above
                { coins: 125, color: '#fbbf24', type: 'coin' },
                { coins: 50,  color: '#c49b00', type: 'coin' }
            ]
        }
    ],

    get segments() {
        return this.tiers[this.currentTier].segments;
    },

    tierName(index) {
        return Localization.get(this.tiers[Math.min(Math.max(index, 0), 2)].key);
    },

    /** The text drawn into a wheel segment, in the player's language. */
    segmentLabel(seg) {
        if (seg.type === 'empty') return Localization.get('spinSegEmpty');
        if (seg.type === 'tier-up') {
            return Localization.get('spinSegUnlock').replace('{tier}', this.tierName(this.currentTier + 1));
        }
        // The number only: drawWheel stamps a painted coin beside it. The 🪙
        // emoji renders differently on every platform and was the one glossy
        // modern object on a painted wheel.
        return String(seg.coins);
    },

    init() {
        this.modal = document.getElementById('daily-spin-modal');
        this.wheelCanvas = document.getElementById('daily-spin-canvas');
        this.spinBtn = document.getElementById('btn-spin-action');
        this.statusText = document.getElementById('daily-spin-status');
        this.countdownEl = document.getElementById('daily-spin-countdown');
        this.closeBtn = document.getElementById('btn-close-spin');
        this.footerCloseBtn = document.getElementById('btn-close-spin-footer');
        const openBtn = document.getElementById('btn-daily-spin');

        if (!this.modal || !this.wheelCanvas) return;

        this.drawWheel();

        if (openBtn) openBtn.addEventListener('click', (e) => { e.preventDefault(); this.open(); });
        if (this.closeBtn) this.closeBtn.addEventListener('click', (e) => { e.preventDefault(); this.close(); });
        if (this.footerCloseBtn) this.footerCloseBtn.addEventListener('click', (e) => { e.preventDefault(); this.close(); });
        if (this.spinBtn) this.spinBtn.addEventListener('click', (e) => { e.preventDefault(); this.handleAction(); });

        // Backdrop click closes, but only the backdrop itself.
        this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.close(); });

        // The canvas carries text, so it has to be redrawn when the language
        // changes — the same reason ui.js re-renders its in-game strings.
        EventBus.on('languageChanged', () => {
            this.drawWheel();
            if (this.modal.classList.contains('active')) this.refreshStatus();
            this.setButtonState(this.actionState);
        });

        this.renderCoinBadge(CardSkins.getCoins());
        EventBus.on('coinsUpdated', (total) => this.renderCoinBadge(total));

        this.updateAvailabilityBadge();
    },

    /**
     * The only place this module paints a balance, and it paints ONE element.
     * Everything else that shows coins does so off the same `coinsUpdated`
     * event, which is why the award below goes through CardSkins.
     */
    renderCoinBadge(total) {
        const el = document.getElementById('banner-coins');
        if (el) el.textContent = String(total);
    },

    /**
     * UTC, via the same `todayKey()` the Daily Challenge uses.
     *
     * This was `new Date().toDateString()` — LOCAL midnight — and the game
     * already had a different answer six files away, with a comment saying
     * why and a test named "todayKey does not drift with local time".
     * Measured at 2026-09-09T22:30Z in Europe/Istanbul: the wheel had
     * flipped to the 10th while the Daily Challenge was still on the 9th.
     * Two features called "daily" in one game, resetting three hours apart.
     */
    canSpinToday() {
        try {
            return localStorage.getItem(LAST_SPIN_KEY) !== todayKey();
        } catch (e) {
            return true;
        }
    },

    consumeSpin() {
        try {
            localStorage.setItem(LAST_SPIN_KEY, todayKey());
            // The ladder is a single turn's climb, so it ends with the turn.
            localStorage.removeItem(TIER_KEY);
        } catch (e) { /* private mode: the spin simply is not remembered */ }
    },

    /* ── The unlocked tier survives closing the modal ───────────────────────
       A tier-up deliberately does NOT consume the day's spin, so `open()` runs
       its "spin available" branch again on the way back in — and that branch
       reset currentTier to 0. The wheel announced "Silver unlocked", the
       player closed the dialog to look at something, and came back to bronze
       with the unlock gone and nothing to show it had ever happened. Stored
       against today's key so it also survives a reload, and cleared by
       consumeSpin above, so tomorrow starts at bronze like it should. */
    saveTier() {
        try { localStorage.setItem(TIER_KEY, `${todayKey()}:${this.currentTier}`); }
        catch (e) { /* private mode: the climb lasts only as long as the dialog */ }
    },

    restoreTier() {
        try {
            const raw = localStorage.getItem(TIER_KEY);
            if (!raw) return 0;
            const [day, tier] = raw.split(':');
            if (day !== todayKey()) return 0;
            const n = Number(tier);
            return Number.isInteger(n) && n >= 0 && n <= 2 ? n : 0;
        } catch (e) { return 0; }
    },

    updateAvailabilityBadge() {
        const badge = document.getElementById('spin-badge-indicator');
        if (badge) badge.style.display = this.canSpinToday() ? 'inline-block' : 'none';
    },

    updateTierIndicator() {
        document.querySelectorAll('.tier-dot').forEach(dot => {
            const tier = parseInt(dot.dataset.tier, 10);
            dot.classList.toggle('active', tier === this.currentTier);
            dot.classList.toggle('completed', tier < this.currentTier);
            const label = dot.querySelector('.tier-dot-label');
            if (label) label.textContent = this.tierName(tier);
        });
    },

    setStatus(text, color) {
        if (!this.statusText) return;
        this.statusText.textContent = text;
        this.statusText.style.color = color;
    },

    refreshStatus() {
        if (this.canSpinToday()) {
            this.setStatus(Localization.get('spinReady'), '#ffd700');
        } else {
            this.setStatus(Localization.get('spinClaimed'), '#9ca3af');
        }
    },

    setButtonState(state) {
        this.actionState = state;
        if (!this.spinBtn) return;

        const tier = this.tiers[this.currentTier];
        const label = (key, text) => `<span>${text || Localization.get(key)}</span>`;

        if (state === 'ready') {
            this.spinBtn.disabled = false;
            this.spinBtn.className = 'btn primary spin-action-btn';
            this.spinBtn.innerHTML = label(null, `${tier.icon} ${Localization.get('spinBtnReady')}`);
        } else if (state === 'spinning') {
            this.spinBtn.disabled = true;
            this.spinBtn.className = 'btn primary spin-action-btn spin-btn-spinning';
            this.spinBtn.innerHTML = label(null, `🌀 ${Localization.get('spinBtnSpinning')}`);
        } else if (state === 'won') {
            this.spinBtn.disabled = false;
            this.spinBtn.className = 'btn primary spin-action-btn';
            this.spinBtn.innerHTML = label(null, `✨ ${Localization.get('spinBtnWon')}`);
        } else if (state === 'empty') {
            this.spinBtn.disabled = false;
            this.spinBtn.className = 'btn secondary spin-action-btn spin-claimed-btn';
            this.spinBtn.innerHTML = label(null, `💨 ${Localization.get('spinBtnEmpty')}`);
        } else if (state === 'tier-up') {
            const next = this.tiers[Math.min(this.currentTier + 1, 2)];
            this.spinBtn.disabled = false;
            this.spinBtn.className = 'btn primary spin-action-btn spin-tier-up-btn';
            this.spinBtn.innerHTML = label(null,
                `🔓 ${next.icon} ${Localization.get('spinBtnTierUp').replace('{tier}', this.tierName(this.currentTier + 1))}`);
        } else if (state === 'claimed') {
            this.spinBtn.disabled = false;
            this.spinBtn.className = 'btn secondary spin-action-btn spin-claimed-btn';
            this.spinBtn.innerHTML = label('spinBtnClaimed');
        }
    },

    startCountdown() {
        this.stopCountdown();
        const update = () => {
            if (!this.countdownEl) return;
            // Counts to the SAME instant the gate opens at — UTC midnight,
            // not the viewer's. A countdown to a different midnight than the
            // one that unlocks the spin is a clock that lies.
            const now = new Date();
            const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
            const diffMs = midnight - now.getTime();
            if (diffMs <= 0) { this.stopCountdown(); this.open(); return; }
            const pad = (n) => String(n).padStart(2, '0');
            const clock = `${pad(Math.floor(diffMs / 3600000))}:${pad(Math.floor((diffMs % 3600000) / 60000))}:${pad(Math.floor((diffMs % 60000) / 1000))}`;
            this.countdownEl.textContent = `⏳ ${Localization.get('spinNext').replace('{time}', clock)}`;
            this.countdownEl.style.display = 'inline-block';
        };
        update();
        this.countdownTimer = setInterval(update, 1000);
    },

    stopCountdown() {
        if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
        if (this.countdownEl) this.countdownEl.style.display = 'none';
    },

    /**
     * v3.17.0 — Ra's wheel as a painted OBJECT, not a widget (DESIGN.md §4).
     *
     * The modal, its buttons, its status line and its typeface are the shared
     * panel, untouched (P6). The wheel itself is a thing in the world the menu
     * art paints, so it is drawn as one: a metal rim in the tier's metal with
     * rivets the pointer rides over, painted faces with a stone grain, prizes
     * written in chalk with a stamped coin beside them, and Ra's sun at the hub.
     * Chosen by the operator over both the pre-3.17 wheel and a darker
     * lapis/umber draft: "samimi" — warm and friendly, a daily gift.
     *
     * Everything is drawn ONCE per drawWheel(); the spin rotates the canvas
     * element, so none of this cost is paid per frame.
     */
    drawWheel() {
        if (!this.wheelCanvas) return;
        const ctx = this.wheelCanvas.getContext('2d');
        if (!ctx) return;
        const segs = this.segments;
        const n = segs.length;
        const arc = (2 * Math.PI) / n;
        const size = this.wheelCanvas.width;
        const R = size / 2;
        const tierIdx = Math.min(Math.max(this.currentTier, 0), 2);
        const [hi, mid, lo] = RIM_METAL[tierIdx];
        const rimOuter = R - 3;
        const rimInner = R - 20;

        ctx.clearRect(0, 0, size, size);
        ctx.save();

        // Faces.
        segs.forEach((seg, i) => {
            const a0 = i * arc;
            ctx.beginPath();
            ctx.moveTo(R, R);
            ctx.arc(R, R, rimInner, a0, a0 + arc);
            ctx.closePath();
            if (seg.type === 'tier-up') {
                const g = ctx.createRadialGradient(R, R, 0, R, R, rimInner);
                g.addColorStop(0, tierIdx === 0 ? '#f2f2f2' : '#fff1a8');
                g.addColorStop(1, tierIdx === 0 ? '#8d8d95' : '#c08d12');
                ctx.fillStyle = g;
            } else if (seg.type === 'empty') {
                ctx.fillStyle = FACE.empty;
            } else {
                ctx.fillStyle = i % 2 === 0 ? FACE.a : FACE.b;
            }
            ctx.fill();
        });

        // Stone grain — seeded, so a redraw never reshuffles it.
        const rnd = lcg(0x5EED + tierIdx);
        for (let k = 0; k < 900; k++) {
            const ang = rnd() * 2 * Math.PI;
            const rr = Math.sqrt(rnd()) * (rimInner - 2);
            ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,240,210,0.07)' : 'rgba(0,0,0,0.10)';
            ctx.fillRect(R + Math.cos(ang) * rr, R + Math.sin(ang) * rr, 1.4, 1.4);
        }

        // Soft light from above-left, so the disc reads as a surface.
        const light = ctx.createRadialGradient(R * 0.7, R * 0.6, R * 0.1, R, R, rimInner);
        light.addColorStop(0, 'rgba(255, 236, 200, 0.16)');
        light.addColorStop(0.6, 'rgba(255, 236, 200, 0)');
        light.addColorStop(1, 'rgba(0, 0, 0, 0.28)');
        ctx.beginPath();
        ctx.arc(R, R, rimInner, 0, 2 * Math.PI);
        ctx.fillStyle = light;
        ctx.fill();

        // Dividers — thin metal inlay between faces.
        ctx.strokeStyle = hi;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < n; i++) {
            const a = i * arc;
            ctx.beginPath();
            ctx.moveTo(R, R);
            ctx.lineTo(R + Math.cos(a) * rimInner, R + Math.sin(a) * rimInner);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // Labels: chalk numbers, a stamped coin beside each prize.
        segs.forEach((seg, i) => {
            const mid = i * arc + arc / 2;
            const isCoin = seg.type === 'coin';
            const flipped = Math.cos(mid) < 0;
            const label = this.segmentLabel(seg);

            ctx.save();
            ctx.translate(R, R);
            ctx.rotate(flipped ? mid + Math.PI : mid);
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
            ctx.shadowBlur = 3;
            ctx.shadowOffsetY = 1;
            if (seg.type === 'tier-up') {
                ctx.fillStyle = tierIdx === 0 ? '#2e2e34' : '#4a3406';
                ctx.shadowColor = 'rgba(255, 255, 255, 0.35)';
                ctx.font = '800 13px Outfit, sans-serif';
            } else if (seg.type === 'empty') {
                ctx.fillStyle = FACE.emptyLabel;
                ctx.font = '700 14px Outfit, sans-serif';
            } else {
                ctx.fillStyle = FACE.label;
                ctx.font = '900 19px Outfit, sans-serif';
            }
            const textR = isCoin ? rimInner - 58 : rimInner - 16;
            ctx.textAlign = flipped ? 'left' : 'right';
            ctx.fillText(label, flipped ? -textR : textR, 0);
            ctx.restore();

            if (isCoin) {
                // The coin is stamped upright, outboard of the number.
                const cr = rimInner - 26;
                const cx = R + Math.cos(mid) * cr;
                const cy = R + Math.sin(mid) * cr;
                const g = ctx.createRadialGradient(cx - 2.5, cy - 2.5, 1, cx, cy, 9);
                g.addColorStop(0, '#fff6c8');
                g.addColorStop(0.55, '#e3b93c');
                g.addColorStop(1, '#8a6212');
                ctx.beginPath();
                ctx.arc(cx, cy, 8.5, 0, 2 * Math.PI);
                ctx.fillStyle = g;
                ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
                ctx.shadowBlur = 3;
                ctx.shadowOffsetY = 1;
                ctx.fill();
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.shadowOffsetY = 0;
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#7a5410';
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
                ctx.strokeStyle = 'rgba(122, 84, 16, 0.55)';
                ctx.stroke();
            }
        });

        // Rim — a metal band in the tier's metal.
        const rim = ctx.createLinearGradient(0, 0, size, size);
        rim.addColorStop(0, hi);
        rim.addColorStop(0.45, mid);
        rim.addColorStop(1, lo);
        ctx.beginPath();
        ctx.arc(R, R, rimOuter, 0, 2 * Math.PI);
        ctx.arc(R, R, rimInner, 0, 2 * Math.PI, true);
        ctx.fillStyle = rim;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = lo;
        ctx.beginPath();
        ctx.arc(R, R, rimOuter, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(R, R, rimInner, 0, 2 * Math.PI);
        ctx.stroke();

        // Small dots between the rivets — a friendly bead, not a scale.
        const beadR = (rimOuter + rimInner) / 2;
        for (let k = 0; k < n * 4; k++) {
            if (k % 4 === 0) continue;
            const a = (k / (n * 4)) * 2 * Math.PI;
            ctx.beginPath();
            ctx.arc(R + Math.cos(a) * beadR, R + Math.sin(a) * beadR, 1.6, 0, 2 * Math.PI);
            ctx.fillStyle = lo;
            ctx.globalAlpha = 0.55;
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Pegs — one per boundary: the rivets the pointer ticks against.
        for (let i = 0; i < n; i++) {
            const a = i * arc;
            const px = R + Math.cos(a) * beadR;
            const py = R + Math.sin(a) * beadR;
            const g = ctx.createRadialGradient(px - 1.5, py - 1.5, 0.5, px, py, 5.5);
            g.addColorStop(0, hi);
            g.addColorStop(0.6, mid);
            g.addColorStop(1, lo);
            ctx.beginPath();
            ctx.arc(px, py, 5.2, 0, 2 * Math.PI);
            ctx.fillStyle = g;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = lo;
            ctx.stroke();
        }

        // Hub — Ra's sun: rays in the tier's metal, a gold disk.
        const rays = 16;
        for (let k = 0; k < rays; k++) {
            const a = (k / rays) * 2 * Math.PI;
            const len = k % 2 === 0 ? 40 : 31;
            const w = 0.12;
            ctx.beginPath();
            ctx.moveTo(R + Math.cos(a - w) * 20, R + Math.sin(a - w) * 20);
            ctx.lineTo(R + Math.cos(a) * len, R + Math.sin(a) * len);
            ctx.lineTo(R + Math.cos(a + w) * 20, R + Math.sin(a + w) * 20);
            ctx.closePath();
            ctx.fillStyle = k % 2 === 0 ? mid : lo;
            ctx.fill();
        }
        const disk = ctx.createRadialGradient(R - 6, R - 6, 2, R, R, 24);
        disk.addColorStop(0, '#fff3b8');
        disk.addColorStop(0.5, '#f0bf3a');
        disk.addColorStop(1, '#a8740e');
        ctx.beginPath();
        ctx.arc(R, R, 23, 0, 2 * Math.PI);
        ctx.fillStyle = disk;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2;
        ctx.strokeStyle = lo;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(R, R, 13, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(120, 75, 10, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();
    },

    open() {
        if (!this.modal) return;
        this.modal.classList.add('active');
        this.modal.style.display = 'flex';

        if (this.canSpinToday()) {
            this.currentTier = this.restoreTier();
            this.currentRotation = 0;
            this.wheelCanvas.style.transition = 'none';
            this.wheelCanvas.style.transform = 'rotate(0deg)';
            this.stopCountdown();
            this.drawWheel();
            this.updateTierIndicator();
            this.setStatus(Localization.get('spinReady'), '#ffd700');
            this.setButtonState('ready');
        } else {
            this.setStatus(Localization.get('spinClaimed'), '#9ca3af');
            this.startCountdown();
            this.setButtonState('claimed');
        }
    },

    close() {
        if (!this.modal) return;
        this.stopCountdown();
        this.modal.classList.remove('active');
        this.modal.style.display = 'none';
        this.updateAvailabilityBadge();
    },

    handleAction() {
        if (this.actionState === 'ready') {
            this.spin();
        } else if (this.actionState === 'tier-up') {
            this.advanceTier();
        } else {
            this.playSfx('cardPlace');
            this.close();
        }
    },

    playSfx(name) {
        try {
            if (AudioManager && typeof AudioManager.playSFX === 'function') AudioManager.playSFX(name);
        } catch (e) { /* audio is never load-bearing */ }
    },

    advanceTier() {
        if (this.currentTier >= 2) return;
        this.currentTier++;
        this.saveTier();
        this.currentRotation = 0;

        this.wheelCanvas.style.transition = 'transform 0.5s ease-in';
        this.wheelCanvas.style.transform = 'scale(0.3) rotate(180deg)';
        this.playSfx('win');

        setTimeout(() => {
            this.drawWheel();
            this.updateTierIndicator();
            this.wheelCanvas.style.transition = 'transform 0.5s ease-out';
            this.wheelCanvas.style.transform = 'scale(1) rotate(0deg)';

            const tier = this.tiers[this.currentTier];
            this.setStatus(
                `${tier.icon} ` + Localization.get('spinTierEntered').replace('{tier}', this.tierName(this.currentTier)),
                tier.ringColor);
            this.setButtonState('ready');
        }, 550);
    },

    /** OS setting or the game's own Comfort toggle — either one is a "no". */
    prefersReducedMotion() {
        try {
            if (Settings.config && Settings.config.reducedMotion) return true;
            return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (e) { return false; }
    },

    playWheelSound(kind) {
        try {
            if (kind === 'tick' && typeof AudioManager.playWheelTick === 'function') AudioManager.playWheelTick();
            if (kind === 'catch' && typeof AudioManager.playWheelCatch === 'function') AudioManager.playWheelCatch();
        } catch (e) { /* audio is never load-bearing */ }
    },

    /**
     * The pawl flicks as a peg passes under it. It hangs from a hinge at the
     * top, so a peg moving RIGHT (the wheel turning forward) swings its tip
     * right — a negative CSS rotation — and the rock-back swings it the other
     * way. No forced reflow: while pegs arrive faster than the flick returns,
     * the pawl simply stays deflected, which is what a fast wheel looks like.
     */
    tickPointer(dir) {
        this.playWheelSound('tick');
        const p = this.pointerEl || (this.pointerEl = document.querySelector('.wheel-pointer'));
        if (!p) return;
        p.style.setProperty('--tick-deg', `${dir > 0 ? -14 : 14}deg`);
        p.classList.add('is-ticking');
        clearTimeout(this._tickTimer);
        this._tickTimer = setTimeout(() => p.classList.remove('is-ticking'), 70);
    },

    /**
     * Turns the wheel from `from` to `to` and resolves when it has STOPPED.
     * The caller applies the result on that resolution — there is no second
     * timer that has to agree with this one.
     */
    turnWheel(from, to, segmentCount) {
        const canvas = this.wheelCanvas;
        canvas.style.transition = 'none';

        if (this.prefersReducedMotion()) {
            // No turns, no rock-back, no clicks: the result, after one beat.
            canvas.style.transform = `rotate(${to}deg)`;
            this.playWheelSound('catch');
            return new Promise(resolve => setTimeout(resolve, 350));
        }

        const raf = (typeof window !== 'undefined' && window.requestAnimationFrame)
            ? window.requestAnimationFrame.bind(window)
            : (cb) => setTimeout(() => cb(Date.now()), 16);

        return new Promise(resolve => {
            let start = null;
            let last = from;
            let lastTick = -Infinity;
            let caught = false;
            const frame = (now) => {
                if (start === null) start = now;
                const t = Math.min(1, (now - start) / SPIN_MS);
                const angle = ancientSpinAngle(t, from, to, segmentCount);
                canvas.style.transform = `rotate(${angle}deg)`;
                if (pegsCrossed(last, angle, segmentCount) > 0 && now - lastTick >= TICK_MIN_GAP_MS) {
                    lastTick = now;
                    this.tickPointer(angle >= last ? 1 : -1);
                }
                if (!caught && t >= SETTLE_START) {
                    caught = true;
                    this.playWheelSound('catch');
                }
                last = angle;
                if (t < 1) {
                    raf(frame);
                } else {
                    canvas.style.transform = `rotate(${to}deg)`;
                    resolve();
                }
            };
            raf(frame);
        });
    },

    spin() {
        if (this.isSpinning || !this.canSpinToday()) return Promise.resolve();
        this.isSpinning = true;
        this.setButtonState('spinning');

        const tier = this.tiers[this.currentTier];
        this.setStatus(
            `${tier.icon} ` + Localization.get('spinSpinning').replace('{tier}', this.tierName(this.currentTier)),
            tier.ringColor);
        this.playSfx('cardPlace');

        const winningIndex = Math.floor(Math.random() * this.segments.length);
        const winningSegment = this.segments[winningIndex];
        const segmentCount = this.segments.length;
        const from = this.currentRotation;

        this.currentRotation = landingRotation(
            this.currentRotation, winningIndex, this.segments.length);

        // ONE clock. The prize is decided above and PAID when the wheel stops,
        // on the animation's own resolution — see "HOW AN ANCIENT WHEEL TURNS".
        return this.turnWheel(from, this.currentRotation, segmentCount).then(() => {
            this.isSpinning = false;

            // A tier-up does NOT consume the day's spin — that is the whole
            // point of the ladder: you climb on the same turn.
            if (winningSegment.type === 'tier-up') {
                this.playSfx('win');
                const next = this.tiers[Math.min(this.currentTier + 1, 2)];
                this.setStatus(
                    '🔓 ' + Localization.get('spinTierUnlocked').replace('{tier}', this.tierName(this.currentTier + 1)),
                    next.ringColor);
                this.setButtonState('tier-up');
                return;
            }

            this.consumeSpin();

            if (winningSegment.type === 'empty') {
                this.setStatus('💨 ' + Localization.get('spinEmpty'), '#ef4444');
                this.setButtonState('empty');
                this.updateAvailabilityBadge();
                return;
            }

            // THE award. CardSkins persists it and emits `coinsUpdated`, which
            // is what every balance on screen — the shop's and the banner's —
            // is already listening for. Writing the key directly here is what
            // made the two disagree in the version this was ported from.
            CardSkins.addCoins(winningSegment.coins);
            this.playSfx('win');

            this.setStatus(
                `🎉 ${tier.icon} ` + Localization.get('spinWon').replace('{n}', String(winningSegment.coins)),
                '#10b981');
            this.setButtonState('won');
            this.updateAvailabilityBadge();
        });
    }
};
