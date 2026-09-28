/**
 * tools/rules-test.mjs — the first gate in this project that runs the SECURITY
 * RULES rather than reading them.
 *
 * WHY THIS EXISTS. Nine gates check source text, markup, locales and layout.
 * None of them could see that `lobbyRooms` was writable by anyone:
 *
 *     ".write": "... || newData.child('hostId').val() === auth.uid || ..."
 *
 * `newData` is the data being WRITTEN. A write that names you host satisfies
 * the clause that is supposed to decide whether you may write. Any signed-in
 * user could overwrite any table — including one mid-match, including
 * `gameState.roomId`, which is the field every other client follows into the
 * game room. Reading the file did not make that obvious. Running it does.
 *
 * HOW IT RUNS. Against the real Firebase Database emulator, over its REST API,
 * with NO new dependencies: the emulator accepts an unsigned JWT in `?auth=`,
 * and the literal token `owner` as a superuser (used only to seed fixtures and
 * to swap rules between mutants). `deploy-db-rules.bat` starts the emulator and
 * refuses to deploy anything unless this file exits 0.
 *
 * WHY IT PROVES ITSELF. A gate that cannot fail is not a gate — this project
 * shipped one in v3.7.7 that never executed and passed for two releases. So
 * this file does three things a source scan cannot:
 *
 *   1. SELF-CHECK. Before any rule is judged, it proves the harness can tell
 *      allowed from refused, and that the emulator honours the forged token.
 *      If token forgery stopped working, every later assertion would pass
 *      vacuously — so that is checked first and named as the reason.
 *   2. SCENARIOS. Each is a sentence about the game, not about a boolean.
 *   3. MUTANTS. The same scenarios are re-run against deliberately broken
 *      copies of the rule. A mutant that nothing catches is reported as
 *      ESCAPED and fails the gate. That is the answer to "the tests were
 *      written by whoever wrote the rule".
 *
 * The rule expression itself is composed HERE, from named pieces, and a test
 * asserts database.rules.json contains exactly that composition. So the file on
 * disk and the thing under test cannot drift, and a mutant is one piece swapped.
 */

import { readFileSync } from 'node:fs';
import { LOBBY_PIECES, composeLobbyWrite, GAMEROOM_PIECES, composeGameRoomWrite, CLIENT_VERSIONS_RULES, ADMIN_ROOMS_READ, ADMINS_RULES,
    CLEANUP_PIECES, composeAdminLobbyDelete, composeAdminRoomDelete, composeLobbyWriteFull, composeGameRoomWriteFull, ONLINE_RULES, ROOM_STALE_MS, ONLINE_ACTIVITIES } from './lobby-rule.mjs';
import { ROOM_PROTOCOL } from '../public/js/slapOutcome.js';

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
// The project's own namespace, not an invented one. An unknown namespace is
// created on demand with DEFAULT rules — which are open — so a typo here would
// not fail, it would quietly test nothing. This is also the namespace
// `emulators:exec` has already loaded database.rules.json into, so the readback
// below is comparing against the file the deploy is about to send.
const NS = process.env.ERS_RULES_NS || 'ers-card-game-default-rtdb';
const BASE = `http://${HOST}`;

let pass = 0, fail = 0;
const failures = [];

