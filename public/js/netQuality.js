/**
 * netQuality.js — shared clock + connection quality.
 *
 * Two jobs:
 *
 * 1. A CLOCK EVERY CLIENT AGREES ON. Firebase publishes `.info/serverTimeOffset`,
 *    the signed difference between this device's clock and the database's.
 *    `serverNow()` applies it. Everything time-sensitive in multiplayer —
 *    `lastPlayTime`, slap reaction, the fair-slap contest window — is expressed
 *    on this clock instead of a local `Date.now()`, so a player whose laptop
 *    clock is 4 seconds fast no longer looks like a superhuman (or a cheat).
 *
 * 2. AN HONEST LATENCY READOUT. Round trips are measured by timing a tiny
 *    acknowledged write to the player's OWN presence node. Deliberately not to
 *    the game room: any write under `gameRooms/{id}` broadcasts a snapshot to
 *    every client in the match and would re-run the whole delta-sync pipeline
 *    several times a minute for a number nobody plays on. `presence/{uid}` is
 *    already writable by exactly this user (database.rules.json) and is watched
 *    by nobody.
 *
 * The readout is a median of the recent samples, not the latest one — a single
 * unlucky packet should not repaint the HUD red.
 */

import { ref as dbRef, onValue, set as dbSet, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { rtdb } from "./firebaseConfig.js";
import EventBus from "./eventbus.js";

const SAMPLE_INTERVAL_MS = 6000;
const SAMPLE_WINDOW = 5;

export const NetQuality = {
    offsetMs: 0,
    offsetKnown: false,
    samples: [],
    rttMs: null,
    tier: 'unknown',
    _unsubOffset: null,
    _timer: null,
    _uid: null,
    _inFlight: false,
    _initialized: false,

    init() {
        if (this._initialized) return;
        this._initialized = true;

        try {
            const offsetRef = dbRef(rtdb, '.info/serverTimeOffset');
            this._unsubOffset = onValue(offsetRef, (snap) => {
                const v = snap.val();
                if (typeof v === 'number' && Number.isFinite(v)) {
                    this.offsetMs = v;
                    this.offsetKnown = true;
                }
            }, () => { /* offline / rules — serverNow() degrades to Date.now() */ });
        } catch (e) {
            console.warn('[NetQuality] serverTimeOffset unavailable, falling back to local clock', e);
        }

        this.hudEl = document.getElementById('net-hud');
        this.hudDotEl = document.getElementById('net-hud-dot');
        this.hudTextEl = document.getElementById('net-hud-text');
    },

    /**
     * The database's "now", in ms. Falls back to the local clock before the
     * offset arrives — which is correct, because the offset is usually small
     * and a wrong-by-40ms clock is far better than a blocked start.
     */
    serverNow() {
        return Date.now() + (this.offsetKnown ? this.offsetMs : 0);
    },

    /**
     * Server ms → this device's ms.
     *
     * Everything written to the room is on the server clock, but the whole UI
     * (reflex readouts, animation timing, `Date.now() - lastPlayTime`) runs on
     * the local one. Converting once, at the sync boundary, means no other
     * module has to know which clock it is holding.
     */
    toLocal(serverMs) {
        const n = Number(serverMs);
        if (!Number.isFinite(n)) return Date.now();
        return n - (this.offsetKnown ? this.offsetMs : 0);
    },

    /** Begin sampling. Called when a multiplayer match starts. */
    start(uid) {
        this._uid = uid || null;
        this.stop(true);
        if (!this._uid) return;
        this.showHud(true);
        this._sample();
        this._timer = setInterval(() => this._sample(), SAMPLE_INTERVAL_MS);
    },

    stop(keepSamples = false) {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        if (!keepSamples) {
            this.samples = [];
            this.rttMs = null;
            this.tier = 'unknown';
            this.showHud(false);
        }
    },

    async _sample() {
        if (!this._uid || this._inFlight) return;
        this._inFlight = true;
        const t0 = Date.now();
        try {
            await dbSet(dbRef(rtdb, `presence/${this._uid}/ping`), serverTimestamp());
            this._record(Date.now() - t0);
        } catch (e) {
            // A failed probe is information too: treat it as a bad sample rather
            // than silently keeping a stale green light.
            this._record(1200);
        } finally {
            this._inFlight = false;
        }
    },

    _record(rtt) {
        this.samples.push(rtt);
        if (this.samples.length > SAMPLE_WINDOW) this.samples.shift();

        const sorted = [...this.samples].sort((a, b) => a - b);
        this.rttMs = sorted[Math.floor(sorted.length / 2)];
        this.tier = this.tierFor(this.rttMs);

        this.renderHud();
        EventBus.emit('netQualityChanged', { rttMs: this.rttMs, tier: this.tier });
    },

    tierFor(rtt) {
        if (rtt === null || rtt === undefined) return 'unknown';
        if (rtt < 120) return 'excellent';
        if (rtt < 250) return 'good';
        if (rtt < 450) return 'fair';
        return 'poor';
    },

    showHud(visible) {
        if (!this.hudEl) this.hudEl = document.getElementById('net-hud');
        if (this.hudEl) this.hudEl.style.display = visible ? 'flex' : 'none';
    },

    renderHud() {
        if (!this.hudEl) this.hudEl = document.getElementById('net-hud');
        if (!this.hudDotEl) this.hudDotEl = document.getElementById('net-hud-dot');
        if (!this.hudTextEl) this.hudTextEl = document.getElementById('net-hud-text');
        if (!this.hudEl || !this.hudTextEl) return;

        this.hudEl.className = `net-hud tier-${this.tier}`;
        this.hudTextEl.innerText = this.rttMs === null ? '—' : `${this.rttMs}ms`;
        // The tooltip is the whole point of showing this at all: it tells the
        // player their ping is NOT deciding their slaps any more.
        this.hudEl.title = `${this.rttMs ?? '—'}ms · fair-slap arbitration active`;
    }
};
