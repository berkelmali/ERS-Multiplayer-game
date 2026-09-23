#!/usr/bin/env node
/**
 * fuzz-pantheon.mjs — a bug hunter for the Table of the Gods (v3.19.x).
 *
 * Plays thousands of random-but-legal matches through the REAL code:
 *   offline  game.js + pantheon.js, driven on a fake clock;
 *   duat     the offline Duat journey (starts dead; Ammit prices wrong slaps);
 *   mp       firebaseSync.js's own transactions (play, slap, contest, timeout)
 *            against an in-memory RTDB that stores what RTDB stores
 *            (tools/fuzz/fake-firebase.mjs);
 *   host     the host's own client: MultiplayerMode.start() on that RTDB, its
 *            listener driving the bot driver, turn timer and defeat checks,
 *            with scripted humans who play, idle, spam slaps and drop out.
 * After every committed write it checks the invariants the design promises
 * and reports the first seed that breaks each one, with the state that broke it.
 * Fixed scenarios (one per award path and per fix) run first, in every mode.
 *
 *   node tools/fuzz-pantheon.mjs [--mode offline|duat|mp|host|both|all] [--duels 200] [--seed 1] [--gods ra,set]
 *   FUZZ_TRACE=1 ...   prints the last writes and timers when a host match freezes
 *
 * Exit 1 when any invariant broke. Every failure prints its seed; a seed
 * replays exactly (--seed N --duels 1), because module hooks run in-thread.
 * tools/fuzz-mutants.mjs proves each invariant can fail.
 */
import * as NodeModule from 'node:module';
if (NodeModule.registerHooks) NodeModule.registerHooks({ resolve: (await import('./fuzz/hooks.mjs')).resolveSync });
else NodeModule.register('./fuzz/hooks.mjs', import.meta.url);

// ── a fake clock: timers fire only when the driver advances time ──────────────
let NOW = 1_800_000_000_000;
let tid = 1;
const timers = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms = 0, ...a) => { const id = tid++; timers.push({ id, at: NOW + Math.max(0, Number(ms) || 0), fn, a }); return id; };
globalThis.clearTimeout = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) { if (globalThis.__traceClear) globalThis.__traceClear(id, new Error().stack.split('\n').slice(2, 4).join(' <- ')); timers.splice(i, 1); } };
globalThis.setInterval = (fn, ms = 0) => { const id = tid++; const tick = () => { fn(); timers.push({ id, at: NOW + ms, fn: tick, a: [] }); }; timers.push({ id, at: NOW + ms, fn: tick, a: [] }); return id; };
globalThis.clearInterval = globalThis.clearTimeout;
Date.now = () => NOW;
const errors = [];
process.on('unhandledRejection', (e) => errors.push(e instanceof Error ? e : new Error('unhandled rejection: ' + String(e))));
function advance(ms) {
    const end = NOW + ms;
    for (let guard = 0; guard < 10000; guard++) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift();
        NOW = Math.max(NOW, t.at);
        try { t.fn(...t.a); } catch (e) { errors.push(e); }
    }
    NOW = end;
}
const flush = () => new Promise(res => setImmediate(res));

// ── a browser shaped enough for the modules to load ──────────────────────────
const el = () => ({ classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, appendChild() {}, append() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, textContent: '', innerHTML: '' });
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    body: el(), documentElement: el(), addEventListener() {}, hidden: false, visibilityState: 'visible' };
globalThis.localStorage = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; })();
try { globalThis.navigator ??= { onLine: true, userAgent: 'fuzz' }; } catch { /* read-only in some node versions */ }
globalThis.addEventListener ??= () => {};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);

let seedState = 1;
Math.random = () => { seedState = (Math.imul(seedState ^ (seedState >>> 15), 2246822519) + 0x9E3779B9) >>> 0; return (seedState >>> 8) / 16777216; };
const rnd = () => Math.random();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const originalWarn = console.warn, originalLog = console.log, originalError = console.error;
const quiet = () => { console.warn = () => {}; console.log = () => {}; console.error = (...a) => errors.push(new Error(a.map(String).join(' '))); };
const loud = () => { console.warn = originalWarn; console.log = originalLog; console.error = originalError; };

quiet();
const { GameState } = await import('../public/js/game.js');
const EventBus = (await import('../public/js/eventbus.js')).default;
const P = await import('../public/js/pantheon.js');
const { HouseRules } = await import('../public/js/houseRules.js');
const { matchSlap } = await import('../public/js/slapRules.js');
const G = await import('../public/js/ghostCards.js');
const FF = await import('./fuzz/fake-firebase.mjs');
// The app imports these under ONE specifier each (test section 84); the
// fuzzer must too, or it drives a second copy the host never sees.
const { FirebaseSync } = await import('../public/js/firebaseSync.js?v=7');
const { MultiplayerMode } = await import('../public/js/multiplayerMode.js?v=6');
const { AuthSystem } = await import('../public/js/auth.js');
const { screenLog } = await import('./fuzz/fake-screen.mjs');
const SO = await import('../public/js/slapOutcome.js');
const DuatMod = await import('../public/js/duat.js');
const { MatchContext } = await import('../public/js/matchContext.js');
const { DEFAULT_RULES } = await import('../public/js/slapRules.js');
const { seatGod } = await import('../public/js/pantheonRoom.js');
const { WINDOW_MS } = await import('../public/js/fairSlap.js');
loud();

// The oracle is the fuzzer's OWN, not the module under test: a mutant in
// ghostCards.js must not also change what the checks count (council ERS-20:
// a ghost is a card marked \`ghost: true\`; a god holds at most 13).
const realCount = (cards) => (cards || []).filter(c => !(c && c.ghost)).length;
const ghostCount = (cards) => (cards || []).filter(c => c && c.ghost).length;
const GHOST_HELD_MAX = 13;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODE = arg('--mode', 'both');
const DUELS = Number(arg('--duels', 200));
const SEED0 = Number(arg('--seed', 1));
const GODS = arg('--gods', P.GODS.map(g => g.id).join(',')).split(',');
const VERBOSE = process.argv.includes('--verbose');

const findings = new Map();   // invariant -> { count, first }
function report(inv, seed, detail) {
    const f = findings.get(inv) || { count: 0, first: null };
    f.count++;
    if (!f.first) f.first = { seed, detail };
    findings.set(inv, f);
}
const cardStr = (c) => (c && typeof c === 'object' ? `${c.rank}${(c.suit || '?')[0]}${c.ghost ? 'g' : ''}` : String(c));
const handsStr = (hs) => hs.map((h, i) => `${i}:[${(h || []).map(cardStr).join(' ')}]`).join(' ');

