/**
 * tools/firestore-rules-test.mjs — runs firestore.rules instead of reading it.
 *
 * Security review, v3.18.0. The Firestore rules changed in three places that
 * decide who can read what: /users became private (it held every player's
 * email and was world-readable), /leaderboard became a mirror whose score must
 * equal the private record's, and /multiplayer_tables stopped letting any
 * signed-in stranger rewrite any table. A source scan cannot prove any of that,
 * so this file drives the real Firestore emulator over its REST API, with no
 * new dependencies — the same approach as tools/rules-test.mjs for the RTDB.
 *
 * It does three things:
 *   1. SELF-CHECK — proves it can tell an allowed request from a refused one
 *      before judging any rule (a harness that cannot fail is not a gate).
 *   2. SCENARIOS — each one a sentence about the game.
 *   3. MUTANTS — the same scenarios against deliberately broken copies of the
 *      rules. A mutant nothing catches is ESCAPED and fails the run.
 *
 * Run by deploy-rules.bat, before anything is sent:
 *   npx firebase-tools emulators:exec --only firestore --project ers-card-game "node tools/firestore-rules-test.mjs"
 */
import { readFileSync } from 'node:fs';

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const PROJECT = process.env.ERS_PROJECT || 'ers-card-game';
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const BASE = `http://${HOST}/v1/${ROOT}`;
const RULES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail = '') {
    if (cond) { pass++; console.log(`PASS ${label}`); }
    else { fail++; failures.push(label); console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

// ── auth ────────────────────────────────────────────────────────────────────
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function tokenFor(uid) {
    const now = Math.floor(Date.now() / 1000);
    return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
        sub: uid, user_id: uid, iat: now, exp: now + 3600, auth_time: now,
        aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`,
        firebase: { sign_in_provider: 'password', identities: {} }
    }) + '.';
}
const ADMIN = 'owner';          // the emulator's rule-bypassing superuser
const ANON = null;

// ── value encoding ──────────────────────────────────────────────────────────
const SERVER_TIME = Symbol('serverTime');
function enc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (Number.isInteger(v)) return { integerValue: String(v) };
    if (typeof v === 'number') return { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    return { mapValue: { fields: encFields(v) } };
}
function encFields(o) {
    const f = {};
    for (const [k, v] of Object.entries(o)) if (v !== SERVER_TIME) f[k] = enc(v);
    return f;
}

// ── requests ────────────────────────────────────────────────────────────────
async function http(method, url, who, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (who) headers.Authorization = `Bearer ${who === ADMIN ? 'owner' : tokenFor(who)}`;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, text };
}
/**
 * One commit of several writes. Each write: { path, data, mask?, mustNotExist? }.
 * `mask` lists the fields this write touches (the rest of the document is kept,
 * which is what the client SDK's update() does); a masked field absent from
 * `data` is DELETED. A SERVER_TIME value becomes a request-time transform.
 */
async function commit(who, writes) {
    const body = {
        writes: writes.map(w => {
            const out = { update: { name: `${ROOT}/${w.path}`, fields: encFields(w.data) } };
            const plain = Object.keys(w.data).filter(k => w.data[k] !== SERVER_TIME);
            if (w.mask) out.updateMask = { fieldPaths: w.mask.filter(k => w.data[k] !== SERVER_TIME) };
            const ts = Object.keys(w.data).filter(k => w.data[k] === SERVER_TIME);
            if (ts.length) out.updateTransforms = ts.map(k => ({ fieldPath: k, setToServerValue: 'REQUEST_TIME' }));
            if (w.mustNotExist) out.currentDocument = { exists: false };
            if (!w.mask && plain.length === 0 && !ts.length) out.update.fields = {};
            return out;
        })
    };
    return http('POST', `${BASE}:commit`, who, body);
}
const allowed = (r) => r.status === 200;
const get = (who, path) => http('GET', `${BASE}/${path}`, who);
const seed = (path, data) => commit(ADMIN, [{ path, data }]);
async function reset() {
    await http('DELETE', `http://${HOST}/emulator/v1/${ROOT}`, null);
}
async function loadRules(content) {
    const r = await http('PUT', `http://${HOST}/emulator/v1/projects/${PROJECT}:securityRules`, null,
        { rules: { files: [{ name: 'firestore.rules', content }] } });
    if (r.status !== 200) throw new Error(`rules did not load (${r.status}): ${r.text.slice(0, 400)}`);
}

// ── fixtures ────────────────────────────────────────────────────────────────
const LONG_AGO = () => new Date(Date.now() - 60_000);
const JUST_NOW = () => new Date(Date.now() - 1_000);
const record = (over = {}) => ({ username: 'Berk', totalScore: 5, gamesPlayed: 9, gamesWon: 5, bestReflex: 400, updatedAt: LONG_AGO(), ...over });
const table = (over = {}) => ({
    tableId: 'ABC123', hostId: 'host', hostUsername: 'Host',
    players: [{ uid: 'host', name: 'Host', index: 0 }, { uid: 'mem', name: 'Mem', index: 1 }],
    playerIds: { host: true, mem: true }, houseRules: 'doubles,sandwich,tens,marriage', god: null,
    gameState: { status: 'waiting', playerCount: 2 }, ...over
});

// Wallets (v3.22.0). `today` is the UTC day number the rules compute.
const TODAY = Math.floor(Date.now() / 86400000);
const wallet = (over = {}) => ({ coins: 100, owned: ['classic'], earnDay: TODAY, earnedToday: 0, spinDay: TODAY - 1, updatedAt: LONG_AGO(), ...over });
const wUpd = (who, uid, data) => commit(who, [{ path: `wallets/${uid}`, data: { ...data, updatedAt: SERVER_TIME }, mask: [...Object.keys(data), 'updatedAt'] }]);
const newWallet = (over = {}) => ({ coins: 0, owned: ['classic'], earnDay: -1, earnedToday: 0, spinDay: -1, updatedAt: SERVER_TIME, ...over });
/** An admin grant as the client commits it: the audit record and the wallet, atomically. */
const grant = (who, to, before, amount, id = 'G1', over = {}, givenBefore = 0) => commit(who, [
    { path: `coin_grants/${id}`, data: { to, by: who, amount, before, after: before + amount, note: 'test', at: SERVER_TIME, ...over } },
    { path: `wallets/${to}`, data: { coins: before + amount, lastGrantId: id, updatedAt: SERVER_TIME }, mask: ['coins', 'lastGrantId', 'updatedAt'] },
    // v3.22.1 (council O1): the admin's daily counter moves in the same commit.
    { path: `admin_daily/${who}`, data: { day: TODAY, given: givenBefore + (amount > 0 ? amount : 0), lastGrantId: id } }
]);

/** Each scenario: [sentence, expected allowed?, async () => response]. */
const SCENARIOS = [
    // ── Coins: the ledger is the server's ───────────────────────────────────
    ['a player creates an empty wallet', true, async () =>
        commit('p1', [{ path: 'wallets/p1', data: newWallet() }])],
    ['a player imports an old local balance worth 1000', true, async () =>
        commit('p1', [{ path: 'wallets/p1', data: newWallet({ coins: 500, owned: ['classic', 'obsidian'] }) }])],
    ['an import worth more than 1000 is refused', false, async () =>
        commit('p1', [{ path: 'wallets/p1', data: newWallet({ coins: 1, owned: ['classic', 'pharaoh'] }) }])],
    ['the Deck of the Gods (2000) cannot be imported: it alone passes the cap', false, async () =>
        commit('p1', [{ path: 'wallets/p1', data: newWallet({ owned: ['classic', 'gods'] }) }])],
    ['buying the Deck of the Gods costs exactly 2000', true, async () => {
        await seed('wallets/p1', wallet({ coins: 2000 })); return wUpd('p1', 'p1', { coins: 0, owned: ['classic', 'gods'] }); }],
    ['a 999999-coin import is refused', false, async () =>
        commit('p1', [{ path: 'wallets/p1', data: newWallet({ coins: 999999 }) }])],
    ['an import may not bring a skin that is not in the catalogue', false, async () =>
        commit('p1', [{ path: 'wallets/p1', data: newWallet({ owned: ['classic', 'dragon'] }) }])],
    ['an import may not pre-claim today\'s spin or earnings', false, async () =>
        commit('p1', [{ path: 'wallets/p1', data: newWallet({ spinDay: TODAY + 5 }) }])],
    ['nobody creates a wallet for someone else', false, async () =>
        commit('evil', [{ path: 'wallets/p1', data: newWallet() }])],
    ['a wallet is private', false, async () => {
        await seed('wallets/p1', wallet()); return get('evil', 'wallets/p1'); }],
    ['a player reads their own wallet', true, async () => {
        await seed('wallets/p1', wallet()); return get('p1', 'wallets/p1'); }],
    ['THE CONSOLE ATTACK: setting the balance to 1000000 is refused', false, async () => {
        await seed('wallets/p1', wallet()); return wUpd('p1', 'p1', { coins: 1000000 }); }],
    ['a win pays 40', true, async () => {
        await seed('wallets/p1', wallet()); return wUpd('p1', 'p1', { coins: 140, earnDay: TODAY, earnedToday: 40 }); }],
    ['an earn above 80 in one write is refused', false, async () => {
        await seed('wallets/p1', wallet()); return wUpd('p1', 'p1', { coins: 181, earnDay: TODAY, earnedToday: 81 }); }],
    ['an earn that lies about the day\'s total is refused', false, async () => {
        await seed('wallets/p1', wallet({ earnedToday: 1190 })); return wUpd('p1', 'p1', { coins: 140, earnDay: TODAY, earnedToday: 40 }); }],
    ['an earn past the 1200 daily cap is refused', false, async () => {
        await seed('wallets/p1', wallet({ earnedToday: 1190 })); return wUpd('p1', 'p1', { coins: 140, earnDay: TODAY, earnedToday: 1230 }); }],
    ['earning up to exactly the daily cap is allowed', true, async () => {
        await seed('wallets/p1', wallet({ earnedToday: 1190 })); return wUpd('p1', 'p1', { coins: 110, earnDay: TODAY, earnedToday: 1200 }); }],
    ['a new UTC day resets the earning total', true, async () => {
        await seed('wallets/p1', wallet({ earnDay: TODAY - 1, earnedToday: 1200 })); return wUpd('p1', 'p1', { coins: 140, earnDay: TODAY, earnedToday: 40 }); }],
    ['an earn dated to a future day is refused', false, async () => {
        await seed('wallets/p1', wallet({ earnedToday: 1200 })); return wUpd('p1', 'p1', { coins: 140, earnDay: TODAY + 1, earnedToday: 40 }); }],
    ['a loss costs 15', true, async () => {
        await seed('wallets/p1', wallet()); return wUpd('p1', 'p1', { coins: 85 }); }],
    ['the balance cannot go below zero', false, async () => {
        await seed('wallets/p1', wallet({ coins: 10 })); return wUpd('p1', 'p1', { coins: -5 }); }],
    ['buying Obsidian costs exactly 500', true, async () => {
        await seed('wallets/p1', wallet({ coins: 600 })); return wUpd('p1', 'p1', { coins: 100, owned: ['classic', 'obsidian'] }); }],
    ['buying Obsidian for 1 coin is refused', false, async () => {
        await seed('wallets/p1', wallet({ coins: 600 })); return wUpd('p1', 'p1', { coins: 599, owned: ['classic', 'obsidian'] }); }],
    ['granting yourself a skin for free is refused', false, async () => {
        await seed('wallets/p1', wallet()); return wUpd('p1', 'p1', { owned: ['classic', 'pharaoh'] }); }],
    ['buying two skins for the price of one is refused', false, async () => {
        await seed('wallets/p1', wallet({ coins: 600 })); return wUpd('p1', 'p1', { coins: 450, owned: ['classic', 'golden', 'pharaoh'] }); }],
    ['buying a skin you cannot afford is refused', false, async () => {
        await seed('wallets/p1', wallet({ coins: 100 })); return wUpd('p1', 'p1', { coins: -50, owned: ['classic', 'golden'] }); }],
    ['today\'s spin pays up to 200', true, async () => {
        await seed('wallets/p1', wallet()); return wUpd('p1', 'p1', { coins: 300, spinDay: TODAY }); }],
    ['an empty spin still uses the day', true, async () => {
        await seed('wallets/p1', wallet()); return wUpd('p1', 'p1', { spinDay: TODAY }); }],
    ['a second spin on the same day is refused', false, async () => {
        await seed('wallets/p1', wallet({ spinDay: TODAY })); return wUpd('p1', 'p1', { coins: 150, spinDay: TODAY }); }],
    ['a spin worth more than 200 is refused', false, async () => {
        await seed('wallets/p1', wallet()); return wUpd('p1', 'p1', { coins: 400, spinDay: TODAY }); }],
    ['a player cannot write a fake grant id to their own wallet', false, async () => {
        await seed('wallets/p1', wallet()); return wUpd('p1', 'p1', { coins: 5000, lastGrantId: 'X' }); }],
    ['a wallet cannot be deleted', false, async () => {
        await seed('wallets/p1', wallet()); return http('DELETE', `${BASE}/wallets/p1`, 'p1'); }],
    // ── Admin grants ────────────────────────────────────────────────────────
    ['nobody makes themselves an admin', false, async () =>
        commit('p1', [{ path: 'admins/p1', data: { note: 'me' } }])],
    ['a non-admin cannot grant coins, even with an audit record', false, async () => {
        await seed('wallets/p1', wallet()); return grant('p2', 'p1', 100, 1000); }],
    ['a player cannot grant coins to themselves', false, async () => {
        await seed('wallets/p1', wallet()); return grant('p1', 'p1', 100, 1000); }],
    ['an admin grants 1000 coins with an audit record', true, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        return grant('boss', 'p1', 100, 1000); }],
    ['an admin may take coins back, never below zero', true, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        return grant('boss', 'p1', 100, -100); }],
    ['...and a take-back below zero is refused', false, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        return grant('boss', 'p1', 100, -101); }],
    ['an admin grant that does not move the admin\'s daily counter is refused', false, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        return commit('boss', [
            { path: 'coin_grants/G1', data: { to: 'p1', by: 'boss', amount: 10, before: 100, after: 110, note: '', at: SERVER_TIME } },
            { path: 'wallets/p1', data: { coins: 110, lastGrantId: 'G1', updatedAt: SERVER_TIME }, mask: ['coins', 'lastGrantId', 'updatedAt'] }]); }],
    ['an admin may give up to 20000 a day', true, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        await seed('admin_daily/boss', { day: TODAY, given: 19000, lastGrantId: 'OLD' });
        return grant('boss', 'p1', 100, 1000, 'G1', {}, 19000); }],
    ['...and not one coin more (a stolen password is capped)', false, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        await seed('admin_daily/boss', { day: TODAY, given: 19500, lastGrantId: 'OLD' });
        return grant('boss', 'p1', 100, 1000, 'G1', {}, 19500); }],
    ['...yesterday\'s total does not count today', true, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        await seed('admin_daily/boss', { day: TODAY - 1, given: 20000, lastGrantId: 'OLD' });
        return grant('boss', 'p1', 100, 1000, 'G1', {}, 0); }],
    ['...a take-back does not use the day\'s allowance', true, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        await seed('admin_daily/boss', { day: TODAY, given: 20000, lastGrantId: 'OLD' });
        return grant('boss', 'p1', 100, -50, 'G1', {}, 20000); }],
    ['an admin cannot reset their own daily counter', false, async () => {
        await seed('admins/boss', { note: 'owner' });
        await seed('admin_daily/boss', { day: TODAY, given: 20000, lastGrantId: 'OLD' });
        return commit('boss', [{ path: 'admin_daily/boss', data: { day: TODAY, given: 0, lastGrantId: 'NEW' } }]); }],
    ['...nor understate a grant in it', false, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        await seed('admin_daily/boss', { day: TODAY, given: 19000, lastGrantId: 'OLD' });
        return commit('boss', [
            { path: 'coin_grants/G1', data: { to: 'p1', by: 'boss', amount: 5000, before: 100, after: 5100, note: '', at: SERVER_TIME } },
            { path: 'wallets/p1', data: { coins: 5100, lastGrantId: 'G1', updatedAt: SERVER_TIME }, mask: ['coins', 'lastGrantId', 'updatedAt'] },
            { path: 'admin_daily/boss', data: { day: TODAY, given: 19001, lastGrantId: 'G1' } }]); }],
    ['an admin grant without its audit record is refused', false, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        return wUpd('boss', 'p1', { coins: 1100, lastGrantId: 'NOPE' }); }],
    ['an audit record whose amount differs from the balance change is refused', false, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        return commit('boss', [
            { path: 'coin_grants/G1', data: { to: 'p1', by: 'boss', amount: 10, before: 100, after: 110, note: '', at: SERVER_TIME } },
            { path: 'wallets/p1', data: { coins: 5100, lastGrantId: 'G1', updatedAt: SERVER_TIME }, mask: ['coins', 'lastGrantId', 'updatedAt'] },
            // The counter is written correctly, so ONLY the amount mismatch can refuse this.
            { path: 'admin_daily/boss', data: { day: TODAY, given: 10, lastGrantId: 'G1' } }]); }],
    ['an admin cannot hang a big change on an old, small audit record', false, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        await seed('coin_grants/G0', { to: 'p1', by: 'boss', amount: 5, before: 0, after: 5, note: '', at: LONG_AGO() });
        return wUpd('boss', 'p1', { coins: 5100, lastGrantId: 'G0' }); }],
    ['an admin cannot replay an old audit record, even for the same amount', false, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        await seed('coin_grants/G0', { to: 'p1', by: 'boss', amount: 5, before: 0, after: 5, note: '', at: LONG_AGO() });
        return wUpd('boss', 'p1', { coins: 105, lastGrantId: 'G0' }); }],
    ['an audit record cannot be written in another admin\'s name', false, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        return grant('boss', 'p1', 100, 1000, 'G1', { by: 'someone' }); }],
    ['an audit record cannot be edited', false, async () => {
        await seed('admins/boss', { note: 'owner' });
        await seed('coin_grants/G1', { to: 'p1', by: 'boss', amount: 5, before: 0, after: 5, note: '', at: LONG_AGO() });
        return commit('boss', [{ path: 'coin_grants/G1', data: { amount: 5000 }, mask: ['amount'] }]); }],
    ['the audit trail is hidden from players', false, async () => {
        await seed('coin_grants/G1', { to: 'p1', by: 'boss', amount: 5, before: 0, after: 5, note: '', at: LONG_AGO() });
        return get('p1', 'coin_grants/G1'); }],
    ['an admin reads any wallet', true, async () => {
        await seed('admins/boss', { note: 'owner' }); await seed('wallets/p1', wallet());
        return get('boss', 'wallets/p1'); }],
    ['a player can see whether they are an admin', true, async () => {
        await seed('admins/boss', { note: 'owner' }); return get('boss', 'admins/boss'); }],
    ['...but not who else is', false, async () => {
        await seed('admins/boss', { note: 'owner' }); return get('p1', 'admins/boss'); }],
    // ── Player records ──────────────────────────────────────────────────────
    // Users: the leak
    ['a stranger cannot read another player\'s record (it may still hold an email)', false, async () => {
        await seed('users/u1', record({ email: 'a@b.c' })); return get('u2', 'users/u1'); }],
    ['nobody signed out can read a player\'s record', false, async () => {
        await seed('users/u1', record({ email: 'a@b.c' })); return get(ANON, 'users/u1'); }],
    ['nobody can LIST the player records', false, async () => {
        await seed('users/u1', record()); return get('u2', 'users'); }],
    ['a player reads their own record', true, async () => {
        await seed('users/u1', record()); return get('u1', 'users/u1'); }],
    // Users: creation
    ['a new record cannot carry an email', false, async () =>
        commit('u1', [{ path: 'users/u1', data: { username: 'Berk', totalScore: 0, gamesPlayed: 0, gamesWon: 0, email: 'a@b.c' } }])],
    ['a new record starts at zero, with a clean name', true, async () =>
        commit('u1', [{ path: 'users/u1', data: { username: 'Berk', totalScore: 0, gamesPlayed: 0, gamesWon: 0 } }])],
    ['a new record cannot start with a score', false, async () =>
        commit('u1', [{ path: 'users/u1', data: { username: 'Berk', totalScore: 500, gamesPlayed: 0, gamesWon: 0 } }])],
    // Users: one match at a time
    ['a won match moves every counter by one', true, async () => {
        await seed('users/u1', record());
        return commit('u1', [{ path: 'users/u1', data: { totalScore: 6, gamesPlayed: 10, gamesWon: 6, updatedAt: SERVER_TIME }, mask: ['totalScore', 'gamesPlayed', 'gamesWon', 'updatedAt'] }]); }],
    ['a score cannot jump', false, async () => {
        await seed('users/u1', record());
        return commit('u1', [{ path: 'users/u1', data: { totalScore: 105, gamesPlayed: 10, gamesWon: 6, updatedAt: SERVER_TIME }, mask: ['totalScore', 'gamesPlayed', 'gamesWon', 'updatedAt'] }]); }],
    ['score rises only with a win', false, async () => {
        await seed('users/u1', record());
        return commit('u1', [{ path: 'users/u1', data: { totalScore: 6, gamesPlayed: 10, updatedAt: SERVER_TIME }, mask: ['totalScore', 'gamesPlayed', 'updatedAt'] }]); }],
    ['a second match inside ten seconds is refused', false, async () => {
        await seed('users/u1', record({ updatedAt: JUST_NOW() }));
        return commit('u1', [{ path: 'users/u1', data: { gamesPlayed: 10, updatedAt: SERVER_TIME }, mask: ['gamesPlayed', 'updatedAt'] }]); }],
    ['a counter cannot move without a fresh stamp', false, async () => {
        await seed('users/u1', record());
        return commit('u1', [{ path: 'users/u1', data: { gamesPlayed: 10 }, mask: ['gamesPlayed'] }]); }],
    ['a player cannot write someone else\'s record', false, async () => {
        await seed('users/u1', record());
        return commit('u2', [{ path: 'users/u1', data: { gamesPlayed: 10, updatedAt: SERVER_TIME }, mask: ['gamesPlayed', 'updatedAt'] }]); }],
    ['an old email copy can be removed', true, async () => {
        await seed('users/u1', record({ email: 'a@b.c' }));
        return commit('u1', [{ path: 'users/u1', data: {}, mask: ['email'] }]); }],
    ['an email cannot be (re)written', false, async () => {
        await seed('users/u1', record({ email: 'a@b.c' }));
        return commit('u1', [{ path: 'users/u1', data: { email: 'x@y.z' }, mask: ['email'] }]); }],
    ['a name with markup is refused', false, async () => {
        await seed('users/u1', record());
        return commit('u1', [{ path: 'users/u1', data: { username: '<img src=x>' }, mask: ['username'] }]); }],
    ['an impossible reflex is refused', false, async () => {
        await seed('users/u1', record());
        return commit('u1', [{ path: 'users/u1', data: { bestReflex: 5 }, mask: ['bestReflex'] }]); }],
    ['a better real reflex is kept', true, async () => {
        await seed('users/u1', record());
        return commit('u1', [{ path: 'users/u1', data: { bestReflex: 310 }, mask: ['bestReflex'] }]); }],
    // Leaderboard
    ['anyone may read the leaderboard', true, async () => {
        await seed('leaderboard/u1', { username: 'Berk', totalScore: 5, updatedAt: LONG_AGO() }); return get(ANON, 'leaderboard'); }],
    ['a leaderboard score must equal the private record', false, async () => {
        await seed('users/u1', record());
        return commit('u1', [{ path: 'leaderboard/u1', data: { username: 'Berk', totalScore: 9999, updatedAt: SERVER_TIME } }]); }],
    ['a leaderboard entry that mirrors the record is accepted', true, async () => {
        await seed('users/u1', record());
        return commit('u1', [{ path: 'leaderboard/u1', data: { username: 'Berk', totalScore: 5, updatedAt: SERVER_TIME } }]); }],
    ['a match and its mirror land in one commit', true, async () => {
        await seed('users/u1', record());
        return commit('u1', [
            { path: 'users/u1', data: { totalScore: 6, gamesPlayed: 10, gamesWon: 6, updatedAt: SERVER_TIME }, mask: ['totalScore', 'gamesPlayed', 'gamesWon', 'updatedAt'] },
            { path: 'leaderboard/u1', data: { username: 'Berk', totalScore: 6, updatedAt: SERVER_TIME } }]); }],
    ['a leaderboard name with markup is refused', false, async () => {
        await seed('users/u1', record());
        return commit('u1', [{ path: 'leaderboard/u1', data: { username: '<a href=//x>win</a>', totalScore: 5, updatedAt: SERVER_TIME } }]); }],
    ['nobody writes another player\'s entry', false, async () => {
        await seed('users/u1', record());
        return commit('u2', [{ path: 'leaderboard/u1', data: { username: 'Berk', totalScore: 5, updatedAt: SERVER_TIME } }]); }],
    // Tables
    ['a stranger cannot redirect a table in play', false, async () => {
        await seed('multiplayer_tables/ABC123', table({ gameState: { status: 'playing', playerCount: 2, roomId: 'R1' } }));
        return commit('evil', [{ path: 'multiplayer_tables/ABC123', data: { gameState: { status: 'playing', playerCount: 2, roomId: 'EVIL' } }, mask: ['gameState'] }]); }],
    ['a stranger joins a waiting table by adding exactly themselves', true, async () => {
        await seed('multiplayer_tables/ABC123', table());
        const t = table();
        return commit('new', [{ path: 'multiplayer_tables/ABC123', data: {
            players: [...t.players, { uid: 'new', name: 'New', index: 2, status: 'online' }],
            playerIds: { host: true, mem: true, new: true }, gameState: { status: 'waiting', playerCount: 3 } },
            mask: ['players', 'playerIds', 'gameState'] }]); }],
    ['a joiner cannot throw someone else out', false, async () => {
        await seed('multiplayer_tables/ABC123', table());
        return commit('new', [{ path: 'multiplayer_tables/ABC123', data: {
            players: [{ uid: 'host', name: 'Host', index: 0 }, { uid: 'new', name: 'New', index: 1 }],
            playerIds: { host: true, new: true }, gameState: { status: 'waiting', playerCount: 2 } },
            mask: ['players', 'playerIds', 'gameState'] }]); }],
    ['a joiner cannot start the game', false, async () => {
        await seed('multiplayer_tables/ABC123', table());
        return commit('new', [{ path: 'multiplayer_tables/ABC123', data: {
            playerIds: { host: true, mem: true, new: true }, gameState: { status: 'playing', playerCount: 3, roomId: 'EVIL' } },
            mask: ['playerIds', 'gameState'] }]); }],
    ['a seated player may leave', true, async () => {
        await seed('multiplayer_tables/ABC123', table());
        return commit('mem', [{ path: 'multiplayer_tables/ABC123', data: {
            players: [{ uid: 'host', name: 'Host', index: 0 }], playerIds: { host: true }, gameState: { status: 'waiting', playerCount: 1 } },
            mask: ['players', 'playerIds', 'gameState'] }]); }],
    ['a seated player cannot change the table\'s god', false, async () => {
        await seed('multiplayer_tables/ABC123', table());
        return commit('mem', [{ path: 'multiplayer_tables/ABC123', data: { god: 'ra' }, mask: ['god'] }]); }],
    ['the host may change the table\'s god', true, async () => {
        await seed('multiplayer_tables/ABC123', table());
        return commit('host', [{ path: 'multiplayer_tables/ABC123', data: { god: 'ra' }, mask: ['god'] }]); }],
    ['nobody creates a table in someone else\'s name', false, async () =>
        commit('evil', [{ path: 'multiplayer_tables/ABC123', data: table() }])],
    ['a host creates their own table', true, async () =>
        commit('host', [{ path: 'multiplayer_tables/ABC123', data: table({ playerIds: { host: true }, players: [{ uid: 'host', name: 'Host', index: 0 }] }) }])],
    // Closed paths
    ['the unused Firestore game rooms are closed', false, async () => {
        await seed('gameRooms/R1', { playerIds: ['u1'] }); return get('u1', 'gameRooms/R1'); }],
];

