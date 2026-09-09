/**
 * rng.js — Deterministic random number utilities.
 *
 * Two independent tools, deliberately kept apart:
 *
 *  1. `Rng` — a *streaming* PRNG that can stand in for `Math.random()`.
 *     Used by `createDeck()`. When unseeded it forwards to `Math.random()`,
 *     so every existing code path behaves EXACTLY as before. Only Daily
 *     Challenge seeds it, and it clears the seed when that run ends.
 *
 *  2. `hashRandom(seed, ...coords)` — a *counter-based* PRNG. It returns a
 *     value that depends only on its arguments, never on how many numbers
 *     were drawn before it. This is what the Daily Challenge bots use:
 *     "bot 2's slap roll on card-play #17" is the same number for every
 *     player in the world, regardless of what happened earlier in their run.
 *     A streaming PRNG could not give that guarantee, because two players'
 *     runs consume a different number of draws.
 *
 * No dependencies — this file is pure and unit-testable from Node.
 */

/** FNV-1a — string → 32-bit unsigned seed. Stable across engines. */
export function hashStringToSeed(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** mulberry32 — small, fast, well-distributed 32-bit PRNG. */
export function makeRng(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Counter-based deterministic value in [0, 1).
 * `hashRandom(s, 2, 17, 1)` always returns the same float for the same inputs.
 */
export function hashRandom(seed, ...coords) {
    let h = (seed >>> 0) ^ 0x9e3779b9;
    for (const c of coords) {
        h ^= (c | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2);
        h = h >>> 0;
        h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    }
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
}

export const Rng = {
    _next: null,
    _seed: null,
    _coord: null,

    /** Switches `Rng.random()` over to a deterministic stream. */
    seed(seedValue) {
        this._seed = seedValue >>> 0;
        this._next = makeRng(this._seed);
    },

    /** Returns to plain `Math.random()`. Always called when a seeded run ends. */
    clear() {
        this._seed = null;
        this._next = null;
    },

    isSeeded() {
        return this._next !== null;
    },

    currentSeed() {
        return this._seed;
    },

    random() {
        return this._next ? this._next() : Math.random();
    },

    /**
     * Installs (or removes, with `null`) a counter-based source for `pick()`.
     * Only the Daily Challenge sets this; everything else keeps rolling
     * ordinary `Math.random()`.
     */
    setCoordSource(fn) {
        this._coord = typeof fn === 'function' ? fn : null;
    },

    /**
     * A roll identified by WHERE it happens rather than by WHEN.
     * `Rng.pick(botId, playCount, purpose)` returns the same number on every
     * machine running the same seeded scenario, and a plain random number
     * otherwise. See dailyChallenge.js for why order-independence is required.
     */
    pick(...coords) {
        return this._coord ? this._coord(...coords) : Math.random();
    }
};
