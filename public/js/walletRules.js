/**
 * walletRules.js — the pure half of wallet.js: every coin movement the
 * server will accept, computed without Firebase so the test suite can load it.
 *
 * SECURITY (v3.22.0). Until this release the balance lived in
 * localStorage['ers_coins'] and every skin in localStorage['ers_owned_skins'].
 * One console line set either to anything. The browser OWNED the ledger.
 *
 * Now the ledger is `wallets/{uid}` in Firestore and firestore.rules (block 6)
 * accepts exactly these moves from a player — each a separate shape, nothing
 * else:
 *
 *   spend     the balance goes DOWN (a loss, a quit). Harmless to allow.
 *   purchase  one catalogue skin is added and the balance drops by exactly its
 *             price. The price list lives in the rules, not in the request.
 *   earn      the balance goes up by at most EARN_PER_WRITE_MAX, and the UTC
 *             day's total may not pass EARN_DAILY_CAP.
 *   spin      at most SPIN_MAX, once per UTC day by the SERVER's clock.
 *   create    once per account: a one-time import of the old local balance,
 *             worth at most IMPORT_CAP counting skins at their price.
 *
 * Giving coins in any other amount is an ADMIN grant: only an account with a
 * document in `admins/` (created by hand in the Firebase console — no client
 * can write there) may do it, and each grant leaves an immutable audit record
 * in `coin_grants/`.
 *
 * What this does NOT do, stated plainly: the browser still decides who won a
 * match. A forger can claim wins — but no more than EARN_DAILY_CAP a day, the
 * same ceiling a real player meets. Only a server that referees the match can
 * close that (SECURITY.md).
 *
 * MIRRORED IN firestore.rules (walletSkinCost / the numeric caps). The test
 * suite fails the build if the two drift apart.
 */
import { CARD_SKINS } from './cardSkins.js';

export const EARN_PER_WRITE_MAX = 80;     // a win (40), or three marks crossed at once (70)
export const EARN_DAILY_CAP = 1200;       // ~30 wins a UTC day
export const SPIN_MAX = 200;              // the Gold wheel's top segment
export const IMPORT_CAP = 1000;           // one-time migration of a local balance
export const ADMIN_GRANT_MAX = 100000;    // one admin grant, either direction
export const ADMIN_DAILY_CAP = 20000;     // what one admin may GIVE a UTC day (council O1)
export const WALLET_FIELDS = Object.freeze(['coins', 'owned', 'earnDay', 'earnedToday', 'spinDay', 'lastGrantId', 'updatedAt']);
export const DAY_MS = 86400000;

/** Skin id -> price, for every skin that is bought (classic is free and always owned). */
export const SKIN_COSTS = Object.freeze(Object.fromEntries(
    CARD_SKINS.filter(s => s.cost > 0).map(s => [s.id, s.cost])));

/** The UTC day number the rules compute from request.time. */
export function dayNumber(ms = Date.now()) {
    return Math.floor(ms / DAY_MS);
}

/** A wallet as stored, with every field defaulted. */
export function normalizeWallet(data) {
    const d = data || {};
    const int = (v, dflt) => (Number.isInteger(v) ? v : dflt);
    const owned = Array.isArray(d.owned) ? d.owned.filter(s => typeof s === 'string') : [];
    if (!owned.includes('classic')) owned.unshift('classic');
    return {
        coins: Math.max(0, int(d.coins, 0)),
        owned,
        earnDay: int(d.earnDay, -1),
        earnedToday: int(d.earnedToday, 0),
        spinDay: int(d.spinDay, -1),
        lastGrantId: typeof d.lastGrantId === 'string' ? d.lastGrantId : ''
    };
}

/** How much more the player may earn today. */
export function earnRoom(w, now = Date.now()) {
    const today = dayNumber(now);
    const used = w.earnDay === today ? w.earnedToday : 0;
    return Math.max(0, EARN_DAILY_CAP - used);
}

/**
 * An earn of `amount`, clamped to what the rules accept. Returns null when
 * nothing may be written (zero, or the day is full).
 */
export function planEarn(w, amount, now = Date.now()) {
    const today = dayNumber(now);
    const want = Math.floor(Number(amount));
    if (!Number.isFinite(want) || want <= 0) return null;
    const granted = Math.min(want, EARN_PER_WRITE_MAX, earnRoom(w, now));
    if (granted <= 0) return null;
    const used = w.earnDay === today ? w.earnedToday : 0;
    return { coins: w.coins + granted, earnDay: today, earnedToday: used + granted, granted };
}

/** A spend (loss, quit). The balance never goes below zero. */
export function planSpend(w, amount) {
    const take = Math.floor(Number(amount));
    if (!Number.isFinite(take) || take <= 0 || w.coins <= 0) return null;
    const coins = Math.max(0, w.coins - take);
    return { coins, taken: w.coins - coins };
}