/** The design's promises, on any table (offline hands or room seats). */
function checkTable(seed, where, { hands, pile, burn, godSeat }) {
    const total = hands.reduce((n, h) => n + realCount(h || []), 0) + realCount(pile || []) + realCount(burn || []);
    if (total !== 52) report('52 real cards in play', seed, `${where}: ${total} — ${handsStr(hands)} pile=[${(pile || []).map(cardStr)}]`);
    hands.forEach((h, i) => {
        if (i !== godSeat && ghostCount(h || []) > 0) report('ghosts only in the god\'s hand', seed, `${where}: seat ${i} ${handsStr([h])}`);
        if ((h || []).length > 0 && realCount(h) === 0) report('no hand of ghosts only', seed, `${where}: seat ${i} ${handsStr([h])}`);
    });
    if (ghostCount(hands[godSeat] || []) > GHOST_HELD_MAX) report('at most 13 ghosts held', seed, `${where}: ${ghostCount(hands[godSeat])}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// OFFLINE — the real engine and the real Pantheon, on the fake clock
// ═════════════════════════════════════════════════════════════════════════════
async function offlineDuel(godId, seed) {
    seedState = seed * 2654435761 >>> 0;
    const PM = P.PantheonMode;
    if (!PM._fuzzInit) { quiet(); PM.init(); loud(); PM._fuzzInit = true; }
    Object.assign(PM, { armed: true, godId, _ai: { seatConfig: {} }, hud: null, topZone: null, panel: null });
    HouseRules.setLocal(P.godRules(godId), { force: true });
    const errBefore = errors.length;
    let overs = [], resurrections = 0, emptyResurrections = 0;
    const onOver = (w) => overs.push(w);
    // 'resurrected' fires inside winPile BEFORE the cards land; judge it on the
    // pileWon that follows, when the hero's hand is final.
    let pendingRes = false;
    const onRes = () => { resurrections++; pendingRes = true; };
    const onWon = () => { if (pendingRes && GameState.players[0].length === 0) emptyResurrections++; pendingRes = false; };
    EventBus.on('gameOver', onOver); EventBus.on('resurrected', onRes); EventBus.on('pileWon', onWon);
    quiet();
    GameState.gameOver = true; timers.length = 0;
    GameState.init();
    const out = { steps: 0, piles: 0, ghostsSeen: 0, end: 'cap', hpEnd: null };
    let idle = 0, lastSig = '';
    try {
        for (let step = 0; step < 3000 && !GameState.gameOver; step++) {
            out.steps++;
            const r = rnd();
            const active = GameState.activePlayerId;
            const valid = GameState.isValidSlap();
            if (r < 0.45) {                                   // someone plays
                advance(1100 + Math.floor(rnd() * 400));
                if (!GameState.gameOver && GameState.activePlayerId >= 0) GameState.playCard(GameState.activePlayerId);
            } else if (r < 0.75 && valid) {                    // a valid slap, fastest seat wins
                advance(300 + Math.floor(rnd() * 500));
                GameState.slap(pick([0, 0, 1, 2, 3]));
            } else if (r < 0.80) {                             // a wrong slap
                advance(200 + Math.floor(rnd() * 800));
                if (!GameState.isValidSlap()) GameState.slap(pick([0, 1, 2, 3]));
            } else if (r < 0.83 && active === 0) {             // the hero is too slow
                GameState.handleTurnTimeout(0);
            } else {
                advance(Math.floor(rnd() * 2500));
            }
            if (GameState.pile.some(G.isGhost)) out.ghostsSeen++;
            checkTable(seed, `offline ${godId} step ${step}`, { hands: GameState.players, pile: GameState.pile, burn: GameState.burnPile, godSeat: 2 });
            if (PM.hp < 0 || PM.hp > PM.maxHp) report('god life stays in [0, max]', seed, `${godId}: ${PM.hp}/${PM.maxHp}`);
            if (PM.hp === 0 && !GameState.gameOver) report('a god at 0 life ends the match', seed, `${godId} step ${step}`);
            const sig = `${GameState.players.map(h => h.length)}|${GameState.pile.length}|${GameState.activePlayerId}|${GameState.challenge.active}`;
            idle = sig === lastSig ? idle + 1 : 0; lastSig = sig;
            if (idle > 60) { report('the table never freezes (offline)', seed, `${godId} step ${step}: ${sig} resolver=${GameState.challengeResolverActive} ${handsStr(GameState.players)}`); break; }
        }
        advance(5000);
        out.end = GameState.gameOver ? (PM.hp <= 0 ? 'life' : `cards:${overs[0]}`) : 'cap';
        out.hpEnd = PM.hp;
    } finally {
        loud();
        EventBus.off && EventBus.off('gameOver', onOver);
        EventBus.off && EventBus.off('resurrected', onRes);
        EventBus.off && EventBus.off('pileWon', onWon);
    }
    if (errors.length > errBefore) report('no uncaught error (offline)', seed, `${godId}: ${String(errors[errBefore] && errors[errBefore].stack || errors[errBefore]).split('\n').slice(0, 3).join(' | ')}`);
        if (overs.length > 1) report('a match ends exactly once', seed, `${godId}: gameOver fired ${overs.length}x (${overs})`);
    if (emptyResurrections) report('"slapped back in" only with cards to show for it', seed, `${godId}: ${emptyResurrections} of ${resurrections} resurrections left the hero with 0 cards`);
    if (out.end === 'cap') report('every duel ends (offline, 3000 actions)', seed, `${godId}: hp ${PM.hp} ${handsStr(GameState.players)}`);
    return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// MULTIPLAYER — firebaseSync's own transactions against the fake RTDB
// ═════════════════════════════════════════════════════════════════════════════
const ROOM = 'gameRooms/FUZZ';
function dealRoom(godId, humans) {
    const deck = [];
    for (const s of ['hearts', 'diamonds', 'clubs', 'spades']) for (let r = 2; r <= 14; r++) deck.push({ rank: r, suit: s });
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const players = [0, 1, 2, 3].map(i => ({
        uid: i < humans ? `human_${i}` : `bot_${i}`, name: `P${i}`, index: i, status: 'online', cards: deck.slice(i * 13, i * 13 + 13)
    }));
    const god = seatGod(godId, players, godId);
    return {
        tableId: 'FUZZ', hostId: 'human_0', players, playerIds: { human_0: true, human_1: true },
        pile: [], activePlayerId: 0, challenge: { active: false, attackerId: null, defenderId: null, chancesLeft: 0 },
        gameStarted: true, gameOver: false, winnerIndex: -1, lastPlayTime: NOW, ...god
    };
}
const seatCards = (room) => [0, 1, 2, 3].map(i => (room.players && room.players[i] && room.players[i].cards) || []);

let OP = '';
/** Checked on EVERY committed transaction, with the transaction's own before/after. */
function checkCommit(seed, godId, godSeat, before, after, state) {
    if (!before || !after) return;
    const where = `mp ${godId} ${OP}`;
    (after.players || []).forEach((p, i) => {
        if (p && p.eliminated && (p.cards || []).length > 0) report('an eliminated seat holds no cards (MP)', seed, `${where}: seat ${i} holds ${(p.cards || []).length} — before: elim=${!!(before.players[i] || {}).eliminated} cards=${((before.players[i] || {}).cards || []).length}`);
    });
    const bs = before.lastPile ? before.lastPile.seq : 0, as = after.lastPile ? after.lastPile.seq : 0;
    const handed = [...(before.burnPile || []), ...(before.pile || [])];
    const cleared = handed.length > 0 && (after.pile || []).length === 0 && (after.burnPile || []).length === 0;
    if (cleared && as !== bs + 1) report('every award is stamped exactly once', seed, `${where}: seq ${bs} -> ${as}, pile ${handed.length} -> 0`);
    if (!cleared && as !== bs && process.env.FUZZ_TRACE) originalLog(TRACE.slice(-8).join('\n'));
    if (!cleared && as !== bs) report('no stamp without an award', seed, `${where}: seq ${bs} -> ${as}; pile ${(before.pile || []).length}+burn ${(before.burnPile || []).length} -> ${(after.pile || []).length}+${(after.burnPile || []).length}; reason ${after.lastWinReason}; winner ${after.lastPile && after.lastPile.winner}; challenge ${JSON.stringify(before.challenge)}; active ${before.activePlayerId}; ${handsStr(seatCards(before))}`);
    if (typeof after.lastResurrectedId === 'number' && after.lastPile && (!before.lastPile || after.lastPile.seq !== before.lastPile.seq)) {
        state.comebacks = (state.comebacks || 0) + 1;
        const w = after.players[after.lastResurrectedId];
        if (!w || w.eliminated || !(w.cards || []).length) report('a comeback leaves the seat in, with cards (MP)', seed, `${where}: ${JSON.stringify(w)}`);
    }
        if (after.forcedTurnPass && JSON.stringify(after.forcedTurnPass) !== JSON.stringify(before.forcedTurnPass || null))
        report('no forced turn pass (it repairs a state that should not exist)', seed, `${where}: ${JSON.stringify(after.forcedTurnPass)}`);
    if (cleared && as === bs + 1) {
        state.awards++;
        const w = after.lastPile.winner;
        // Real cards are conserved, so the only seat that can GAIN real cards
        // in an award is the one the stamp names (the god's sandstorm steals
        // only on the god's own win, and the god is then the winner).
        const gain = [0, 1, 2, 3].map(i => realCount(((after.players[i] || {}).cards) || []) - realCount(((before.players[i] || {}).cards) || []));
        const others = gain.map((g, i) => (i !== w && g > 0 ? i : -1)).filter(i => i >= 0);
        if (others.length) report('the stamped winner is the seat that took the real cards', seed, `${where}: stamp names ${w}, but seat(s) ${others} gained ${others.map(i => gain[i])}`);
        if (gain[w] < 0) report('the stamped winner does not lose cards by winning', seed, `${where}: seat ${w} ${gain[w]}`);
        if (after.lastPile.vanished < ghostCount(handed)) report('the stamp counts every ghost that vanished', seed, `${where}: ${after.lastPile.vanished} < ${ghostCount(handed)}`);
    }
}

async function mpDuel(godId, seed) {
    seedState = seed * 2246822519 >>> 0;
    const humans = rnd() < 0.5 ? 2 : 3;
    const room = dealRoom(godId, humans);
    FF.store.root = {}; FF.write(ROOM, room);
    HouseRules.applyRoom(room.houseRules);
    FirebaseSync.roomId = 'FUZZ';
    FirebaseSync.USE_SERVER_VALIDATION = false;
    const godSeat = room.godSeat;
    const out = { steps: 0, awards: 0, ghostsSeen: 0, end: 'cap' };
    FF.store.onCommit = (path, b, a) => { if (path === ROOM) checkCommit(seed, godId, godSeat, b, a, out); };
    let idle = 0, lastSig = '', lastSeq = 0;
    quiet();
    try {
        for (let step = 0; step < 2500; step++) {
            out.steps++;
            const before = FF.read(ROOM);
            if (!before || before.gameOver) break;
            AuthSystem.currentUser = { uid: before.hostId };   // bot seats are written by the host (ERS-23 fence)
            const r = rnd();
            const active = before.activePlayerId;
            const valid = matchSlap(before.pile || [], HouseRules.active()) !== null;
            if (r < 0.45 && typeof active === 'number') {
                NOW += 900 + Math.floor(rnd() * 400);
                OP = `play ${active}`; await FirebaseSync.pushPlayCard({ playerIndex: active });
            } else if (r < 0.75 && valid) {
                NOW += 250 + Math.floor(rnd() * 400);
                const n = 1 + Math.floor(rnd() * 3);            // one to three claimants
                for (let k = 0; k < n; k++) { NOW += Math.floor(rnd() * 60); const s2 = pick([0, 1, 2, 3]); OP = `slap ${s2}`; await FirebaseSync.pushSlapAttempt({ playerIndex: s2 }); }
                NOW += WINDOW_MS + 10;
                OP = 'close contest'; await FirebaseSync.closeSlapContest();
            } else if (r < 0.80) {
                NOW += 200 + Math.floor(rnd() * 600);
                const cur = FF.read(ROOM);
                if (cur && !matchSlap(cur.pile || [], HouseRules.active())) { const s3 = pick([0, 1, 2, 3]); OP = `wrong slap ${s3}`; await FirebaseSync.pushSlapAttempt({ playerIndex: s3 }); }
            } else if (r < 0.86 && typeof active === 'number') {
                NOW += SO.TURN_TIMEOUT_MS + 500;
                OP = `timeout ${active}`; await FirebaseSync.pushTimeout(active);
            } else {
                NOW += Math.floor(rnd() * 1500);
                OP = 'close contest (idle)'; await FirebaseSync.closeSlapContest();
            }
            await flush();
            const after = FF.read(ROOM);
            if (!after) { report('the room survives the match', seed, `${godId} step ${step}: room deleted`); break; }
            const hands = seatCards(after);
            if ((after.pile || []).some(G.isGhost)) out.ghostsSeen++;
            checkTable(seed, `mp ${godId} step ${step}`, { hands, pile: after.pile, burn: after.burnPile, godSeat });
            const seq = after.lastPile ? after.lastPile.seq : 0;
            if (seq < lastSeq) report('the award stamp never goes backwards', seed, `${seq} < ${lastSeq}`);
            lastSeq = seq;
            if (after.godHp < 0 || after.godHp > after.godMaxHp) report('god life stays in [0, max] (MP)', seed, `${after.godHp}`);
            if (after.godHp === 0 && !after.gameOver) report('a god at 0 life ends the match (MP)', seed, `${godId} step ${step}`);
            // A turn must belong to someone who can take it.
            if (!after.gameOver) {
                const a = after.activePlayerId;
                const ch = after.challenge || {};
                const holder = typeof a === 'number' ? after.players[a] : null;
                const canAct = holder && !holder.eliminated && (((holder.cards || []).length > 0) || (ch.active && ch.defenderId === a));
                if (!canAct && typeof a === 'number') {
                    // Give the table every chance the live app has: play, timeout, contest close.
                    OP = `rescue play ${a}`; await FirebaseSync.pushPlayCard({ playerIndex: a }); NOW += SO.TURN_TIMEOUT_MS + 500; OP = `rescue timeout ${a}`; await FirebaseSync.pushTimeout(a);
                    const again = FF.read(ROOM);
                    if (again && !again.gameOver && again.activePlayerId === a && JSON.stringify(seatCards(again)) === JSON.stringify(hands))
                        report('the turn always belongs to a seat that can act (MP)', seed, `${godId} step ${step}: seat ${a} (${holder ? `${(holder.cards || []).length} cards, eliminated=${!!holder.eliminated}` : 'missing'}) challenge=${JSON.stringify(ch)} ${handsStr(hands)}`);
                }
            }
            const sig = `${hands.map(h => h.length)}|${(after.pile || []).length}|${after.activePlayerId}`;
            idle = sig === lastSig ? idle + 1 : 0; lastSig = sig;
            if (idle > 80) { report('the table never freezes (MP)', seed, `${godId} step ${step}: ${sig} ${handsStr(hands)} contest=${!!after.slapContest}`); break; }
        }
        const fin = FF.read(ROOM);
        out.end = fin && fin.gameOver ? (fin.godFallen ? 'life' : `cards:${fin.winnerId}`) : 'cap';
        if (fin && fin.gameOver) {
            const alive = fin.players.map((p, i) => (!p.eliminated && (p.cards || []).length ? i : -1)).filter(i => i >= 0);
            if (!fin.godFallen && typeof fin.winnerId === 'number' && fin.winnerId >= 0 && realCount((fin.players[fin.winnerId] || {}).cards) === 0)
                report('the winner holds cards (MP)', seed, `${godId}: winner ${fin.winnerId} ${handsStr(seatCards(fin))} alive=${alive}`);
        }
    } finally { loud(); FF.store.onCommit = null; }
    if (out.end === 'cap') report('every duel ends (MP, 2500 actions)', seed, `${godId}: hp ${FF.read(ROOM)?.godHp} ${handsStr(seatCards(FF.read(ROOM) || {}))}`);
    return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// DUAT — the offline journey that starts dead (council ERS-22, Q5): the hero
// holds nothing, may slap back in, and pays a wrong slap to Ammit (a round).
// The engine's empty-hand lock (ERS-22 c) must stand aside here, and a
// journey must end: at dawn, or when the Duat keeps the hero.
// ═════════════════════════════════════════════════════════════════════════════
async function duatDuel(_godId, seed) {
    seedState = seed * 2971215073 >>> 0;
    const DM = DuatMod.DuatMode;
    if (!DM._fuzzInit) { quiet(); DM.init(); loud(); DM._fuzzInit = true; }
    P.PantheonMode.armed = false;
    HouseRules.setLocal({ ...DEFAULT_RULES }, { force: true });
    Object.assign(DM, { armed: true, _ai: { seatConfig: {} }, hud: null, _gm: null });
    MatchContext.ownsElimination = true;
    MatchContext.pricesWrongSlaps = true;
    const errBefore = errors.length;
    let overs = [], attempts = 0, refused = 0, spam = 0;
    const onOver = (w) => overs.push(w);
    const onAttempt = (s) => { if (s === 0) attempts++; };
    EventBus.on('gameOver', onOver); EventBus.on('slapAttempt', onAttempt);
    quiet();
    GameState.gameOver = true; timers.length = 0;
    GameState.init(DuatMod.duatScenario());
    const out = { steps: 0, piles: 0, ghostsSeen: 0, end: 'cap', risen: 0 };
    let idle = 0, lastSig = '';
    try {
        for (let step = 0; step < 4000 && !GameState.gameOver; step++) {
            out.steps++;
            const r = rnd();
            const heroEmpty = GameState.players[0].length === 0;
            if (heroEmpty && r < 0.25) {
                // A dead hero hammering the table: every attempt must be heard
                // (and a wrong one fed to Ammit), never refused by the lock.
                advance(120 + Math.floor(rnd() * 200));
                if (!GameState.gameOver && Date.now() - GameState.lastSlapWinTime >= 500) {
                    const before = attempts;
                    spam++;
                    GameState.slap(0);
                    if (attempts === before) refused++;
                }
            } else if (r < 0.55) {
                advance(1100 + Math.floor(rnd() * 400));
                if (!GameState.gameOver && GameState.activePlayerId >= 0) GameState.playCard(GameState.activePlayerId);
            } else if (r < 0.8 && GameState.isValidSlap()) {
                advance(300 + Math.floor(rnd() * 500));
                GameState.slap(pick([0, 0, 1, 2, 3]));
            } else if (r < 0.84) {
                advance(200 + Math.floor(rnd() * 800));
                if (!GameState.isValidSlap()) GameState.slap(pick([0, 1, 2, 3]));
            } else if (r < 0.87 && GameState.activePlayerId === 0) {
                GameState.handleTurnTimeout(0);
            } else {
                advance(Math.floor(rnd() * 2500));
            }
            if (!DM.dead) out.risen = 1;
            checkTable(seed, `duat step ${step}`, { hands: GameState.players, pile: GameState.pile, burn: GameState.burnPile, godSeat: -1 });
            if (DM.hour < 0 || DM.hour > DuatMod.DAWN_HOUR) report('the Duat hour stays in [0, dawn]', seed, `${DM.hour}`);
            if (!GameState.gameOver && DM.dead && Math.floor(DM.progress) >= DuatMod.DUAT_ROUNDS) report('ten rounds in the Duat end the journey', seed, `progress ${DM.progress}`);
            const sig = `${GameState.players.map(h => h.length)}|${GameState.pile.length}|${GameState.activePlayerId}|${GameState.challenge.active}`;
            idle = sig === lastSig ? idle + 1 : 0; lastSig = sig;
            if (idle > 80) { report('the table never freezes (Duat)', seed, `step ${step}: ${sig}`); break; }
        }
        advance(5000);
        out.end = GameState.gameOver ? (overs[0] === 0 ? 'life' : `cards:${overs[0]}`) : 'cap';
    } finally {
        loud();
        EventBus.off('gameOver', onOver); EventBus.off('slapAttempt', onAttempt);
        try { quiet(); DM.stop(); } catch (e) { errors.push(e); } finally { loud(); }
        MatchContext.ownsElimination = false; MatchContext.pricesWrongSlaps = false;
    }
    out.spam = spam;
    if (refused) report('the Duat never refuses a slap from the Duat (ERS-22 c exemption)', seed, `${refused} of ${spam} empty-hand slaps were refused`);
    if (errors.length > errBefore) report('no uncaught error (Duat)', seed, String(errors[errBefore] && errors[errBefore].stack || errors[errBefore]).split('\n').slice(0, 3).join(' | '));
    if (overs.length > 1) report('a match ends exactly once (Duat)', seed, `gameOver fired ${overs.length}x`);
    if (out.end === 'cap') report('every Duat journey ends (4000 actions)', seed, `hour ${DM.hour} progress ${DM.progress} dead ${DM.dead} ${handsStr(GameState.players)}`);
    return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// HOST — the host's own client, end to end (council ERS-22, condition I2).
// MultiplayerMode.start() attaches the real listener; every snapshot of the
// fake RTDB reaches syncToLocal and 'gameSynced', and from there the host's
// bot driver, turn timer, contest close and defeat checks run exactly as in
// the browser. The humans are scripted clients: one who plays, one who never
// does (so the host MUST time them out), and one who spams slaps from an
// empty hand (so the ERS-22 (c) lock is attacked on every pile).
// ═════════════════════════════════════════════════════════════════════════════
let ACTOR = null;               // the scripted client whose write is in flight (set synchronously)
async function stepClock(maxMs) {
    timers.sort((a, b) => a.at - b.at || a.id - b.id);
    const t = timers[0];
    if (t && t.at <= NOW + maxMs) {
        timers.shift();
        NOW = Math.max(NOW, t.at);
        try { t.fn(...t.a); } catch (e) { errors.push(e); }
    } else NOW += maxMs;
    await flush();
}
const sessionSyncSentinel = () => {};   // stands in for ui.js's session-wide gameSynced listener
EventBus.on('gameSynced', sessionSyncSentinel);
const TRACE = [];
if (process.env.FUZZ_TRACE) {
    globalThis.__traceClear = (id, where) => { TRACE.push(`${NOW % 1e6} clearTimeout(${id}) ${where.replace(/\s+/g, ' ').slice(0, 200)}`); if (TRACE.length > 60) TRACE.shift(); };
    for (const m of ['playCard', 'executePlay', 'checkBotTurn', 'checkTurnTimeouts']) {
        const f = MultiplayerMode[m];
        MultiplayerMode[m] = function (...a) {
            TRACE.push(`${NOW % 1e6} MM.${m}(${m === 'checkBotTurn' ? (a[0] && a[0].activePlayerId) + ' p=' + JSON.stringify(a[0] && a[0].players[a[0].activePlayerId], (k, v) => k === 'cards' ? v.length : v) + ' started=' + (a[0] && a[0].gameStarted) + ' over=' + (a[0] && a[0].gameOver) + ' host=' + (a[0] && a[0].hostId) : JSON.stringify(a)}) GS.active=${GameState.activePlayerId} started=${GameState.gameStarted} over=${GameState.gameOver} rd.active=${FirebaseSync.roomData && FirebaseSync.roomData.activePlayerId}`);
            if (TRACE.length > 60) TRACE.shift();
            return f.apply(this, a);
        };
    }
    for (const m of ['pushPlayCard', 'pushSlapAttempt', 'closeSlapContest', 'pushTimeout', 'pushUpdate']) {
        const f = FirebaseSync[m];
        FirebaseSync[m] = function (...a) {
            const before = JSON.stringify(FF.read(ROOM) || {}).length; const w = FF.store.writes, ab = FF.store.aborted;
            const r = f.apply(this, a);
            TRACE.push(`${NOW % 1e6} ${m}(${JSON.stringify(a)}) actor=${ACTOR ? ACTOR.kind + ACTOR.seat : 'host'} -> ${FF.store.writes > w ? 'write' : FF.store.aborted > ab ? 'abort' : 'nochange'} active=${(FF.read(ROOM) || {}).activePlayerId} contest=${JSON.stringify((FF.read(ROOM) || {}).slapContest || null)}`);
            if (TRACE.length > 40) TRACE.shift();
            return r;
        };
    }
}
async function hostDuel(godId, seed, capMs = 25 * 60 * 1000) {
    seedState = seed * 3266489917 >>> 0;
    const humans = rnd() < 0.5 ? 2 : 3;
    const room = dealRoom(godId, humans);
    const policy = [0, 1, 2, 3].map(i => (i >= humans ? 'bot' : pick(['normal', 'normal', 'normal', 'afk', 'spam'])));
    // Some players leave mid-match: their connection drops (RTDB's
    // onDisconnect marks the seat), their client stops, and nobody migrates
    // anything for them — a closed tab runs abandonRoom, a lost network does not.
    const leaveAt = [0, 1, 2, 3].map(i => (i < humans && rnd() < 0.2 ? NOW + 20000 + Math.floor(rnd() * 180000) : Infinity));
    const gone = [false, false, false, false];
    timers.length = 0;
    FF.store.root = {}; FF.store.listeners = []; FF.store.errors = [];
    FF.write(ROOM, room);
    FirebaseSync.USE_SERVER_VALIDATION = false;
    AuthSystem.currentUser = { uid: 'human_0' };
    screenLog.shows.length = 0; screenLog.notifications.length = 0;
    const godSeat = room.godSeat;
    const out = { steps: 0, awards: 0, ghostsSeen: 0, end: 'cap', comebacks: 0, spamRefused: 0, hostMoves: 0, leavers: 0 };
    const errBefore = errors.length;
    let lastCommitAt = NOW;
    FF.store.onCommit = (path, b, a, how) => {
        if (path !== ROOM || !b || !a) return;
        lastCommitAt = NOW;
        OP = ACTOR ? `${ACTOR.kind} ${ACTOR.seat}` : `host ${how}`;
        if (ACTOR && ACTOR.locked) report('a locked empty hand writes nothing (ERS-22 c, host)', seed, `${godId}: seat ${ACTOR.seat} wrote on pile ${SO.pileKey(b)}`);
        checkCommit(seed, godId, godSeat, b, a, out);
        const newPile = a.lastPile && (!b.lastPile || a.lastPile.seq !== b.lastPile.seq);
        if (newPile && a.lastWinReason === 'slap' && SO.emptySlapLocked(b, a.lastPile.winner))
            report('a seat locked out of this pile never wins it by a slap (ERS-22 c)', seed, `${godId}: seat ${a.lastPile.winner}`);
        if (a.gameOver && !b.gameOver && a.winnerId === -1) {
            const stillIn = a.players.map((p, i) => (p && !p.uid.startsWith('bot_') && p.status !== 'disconnected' && !p.eliminated ? i : -1)).filter(i => i >= 0);
            if (stillIn.length) report('"every human is out" ends a match only when every human is out (host)', seed,
                `${godId} [${OP}]: human seat(s) ${stillIn} not eliminated — ${stillIn.map(i => `${i}: ${(a.players[i].cards || []).length} cards${b.challenge && b.challenge.active && b.challenge.attackerId === i ? ', ATTACKER in a live challenge' : ''}`).join('; ')}`);
        }
    };

    // The scripted human clients, each reacting to the same snapshots.
    const planned = {};
    let elim0 = false, elim0Shown = 0;
    const act = (s, kind, fn) => {
        const cur = FF.read(ROOM);
        if (!cur || cur.gameOver) return;
        const locked = kind.includes('slap') && SO.emptySlapLocked(cur, s);
        if (locked) out.spamRefused++;
        ACTOR = { seat: s, kind, locked };
        try { fn(cur); } finally { ACTOR = null; }
    };
    const slapAs = (s) => (s === 0 ? MultiplayerMode.slap(0) : FirebaseSync.pushSlapAttempt({ playerIndex: s }));
    const plan = (s, d) => {
        const me = d.players[s];
        if (!me || policy[s] === 'afk') return;
        const pileKey = `${SO.pileKey(d)}|${(d.pile || []).length}`;
        const valid = matchSlap(d.pile || [], HouseRules.active()) !== null;
        if (d.activePlayerId === s && !me.eliminated && planned[s + 'turn'] !== `${d.lastPlayTime}|${pileKey}`) {
            planned[s + 'turn'] = `${d.lastPlayTime}|${pileKey}`;
            setTimeout(() => act(s, 'play', (cur) => {
                if (cur.activePlayerId !== s) return;
                if (s === 0) MultiplayerMode.playCard(0); else FirebaseSync.pushPlayCard({ playerIndex: s });
            }), 400 + Math.floor(rnd() * 3000));
        }
        if (planned[s + 'slap'] === pileKey) return;
        planned[s + 'slap'] = pileKey;
        const empty = realCount(me.cards || []) === 0;
        if (policy[s] === 'spam' && empty && (d.pile || []).length) {
            // From an empty hand, hammer the table: the first miss locks the seat
            // out of this pile; every later slap must write nothing.
            for (let k = 0; k < 6; k++) setTimeout(() => act(s, 'spam slap', () => slapAs(s)), 60 + 160 * k);
        } else if (valid && rnd() < (policy[s] === 'spam' ? 1 : 0.6)) {
            setTimeout(() => act(s, 'slap', (cur) => { if (matchSlap(cur.pile || [], HouseRules.active())) slapAs(s); }), 220 + Math.floor(rnd() * 700));
        } else if (!valid && rnd() < 0.04) {
            setTimeout(() => act(s, 'wrong slap', (cur) => { if (!matchSlap(cur.pile || [], HouseRules.active())) slapAs(s); }), 300 + Math.floor(rnd() * 1200));
        }
    };
    const unsubHumans = FF.onValue({ path: ROOM }, (snap) => {
        const d = snap.val();
        if (!d || d.gameOver) return;
        // The room moves its host when the host is knocked out (slapOutcome.
        // migrateHostIfNeeded); the new host's client takes over the bots and
        // the turn timer. One client instance plays every host in turn: it
        // answers to whichever uid the room names.
        // Whose client is this? The host's, while the host is connected;
        // otherwise the first connected human's (the one a failover would
        // pick) — which is NOT the host until the room says so.
        const hostSeat = d.players.find(p => p && p.uid === d.hostId);
        const liveHumans = d.players.filter(p => p && !p.uid.startsWith('bot_') && p.status !== 'disconnected');
        const me = hostSeat && hostSeat.status !== 'disconnected' ? d.hostId
            : ((liveHumans.find(p => !p.eliminated) || liveHumans[0] || { uid: 'nobody' }).uid);
        if (AuthSystem.currentUser.uid !== me) { AuthSystem.currentUser = { uid: me }; out.hostMoves++; }
        const e0 = !!(d.players[0] && d.players[0].eliminated);
        if (e0 && !elim0) elim0Shown++;
        elim0 = e0;
        for (let s = 0; s < humans; s++) if (!gone[s]) plan(s, d);
    });

    quiet();
    let over = null;
    try {
        MultiplayerMode.start('FUZZ', 0);
        await flush();
        const T_END = NOW + capMs;
        while (NOW < T_END) {
            await stepClock(1000);
            const cur = FF.read(ROOM);
            if (!cur) { report('the room survives the match (host)', seed, `${godId}: room deleted`); break; }
            if (cur.gameOver) { over = cur; break; }
            // Every human has left: no client runs, so nothing drives the room
            // (slapOutcome.resolveEndOfMatch says so: inert, not finished).
            if (!cur.players.some(p => p && !p.uid.startsWith('bot_') && p.status !== 'disconnected')) { out.abandoned = 1; break; }
            out.steps++;
            for (let s = 0; s < humans; s++) {
                if (!gone[s] && NOW >= leaveAt[s]) {
                    gone[s] = true; out.leavers++;
                    FF.write(`${ROOM}/players/${s}/status`, 'disconnected');
                    FF.write(`${ROOM}/players/${s}/disconnectedAt`, NOW);
                }
                if (gone[s] && NOW > leaveAt[s] + 60000 + 8000 && cur.players[s] && !cur.players[s].uid.startsWith('bot_'))
                    { report('a player who leaves is replaced by a bot after 60 s (host)', seed, `${godId}: seat ${s} left ${Math.round((NOW - leaveAt[s]) / 1000)} s ago; host ${cur.hostId}; ${cur.players.map(p => `${p.uid}/${p.status}${p.eliminated ? '/out' : ''}`)}`); leaveAt[s] = Infinity; }
            }
            if ((cur.pile || []).some(G.isGhost)) out.ghostsSeen++;
            checkTable(seed, `host ${godId} t+${Math.round((NOW - lastCommitAt) / 1000)}s`, { hands: seatCards(cur), pile: cur.pile, burn: cur.burnPile, godSeat });
            const a = cur.activePlayerId;
            const holder = typeof a === 'number' ? cur.players[a] : null;
            if (holder && !holder.uid.startsWith('bot_') && !holder.eliminated && NOW - (cur.lastPlayTime || NOW) > 15000 + 3000) {
                report('a human who does not play is timed out after 15 s (host)', seed, `${godId}: seat ${a} (${policy[a]}) has held the turn ${Math.round((NOW - cur.lastPlayTime) / 1000)} s; host ${cur.hostId} me ${AuthSystem.currentUser.uid} locks ${JSON.stringify(MultiplayerMode.timeoutLocks || {})} watcher ${MultiplayerMode.timeoutWatcher} pending ${timers.map(t => t.id)} seats ${cur.players.map(p => `${p.uid}/${p.status}${p.eliminated ? '/out' : ''}/${(p.cards || []).length}`)} challenge ${JSON.stringify(cur.challenge)} contest ${JSON.stringify(cur.slapContest || null)}`);
                if (process.env.FUZZ_TRACE) originalLog(TRACE.join('\n') + '\nPENDING ' + timers.map(t => `${t.id}@+${Math.round(t.at - NOW)} ${String(t.fn).replace(/\s+/g, ' ').slice(0, 160)}`).join('\n') + ' uid=' + AuthSystem.currentUser.uid + ' host=' + cur.hostId + ' watcher=' + MultiplayerMode.timeoutWatcher + ' locks=' + JSON.stringify(MultiplayerMode.timeoutLocks));
                break;
            }
            if (NOW - lastCommitAt > 40000) {
                report('the table never freezes (host)', seed, `${godId}: no write for 40 s; local: active ${GameState.activePlayerId} started ${GameState.gameStarted} over ${GameState.gameOver} botT ${JSON.stringify(Object.keys(MultiplayerMode.botTimeouts))} pending ${timers.length} roomData.active ${FirebaseSync.roomData && FirebaseSync.roomData.activePlayerId}; turn ${a} ${handsStr(seatCards(cur))} challenge=${JSON.stringify(cur.challenge)} contest=${!!cur.slapContest} policies=${policy} host=${cur.hostId} seats=${cur.players.map(p => `${p.uid}/${p.status}${p.eliminated ? '/out' : ''}`)}`);
                if (process.env.FUZZ_TRACE) originalLog(TRACE.join('\n') + '\nPENDING ' + timers.map(t => `${t.id}@+${Math.round(t.at - NOW)} ${String(t.fn).replace(/\s+/g, ' ').slice(0, 160)}`).join('\n') + '\nbotT=' + JSON.stringify(MultiplayerMode.botTimeouts) + ' roomData.lastPlayTime=' + (FirebaseSync.roomData && FirebaseSync.roomData.lastPlayTime) + ' NOW=' + NOW);
                break;
            }
        }
        for (let k = 0; k < 20; k++) await stepClock(250);
    } finally {
        FF.store.onCommit = null;
        unsubHumans();
        const mine = MultiplayerMode.syncListener;
        try { MultiplayerMode.quit(); } catch (e) { errors.push(e); }
        await flush();
        // Leaving a match removes the match's own listeners and nobody else's
        // (ui.js keeps one on 'gameSynced' for the whole session).
        const left = EventBus.listeners.gameSynced || [];
        if (left.includes(mine)) report('leaving a match removes its sync listener (host)', seed, `${godId}: still attached`);
        if (!left.includes(sessionSyncSentinel)) report('leaving a match leaves other modules\' listeners alone (host)', seed, `${godId}: the session-wide gameSynced listener was removed`);
        timers.length = 0;
        GameState.isMultiplayer = false; GameState.gameOver = true;
        loud();
    }
    if (over) {
        out.end = over.godFallen ? 'life' : over.winnerId === -1 ? 'cards:no human' : `cards:${over.winnerId}`;
        out.humansOut = over.winnerId === -1 ? 1 : 0;
    } else if (!out.abandoned) {
        const cur = FF.read(ROOM) || {};
        if (!cur.gameOver) report('every duel ends (host, 25 min)', seed, `${godId}: hp ${cur.godHp} ${handsStr(seatCards(cur))} policies=${policy}`);
    }
    const shows99 = screenLog.shows.filter(c => c === 99).length;
    if (shows99 < elim0Shown) report('the host sees the defeat screen every time it is knocked out (host)', seed, `${godId}: out ${elim0Shown}x, screen ${shows99}x`);
    const errs = [...errors.slice(errBefore), ...(FF.store.errors || [])];
    if (errs.length) report('no uncaught error (host)', seed, `${godId}: ${String(errs[0] && errs[0].stack || errs[0]).split('\n').slice(0, 3).join(' | ')}`);
    return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIOS — one fixed case per award path (council ERS-21, condition a).
// Each drives the real FirebaseSync method against the fake RTDB and states
// the behaviour that path has since v3.19.1, including what CHANGED.
// ═════════════════════════════════════════════════════════════════════════════
const scenarioResults = [];
async function scenario(name, room, act, expect, asUid = 'human_0') {
    const base = { tableId: 'FUZZ', hostId: 'human_0', playerIds: { human_0: true, human_1: true }, gameStarted: true, gameOver: false,
        challenge: { active: false, attackerId: null, defenderId: null, chancesLeft: 0 }, lastPlayTime: NOW, pile: [], burnPile: [] };
    FF.store.root = {}; FF.write(ROOM, { ...base, ...room });
    HouseRules.applyRoom(room.houseRules || 'doubles,sandwich,marriage,tens');
    FirebaseSync.roomId = 'FUZZ'; FirebaseSync.USE_SERVER_VALIDATION = false;
    const prevUser = AuthSystem.currentUser;
    AuthSystem.currentUser = { uid: asUid };           // whose client acts (the host by default)
    quiet();
    try { NOW += SO.TURN_TIMEOUT_MS + 1000; await act(); await flush(); } finally { loud(); AuthSystem.currentUser = prevUser; }
    const after = FF.read(ROOM);
    let problem = null;
    try { problem = expect(after); } catch (e) { problem = 'threw ' + e.message; }
    scenarioResults.push({ name, ok: !problem, problem });
    if (problem) report(`scenario: ${name}`, 0, problem);
}
const C2 = (rank, suit = 'hearts') => ({ rank, suit });
const G2 = (rank) => ({ rank, suit: 'spades', ghost: true });
const seat = (i, cards, extra = {}) => ({ uid: i < 2 ? `human_${i}` : `bot_${i}`, name: `P${i}`, index: i, status: 'online', cards, ...extra });
const need = (cond, msg) => (cond ? null : msg);
async function runScenarios() {
    // S1 play path: the defender's turn comes with no cards -> the attacker takes the table.
    await scenario('play: a defender with no cards loses the challenge', {
        players: [seat(0, [C2(2), C2(3)]), seat(1, []), seat(2, [C2(4)]), seat(3, [C2(5)])],
        pile: [C2(12, 'clubs'), C2(6)], challenge: { active: true, attackerId: 0, defenderId: 1, chancesLeft: 1 }, activePlayerId: 1
    }, () => FirebaseSync.pushPlayCard({ playerIndex: 1 }), (r) => need(r.lastPile && r.lastPile.winner === 0 && r.players[0].cards.length === 4 && r.lastWinReason === 'challenge' && r.activePlayerId === 0 && !r.challenge.active,
        `got winner ${r.lastPile && r.lastPile.winner}, cards ${r.players[0].cards.length}, active ${r.activePlayerId}`));
    // S2 play path: the last chance is not a face card -> attacker wins.
    await scenario('play: the last chance spent hands the attacker the table', {
        players: [seat(0, [C2(2)]), seat(1, [C2(7, 'clubs'), C2(8)]), seat(2, [C2(4)]), seat(3, [C2(5)])],
        pile: [C2(11, 'clubs')], challenge: { active: true, attackerId: 0, defenderId: 1, chancesLeft: 1 }, activePlayerId: 1
    }, () => FirebaseSync.pushPlayCard({ playerIndex: 1 }), (r) => need(r.lastPile && r.lastPile.winner === 0 && r.players[0].cards.length === 3 && r.players[1].cards.length === 1,
        `got ${JSON.stringify(r.lastPile)} p0 ${r.players[0].cards.length} p1 ${(r.players[1].cards || []).length}`));
    // S3 timeout path, CHANGED: it now ends the match when the award leaves one seat standing.
    await scenario('timeout: a challenge won by timeout can end the match (new in v3.19.1)', {
        players: [seat(0, [C2(2)]), seat(1, [C2(9)]), seat(2, [], { eliminated: true }), seat(3, [], { eliminated: true })],
        pile: [C2(13, 'clubs')], challenge: { active: true, attackerId: 0, defenderId: 1, chancesLeft: 3 }, activePlayerId: 1
    }, () => FirebaseSync.pushTimeout(1), (r) => need(r.gameOver === true && r.winnerId === 0 && r.players[0].cards.length === 3,
        `gameOver ${r.gameOver} winner ${r.winnerId} p0 ${r.players[0].cards.length}`));
    // S4 timeout path, CHANGED: a defender with no cards used to hold the turn forever.
    await scenario('timeout: a defender with no cards loses the challenge (new in v3.19.1)', {
        players: [seat(0, [C2(2)]), seat(1, []), seat(2, [C2(4)]), seat(3, [C2(5)])],
        pile: [C2(14, 'clubs')], challenge: { active: true, attackerId: 0, defenderId: 1, chancesLeft: 4 }, activePlayerId: 1
    }, () => FirebaseSync.pushTimeout(1), (r) => need(r.lastPile && r.lastPile.winner === 0 && r.players[0].cards.length === 2 && r.activePlayerId === 0,
        `got ${JSON.stringify(r.lastPile)} active ${r.activePlayerId}`));
    // S5 burn path: the defender burns its last card on a wrong slap.
    await scenario('wrong slap: burning the last card mid-challenge hands the attacker the table', {
        players: [seat(0, [C2(2)]), seat(1, [C2(3, 'clubs')]), seat(2, [C2(4)]), seat(3, [C2(5)])],
        pile: [C2(12, 'clubs'), C2(9)], challenge: { active: true, attackerId: 0, defenderId: 1, chancesLeft: 1 }, activePlayerId: 1
    }, () => FirebaseSync.pushSlapAttempt({ playerIndex: 1 }), (r) => need(r.lastPile && r.lastPile.winner === 0 && r.players[0].cards.length === 4 && r.players[1].eliminated === true,
        `got ${JSON.stringify(r.lastPile)} p0 ${r.players[0].cards.length} p1 elim ${r.players[1].eliminated}`));
    // S6 F1: an eliminated attacker wins by timeout -> back in, with the turn.
    await scenario('F1: an eliminated attacker who wins a challenge is back in', {
        players: [seat(0, [C2(2)]), seat(1, [], { eliminated: true }), seat(2, [C2(4), C2(6)]), seat(3, [C2(5)])],
        pile: [C2(11, 'clubs'), C2(8)], challenge: { active: true, attackerId: 1, defenderId: 2, chancesLeft: 1 }, activePlayerId: 2
    }, () => FirebaseSync.pushTimeout(2), (r) => need(!r.players[1].eliminated && r.players[1].cards.length === 3 && r.activePlayerId === 1 && r.lastResurrectedId === 1,
        `p1 elim ${r.players[1].eliminated} cards ${(r.players[1].cards || []).length} active ${r.activePlayerId} res ${r.lastResurrectedId}`));
    // S7 a pile of ghosts only: the winner gains nothing, so it does not lead
    // (and a seat that was not out is not announced as back in).
    await scenario('a pile of ghosts only: the winner gains nothing and the lead moves on', {
        players: [seat(0, [C2(2)]), seat(1, []), seat(2, [C2(4)]), seat(3, [G2(9), C2(5)])],
        pile: [G2(7), G2(7)], activePlayerId: 3, god: 'ra', godSeat: 3, godHp: 160, godMaxHp: 160, godDamage: [0, 0, 0, 0]
    }, async () => { await FirebaseSync.pushSlapAttempt({ playerIndex: 1 }); NOW += WINDOW_MS + 10; await FirebaseSync.closeSlapContest(); },
    (r) => need(r.lastPile && r.lastPile.winner === 1 && r.lastPile.vanished === 2 && !(r.players[1].cards || []).length && r.activePlayerId !== 1 && r.lastResurrectedId == null,
        `lastPile ${JSON.stringify(r.lastPile)} p1 ${(r.players[1].cards || []).length} active ${r.activePlayerId} res ${r.lastResurrectedId}`));
    // S10 SLAP BACK IN online (v3.19.2): an eliminated player may slap, and a
    // good slap brings them back with the pile — the rules panel's promise.
    await scenario('slap back in: an eliminated player who slaps a real pattern is back in', {
        players: [seat(0, [C2(2), C2(3)]), seat(1, [], { eliminated: true }), seat(2, [C2(4)]), seat(3, [C2(5)])],
        pile: [C2(9, 'clubs'), C2(9)], activePlayerId: 2
    }, async () => { await FirebaseSync.pushSlapAttempt({ playerIndex: 1 }); NOW += WINDOW_MS + 10; await FirebaseSync.closeSlapContest(); },
    (r) => need(r.lastPile && r.lastPile.winner === 1 && !r.players[1].eliminated && (r.players[1].cards || []).length === 2 && r.lastResurrectedId === 1 && r.activePlayerId === 1,
        `lastPile ${JSON.stringify(r.lastPile)} p1 elim ${r.players[1].eliminated} cards ${(r.players[1].cards || []).length} res ${r.lastResurrectedId}`));
    await scenario('slap back in: a wrong slap from an empty hand costs nothing', {
        players: [seat(0, [C2(2), C2(3)]), seat(1, [], { eliminated: true }), seat(2, [C2(4)]), seat(3, [C2(5)])],
        pile: [C2(9, 'clubs'), C2(8)], activePlayerId: 2
    }, () => FirebaseSync.pushSlapAttempt({ playerIndex: 1 }), (r) => need(r.players[1].eliminated === true && !r.gameOver && (r.pile || []).length === 2 && !(r.burnPile || []).length,
        `p1 elim ${r.players[1].eliminated} over ${r.gameOver} pile ${(r.pile || []).length} burn ${(r.burnPile || []).length}`));
    // S11 v3.19.2: a slap window that has closed but not been settled is
    // settled BEFORE a play: the pair was slapped before the card landed.
    const contestOn = (claims, deadlineIn) => ({ openedAt: NOW - 200, deadline: NOW + deadlineIn, claims });
    await scenario('play after a closed slap window: the slapper gets the pile, the card is not played', {
        players: [seat(0, [C2(2), C2(3)]), seat(1, [C2(4)]), seat(2, [C2(7, 'clubs')]), seat(3, [C2(5)])],
        pile: [C2(12, 'clubs'), C2(9, 'diamonds'), C2(9)], challenge: { active: true, attackerId: 1, defenderId: 2, chancesLeft: 1 }, activePlayerId: 2,
        slapContest: contestOn({ 0: { r: 300, t: NOW - 100 } }, 100)
    }, () => FirebaseSync.pushPlayCard({ playerIndex: 2 }), (r) => need(r.lastPile && r.lastPile.winner === 0 && r.lastWinReason === 'slap' && r.players[0].cards.length === 5 && r.players[2].cards.length === 1 && !r.slapContest && r.activePlayerId === 0,
        `lastPile ${JSON.stringify(r.lastPile)} reason ${r.lastWinReason} p0 ${r.players[0].cards.length} p2 ${(r.players[2].cards || []).length} active ${r.activePlayerId}`));
    // S12 v3.19.2: a timeout waits out an OPEN window...
    await scenario('timeout during an open slap window: nothing moves until the window is settled', {
        players: [seat(0, [C2(2)]), seat(1, [C2(4)]), seat(2, []), seat(3, [C2(5)])],
        pile: [C2(13, 'clubs'), C2(6), C2(6, 'clubs')], challenge: { active: true, attackerId: 1, defenderId: 2, chancesLeft: 2 }, activePlayerId: 2,
        slapContest: contestOn({ 0: { r: 250, t: NOW } }, SO.TURN_TIMEOUT_MS + 6000)
    }, () => FirebaseSync.pushTimeout(2), (r) => need(!r.lastPile && (r.pile || []).length === 3 && r.slapContest && r.challenge.active,
        `lastPile ${JSON.stringify(r.lastPile)} pile ${(r.pile || []).length} contest ${!!r.slapContest}`));
    // ...and settles a CLOSED one first (the defender had no cards: the
    // challenge would have handed the disputed pile to the attacker).
    await scenario('timeout after a closed slap window: the slapper gets the pile, not the attacker', {
        players: [seat(0, [C2(2)]), seat(1, [C2(4)]), seat(2, []), seat(3, [C2(5)])],
        pile: [C2(13, 'clubs'), C2(6), C2(6, 'clubs')], challenge: { active: true, attackerId: 1, defenderId: 2, chancesLeft: 2 }, activePlayerId: 2,
        slapContest: contestOn({ 0: { r: 250, t: NOW } }, 100)
    }, () => FirebaseSync.pushTimeout(2), (r) => need(r.lastPile && r.lastPile.winner === 0 && r.players[0].cards.length === 4 && r.players[1].cards.length === 1,
        `lastPile ${JSON.stringify(r.lastPile)} p0 ${r.players[0].cards.length} p1 ${(r.players[1].cards || []).length}`));
    // S13 ERS-22 (c): one free miss per pile from an empty hand.
    await scenario('ERS-22 (c): after a miss from an empty hand, the seat cannot slap the same pile', {
        players: [seat(0, [C2(2), C2(3)]), seat(1, [], { eliminated: true }), seat(2, [C2(8, 'diamonds'), C2(4)]), seat(3, [C2(5)])],
        pile: [C2(9, 'clubs'), C2(8)], activePlayerId: 2
    }, async () => {
        await FirebaseSync.pushSlapAttempt({ playerIndex: 1 });          // a miss: free, but it locks this pile
        NOW += 1100; await FirebaseSync.pushPlayCard({ playerIndex: 2 }); // 8♦ on 8♥: now a real Double
        NOW += 300; await FirebaseSync.pushSlapAttempt({ playerIndex: 1 });
        NOW += WINDOW_MS + 10; await FirebaseSync.closeSlapContest();
    }, (r) => need(!r.lastPile && (r.pile || []).length === 3 && r.players[1].eliminated === true && r.players[1].slapLock === 0,
        `lastPile ${JSON.stringify(r.lastPile)} pile ${(r.pile || []).length} p1 ${JSON.stringify(r.players[1])}`));
    await scenario('ERS-22 (c): the lock is for one pile — on the next pile the seat may slap back in', {
        players: [seat(0, [C2(2), C2(3)]), seat(1, [], { eliminated: true, slapLock: 4 }), seat(2, [C2(4)]), seat(3, [C2(5)])],
        pile: [C2(9, 'clubs'), C2(9)], activePlayerId: 2, lastPile: { winner: 0, vanished: 0, seq: 5 }
    }, async () => { await FirebaseSync.pushSlapAttempt({ playerIndex: 1 }); NOW += WINDOW_MS + 10; await FirebaseSync.closeSlapContest(); },
    (r) => need(r.lastPile && r.lastPile.winner === 1 && r.lastPile.seq === 6 && !r.players[1].eliminated && r.lastResurrectedId === 1,
        `lastPile ${JSON.stringify(r.lastPile)} p1 ${JSON.stringify(r.players[1])}`));
    // S14 v3.19.2: host failover — the first connected human takes a room
    // whose host dropped; nobody else can, and a present host keeps it.
    {
        const asUser = (uid, room, name, expectHost) =>
            scenario(name, room, () => FirebaseSync.claimOrphanedHost(FF.read(ROOM)), (r) => need(r.hostId === expectHost, `hostId ${r.hostId}`), uid);
        const dropped = () => ({ players: [seat(0, [C2(2)], { status: 'disconnected' }), seat(1, [C2(3)]), seat(2, [C2(4)]), seat(3, [C2(5)])], activePlayerId: 2 });
        await asUser('human_1', dropped(), 'host failover: the first connected human takes a dropped host\'s room', 'human_1');
        await asUser('bot_2', dropped(), 'host failover: no other client can take it', 'human_0');
        await asUser('human_1', { players: [seat(0, [C2(2)]), seat(1, [C2(3)]), seat(2, [C2(4)]), seat(3, [C2(5)])], activePlayerId: 2 }, 'host failover: a connected host keeps the room', 'human_0');
    }
    // S15 v3.19.0 hollow hand: the god plays its last real card over ghosts
    // -> the ghosts go with it (random play rarely drains a god of real cards).
    await scenario('the god plays its last real card: the ghosts under it vanish', {
        players: [seat(0, [C2(2)]), seat(1, [C2(4)]), seat(2, [C2(5)]), seat(3, [C2(8, 'clubs'), G2(9), G2(10)])],
        pile: [C2(3)], activePlayerId: 3, god: 'ra', godSeat: 3, godHp: 160, godMaxHp: 160, godDamage: [0, 0, 0, 0]
    }, () => FirebaseSync.pushPlayCard({ playerIndex: 3 }), (r) => need(!(r.players[3].cards || []).length && (r.pile || []).length === 2,
        `god holds ${JSON.stringify(r.players[3].cards)} pile ${(r.pile || []).length}`));
    // S19 v3.19.0 (ERS-20): a wounding slap clones onto the god's hand, up to
    // 13 ghosts held (random play rarely reaches the cap).
    await scenario('a god already holding 12 ghosts takes one more clone, never more than 13', {
        players: [seat(0, [C2(2)]), seat(1, [C2(4)]), seat(2, [C2(5)]),
            seat(3, [...Array.from({ length: 12 }, (_, i) => G2(2 + (i % 12))), C2(8, 'clubs'), C2(10, 'clubs')])],
        pile: [C2(6, 'clubs'), C2(12), C2(12, 'clubs')], activePlayerId: 1, god: 'ra', godSeat: 3, godHp: 160, godMaxHp: 160, godDamage: [0, 0, 0, 0]
    }, async () => { await FirebaseSync.pushSlapAttempt({ playerIndex: 0 }); NOW += WINDOW_MS + 10; await FirebaseSync.closeSlapContest(); },
    (r) => need(r.lastPile && r.lastPile.winner === 0 && ghostCount(r.players[3].cards) === GHOST_HELD_MAX,
        `lastPile ${JSON.stringify(r.lastPile)} god ghosts ${ghostCount(r.players[3].cards)}`));
    // S16 v3.19.2 (council ERS-23) — the fence. Client A was the host, went
    // offline with writes queued, and B took the room over. When A's writes
    // replay (RTDB re-runs a queued transaction on the server's copy), none
    // may change the table. The same writes from B, the host, do: the control
    // that proves the scenario is not vacuous.
    {
        const replaced = () => ({ hostId: 'human_1', lastPlayTime: NOW - 60000,
            players: [seat(0, [C2(2), C2(3)]), seat(1, [C2(4), C2(6)]), seat(2, [C2(9, 'diamonds'), C2(5)]), seat(3, [C2(7), C2(8)])],
            pile: [C2(9, 'clubs'), C2(9)], activePlayerId: 2 });
        const allOut = () => ({ hostId: 'human_1',
            players: [seat(0, [], { eliminated: true }), seat(1, [], { eliminated: true }), seat(2, [C2(4), C2(5)]), seat(3, [C2(7), ...Array.from({ length: 3 }, (_, i) => C2(10 + i))])],
            pile: [], activePlayerId: 2 });
        const departed = () => ({ hostId: 'human_1', lastPlayTime: NOW - 60000,
            players: [seat(0, [C2(2)]), seat(1, [C2(4)]), { ...seat(2, [C2(5)]), uid: 'human_2', status: 'disconnected', disconnectedAt: NOW - 90000 }, seat(3, [C2(7)])],
            pile: [], activePlayerId: 0 });
        let snap = null;
        const unchanged = (r) => need(JSON.stringify(r) === snap, 'the table changed: ' + JSON.stringify(r).slice(0, 300));
        const changed = (r) => need(JSON.stringify(r) !== snap, 'nothing changed');
        const take = (fn) => async () => { snap = JSON.stringify(FF.read(ROOM)); await fn(); };
        const WRITES = [
            ['a bot\'s card', replaced, () => FirebaseSync.pushPlayCard({ playerIndex: 2 })],
            ['a bot\'s slap', replaced, async () => { await FirebaseSync.pushSlapAttempt({ playerIndex: 3 }); NOW += WINDOW_MS + 10; await FirebaseSync.closeSlapContest(); }],
            ['a turn timeout', () => ({ ...replaced(), activePlayerId: 0 }), () => FirebaseSync.pushTimeout(0)],
            ['"every human is out"', allOut, () => FirebaseSync.endIfNoHumanLeft()],
            ['a bot conversion', departed, () => FirebaseSync.convertToBot(2)]
        ];
        // ...and even the host times a turn out only after its 15 s (a copy
        // queued early must not fire the moment it replays).
        await scenario('fence: a turn timeout before its 15 s changes nothing, even from the host',
            { ...replaced(), hostId: 'human_0', activePlayerId: 0, lastPlayTime: NOW + SO.TURN_TIMEOUT_MS }, take(() => FirebaseSync.pushTimeout(0)), unchanged, 'human_0');
        for (const [what, room, write] of WRITES) {
            await scenario(`fence: ${what} replayed by a replaced host changes nothing`, room(), take(write), unchanged, 'human_0');
            await scenario(`fence (control): ${what} from the current host goes through`, room(), take(write), changed, 'human_1');
        }
    }
    // S17 v3.19.2: a slap window whose pile is already gone awards nothing.
    await scenario('a closed slap window over an empty table awards nothing', {
        players: [seat(0, [C2(2)]), seat(1, [C2(4)]), seat(2, [C2(5)]), seat(3, [C2(7)])],
        pile: [], activePlayerId: 2, lastPile: { winner: 1, vanished: 0, seq: 3 },
        slapContest: { openedAt: NOW - 300, deadline: NOW - 100, claims: { 0: { r: 250, t: NOW - 250 } } }
    }, () => FirebaseSync.closeSlapContest(), (r) => need(r.lastPile.seq === 3 && r.lastPile.winner === 1 && !r.slapContest && r.activePlayerId === 2,
        `lastPile ${JSON.stringify(r.lastPile)} contest ${!!r.slapContest} active ${r.activePlayerId}`));
    // S18 v3.19.2 (ERS-23): a host that lost the database drives nothing.
    {
        const prevUser = AuthSystem.currentUser, prevConn = FirebaseSync.isConnected;
        AuthSystem.currentUser = { uid: 'human_0' };
        const room = { hostId: 'human_0', gameStarted: true, gameOver: false, activePlayerId: 2, pile: [C2(9, 'clubs'), C2(9)],
            players: [seat(0, [C2(2)]), seat(1, [C2(4)]), seat(2, [C2(5)]), seat(3, [C2(7)])] };
        MultiplayerMode.standDown(); MultiplayerMode.localPlayerIndex = 0;
        FirebaseSync.isConnected = false;
        MultiplayerMode.checkBotTurn(room); MultiplayerMode.checkBotSlaps(room); await flush(); await flush();
        const offline = Object.keys(MultiplayerMode.botTimeouts).length + Object.keys(MultiplayerMode.botSlapTimeouts).length;
        FirebaseSync.isConnected = true;
        MultiplayerMode.checkBotTurn(room); await flush(); await flush();
        const online = Object.keys(MultiplayerMode.botTimeouts).length;
        EventBus.emit('roomConnection', false);   // no listener outside a match: call what it calls
        MultiplayerMode.standDown();
        const after = Object.keys(MultiplayerMode.botTimeouts).length;
        const problem = need(offline === 0 && online === 1 && after === 0, `offline ${offline}, online ${online}, after stand-down ${after}`);
        scenarioResults.push({ name: 'ERS-23: a host that lost the database schedules nothing, and stands down', ok: !problem, problem });
        if (problem) report('scenario: a disconnected host drives nothing', 0, problem);
        AuthSystem.currentUser = prevUser; FirebaseSync.isConnected = prevConn; timers.length = 0;
    }
    // S8 F3: a turn nobody can take is passed on, and SAYS so.
    await scenario('F3: a turn held by a seat that cannot act is passed on and stamped', {
        players: [seat(0, [C2(2)]), seat(1, []), seat(2, [C2(4)]), seat(3, [C2(5)])], activePlayerId: 1
    }, () => FirebaseSync.pushPlayCard({ playerIndex: 1 }), (r) => need(r.activePlayerId === 2 && r.forcedTurnPass && r.forcedTurnPass.seat === 1 && r.forcedTurnPass.count === 1,
        `active ${r.activePlayerId} stamp ${JSON.stringify(r.forcedTurnPass)}`));
    // S9 F5 offline: the first turn gets ONE timer; the next turnChanged replaces it, never doubles it.
    {
        quiet();
        GameState.gameOver = true; timers.length = 0;
        GameState._turnListenerAttached = false;
        GameState.init();
        const first = GameState.turnTimeoutId;
        EventBus.emit('turnChanged', GameState.activePlayerId);
        const second = GameState.turnTimeoutId;
        const alive = [first, second].filter(id => timers.some(t => t.id === id));
        loud();
        const problem = need(first && second && first !== second && alive.length === 1 && alive[0] === second, `first ${first}, second ${second}, pending ${alive}`);
        scenarioResults.push({ name: 'F5: the first turn has one timer, and a new turn replaces it', ok: !problem, problem });
        if (problem) report('scenario: F5 one turn timer', 0, problem);
        GameState.gameOver = true; timers.length = 0;
    }
}
await runScenarios();
for (const r of scenarioResults) console.log(`${r.ok ? 'ok  ' : 'FAIL'} scenario: ${r.name}${r.problem ? ' — ' + r.problem : ''}`);

const summary = [];
for (const mode of MODE === 'both' ? ['offline', 'mp'] : MODE === 'all' ? ['offline', 'duat', 'mp', 'host'] : [MODE]) {
    for (const godId of mode === 'duat' ? ['duat'] : GODS) {
        const agg = { n: 0, steps: 0, ghosts: 0, life: 0, cards: 0, cap: 0 };
        for (let d = 0; d < DUELS; d++) {
            const seed = SEED0 + d;
            const r = mode === 'offline' ? await offlineDuel(godId, seed) : mode === 'host' ? await hostDuel(godId, seed) : mode === 'duat' ? await duatDuel(godId, seed) : await mpDuel(godId, seed);
            agg.n++; agg.steps += r.steps; agg.ghosts += r.ghostsSeen; agg.comebacks = (agg.comebacks || 0) + (r.comebacks || 0); agg.refused = (agg.refused || 0) + (r.spamRefused || 0); agg.humansOut = (agg.humansOut || 0) + (r.humansOut || 0); agg.hostMoves = (agg.hostMoves || 0) + (r.hostMoves || 0); agg.leavers = (agg.leavers || 0) + (r.leavers || 0); agg.abandoned = (agg.abandoned || 0) + (r.abandoned || 0); agg.risen = (agg.risen || 0) + (r.risen || 0); agg.spam = (agg.spam || 0) + (r.spam || 0);
            if (r.end === 'life') agg.life++; else if (r.end === 'cap') agg.cap++; else agg.cards++;
        }
        summary.push({ mode, godId, ...agg });
    }
}
for (const s of summary) console.log(`${s.mode.padEnd(7)} ${s.godId.padEnd(7)} duels ${s.n}  ended by life ${s.life}, by cards ${s.cards}, unfinished ${s.cap}  avg actions ${(s.steps / s.n).toFixed(0)}  ghost-on-pile moments ${s.ghosts}${s.mode === 'duat' ? `  risen at least once ${s.risen}  empty-hand slaps ${s.spam}` : ''}${s.mode === 'mp' || s.mode === 'host' ? `  comebacks ${s.comebacks || 0}` : ''}${s.mode === 'host' ? `  locked slaps ${s.refused}  no-human endings ${s.humansOut}  host moves ${s.hostMoves}  leavers ${s.leavers}  abandoned ${s.abandoned}` : ''}`);
const uniqErr = [...new Set(errors.map(e => String(e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e)))];
if (uniqErr.length) { console.log(`\nuncaught errors (${errors.length}, ${uniqErr.length} distinct):`); for (const e of uniqErr.slice(0, 12)) console.log('  ' + e); }
if (findings.size === 0) console.log('\nfuzz: no invariant broke');
else {
    console.log('\nfuzz: BROKEN INVARIANTS');
    for (const [inv, f] of findings) console.log(`  ✗ ${inv} — ${f.count}x; first: seed ${f.first.seed}: ${String(f.first.detail).slice(0, 600)}`);
}
if (VERBOSE) console.log(JSON.stringify([...findings], null, 1));
process.exit(findings.size ? 1 : 0);
