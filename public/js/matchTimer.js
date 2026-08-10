import { GameState } from './game.js';
import { GameManager } from './gameManager.js';
import EventBus from './eventbus.js';

// --- QUICK MATCH TIMER / BLITZ MODE (v2.9.0) ---
// Optional bounded-time offline match: when the clock runs out, whoever has
// the most cards wins (GameState.forceTimeUp()) instead of playing to full
// elimination. Offline-only by design — a synchronized countdown across
// multiple real players' devices in multiplayer is a genuinely harder
// problem (whose clock is authoritative?) and out of scope here, consistent
// with how BotPersonalities/BotNemesis are also offline-only.
export const MatchTimer = {
    intervalId: null,
    endTime: null,
    active: false,
    _listenerBound: false,

    start(durationSeconds) {
        this.stop();
        this.active = true;
        this.endTime = Date.now() + durationSeconds * 1000;
        const el = document.getElementById('match-timer-display');
        if (el) el.style.display = '';
        this._render();
        this.intervalId = setInterval(() => this._tick(), 250);

        if (!this._listenerBound) {
            this._listenerBound = true;
            // Belt-and-suspenders: stop immediately the moment ANY game-over
            // path fires (normal elimination, forceTimeUp, etc.) rather than
            // waiting up to 250ms for the next poll tick to notice.
            EventBus.on('gameOver', () => this.stop());
        }
    },

    stop() {
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = null;
        this.active = false;
        const el = document.getElementById('match-timer-display');
        if (el) el.style.display = 'none';
    },

    _tick() {
        if (!this.active) return;
        if (GameState.gameOver || GameManager.activeMode !== 'bots') {
            this.stop(); // Game ended some other way, or mode switched — stop cleanly.
            return;
        }
        const remainingMs = this.endTime - Date.now();
        if (remainingMs <= 0) {
            this.stop();
            GameState.forceTimeUp();
            return;
        }
        this._render(remainingMs);
    },

    _render(remainingMs) {
        const el = document.getElementById('match-timer-display');
        if (!el) return;
        const ms = remainingMs !== undefined ? remainingMs : (this.endTime - Date.now());
        const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        el.textContent = `⏱️ ${m}:${s.toString().padStart(2, '0')}`;
        el.classList.toggle('match-timer-critical', totalSeconds <= 30);
    }
};
