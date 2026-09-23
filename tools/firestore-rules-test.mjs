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

/** Each scenario: [sentence, expected allowed?, async () => response]. */
const SCENARIOS = [
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
    for (const [name, from, to] of MUTANTS) {
        if (!RULES.includes(from)) { ok(`mutant "${name}" applies to the current rules`, false, 'anchor text not found'); continue; }
        await loadRules(RULES.replace(from, to));
        const res = await runScenarios(false);
        const caught = res.filter(x => !x).length;
        ok(`mutant caught: ${name} (${caught} scenario${caught === 1 ? '' : 's'} failed)`, caught > 0, 'ESCAPED — no scenario notices this weakening');
    }
    await loadRules(RULES);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) { console.log('Failed:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