async function runScenarios(verbose) {
    const results = [];
    for (const [label, expect, fn] of SCENARIOS) {
        await reset();
        let r;
        try { r = await fn(); } catch (e) { r = { status: -1, text: String(e) }; }
        const got = allowed(r);
        results.push(got === expect);
        if (verbose) ok(label, got === expect, `expected ${expect ? 'ALLOWED' : 'REFUSED'}, got HTTP ${r.status} ${r.status !== 200 ? r.text.slice(0, 160).replace(/\s+/g, ' ') : ''}`);
    }
    return results;
}

const MUTANTS = [
    ['player records world-readable again', "allow read: if isUser(userId);", "allow read: if true;"],
    ['no cooldown between matches', "|| request.time > resource.data.updatedAt + duration.value(10, 's')", "|| true"],
    ['leaderboard score no longer tied to the record', "== getAfter(/databases/$(database)/documents/users/$(userId)).data.get('totalScore', 0)", ">= 0"],
    ['non-hosts may change any table field', "&& changed().hasOnly(['players', 'playerIds', 'gameState', 'hostId', 'hostUsername'])", ""],
    ['names no longer checked', "return n is string && n.matches(", "return n is string || n.matches("],
    // v3.22.0 — every coin bound must be load-bearing.
    ['wallets writable at will again', "allow update: if walletShape(request.resource.data)\n        && ((isUser(userId)", "allow update: if isUser(userId) || ((isUser(userId)"],
    ['no daily earning cap', "&& n.earnedToday <= 1200;", ";"],
    ['no per-write earning cap', "coinDelta() > 0 && coinDelta() <= 80", "coinDelta() > 0"],
    ['purchase price not checked', "&& coinDelta() == -walletSkinCost()[added[0]];", "&& coinDelta() <= 0;"],
    ['spin not once a day', "&& resource.data.spinDay < today()", ""],
    ['spin not capped', "coinDelta() >= 0 && coinDelta() <= 200", "coinDelta() >= 0"],
    ['import not capped', "+ ownedValue(request.resource.data.owned) <= 1000", "+ ownedValue(request.resource.data.owned) >= 0"],
    ['anyone is an admin', "return signedIn() && exists(/databases/$(database)/documents/admins/$(request.auth.uid));", "return signedIn();"],
    ['admins writable by clients', "match /admins/{userId} {\n      allow read: if isUser(userId);\n      allow write: if false;", "match /admins/{userId} {\n      allow read: if isUser(userId);\n      allow write: if isUser(userId);"],
    // The amount is bound twice — in the wallet rule and in the audit record's
    // before/after — on purpose. Either alone holds, so the mutant removes both.
    // v3.22.1: the daily counter binds the amount a THIRD way (it must add
    // the grant up); the "bound nowhere" mutant removes the wallet-side
    // bindings, and the counter's own arithmetic has its own mutant below.
    ['grant amount bound nowhere', "&& grant.amount == coinDelta();", ";",
        "&& getAfter(/databases/$(database)/documents/wallets/$(request.resource.data.to)).data.coins == request.resource.data.after", "",
        "&& request.resource.data.after == request.resource.data.before + request.resource.data.amount", ""],
    ['an old audit record may be replayed', "&& !exists(/databases/$(database)/documents/coin_grants/$(request.resource.data.lastGrantId))", ""],
    ['audit records editable', "allow update, delete: if false;\n    }\n\n    // The admin's daily ceiling", "allow update, delete: if isAdmin();\n    }\n\n    // The admin's daily ceiling"],
    ['wallets world-readable', "allow read: if isUser(userId) || isAdmin();", "allow read: if true;"],
    // v3.22.1 — the admin's daily ceiling (council O1).
    ['no admin daily ceiling', "&& request.resource.data.given <= 20000;", ";"],
    ['grants need not move the daily counter',
        "\n        // ...and the sending admin's daily counter moved with it (below).\n        && getAfter(/databases/$(database)/documents/admin_daily/$(request.auth.uid)).data.lastGrantId == grantId;", ";"],
    ['the daily counter may be written on its own',
        "allow create, update: if isUser(userId) && isAdmin()\n        && request.resource.data.keys().hasOnly(['day', 'given', 'lastGrantId'])",
        "allow create, update: if isUser(userId) && isAdmin()\n        || request.resource.data.keys().hasOnly(['day', 'given', 'lastGrantId'])"],
    ['the daily counter need not add the grant up',
        "== ((resource != null && resource.data.day == today()) ? resource.data.given : 0)", ">= 0"],
];