/** A purchase: one skin in, exactly its price out. */
export function planPurchase(w, skinId) {
    if (!Object.prototype.hasOwnProperty.call(SKIN_COSTS, skinId)) return { ok: false, reason: 'not_found' };
    if (w.owned.includes(skinId)) return { ok: false, reason: 'already_owned' };
    const cost = SKIN_COSTS[skinId];
    if (w.coins < cost) return { ok: false, reason: 'insufficient_funds', needed: cost - w.coins };
    return { ok: true, coins: w.coins - cost, owned: [...w.owned, skinId], cost };
}

/** Today's spin. `amount` 0 is an empty segment: it still uses the day. */
export function planSpin(w, amount, now = Date.now()) {
    const today = dayNumber(now);
    if (w.spinDay >= today) return { ok: false, reason: 'already_spun' };
    const n = Math.floor(Number(amount));
    if (!Number.isFinite(n) || n < 0 || n > SPIN_MAX) return { ok: false, reason: 'bad_amount' };
    return { ok: true, coins: w.coins + n, spinDay: today, granted: n };
}

/**
 * The one-time import of a pre-v3.22.0 local balance. Skins first, dearest
 * first, while they fit under IMPORT_CAP; coins fill what is left.
 */
export function planImport(localCoins, localOwned) {
    let room = IMPORT_CAP;
    const owned = ['classic'];
    const skins = [...new Set(Array.isArray(localOwned) ? localOwned : [])]
        .filter(id => Object.prototype.hasOwnProperty.call(SKIN_COSTS, id))
        .sort((a, b) => SKIN_COSTS[b] - SKIN_COSTS[a]);
    for (const id of skins) {
        if (SKIN_COSTS[id] <= room) { owned.push(id); room -= SKIN_COSTS[id]; }
    }
    const c = Math.floor(Number(localCoins));
    const coins = Number.isFinite(c) && c > 0 ? Math.min(c, room) : 0;
    return { coins, owned, earnDay: -1, earnedToday: 0, spinDay: -1, lastGrantId: '' };
}

/** What the rules value an imported wallet at. */
export function importValue(w) {
    return w.coins + w.owned.reduce((a, id) => a + (SKIN_COSTS[id] || 0), 0);
}

/** An admin grant: any non-zero amount within ADMIN_GRANT_MAX, never below zero. */
export function planGrant(w, amount) {
    const n = Math.trunc(Number(amount));
    if (!Number.isFinite(n) || n === 0 || Math.abs(n) > ADMIN_GRANT_MAX) return { ok: false, reason: 'bad_amount' };
    if (w.coins + n < 0) return { ok: false, reason: 'below_zero' };
    return { ok: true, coins: w.coins + n, amount: n };
}

/**
 * The admin's daily counter after a grant of `amount` (take-backs are not
 * counted). { ok:false } when the grant would pass ADMIN_DAILY_CAP.
 */
export function planAdminDaily(prev, amount, now = Date.now()) {
    const today = dayNumber(now);
    const p = prev || {};
    const used = p.day === today && Number.isInteger(p.given) ? p.given : 0;
    const given = used + (amount > 0 ? amount : 0);
    if (given > ADMIN_DAILY_CAP) return { ok: false, reason: 'admin_daily_cap', left: Math.max(0, ADMIN_DAILY_CAP - used) };
    return { ok: true, day: today, given };
}

/**
 * An in-memory ledger with the same contract as wallet.js — for the test
 * suite and the offline smoke test, which have no Firestore. Each call applies
 * the same plan the real ledger commits, synchronously.
 */
export function createMemoryLedger(sink, initial = {}, clock = () => Date.now()) {
    let w = normalizeWallet(initial);
    const publish = () => sink.setWallet({ ...w, owned: [...w.owned] });
    const ledger = {
        kind: 'memory',
        preview(amount) { return previewAward(w, amount, clock()); },
        canSpin() { return planSpin(w, 0, clock()).ok; },
        async earn(amount) { const p = planEarn(w, amount, clock()); if (!p) return 0; w = { ...w, ...p }; publish(); return p.granted; },
        async spend(amount) { const p = planSpend(w, amount); if (!p) return 0; w = { ...w, coins: p.coins }; publish(); return -p.taken; },
        async purchase(skinId) { const p = planPurchase(w, skinId); if (!p.ok) return p; w = { ...w, coins: p.coins, owned: p.owned }; publish(); return { ok: true, coins: p.coins }; },
        async claimSpin(amount) { const p = planSpin(w, amount, clock()); if (!p.ok) return p; w = { ...w, coins: p.coins, spinDay: p.spinDay }; publish(); return p; },
        snapshot() { return { ...w, owned: [...w.owned] }; }
    };
    sink.attachLedger(ledger);
    publish();
    return ledger;
}

/** The signed change an award of `amount` will make: an earn clamped to the day, a spend clamped to zero. */
export function previewAward(w, amount, now = Date.now()) {
    const n = Math.trunc(Number(amount)) || 0;
    if (n < 0) { const p = planSpend(w, -n); return p ? -p.taken : 0; }
    const p = planEarn(w, n, now);
    return p ? p.granted : 0;
}
