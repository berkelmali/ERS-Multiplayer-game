/**
 * errorCodes.js — v3.7.0
 *
 * Error classification, typed throws, and network deadlines.
 *
 * ZERO IMPORTS BY DESIGN. No DOM, no Firebase, no Localization. Every function
 * here is a pure function of its arguments, so the whole module is unit-testable
 * in plain node with no stubs. Anything that needs the DOM belongs in
 * errorScreen.js; anything that needs Firebase belongs at the call site.
 *
 * ── Why this module exists ───────────────────────────────────────────────────
 * Before v3.7.0 the app answered six genuinely different failures with one
 * sentence. `TableManager` threw bare English strings ("Table not found or
 * already full!", "Game already started!", "Not logged in"), and every caller
 * caught them into a single hardcoded message. A player who was offline, whose
 * write was refused, or who arrived one second after the host pressed Start was
 * told the table did not exist. Five of six were told something untrue.
 *
 * A stable `.ersCode` on the thrown error is what lets a catch block say *why*
 * without matching English prose it does not control.
 */

/** Stable machine codes. These are written to markup and matched by tests —
 *  never rename one without changing both. */
export const ERR = Object.freeze({
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    OFFLINE: 'OFFLINE',
    NETWORK: 'NETWORK',
    TIMEOUT: 'TIMEOUT',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    TABLE_NOT_FOUND: 'TABLE_NOT_FOUND',
    TABLE_FULL: 'TABLE_FULL',
    GAME_ALREADY_STARTED: 'GAME_ALREADY_STARTED',
    NOT_ENOUGH_PLAYERS: 'NOT_ENOUGH_PLAYERS',
    HOST_LEFT: 'HOST_LEFT',
    SYNC_LOST: 'SYNC_LOST',
    CLIPBOARD_DENIED: 'CLIPBOARD_DENIED',
    UNKNOWN: 'UNKNOWN'
});

const ALL_CODES = Object.freeze(Object.keys(ERR));

/**
 * The Localization key carrying the human reason for a code.
 *
 * Deliberately mechanical: `ERR.TABLE_FULL` -> `errReasonTableFull`. A test
 * asserts that every code in ERR has a key here AND that every key resolves in
 * all four languages, so a code can never reach a player as raw camelCase.
 * (Localization.get returns the KEY on a miss — not undefined, not a blank —
 * so an unresolved key ships as visible `errReasonTableFull` text.)
 */
export function reasonKeyFor(code) {
    if (!code || !ALL_CODES.includes(code)) return 'errReasonUnknown';
    // ABC_DEF -> errReasonAbcDef
    const camel = code.toLowerCase().replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
    return 'errReason' + camel.charAt(0).toUpperCase() + camel.slice(1);
}

export function isKnownCode(code) {
    return ALL_CODES.includes(code);
}

export function allCodes() {
    return ALL_CODES.slice();
}

/**
 * Build an Error carrying a stable code.
 * The `message` stays English and developer-facing — it goes to the console and
 * to the collapsed technical line, never to the player as their explanation.
 */
export function appError(code, message) {
    const err = new Error(message || code);
    err.ersCode = isKnownCode(code) ? code : ERR.UNKNOWN;
    return err;
}

/**
 * Firebase SDK error codes we can map with confidence. Anything not listed
 * falls through to the heuristics and then to UNKNOWN — guessing a specific
 * cause we cannot prove is exactly the defect this module exists to remove.
 */
const FIREBASE_CODE_MAP = Object.freeze({
    'permission-denied': ERR.PERMISSION_DENIED,
    'PERMISSION_DENIED': ERR.PERMISSION_DENIED,
    'unauthenticated': ERR.AUTH_REQUIRED,
    'unavailable': ERR.NETWORK,
    'deadline-exceeded': ERR.TIMEOUT,
    'not-found': ERR.TABLE_NOT_FOUND,
    'resource-exhausted': ERR.NETWORK,
    'auth/network-request-failed': ERR.NETWORK,
    'auth/too-many-requests': ERR.NETWORK,
    'auth/user-not-found': ERR.AUTH_REQUIRED,
    'auth/invalid-credential': ERR.AUTH_REQUIRED,
    'cancelled': ERR.NETWORK,
    'internal': ERR.NETWORK
});

/**
 * Classify any thrown value into exactly one ERR code.
 *
 * Order matters and the first match wins:
 *   1. our own `.ersCode` — a deliberate throw always beats a guess;
 *   2. `ctx.online === false`;
 *   3. the Firebase `.code`;
 *   4. narrow message heuristics;
 *   5. UNKNOWN.
 *
 * `ctx.online` is supplied by the caller as `navigator.onLine` and is trusted
 * ONLY in the negative direction. `navigator.onLine === true` means a link-layer
 * connection exists, which is not evidence that anything is reachable — so a
 * `true` value is never allowed to conclude anything. `false`, however, is
 * reliable, and it is the one signal that turns a generic failure into the
 * sentence the player actually needs: "your connection dropped".
 */
