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

const LAST_SPIN_KEY = 'ers_last_spin_date';

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
                { coins: 0,  color: '#2a2a3a', type: 'empty' },
                { coins: 50, color: '#c0c0c0', type: 'coin' },
                { coins: 0,  color: '#ffd700', type: 'tier-up' },
                { coins: 25, color: '#969696', type: 'coin' },
                { coins: 0,  color: '#2a2a3a', type: 'empty' },
                { coins: 40, color: '#b0b0b0', type: 'coin' },
                { coins: 35, color: '#a8a8a8', type: 'coin' }
            ]
        },
        {
            key: 'spinTierGold', icon: '🥇', ringColor: '#ffd700',
            segments: [
                { coins: 100, color: '#ffd700', type: 'coin' },
                { coins: 0,   color: '#2b2114', type: 'empty' },
                { coins: 150, color: '#eab308', type: 'coin' },
                { coins: 200, color: '#f59e0b', type: 'coin' },
                { coins: 75,  color: '#d4a017', type: 'coin' },
                { coins: 0,   color: '#2b2114', type: 'empty' },
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
        return `${seg.coins} 🪙`;
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
        } catch (e) { /* private mode: the spin simply is not remembered */ }
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

    drawWheel() {
        if (!this.wheelCanvas) return;
        const ctx = this.wheelCanvas.getContext('2d');
        if (!ctx) return;
        const segs = this.segments;
        const arc = (2 * Math.PI) / segs.length;
        const size = this.wheelCanvas.width;
        const radius = size / 2;
        const tier = this.tiers[this.currentTier];

        ctx.clearRect(0, 0, size, size);

        ctx.beginPath();
        ctx.arc(radius, radius, radius - 2, 0, 2 * Math.PI);
        ctx.strokeStyle = tier.ringColor;
        ctx.lineWidth = 5;
        ctx.shadowColor = tier.ringColor;
        ctx.shadowBlur = 20;
        ctx.stroke();
        ctx.shadowBlur = 0;

        segs.forEach((seg, i) => {
            const angle = i * arc;
            ctx.beginPath();

            if (seg.type === 'empty') {
                ctx.fillStyle = seg.color;
            } else if (seg.type === 'tier-up') {
                const grad = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
                grad.addColorStop(0, seg.color);
                grad.addColorStop(1, this.currentTier === 0 ? '#808080' : '#b8860b');
                ctx.fillStyle = grad;
            } else {
                ctx.fillStyle = i % 2 === 0 ? '#1f1910' : '#2b2114';
            }

            ctx.strokeStyle = tier.ringColor;
            ctx.lineWidth = 2;
            ctx.moveTo(radius, radius);
            ctx.arc(radius, radius, radius - 8, angle, angle + arc);
            ctx.lineTo(radius, radius);
            ctx.fill();
            ctx.stroke();

            // Labels on the LEFT half of the wheel would otherwise be drawn
            // upside down — the segment's own rotation carries the text past
            // vertical. Flipping those by a further 180° and anchoring from
            // the other end keeps every label readable without moving it.
            ctx.save();
            ctx.translate(radius, radius);
            const mid = angle + arc / 2;
            const flipped = Math.cos(mid) < 0;
            ctx.rotate(flipped ? mid + Math.PI : mid);
            ctx.textAlign = flipped ? 'left' : 'right';
            ctx.textBaseline = 'alphabetic';

            if (seg.type === 'empty') {
                ctx.fillStyle = '#ff6b6b';
                ctx.font = 'bold 14px Outfit, sans-serif';
            } else if (seg.type === 'tier-up') {
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 12px Outfit, sans-serif';
            } else {
                ctx.fillStyle = seg.color;
                ctx.font = 'bold 15px Outfit, sans-serif';
            }

            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 4;
            ctx.fillText(this.segmentLabel(seg), flipped ? -(radius - 22) : radius - 22, 6);
            ctx.restore();
        });

        ctx.beginPath();
        ctx.arc(radius, radius, 26, 0, 2 * Math.PI);
        const hub = ctx.createRadialGradient(radius, radius, 0, radius, radius, 26);
        hub.addColorStop(0, '#2a2520');
        hub.addColorStop(1, '#14120f');
        ctx.fillStyle = hub;
        ctx.strokeStyle = tier.ringColor;
        ctx.lineWidth = 4;
        ctx.shadowColor = tier.ringColor;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = tier.ringColor;
        ctx.font = '20px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tier.icon, radius, radius);
    },

    open() {
        if (!this.modal) return;
        this.modal.classList.add('active');
        this.modal.style.display = 'flex';

        if (this.canSpinToday()) {
            this.currentTier = 0;
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

    spin() {
        if (this.isSpinning || !this.canSpinToday()) return;
        this.isSpinning = true;
        this.setButtonState('spinning');

        const tier = this.tiers[this.currentTier];
        this.setStatus(
            `${tier.icon} ` + Localization.get('spinSpinning').replace('{tier}', this.tierName(this.currentTier)),
            tier.ringColor);
        this.playSfx('cardPlace');

        const winningIndex = Math.floor(Math.random() * this.segments.length);
        const winningSegment = this.segments[winningIndex];

        const arcDeg = 360 / this.segments.length;
        const segmentOffset = (this.segments.length - 1 - winningIndex) * arcDeg + (arcDeg / 2);
        this.currentRotation = this.currentRotation + (360 * 5) + segmentOffset;

        this.wheelCanvas.style.transition = 'transform 4s cubic-bezier(0.15, 0.9, 0.25, 1)';
        this.wheelCanvas.style.transform = `rotate(${this.currentRotation}deg)`;

        setTimeout(() => {
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
        }, 4100);
    }
};
