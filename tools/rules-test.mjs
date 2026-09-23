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
import { LOBBY_PIECES, composeLobbyWrite, GAMEROOM_PIECES, composeGameRoomWrite, CLIENT_VERSIONS_RULES } from './lobby-rule.mjs';
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
ok('database.rules.json carries exactly the composed lobby rule',
    LIVE_LOBBY_WRITE === compose(P),
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
    LIVE_ROOM_WRITE === composeGameRoomWrite(RP), 'the file and this test have drifted');
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
    console.log('\nfailed:\n  ' + failures.join('\n  '));
    process.exit(1);
}