export function classifyError(error, ctx) {
    const online = ctx && Object.prototype.hasOwnProperty.call(ctx, 'online') ? ctx.online : true;

    if (error && typeof error === 'object' && isKnownCode(error.ersCode)) {
        return error.ersCode;
    }

    // A deliberate offline signal outranks any SDK code, because every SDK code
    // raised while the device is offline is a downstream symptom of that.
    if (online === false) return ERR.OFFLINE;

    const rawCode = error && typeof error === 'object' ? error.code : null;
    if (rawCode && Object.prototype.hasOwnProperty.call(FIREBASE_CODE_MAP, rawCode)) {
        return FIREBASE_CODE_MAP[rawCode];
    }

    const msg = (error && (error.message || String(error))) || '';
    const lower = msg.toLowerCase();

    // Heuristics stay narrow and are only reached when nothing authoritative
    // was available. Each phrase below is one the Firebase SDK actually emits.
    if (lower.includes('permission') || lower.includes('insufficient')) return ERR.PERMISSION_DENIED;
    if (lower.includes('network') || lower.includes('offline') ||
        lower.includes('unavailable') || lower.includes('failed to fetch')) return ERR.NETWORK;
    if (lower.includes('timeout') || lower.includes('deadline')) return ERR.TIMEOUT;
    if (lower.includes('clipboard')) return ERR.CLIPBOARD_DENIED;

    return ERR.UNKNOWN;
}

/* ─────────────────────────── Network deadlines ────────────────────────────
 *
 * The most expensive discovery of the ERS-08 review: before v3.7.0 the app had
 * no network deadline anywhere. `grep -rn "Promise.race\|AbortController"`
 * returned nothing across all 53 modules.
 *
 * That matters more than every catch block in the app combined. When the
 * connection drops during `await getDoc(...)`, the Firestore SDK does NOT
 * reject — it queues the read and retries with backoff indefinitely. The
 * promise never settles, `finally` never runs, `hideLoading()` never fires, and
 * the player is left staring at an undismissable full-screen "Searching for
 * table..." spinner. No catch block is ever entered, so no amount of better
 * error messaging in catch blocks can help: there is nothing to catch.
 *
 * A deadline is what converts that hang into a real rejection that the error
 * screen can then explain.
 */

export const DEFAULT_DEADLINE_MS = 10000;
export const LOADING_WATCHDOG_MS = 15000;

/**
 * An operation token.
 *
 * `Promise.race` does not cancel the loser. A `getDoc` that blew its deadline
 * can still resolve thirty seconds later and run its success continuation —
 * entering the waiting room behind an error screen the player has already
 * dismissed, or joining a table twice. The token is the guard: the deadline
 * cancels it, and every continuation checks it before touching shared state.
 *
 * Retry re-arms by creating a fresh token, which also makes a stale in-flight
 * attempt from the previous try inert.
 */
export function createOperationToken() {
    return {
        cancelled: false,
        cancel() { this.cancelled = true; },
        get active() { return !this.cancelled; }
    };
}

/**
 * Race `promise` against a deadline.
 *
 * On timeout: cancels `token` (if given) and rejects with a typed TIMEOUT error.
 * The underlying promise keeps running — we cannot abort a Firebase read — but
 * the cancelled token makes its late result unusable, which is the part that
 * actually protects state.
 *
 * `setTimeoutImpl` is injectable so the unit tests can drive the clock without
 * waiting ten real seconds.
 */
export function withDeadline(promise, ms, token, setTimeoutImpl, clearTimeoutImpl) {
    const delay = typeof ms === 'number' && ms > 0 ? ms : DEFAULT_DEADLINE_MS;
    const setT = setTimeoutImpl || (typeof setTimeout !== 'undefined' ? setTimeout : null);
    const clearT = clearTimeoutImpl || (typeof clearTimeout !== 'undefined' ? clearTimeout : null);
    if (!setT) return Promise.resolve(promise);

    let timer = null;
    const deadline = new Promise((_resolve, reject) => {
        timer = setT(() => {
            if (token && typeof token.cancel === 'function') token.cancel();
            reject(appError(ERR.TIMEOUT, 'deadline exceeded after ' + delay + 'ms'));
        }, delay);
    });

    return Promise.race([promise, deadline]).finally(() => {
        if (timer !== null && clearT) clearT(timer);
    });
}

/**
 * Read `navigator.onLine` defensively. Returns true when it cannot be read —
 * see classifyError: only `false` is ever allowed to conclude anything, so an
 * unavailable reading must not masquerade as "offline".
 */
export function readOnline(nav) {
    const n = nav || (typeof navigator !== 'undefined' ? navigator : null);
    if (!n || typeof n.onLine !== 'boolean') return true;
    return n.onLine;
}