(async () => {
    try { await loadRules(RULES); }
    catch (e) { console.log(`FAIL could not load firestore.rules into the emulator: ${e.message}`); process.exit(1); }

    // 1. Self-check: the harness can see both outcomes, and forged tokens work.
    await reset();
    const a = await seed('users/self', record());
    ok('self-check: the admin channel writes', allowed(a), `HTTP ${a.status} ${a.text.slice(0, 200)}`);
    const own = await get('self', 'users/self');
    const other = await get('someone-else', 'users/self');
    ok('self-check: a forged sign-in is honoured (own record readable)', allowed(own), `HTTP ${own.status}`);
    ok('self-check: and a refusal is visible (another record is not)', !allowed(other), `HTTP ${other.status}`);
    if (fail) { console.log('\nSelf-check failed: every later verdict would be meaningless. Stopping.'); process.exit(1); }

    // 2. Scenarios against the file on disk.
    console.log('\n-- scenarios --');
    await runScenarios(true);

    // 3. Mutants: each must break at least one scenario.
    console.log('\n-- mutants --');
    for (const [name, ...pairs] of MUTANTS) {
        let mutated = RULES, missing = false;
        for (let i = 0; i < pairs.length; i += 2) {
            if (!mutated.includes(pairs[i])) { missing = true; break; }
            mutated = mutated.replace(pairs[i], pairs[i + 1]);
        }
        if (missing) { ok(`mutant "${name}" applies to the current rules`, false, 'anchor text not found'); continue; }
        await loadRules(mutated);
        const res = await runScenarios(false);
        const caught = res.filter(x => !x).length;
        ok(`mutant caught: ${name} (${caught} scenario${caught === 1 ? '' : 's'} failed)`, caught > 0, 'ESCAPED — no scenario notices this weakening');
    }
    await loadRules(RULES);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) { console.log('Failed:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
