#!/usr/bin/env node
/**
 * fuzz-pantheon.mjs — a bug hunter for the Table of the Gods (v3.19.x).
 *
 * Plays thousands of random-but-legal duels through the REAL code:
 *   offline      game.js + pantheon.js, driven on a fake clock;
 *   multiplayer  firebaseSync.js's own transactions (play, slap, contest,
 *                timeout) against an in-memory RTDB that stores what RTDB
 *                stores (tools/fuzz/fake-firebase.mjs).
 * After every action it checks the invariants the design promises and
 * reports the first seed that breaks each one, with the state that broke it.
 *
 *   node tools/fuzz-pantheon.mjs [--mode offline|mp|both] [--duels 200] [--seed 1] [--gods ra,set]
 *
 * Exit 1 when any invariant broke. Every failure prints its seed, so it can be
 * replayed with --seed N --duels 1.
 */
import { register } from 'node:module';
register('./fuzz/hooks.mjs', import.meta.url);

// ── a fake clock: timers fire only when the driver advances time ──────────────
let NOW = 1_800_000_000_000;
let tid = 1;
const timers = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms = 0, ...a) => { const id = tid++; timers.push({ id, at: NOW + Math.max(0, Number(ms) || 0), fn, a }); return id; };
globalThis.clearTimeout = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
globalThis.setInterval = (fn, ms = 0) => { const id = tid++; const tick = () => { fn(); timers.push({ id, at: NOW + ms, fn: tick, a: [] }); }; timers.push({ id, at: NOW + ms, fn: tick, a: [] }); return id; };
globalThis.clearInterval = globalThis.clearTimeout;
Date.now = () => NOW;
const errors = [];
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
const flush = () => new Promise(res => realSetTimeout(res, 0));

// ── a browser shaped enough for the modules to load ──────────────────────────
const el = () => ({ classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {}, setAttribute() {}, appendChild() {}, append() {}, remove() {},
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
const { FirebaseSync } = await import('../public/js/firebaseSync.js');
const { seatGod } = await import('../public/js/pantheonRoom.js');
const { WINDOW_MS } = await import('../public/js/fairSlap.js');
loud();

const { realCount, ghostCount, GHOST_HELD_MAX } = G;
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
    if (!cleared && as !== bs) report('no stamp without an award', seed, `${where}: seq ${bs} -> ${as}`);
    if (after.forcedTurnPass && JSON.stringify(after.forcedTurnPass) !== JSON.stringify(before.forcedTurnPass || null))
        report('no forced turn pass (it repairs a state that should not exist)', seed, `${where}: ${JSON.stringify(after.forcedTurnPass)}`);
    if (cleared && as === bs + 1) {
        state.awards++;
        const w = after.lastPile.winner;
        const bw = ((before.players[w] || {}).cards || []), aw = ((after.players[w] || {}).cards || []);
        const clones = w === godSeat ? 0 : 0;
        const gained = realCount(aw) - realCount(bw);
        if (gained !== realCount(handed) + clones) report('the stamped winner is the seat that took the real cards', seed, `${where}: seat ${w} gained ${gained} real, the table held ${realCount(handed)} real`);
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
                NOW += 10000;
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
                    OP = `rescue play ${a}`; await FirebaseSync.pushPlayCard({ playerIndex: a }); NOW += 10000; OP = `rescue timeout ${a}`; await FirebaseSync.pushTimeout(a);
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
// ═════════════════════════════════════════════════════════════════════════════
// SCENARIOS — one fixed case per award path (council ERS-21, condition a).
// Each drives the real FirebaseSync method against the fake RTDB and states
// the behaviour that path has since v3.19.1, including what CHANGED.
// ═════════════════════════════════════════════════════════════════════════════
const scenarioResults = [];
async function scenario(name, room, act, expect) {
    const base = { tableId: 'FUZZ', hostId: 'human_0', playerIds: { human_0: true, human_1: true }, gameStarted: true, gameOver: false,
        challenge: { active: false, attackerId: null, defenderId: null, chancesLeft: 0 }, lastPlayTime: NOW, pile: [], burnPile: [] };
    FF.store.root = {}; FF.write(ROOM, { ...base, ...room });
    HouseRules.applyRoom(room.houseRules || 'doubles,sandwich,marriage,tens');
    FirebaseSync.roomId = 'FUZZ'; FirebaseSync.USE_SERVER_VALIDATION = false;
    quiet();
    try { NOW += 11000; await act(); await flush(); } finally { loud(); }
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
for (const mode of MODE === 'both' ? ['offline', 'mp'] : [MODE]) {
    for (const godId of GODS) {
        const agg = { n: 0, steps: 0, ghosts: 0, life: 0, cards: 0, cap: 0 };
        for (let d = 0; d < DUELS; d++) {
            const seed = SEED0 + d;
            const r = mode === 'offline' ? await offlineDuel(godId, seed) : await mpDuel(godId, seed);
            agg.n++; agg.steps += r.steps; agg.ghosts += r.ghostsSeen;
            if (r.end === 'life') agg.life++; else if (r.end === 'cap') agg.cap++; else agg.cards++;
        }
        summary.push({ mode, godId, ...agg });
    }
}
for (const s of summary) console.log(`${s.mode.padEnd(7)} ${s.godId.padEnd(7)} duels ${s.n}  ended by life ${s.life}, by cards ${s.cards}, unfinished ${s.cap}  avg actions ${(s.steps / s.n).toFixed(0)}  ghost-on-pile moments ${s.ghosts}`);
const uniqErr = [...new Set(errors.map(e => String(e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e)))];
if (uniqErr.length) { console.log(`\nuncaught errors (${errors.length}, ${uniqErr.length} distinct):`); for (const e of uniqErr.slice(0, 12)) console.log('  ' + e); }
if (findings.size === 0) console.log('\nfuzz: no invariant broke');
else {
    console.log('\nfuzz: BROKEN INVARIANTS');
    for (const [inv, f] of findings) console.log(`  ✗ ${inv} — ${f.count}x; first: seed ${f.first.seed}: ${String(f.first.detail).slice(0, 600)}`);
}
if (VERBOSE) console.log(JSON.stringify([...findings], null, 1));
process.exit(findings.size ? 1 : 0);