function ok(label, cond, detail = '') {
    if (cond) { pass++; console.log(`PASS ${label}`); }
    else { fail++; failures.push(label); console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

// --- the forged token -------------------------------------------------------
// The emulator does not verify signatures. `alg: none` with an empty signature
// is what the Firebase tooling itself sends; uid lands in both `sub` and
// `user_id` because the rules engine has read `auth.uid` from either.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function tokenFor(uid) {
    const now = Math.floor(Date.now() / 1000);
    return b64({ alg: 'none', typ: 'JWT' }) + '.' +
        b64({ sub: uid, user_id: uid, iat: now, exp: now + 3600, aud: NS, iss: NS }) + '.';
}

// --- emulator plumbing ------------------------------------------------------
//
// THE EMULATOR HAS TWO AUTHORITY CHANNELS AND THEY ARE NOT INTERCHANGEABLE.
// The first run of this file proved it:
//
//     PUT /.settings/rules.json?ns=...&auth=owner   ->  403 Permission denied
//
// `?auth=` is the DATA plane: it carries an end-user token, and the rules
// engine reads `auth.uid` out of it. The ADMIN plane — the endpoints that
// change the rules themselves — does not read that parameter at all; it wants
// `Authorization: Bearer owner`. Sending a superuser token down the user
// channel is a category error, and the emulator was right to refuse it.
// Which spelling the admin plane wants is NOT documented for the emulator —
// the public REST page covers production, where it is `?access_token=`. So
// this file does not pick one and hope. It PROBES: each candidate is used to
// write a recognisable sentinel rule and then to read it back, and the first
// one that round-trips is the one used for the rest of the run. The winner is
// printed, so the next reader knows which channel this emulator version wants
// instead of inheriting my guess.
const ADMIN_CANDIDATES = [
    { name: "Authorization: Bearer owner", headers: { Authorization: 'Bearer owner' }, query: '' },
    { name: "?access_token=owner", headers: {}, query: '&access_token=owner' },
    { name: "?auth=owner  (the data plane; 403 on v4.11.2)", headers: {}, query: '&auth=owner' }
];
let ADMIN = null;                       // chosen by probeAdminChannel()
const JSON_H = { 'Content-Type': 'application/json' };

const url = (path, auth) =>
    `${BASE}/${path}.json?ns=${NS}` + (auth === undefined ? '' : `&auth=${auth}`);

/** Writes as the emulator superuser: fixtures only, never a rule judgement. */
async function asOwner(path, body) {
    const r = await fetch(url(path) + ADMIN.query, {
        method: 'PUT', headers: { ...JSON_H, ...ADMIN.headers }, body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`owner write to ${path} failed: ${r.status} ${await r.text()}`);
}

/** Attempts a write as `uid`, or unauthenticated when uid is null. */
async function tryWrite(path, body, uid) {
    const r = await fetch(url(path, uid === null ? undefined : tokenFor(uid)), {
        method: 'PUT', headers: JSON_H, body: JSON.stringify(body)
    });
    return r.status;          // 200 allowed, 401/403 refused
}
const allowed = (s) => s === 200;
const refused = (s) => s === 401 || s === 403;

/** The lobby write rule the emulator is enforcing RIGHT NOW. */
async function readLobbyRule(channel = ADMIN) {
    const r = await fetch(`${BASE}/.settings/rules.json?ns=${NS}${channel.query}`,
        { headers: channel.headers });
    if (!r.ok) throw new Error(`rule readback failed: ${r.status} ${await r.text()}`);
    const live = JSON.parse(await r.text());
    return live.rules.lobbyRooms.$tableId['.write'];
}

async function putRules(channel, rulesObject) {
    return fetch(`${BASE}/.settings/rules.json?ns=${NS}${channel.query}`, {
        method: 'PUT', headers: { ...JSON_H, ...channel.headers },
        body: JSON.stringify(rulesObject)
    });
}

/**
 * Finds the admin channel this emulator actually honours, by using it.
 *
 * A candidate is accepted only if a sentinel rule written through it comes
 * back through it. A 200 is not enough: an endpoint that accepts a rule load
 * and keeps serving the old rules would leave every mutant below running
 * against the REAL rule — six "caught", gate green, nothing measured.
 */
async function probeAdminChannel() {
    const sentinel = rulesWith(composeLobbyWrite() + " && true");
    const tried = [];
    for (const c of ADMIN_CANDIDATES) {
        try {
            const put = await putRules(c, sentinel);
            if (!put.ok) { tried.push(`${c.name} -> PUT ${put.status}`); continue; }
            const got = await readLobbyRule(c);
            if (got !== sentinel.rules.lobbyRooms.$tableId['.write']) {
                tried.push(`${c.name} -> PUT accepted but the emulator kept serving something else`);
                continue;
            }
            ADMIN = c;
            await putRules(c, rulesFile);      // put the real rules straight back
            return tried;
        } catch (e) {
            tried.push(`${c.name} -> ${e.message}`);
        }
    }
    const err = new Error('no admin channel worked:\n  ' + tried.join('\n  '));
    err.tried = tried;
    throw err;
}

/**
 * Swaps the rules the emulator enforces, then READS THEM BACK.
 *
 * The readback is the whole point. A rule load that is accepted and quietly
 * ignored would leave every mutant running against the real rules — all six
 * would be "caught", the gate would go green, and it would be measuring
 * nothing. That is this project's recurring failure (v3.7.7), so the
 * assumption is checked rather than trusted.
 */
async function loadRules(rulesObject) {
    const r = await putRules(ADMIN, rulesObject);
    if (!r.ok) throw new Error(`rule load failed: ${r.status} ${await r.text()}`);
    const want = rulesObject.rules.lobbyRooms.$tableId['.write'];
    const got = await readLobbyRule();
    if (got !== want) {
        throw new Error('the emulator accepted a rule load and is enforcing something else.\n'
            + `  wanted: ${want}\n  serving: ${got}`);
    }
    // v3.19.0: the game-room mutants are swapped in the same way, so their
    // load is read back too — a stale rule would let every mutant "survive".
    const r2 = await fetch(`${BASE}/.settings/rules.json?ns=${NS}${ADMIN.query}`, { headers: ADMIN.headers });
    const liveRoom = JSON.parse(await r2.text()).rules.gameRooms.$roomId['.write'];
    const wantRoom = rulesObject.rules.gameRooms.$roomId['.write'];
    if (liveRoom !== wantRoom) {
        throw new Error('the emulator is enforcing a different game-room rule.\n'
            + `  wanted: ${wantRoom}\n  serving: ${liveRoom}`);
    }
}

// --- the rule under test -------------------------------------------------
// Composed in tools/lobby-rule.mjs so that this file, database.rules.json and
// the always-run suite all read the same expression. A mutant below is one
// named piece swapped for `true`.
const P = LOBBY_PIECES;
const compose = composeLobbyWrite;

const rulesFile = JSON.parse(readFileSync('./database.rules.json', 'utf8'));
const LIVE_LOBBY_WRITE = rulesFile.rules.lobbyRooms.$tableId['.write'];

function rulesWith(lobbyWrite) {
    const clone = JSON.parse(JSON.stringify(rulesFile));
    clone.rules.lobbyRooms.$tableId['.write'] = lobbyWrite;
    return clone;
}

// --- fixtures ---------------------------------------------------------------
const HOSTU = 'uid_host', SEAT = 'uid_seated', OUT = 'uid_outsider';

const table = (status, hostId = HOSTU) => ({
    tableId: 'ABC123',
    hostId,
    hostUsername: 'Host',
    playerIds: { [HOSTU]: true, [SEAT]: true },
    players: [{ uid: HOSTU, name: 'Host', index: 0 }, { uid: SEAT, name: 'Seat', index: 1 }],
    gameState: { status, playerCount: 2, roomId: status === 'playing' ? 'ROOM01' : null }
});

/** A whole-node write that keeps every invariant — what the app really sends. */
const legalUpdate = (extra = {}) => ({ ...table('waiting'), ...extra });

async function seed(status = 'waiting') {
    await asOwner('lobbyRooms/ABC123', table(status));
}
async function clearTable() { await asOwner('lobbyRooms/ABC123', null); }

// --- the scenarios ----------------------------------------------------------
// Returns the list of [label, wasAllowed, shouldBeAllowed] so mutants can be
// scored with the very same list the real rules are scored with.
async function runScenarios() {
    const r = [];
    const record = async (label, want, fn) => r.push([label, await fn(), want]);

    // creation
    await clearTable();
    await record('a player creates a table and hosts it', true, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123', table('waiting'), HOSTU)));

    await clearTable();
    await record('nobody can create a table hosted by someone else', false, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123', table('waiting', HOSTU), OUT)));

    await clearTable();
    await record('a created table cannot name a host who is not seated', false, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123', { ...table('waiting'), hostId: OUT }, HOSTU)));

    // the hole this release closes
    await seed('playing');
    await record('a stranger cannot overwrite a table that is mid-match', false, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123',
            { ...table('playing', OUT), playerIds: { [OUT]: true } }, OUT)));

    await seed('playing');
    await record('...and cannot join one either', false, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123',
            { ...table('playing'), playerIds: { [HOSTU]: true, [SEAT]: true, [OUT]: true } }, OUT)));

    await seed('waiting');
    await record('a stranger cannot overwrite a waiting table without joining it', false, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123',
            { ...table('waiting'), hostUsername: 'pwned' }, OUT)));

    // Reported live, on the first press of Leave. The host's own client had
    // already migrated the table and taken itself out of the seat list, and
    // then wrote the table a second time. From the table's point of view that
    // second write comes from someone who is not there — and being refused is
    // correct. The client was fixed; this pins what the rule must keep saying.
    await asOwner('lobbyRooms/ABC123', {
        ...table('waiting', SEAT), hostUsername: 'Seat',
        playerIds: { [SEAT]: true },
        players: [{ uid: SEAT, name: 'Seat', index: 0 }]
    });
    await record('a client the table has already removed may not write it again', false, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123', {
            ...table('waiting', SEAT), hostUsername: 'Seat',
            playerIds: { [SEAT]: true },
            players: [{ uid: SEAT, name: 'Seat', index: 0 }]
        }, HOSTU)));

    // the flows that must keep working
    await seed('waiting');
    await record('a stranger CAN join a waiting table by adding themselves', true, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123',
            { ...table('waiting'), playerIds: { [HOSTU]: true, [SEAT]: true, [OUT]: true } }, OUT)));

    await seed('waiting');
    await record('the host may update the table', true, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123', legalUpdate({ hostUsername: 'Renamed' }), HOSTU)));

    await seed('waiting');
    await record('a seated player may update the table', true, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123', legalUpdate({ hostUsername: 'Renamed' }), SEAT)));

    // host migration is done by a NON-host client — see handlePlayerDisconnect
    await seed('waiting');
    await record('a seated player may migrate the host to another seated player', true, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123',
            { ...table('waiting', SEAT), hostUsername: 'Seat' }, SEAT)));

    await seed('waiting');
    await record('...but may not hand the table to an outsider', false, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123', { ...table('waiting', OUT) }, SEAT)));

    await seed('waiting');
    await record('nobody may change the table id', false, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123', { ...table('waiting'), tableId: 'ZZZZZZ' }, SEAT)));

    // deletion: the host leaves, or the last seated client tidies up
    await seed('waiting');
    await record('the host may delete the table', true, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123', null, HOSTU)));

    await seed('waiting');
    await record('a seated player may delete the table', true, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123', null, SEAT)));

    await seed('waiting');
    await record('a stranger may not delete the table', false, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123', null, OUT)));

    await seed('waiting');
    await record('an unauthenticated client may not write at all', false, async () =>
        allowed(await tryWrite('lobbyRooms/ABC123', table('waiting'), null)));

    return r;
}

// --- main -------------------------------------------------------------------
console.log(`\nrules-test: emulator at ${HOST}, namespace ${NS}\n`);

// 0. PLUMBING. Everything below is a claim about the rules; none of it means
//    anything if the emulator is not actually serving the rules we think it is.
//    So the very first thing is: put our rules in, read them back out, and
//    refuse to continue unless they match. A plumbing failure here must read
//    like a diagnosis, not a stack trace — the first run of this file failed
//    exactly here, and the message is what made it a five-minute fix.
try {
    const rejected = await probeAdminChannel();
    for (const line of rejected) console.log(`     (not this one: ${line})`);
    console.log(`rules-test: admin channel = ${ADMIN.name}\n`);
    ok('the harness can put a rule in and read the same rule back', true);
    await loadRules(rulesFile);
    ok('the emulator is serving the rules from database.rules.json', true);
} catch (e) {
    console.log('\nFAIL the harness could not take control of the emulator\n');
    console.log('  ' + String(e.message).split('\n').join('\n  '));
    console.log('\n  Nothing below ran. The rules were NOT tested, and nothing was deployed.');
    console.log(`  Namespace tried: ${NS} — override with ERS_RULES_NS if that is wrong.`);
    console.log('  Bring this output back as it is; we add the channel the emulator names,');
    console.log('  we do not guess a fourth one.');
    process.exit(1);
}

// 1. SELF-CHECK — before judging any rule, prove this harness can see the
//    difference between allowed and refused. `presence` is the simplest rule
//    in the file and this release does not touch it, so it is the fixed point.
{
    const mine = await tryWrite(`presence/${SEAT}`, 'online', SEAT);
    const theirs = await tryWrite(`presence/${HOSTU}`, 'offline', SEAT);
    const anon = await tryWrite(`presence/${SEAT}`, 'online', null);
    ok('the harness can perform an allowed write (forged token is accepted)',
        allowed(mine), `presence/own returned ${mine} — if this is 401/403 the emulator `
        + 'rejected the forged token and every later assertion would pass vacuously');
    ok('the harness can observe a refused write', refused(theirs), `got ${theirs}`);
    ok('...and an unauthenticated one', refused(anon), `got ${anon}`);
}

// 2. The file on disk is the expression this test reasons about.
// v3.22.3: the file carries the player rule OR an admin closing a dead table;
// sections 3-4 mutate the player half, section 7 the admin half.
ok('database.rules.json carries exactly the composed lobby rule',
    LIVE_LOBBY_WRITE === composeLobbyWriteFull(),
    'the file and this test have drifted; rewrite one from the other');

// 3. The real rules must satisfy every scenario.
{
    const results = await runScenarios();
    for (const [label, was, want] of results) {
        ok(label, was === want, `write was ${was ? 'ALLOWED' : 'REFUSED'}, wanted ${want ? 'ALLOWED' : 'REFUSED'}`);
    }
}

// 4. MUTANTS. Each is the real rule with one clause weakened. Every one must
//    break at least one scenario; a mutant nothing catches is a scenario that
//    was never load-bearing.
// An EQUIVALENT mutant is one that cannot change any verdict, so no scenario
// can catch it and none should be invented to pretend otherwise. Declaring one
// is a claim, and a claim has to be falsifiable: if such a mutant ever IS
// caught, the claim was wrong and the gate fails on that instead. The reason is
// also checked statically — see test_gameLogic.mjs section 64.
const MUTANTS = [
    { label: 'the v3.14.x hole, restored: a write that NAMES you host satisfies the check',
      build: () => compose(P) + " || newData.child('hostId').val() === auth.uid" },
    { label: 'the join branch stops checking that the table is still waiting',
      build: () => compose({ ...P, tableWaiting: 'true' }) },
    { label: 'the table id is no longer immutable',
      build: () => compose({ ...P, keepsTableId: 'true' }) },
    { label: 'a new host no longer has to be seated',
      build: () => compose({ ...P, newHostSeated: 'true' }) },
    { label: 'the creator no longer has to be the host',
      build: () => compose({ ...P, creatorIsHost: 'true' }) },
    { label: 'sign-in is no longer required',
      build: () => compose({ ...P, signedIn: 'true' }),
      // Measured, not assumed: this one survived the first real run. Every
      // clause that can authorise a write reads `auth.uid` — isHost compares
      // it, isSeated and addsSelf look it up as a key, creatorIsHost compares
      // it. With no sign-in `auth.uid` is null, so all of them are already
      // false and the leading `auth != null` decides nothing. It stays in the
      // rule as defence in depth and because the next clause added might not
      // mention auth.uid at all -- and the static test named below is what
      // notices the day that happens.
      equivalent: 'every authorising clause already reads auth.uid' }
];

console.log('\n--- mutants ---');
let escaped = 0, staleClaims = 0, equivalent = 0;
for (const { label, build, equivalent: why } of MUTANTS) {
    await loadRules(rulesWith(build()));
    const results = await runScenarios();
    const broke = results.filter(([, was, want]) => was !== want);
    if (broke.length && !why) {
        console.log(`CAUGHT     ${label}`);
        console.log(`           first miss: ${broke[0][0]}`);
    } else if (broke.length && why) {
        staleClaims++;
        console.log(`CLAIM STALE ${label}`);
        console.log(`           declared equivalent because "${why}", but a scenario caught it:`);
        console.log(`           ${broke[0][0]}`);
        console.log(`           -- drop the equivalent flag; this mutant is real.`);
    } else if (why) {
        equivalent++;
        console.log(`EQUIVALENT ${label}`);
        console.log(`           cannot change any verdict: ${why}`);
    } else {
        escaped++;
        console.log(`ESCAPED    ${label}`);
    }
}
await loadRules(rulesFile);
ok(`no mutant escaped (${MUTANTS.length - equivalent} real, ${equivalent} equivalent)`,
    escaped === 0, `${escaped} escaped`);
ok('...and no equivalence claim is stale', staleClaims === 0, `${staleClaims} stale`);

// 5. v3.19.0 — THE GOD-ROOM GATE (council ERS-20, condition 1).
//    Ghost cards changed how a pile is handed over. A tab still open from
//    before the deploy would hand ghosts to a person and count them toward the
//    52, and nothing in the room can tell it not to. So a room with a god
//    accepts writes only from users who registered the ghost-card protocol
//    under clientVersions/{uid}. Same method as above: scenarios, then mutants.
const RP = GAMEROOM_PIECES;
const LIVE_ROOM_WRITE = rulesFile.rules.gameRooms.$roomId['.write'];
function rulesWithRoom(roomWrite) {
    const clone = JSON.parse(JSON.stringify(rulesFile));
    clone.rules.gameRooms.$roomId['.write'] = roomWrite;
    return clone;
}
const room = (god = 'ra') => ({
    tableId: 'ABC123',
    hostId: HOSTU,
    playerIds: { [HOSTU]: true, [SEAT]: true },
    players: [{ uid: HOSTU, name: 'Host', cards: [{ rank: 5, suit: 'hearts' }] },
              { uid: SEAT, name: 'Seat', cards: [{ rank: 9, suit: 'clubs' }] }],
    pile: [],
    gameStarted: true,
    gameOver: false,
    ...(god ? { god, godSeat: 3, godHp: 160, godMaxHp: 160 } : {})
});
async function speaks(uid, version) { await asOwner(`clientVersions/${uid}`, version); }
async function seedRoom(god) { await asOwner('gameRooms/ROOM01', room(god)); }
async function clearRoom() { await asOwner('gameRooms/ROOM01', null); }

async function runRoomScenarios() {
    const r = [];
    const record = async (label, want, fn) => r.push([label, await fn(), want]);
    const turn = (god) => ({ ...room(god), pile: [{ rank: 7, suit: 'spades' }] });

    await speaks(HOSTU, ROOM_PROTOCOL); await speaks(SEAT, null); await speaks(OUT, ROOM_PROTOCOL);

    await seedRoom('ra');
    await record('a seated player on a current client may play in a god room', true, async () =>
        allowed(await tryWrite('gameRooms/ROOM01', turn('ra'), HOSTU)));
    await seedRoom('ra');
    await record('...and may update a single seat in it (status, cards)', true, async () =>
        allowed(await tryWrite('gameRooms/ROOM01/players/0/status', 'online', HOSTU)));

    await seedRoom('ra');
    await record('a seated player on an OLD client may not write a god room', false, async () =>
        allowed(await tryWrite('gameRooms/ROOM01', turn('ra'), SEAT)));
    await seedRoom('ra');
    await record('...not even one seat of it', false, async () =>
        allowed(await tryWrite('gameRooms/ROOM01/players/1/cards', [], SEAT)));
    await seedRoom('ra');
    await record('...nor delete it', false, async () =>
        allowed(await tryWrite('gameRooms/ROOM01', null, SEAT)));
    await speaks(SEAT, ROOM_PROTOCOL - 1);
    await seedRoom('ra');
    await record('a client registered at an OLDER protocol is still refused', false, async () =>
        allowed(await tryWrite('gameRooms/ROOM01', turn('ra'), SEAT)));
    await speaks(SEAT, null);

    await seedRoom(null);
    await record('an old client may still play an ordinary room (no god)', true, async () =>
        allowed(await tryWrite('gameRooms/ROOM01', turn(null), SEAT)));
    await seedRoom(null);
    await record('...but may not seat a god in it', false, async () =>
        allowed(await tryWrite('gameRooms/ROOM01', turn('ra'), SEAT)));

    await clearRoom();
    await record('a host on a current client may deal a god room', true, async () =>
        allowed(await tryWrite('gameRooms/ROOM01', room('ra'), HOSTU)));
    await clearRoom();
    await record('a host on an old client may not deal one', false, async () =>
        allowed(await tryWrite('gameRooms/ROOM01', room('ra'), SEAT)));

    await seedRoom('ra');
    await record('a current client that is NOT seated may not write a god room', false, async () =>
        allowed(await tryWrite('gameRooms/ROOM01', turn('ra'), OUT)));

    await record('a user may register the protocol for themselves', true, async () =>
        allowed(await tryWrite(`clientVersions/${SEAT}`, ROOM_PROTOCOL, SEAT)));
    await record('...but not for someone else', false, async () =>
        allowed(await tryWrite(`clientVersions/${HOSTU}`, ROOM_PROTOCOL, SEAT)));
    await record('...and only as a number', false, async () =>
        allowed(await tryWrite(`clientVersions/${SEAT}`, 'v3.19.0', SEAT)));
    await speaks(SEAT, null);
    return r;
}

ok('database.rules.json carries exactly the composed game-room rule',
    LIVE_ROOM_WRITE === composeGameRoomWriteFull(), 'the file and this test have drifted');
ok('database.rules.json carries the clientVersions rules',
    JSON.stringify(rulesFile.rules.clientVersions) === JSON.stringify(CLIENT_VERSIONS_RULES));
{
    const results = await runRoomScenarios();
    for (const [label, was, want] of results) {
        ok(label, was === want, `write was ${was ? 'ALLOWED' : 'REFUSED'}, wanted ${want ? 'ALLOWED' : 'REFUSED'}`);
    }
}
const ROOM_MUTANTS = [
    { label: 'the protocol is never checked', build: () => composeGameRoomWrite({ ...RP, speaksProtocol: 'true' }) },
    { label: 'no room counts as a god room', build: () => composeGameRoomWrite({ ...RP, godRoom: 'false' }) },
    { label: 'a god room is recognised only by what it was, not what the write makes it',
      build: () => composeGameRoomWrite({ ...RP, godRoom: "data.child('god').exists()" }) },
    { label: 'any signed-in user may write any room', build: () => composeGameRoomWrite({ ...RP, isSeated: 'true' }) },
    { label: 'the protocol gate is the pre-v3.19.0 rule (removed)',
      build: () => `${RP.signedIn} && (${RP.creating} || ${RP.isSeated})` }
];
console.log('\n--- game-room mutants ---');
let roomEscaped = 0;
for (const { label, build } of ROOM_MUTANTS) {
    await loadRules(rulesWithRoom(build()));
    const broke = (await runRoomScenarios()).filter(([, was, want]) => was !== want);
    if (broke.length) { console.log(`CAUGHT     ${label}`); console.log(`           first miss: ${broke[0][0]}`); }
    else { roomEscaped++; console.log(`ESCAPED    ${label}`); }
}
await loadRules(rulesFile);
ok(`no game-room mutant escaped (${ROOM_MUTANTS.length})`, roomEscaped === 0, `${roomEscaped} escaped`);


// 6. v3.22.2 — ADMIN READ OF GAME ROOMS (approved by the owner).
//    The admin page watches every live room. READ ONLY, gameRooms ONLY. An
//    admin is `admins/{uid} === true`, set in the console; no client may write
//    that flag. Scenarios first, then mutants, same as above.
async function tryRead(path, uid) {
    const r = await fetch(url(path, uid === null ? undefined : tokenFor(uid)));
    return r.status;
}
const BOSS = 'uid_boss';
function rulesWithAdmin(roomsRead, adminsRules = ADMINS_RULES) {
    const clone = JSON.parse(JSON.stringify(rulesFile));
    if (roomsRead === null) delete clone.rules.gameRooms['.read'];
    else clone.rules.gameRooms['.read'] = roomsRead;
    clone.rules.admins = adminsRules;
    return clone;
}
async function runAdminScenarios() {
    const r = [];
    const record = async (label, want, fn) => r.push([label, await fn(), want]);
    await asOwner('gameRooms/ROOM01', room(null));
    await asOwner(`admins/${BOSS}`, true);
    await asOwner('admins/uid_fake', 'yes');
    await record('an admin lists every game room', true, async () => allowed(await tryRead('gameRooms', BOSS)));
    await record('an admin reads one room', true, async () => allowed(await tryRead('gameRooms/ROOM01', BOSS)));
    await record('a signed-in player cannot list the rooms', false, async () => allowed(await tryRead('gameRooms', OUT)));
    await record('a seated player still reads their own room', true, async () => allowed(await tryRead('gameRooms/ROOM01', SEAT)));
    await record('an outsider still cannot read a room', false, async () => allowed(await tryRead('gameRooms/ROOM01', OUT)));
    await record('nobody signed out lists the rooms', false, async () => allowed(await tryRead('gameRooms', null)));
    await record('an admin flag must be exactly true ("yes" is not an admin)', false, async () => allowed(await tryRead('gameRooms', 'uid_fake')));
    await record('the admin read is READ only: an admin cannot write a room', false, async () =>
        allowed(await tryWrite('gameRooms/ROOM01/gameOver', true, BOSS)));
    await record('...nor delete a live one', false, async () => allowed(await tryWrite('gameRooms/ROOM01', null, BOSS)));
    await record('nobody makes themselves an admin', false, async () => allowed(await tryWrite(`admins/${OUT}`, true, OUT)));
    await record('an admin cannot edit the admin list either', false, async () => allowed(await tryWrite('admins/uid_new', true, BOSS)));
    await record('an admin reads their own flag', true, async () => allowed(await tryRead(`admins/${BOSS}`, BOSS)));
    await record('...but not who else is an admin', false, async () => allowed(await tryRead(`admins/${BOSS}`, OUT)));
    await asOwner('gameRooms/ROOM01', null);
    await asOwner('admins', null);
    return r;
}
ok('database.rules.json: the admin room read is the composed one',
    rulesFile.rules.gameRooms['.read'] === ADMIN_ROOMS_READ, 'the file and lobby-rule.mjs have drifted');
ok('database.rules.json: the admins rules are the composed ones',
    JSON.stringify(rulesFile.rules.admins) === JSON.stringify(ADMINS_RULES));
ok('database.rules.json: no other top-level node grants an admin anything',
    Object.entries(rulesFile.rules).filter(([k]) => !['gameRooms', 'admins', 'lobbyRooms', 'online'].includes(k))
        .every(([, v]) => !JSON.stringify(v).includes("child('admins')")));
{
    for (const [label, was, want] of await runAdminScenarios()) {
        ok(label, was === want, `was ${was ? 'ALLOWED' : 'REFUSED'}, wanted ${want ? 'ALLOWED' : 'REFUSED'}`);
    }
}
const ADMIN_MUTANTS = [
    { label: 'any signed-in user may list the rooms', build: () => rulesWithAdmin('auth != null') },
    { label: 'any admin flag counts, not just true', build: () => rulesWithAdmin("auth != null && root.child('admins').child(auth.uid).exists()") },
    { label: 'players may write their own admin flag', build: () => rulesWithAdmin(ADMIN_ROOMS_READ, { $uid: { '.read': 'auth != null && auth.uid === $uid', '.write': 'auth != null && auth.uid === $uid' } }) },
    { label: 'the admin flags are world-readable', build: () => rulesWithAdmin(ADMIN_ROOMS_READ, { $uid: { '.read': 'auth != null', '.write': false } }) },
    { label: 'the admin read is removed (the page goes blind)', build: () => rulesWithAdmin(null) }
];
console.log('\n--- admin mutants ---');
let adminEscaped = 0;
for (const { label, build } of ADMIN_MUTANTS) {
    await loadRules(build());
    const broke = (await runAdminScenarios()).filter(([, was, want]) => was !== want);
    if (broke.length) { console.log(`CAUGHT     ${label}`); console.log(`           first miss: ${broke[0][0]}`); }
    else { adminEscaped++; console.log(`ESCAPED    ${label}`); }
}
await loadRules(rulesFile);
ok(`no admin mutant escaped (${ADMIN_MUTANTS.length})`, adminEscaped === 0, `${adminEscaped} escaped`);


// 7. v3.22.3 — ADMIN CLEANUP AND THE ONLINE LIST (council ERS-30).
//    Tables and rooms are tidied only by the players' browsers; when all of
//    them are gone first, nothing ever does. An admin may now DELETE — never
//    edit — a room or lobby, and only one the server's own data calls dead.
//    online/{uid}/{conn} is a per-connection marker the admin page lists.
const CONN = '-Nabcdefghijklmnopqr', CONN2 = '-Nzyxwvutsrqponmlkji';
function rulesWithCleanup({ lobbyDel = composeAdminLobbyDelete(), roomDel = composeAdminRoomDelete(), online = ONLINE_RULES, lobbyRead = ADMIN_ROOMS_READ } = {}) {
    const clone = JSON.parse(JSON.stringify(rulesFile));
    clone.rules.lobbyRooms.$tableId['.write'] = `(${composeLobbyWrite()}) || (${lobbyDel})`;
    clone.rules.gameRooms.$roomId['.write'] = `(${composeGameRoomWrite()}) || (${roomDel})`;
    clone.rules.lobbyRooms['.read'] = lobbyRead;
    clone.rules.online = online;
    return clone;
}
const deadRoom = () => ({ ...room(null), lastPlayTime: Date.now() - ROOM_STALE_MS - 60000 });
const liveRoom = () => ({ ...room(null), lastPlayTime: Date.now() - 60000 });
const overRoom = () => ({ ...room(null), gameOver: true, winnerIndex: 0, lastPlayTime: Date.now() });
const mark = (s = 'menu') => ({ at: Date.now() - 1000, t: Date.now() - 1000, s });
async function runCleanupScenarios() {
    const r = [];
    const record = async (label, want, fn) => r.push([label, await fn(), want]);
    const fresh = async () => {
        await asOwner('gameRooms', null); await asOwner('lobbyRooms', null);
        await asOwner('online', null); await asOwner(`admins/${BOSS}`, true);
    };

    // rooms
    await fresh(); await asOwner('gameRooms/ROOM01', overRoom());
    await record('an admin deletes a finished room', true, async () => allowed(await tryWrite('gameRooms/ROOM01', null, BOSS)));
    await fresh(); await asOwner('gameRooms/ROOM01', deadRoom());
    await record('an admin deletes a room nobody moved in for 15 minutes', true, async () => allowed(await tryWrite('gameRooms/ROOM01', null, BOSS)));
    await fresh(); await asOwner('gameRooms/ROOM01', liveRoom());
    await record('an admin cannot delete a room that moved a minute ago', false, async () => allowed(await tryWrite('gameRooms/ROOM01', null, BOSS)));
    await fresh(); await asOwner('gameRooms/ROOM01', overRoom());
    await record('an admin cannot EDIT even a finished room', false, async () => allowed(await tryWrite('gameRooms/ROOM01/winnerIndex', 2, BOSS)));
    await fresh(); await asOwner('gameRooms/ROOM01', deadRoom());
    await record('a player who is not an admin cannot delete a dead room', false, async () => allowed(await tryWrite('gameRooms/ROOM01', null, OUT)));

    // lobbies
    await fresh(); await asOwner('lobbyRooms/ABC123', table('playing'));
    await record('an admin deletes a mid-match lobby whose room is gone', true, async () => allowed(await tryWrite('lobbyRooms/ABC123', null, BOSS)));
    await fresh(); await asOwner('lobbyRooms/ABC123', table('playing')); await asOwner('gameRooms/ROOM01', deadRoom());
    await record('an admin deletes a mid-match lobby whose room is dead', true, async () => allowed(await tryWrite('lobbyRooms/ABC123', null, BOSS)));
    await fresh(); await asOwner('lobbyRooms/ABC123', table('playing')); await asOwner('gameRooms/ROOM01', liveRoom());
    await record('an admin cannot delete a lobby whose room is live', false, async () => allowed(await tryWrite('lobbyRooms/ABC123', null, BOSS)));
    await fresh(); await asOwner('lobbyRooms/ABC123', table('waiting'));
    await record('an admin deletes a waiting lobby whose host is disconnected', true, async () => allowed(await tryWrite('lobbyRooms/ABC123', null, BOSS)));
    await fresh(); await asOwner('lobbyRooms/ABC123', table('waiting')); await asOwner(`online/${HOSTU}/${CONN}`, mark());
    await record('an admin cannot delete a waiting lobby whose host is connected', false, async () => allowed(await tryWrite('lobbyRooms/ABC123', null, BOSS)));
    await fresh();
    await asOwner('lobbyRooms/ABC123', { ...table('waiting'), gameState: { status: 'waiting', playerCount: 2, roomId: 'ROOM01' } });
    await asOwner(`online/${HOSTU}/${CONN}`, mark());
    await record('...not even when it still names an old, dead room ("play again")', false, async () => allowed(await tryWrite('lobbyRooms/ABC123', null, BOSS)));
    await fresh(); await asOwner('lobbyRooms/ABC123', table('playing')); await asOwner('gameRooms/ROOM01', overRoom());
    await record('an admin cannot EDIT a dead lobby', false, async () => allowed(await tryWrite('lobbyRooms/ABC123/hostUsername', 'x', BOSS)));
    await fresh(); await asOwner('lobbyRooms/ABC123', table('waiting'));
    await record('a stranger cannot delete a waiting lobby whose host left', false, async () => allowed(await tryWrite('lobbyRooms/ABC123', null, OUT)));
    await record('an admin lists the lobbies (to find orphans)', true, async () => allowed(await tryRead('lobbyRooms', BOSS)));
    await record('a player cannot list the lobbies', false, async () => allowed(await tryRead('lobbyRooms', OUT)));
    await record('a player still reads one lobby by its code', true, async () => allowed(await tryRead('lobbyRooms/ABC123', OUT)));

    // the online list — a marker is { at, t, s } (v3.22.4)
    const SV = { '.sv': 'timestamp' };
    await fresh();
    await record('a player writes their own connection marker (server time, activity)', true, async () => allowed(await tryWrite(`online/${OUT}/${CONN}`, { at: SV, t: SV, s: 'menu' }, OUT)));
    await record('...changes only the activity when a match starts', true, async () => allowed(await tryWrite(`online/${OUT}/${CONN}/s`, 'bots', OUT)));
    await record('...and removes it (what onDisconnect does)', true, async () => allowed(await tryWrite(`online/${OUT}/${CONN}`, null, OUT)));
    await record('nobody writes a marker for someone else', false, async () => allowed(await tryWrite(`online/${SEAT}/${CONN}`, { at: SV, t: SV, s: 'menu' }, OUT)));
    await record('a bare number is no longer a marker', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}`, Date.now() - 1000, OUT)));
    await record('a marker is not dated in the future', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}`, { at: Date.now() + 3600e3, t: SV, s: 'menu' }, OUT)));
    await record('...nor is its last change', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}`, { at: SV, t: Date.now() + 3600e3, s: 'menu' }, OUT)));
    await record('the activity is a word from the closed list', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}`, { at: SV, t: SV, s: '<img src=x>' }, OUT)));
    await record('a marker carries all three fields', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}`, { at: SV, s: 'menu' }, OUT)));
    await record('a marker cannot smuggle an extra field', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}`, { at: SV, t: SV, s: 'menu', name: 'x' }, OUT)));
    await record('a marker key has the shape of a connection id', false, async () => allowed(await tryWrite(`online/${OUT}/short`, { at: SV, t: SV, s: 'menu' }, OUT)));
    // v3.22.5 — the solo match summary g (counts only)
    const G = (over = {}) => ({ h: { 0: 13, 1: 12, 2: 14, 3: 13 }, p: 0, b: 0, a: 2, n: 40, o: false, e: 0, u: SV, ...over });
    await tryWrite(`online/${OUT}/${CONN}`, { at: SV, t: SV, s: 'bots' }, OUT);
    await record('a bot match summary is accepted', true, async () => allowed(await tryWrite(`online/${OUT}/${CONN}/g`, G(), OUT)));
    await record('...and removed when the match ends', true, async () => allowed(await tryWrite(`online/${OUT}/${CONN}/g`, null, OUT)));
    await record('a summary cannot carry a card (or anything else)', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}/g`, G({ cards: [{ rank: 5 }] }), OUT)));
    await record('a hand size is bounded', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}/g`, G({ h: { 0: 999, 1: 0, 2: 0, 3: 0 } }), OUT)));
    await record('there are exactly four seats', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}/g`, G({ h: { 0: 13, 1: 13, 2: 13, 3: 13, 4: 1 } }), OUT)));
    await record('a hand size is a whole number', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}/g`, G({ p: 1.5 }), OUT)));
    await record('the turn is a seat or -1', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}/g`, G({ a: 7 }), OUT)));
    await record('"over" is a boolean', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}/g`, G({ o: 'yes' }), OUT)));
    await record('the error count is bounded', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}/g`, G({ e: 5000 }), OUT)));
    await record('a summary is not dated in the future', false, async () => allowed(await tryWrite(`online/${OUT}/${CONN}/g`, G({ u: Date.now() + 3600e3 }), OUT)));
    await record('a summary has every field', false, async () => { const g = G(); delete g.n; return allowed(await tryWrite(`online/${OUT}/${CONN}/g`, g, OUT)); });
    await record('nobody writes a summary into another player marker', false, async () => allowed(await tryWrite(`online/${SEAT}/${CONN}/g`, G(), OUT)));
    await record('every activity word the client sends is accepted', true, async () => {
        for (const s of ONLINE_ACTIVITIES) if (!allowed(await tryWrite(`online/${OUT}/${CONN2}`, { at: SV, t: SV, s }, OUT))) return false;
        return true;
    });
    await asOwner(`online/${OUT}/${CONN}`, mark());
    await record('an admin lists who is online', true, async () => allowed(await tryRead('online', BOSS)));
    await record('a player cannot list who is online', false, async () => allowed(await tryRead('online', OUT)));
    await record('...nor read one player\'s markers', false, async () => allowed(await tryRead(`online/${OUT}`, SEAT)));

    await asOwner('gameRooms', null); await asOwner('lobbyRooms', null); await asOwner('online', null); await asOwner('admins', null);
    return r;
}
ok('database.rules.json: the online rules are the composed ones',
    JSON.stringify(rulesFile.rules.online) === JSON.stringify(ONLINE_RULES));
ok('database.rules.json: the admin lobby list is the composed read',
    rulesFile.rules.lobbyRooms['.read'] === ADMIN_ROOMS_READ);
{
    for (const [label, was, want] of await runCleanupScenarios()) {
        ok(label, was === want, `was ${was ? 'ALLOWED' : 'REFUSED'}, wanted ${want ? 'ALLOWED' : 'REFUSED'}`);
    }
}
const CP = CLEANUP_PIECES;
const onlineWith = (over) => ({ ...ONLINE_RULES, $uid: { $conn: { ...ONLINE_RULES.$uid.$conn, ...over } } });
const CLEANUP_MUTANTS = [
    { label: 'anyone may close a dead room or lobby', build: () => rulesWithCleanup({ roomDel: composeAdminRoomDelete({ ...CP, isAdmin: 'auth != null' }), lobbyDel: composeAdminLobbyDelete({ ...CP, isAdmin: 'auth != null' }) }) },
    { label: 'an admin may edit, not only delete', build: () => rulesWithCleanup({ roomDel: composeAdminRoomDelete({ ...CP, deletes: 'true' }), lobbyDel: composeAdminLobbyDelete({ ...CP, deletes: 'true' }) }) },
    { label: 'an admin may delete a live room', build: () => rulesWithCleanup({ roomDel: composeAdminRoomDelete({ ...CP, roomDead: 'true' }) }) },
    { label: 'a lobby may be deleted while its room is live', build: () => rulesWithCleanup({ lobbyDel: composeAdminLobbyDelete({ ...CP, linkedRoomDead: 'true' }) }) },
    { label: 'a waiting lobby may be deleted while its host is here', build: () => rulesWithCleanup({ lobbyDel: composeAdminLobbyDelete({ ...CP, hostGone: 'true' }) }) },
    { label: 'any player may list the lobbies', build: () => rulesWithCleanup({ lobbyRead: 'auth != null' }) },
    { label: 'any player may list who is online', build: () => rulesWithCleanup({ online: { ...ONLINE_RULES, '.read': 'auth != null' } }) },
    { label: 'a player may write anyone\'s marker', build: () => rulesWithCleanup({ online: onlineWith({ '.write': 'auth != null && $conn.matches(/^[-0-9A-Za-z_]{20}$/)' }) }) },
    { label: 'the marker key is not checked', build: () => rulesWithCleanup({ online: onlineWith({ '.write': 'auth != null && auth.uid === $uid' }) }) },
    { label: 'a marker may be dated in the future', build: () => rulesWithCleanup({ online: onlineWith({ at: { '.validate': 'newData.isNumber()' } }) }) },
    { label: 'its last change may be dated in the future', build: () => rulesWithCleanup({ online: onlineWith({ t: { '.validate': 'newData.isNumber()' } }) }) },
    { label: 'the activity may be any text', build: () => rulesWithCleanup({ online: onlineWith({ s: { '.validate': 'newData.isString()' } }) }) },
    { label: 'a marker may carry extra fields', build: () => rulesWithCleanup({ online: onlineWith({ $other: { '.validate': true } }) }) },
    { label: 'a summary may carry anything', build: () => rulesWithCleanup({ online: onlineWith({ g: { ...ONLINE_RULES.$uid.$conn.g, $other: { '.validate': true } } }) }) },
    { label: 'hand sizes are unbounded', build: () => rulesWithCleanup({ online: onlineWith({ g: { ...ONLINE_RULES.$uid.$conn.g, h: { ...ONLINE_RULES.$uid.$conn.g.h, $seat: { '.validate': 'newData.isNumber()' } } } }) }) },
    { label: 'a summary may lack fields', build: () => rulesWithCleanup({ online: onlineWith({ g: { ...ONLINE_RULES.$uid.$conn.g, '.validate': 'true' } }) }) },
    { label: 'the summary time may be in the future', build: () => rulesWithCleanup({ online: onlineWith({ g: { ...ONLINE_RULES.$uid.$conn.g, u: { '.validate': 'newData.isNumber()' } } }) }) },
    { label: 'the turn is unbounded', build: () => rulesWithCleanup({ online: onlineWith({ g: { ...ONLINE_RULES.$uid.$conn.g, a: { '.validate': 'newData.isNumber()' } } }) }) },
    { label: 'a marker may lack fields (or be a bare number)', build: () => rulesWithCleanup({ online: onlineWith({ '.validate': 'true' }) }) }
];
console.log('\n--- cleanup / online mutants ---');
let cleanupEscaped = 0;
for (const { label, build } of CLEANUP_MUTANTS) {
    await loadRules(build());
    const broke = (await runCleanupScenarios()).filter(([, was, want]) => was !== want);
    if (broke.length) { console.log(`CAUGHT     ${label}`); console.log(`           first miss: ${broke[0][0]}`); }
    else { cleanupEscaped++; console.log(`ESCAPED    ${label}`); }
}
await loadRules(rulesFile);
ok(`no cleanup/online mutant escaped (${CLEANUP_MUTANTS.length})`, cleanupEscaped === 0, `${cleanupEscaped} escaped`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
    console.log('\nfailed:\n  ' + failures.join('\n  '));
    process.exit(1);
}
