/**
 * fairSlap.js — latency-compensated slap arbitration (pure logic).
 *
 * THE PROBLEM (COUNCIL.md, Competitive Player, `[Kesin]`):
 * multiplayer slaps were decided by whichever RTDB transaction committed first.
 * That is a race between NETWORK connections, not between REFLEXES. A player on
 * 40ms beats a player on 180ms even when the slower connection belonged to the
 * faster hand. Over a session that is a systematic, invisible tax on anyone not
 * sitting near the database region.
 *
 * THE FIX: stop measuring arrival, start measuring reaction.
 *
 *   reactionMs = serverNow() - lastPlayTime
 *
 * Both terms come from the SAME clock — Firebase's `.info/serverTimeOffset`
 * gives every client the server's notion of "now" to within a few milliseconds,
 * so this number is the player's actual reflex with the network subtracted out.
 *
 * The first valid slap does not win the pile any more; it opens a short CONTEST
 * WINDOW. Every valid slap that lands inside the window is recorded as a claim.
 * When the window closes, the LOWEST reactionMs wins. Ties break on the earliest
 * server-side arrival, then on seat index, so the outcome is identical on every
 * client that evaluates it.
 *
 * COST, STATED HONESTLY: it delays pile award by up to `WINDOW_MS`. That is why
 * `needsContest()` exists — a room with fewer than two live humans cannot have a
 * contested slap, so those rooms keep the old instant path and pay nothing. The
 * window is also skipped for invalid slaps: a burn is not a race.
 *
 * TRUST MODEL: `reactionMs` is self-reported, so a patched client could claim a
 * 1ms reflex. `sanitizeReaction()` clamps to a human floor, which stops the
 * naive version. It does not make this cheat-proof — real enforcement belongs in
 * the Cloud Function path (`FirebaseSync.USE_SERVER_VALIDATION`), which owns the
 * clock. Note that the *previous* behaviour was not cheat-proof either: a
 * patched client could always fire a slap transaction instantly. This changes
 * who wins an honest race; it does not claim to change who wins a dishonest one.
 *
 * Pure module: no imports, no DOM, no Firebase. Unit-tested in test_gameLogic.mjs.
 */

/** How long the window stays open, in server milliseconds. */
export const WINDOW_MS = 200;

/** Below this, a "reaction" is not a human one. Claims are clamped up to it. */
export const MIN_HUMAN_REACTION_MS = 80;

/** Above this, the sample is garbage (tab was suspended, clock skew, etc). */
export const MAX_REACTION_MS = 60000;

/** A contest older than this is force-resolved even if a client went silent. */
export const STALE_AFTER_MS = 5000;

/**
 * Contest arbitration only matters when two or more live humans could race.
 * Bots are excluded: their slaps are issued by the host client on a timer, so
 * they are not competing on latency in the first place.
 */
export function needsContest(players) {
    if (!Array.isArray(players)) return false;
    const liveHumans = players.filter(p =>
        p && typeof p.uid === 'string' && !p.uid.startsWith('bot_') && !p.eliminated
    );
    return liveHumans.length >= 2;
}

/** Clamps a self-reported reaction into a believable range. */
export function sanitizeReaction(reactionMs) {
    const n = Number(reactionMs);
    if (!Number.isFinite(n)) return MAX_REACTION_MS;
    if (n < MIN_HUMAN_REACTION_MS) return MIN_HUMAN_REACTION_MS;
    if (n > MAX_REACTION_MS) return MAX_REACTION_MS;
    return Math.round(n);
}


/**
 * Normalises `contest.claims` into a clean list.
 *
 * This filter is load-bearing, not defensive noise. Realtime Database coerces
 * an object whose keys are sequential integer strings into a JSON ARRAY on the
 * way out — so `{"3": {...}}` comes back as `[null, null, null, {...}]`. Without
 * dropping the holes, seats 0–2 would each read as a phantom claim with the
 * worst possible reaction: the right player would still win, but `claimCount()`
 * would report a four-way photo finish that never happened and
 * `winningMargin()` would be nonsense.
 */
function claimEntries(contest) {
    if (!contest || !contest.claims) return [];
    return Object.entries(contest.claims)
        .filter(([, v]) => v && typeof v === 'object')
        .map(([k, v]) => ({
            index: parseInt(k, 10),
            reactionMs: sanitizeReaction(v.r),
            at: Number(v.t) || 0
        }))
        .filter(e => Number.isInteger(e.index));
}

/**
 * @returns a fresh contest object ready to be written to the room.
 * `claims` is an object, not an array — RTDB drops sparse arrays.
 */
export function openContest(serverNow, claim, windowMs = WINDOW_MS) {
    const at = Number(serverNow) || 0;
    return {
        openedAt: at,
        deadline: at + windowMs,
        claims: {
            [String(claim.index)]: {
                r: sanitizeReaction(claim.reactionMs),
                t: at
            }
        }
    };
}

/**
 * Records one more claim. A seat that already claimed keeps its FIRST claim —
 * spamming the pile must not let a player retry for a better number.
 * @returns a new contest object (never mutates the input).
 */
export function addClaim(contest, serverNow, claim) {
    const key = String(claim.index);
    const claims = { ...(contest.claims || {}) };
    if (!claims[key]) {
        claims[key] = { r: sanitizeReaction(claim.reactionMs), t: Number(serverNow) || 0 };
    }
    return { ...contest, claims };
}

export function isExpired(contest, serverNow) {
    if (!contest) return false;
    return (Number(serverNow) || 0) >= Number(contest.deadline || 0);
}

export function isStale(contest, serverNow) {
    if (!contest) return false;
    return (Number(serverNow) || 0) > Number(contest.deadline || 0) + STALE_AFTER_MS;
}

/**
 * Picks the winner. Deterministic, so every client that runs it agrees.
 * Order: lowest reaction → earliest arrival → lowest seat index.
 * @returns {{index: number, reactionMs: number}|null}
 */
export function resolveContest(contest) {
    const entries = claimEntries(contest);

    if (entries.length === 0) return null;

    entries.sort((a, b) =>
        (a.reactionMs - b.reactionMs) || (a.at - b.at) || (a.index - b.index)
    );
    return { index: entries[0].index, reactionMs: entries[0].reactionMs };
}

/** How many seats are contesting — used for the "photo finish" callout. */
export function claimCount(contest) {
    return claimEntries(contest).length;
}

/**
 * Margin of victory in ms between first and second place, or null when the slap
 * was uncontested. Drives the "won by 12ms" line on the winner's screen.
 */
export function winningMargin(contest) {
    const rs = claimEntries(contest).map(e => e.reactionMs).sort((a, b) => a - b);
    return rs.length >= 2 ? rs[1] - rs[0] : null;
}
