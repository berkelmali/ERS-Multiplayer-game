/**
 * admin.js — the admin page (public/admin.html). v3.22.1, redesigned in
 * v3.22.2 around the question the page exists to answer: "is anything broken
 * in multiplayer right now, and what just happened in that room?"
 *
 * SECURITY, the whole of it:
 *   · Sign-in is ordinary Firebase Authentication (username → a fixed admin
 *     email domain, or a real email; adminCore.adminEmailFor).
 *   · Being signed in unlocks NOTHING. The page asks the server whether
 *     `admins/{uid}` exists and shows the panel only then — and, more to the
 *     point, the rules refuse every admin read and write to anyone else, so a
 *     player who un-hides this page gets refusals, not data.
 *   · Live rooms are READ ONLY: database.rules.json gives an admin a read on
 *     /gameRooms and no write anywhere (tools/rules-test.mjs, section 6) —
 *     with one exception since v3.22.3 (council ERS-30): an admin may DELETE a
 *     room, lobby or table that the server's own data calls dead (over, idle
 *     15 minutes, host gone). Never an edit, never a live one (section 7).
 *   · The online list (v3.22.3) reads online/{uid}/{conn}, written by each
 *     signed-in tab (onlinePresence.js) and removed by the server on disconnect.
 *   · v3.24.0 (council ERS-36, the owner's choices): suspensions, board
 *     cleanup, the menu announcement, match history, error reports and player
 *     stats. Every write goes through adminCommit(): ONE batch with an
 *     immutable admin_actions record naming the kind and the exact target —
 *     the rules refuse the change without it. Live matches stay untouchable.
 *   · Nothing player-chosen ever reaches innerHTML: every node is built with
 *     `h()` below, text through text nodes. Names are player input.
 *   · Every id that becomes part of a database path passes adminCore.safeId.
 *   · 5 wrong passwords lock the form for a minute (Firebase also throttles),
 *     and 30 idle minutes sign the session out.
 *
 * THE FEED is derived by adminCore.roomEvents from consecutive snapshots of
 * /gameRooms, while this page is open — a room is deleted when its match ends,
 * so there is no history before the page was opened, and the page says so.
 */
import { app, rtdb } from './firebaseConfig.js';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy, limit, onSnapshot, deleteDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, get, onValue, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { WalletAdmin } from './wallet.js';
import { CARD_SKINS } from './cardSkins.js';
import { EARN_DAILY_CAP, ADMIN_GRANT_MAX, ADMIN_DAILY_CAP, dayNumber } from './walletRules.js';
import {
    adminEmailFor, asList, toMillis, formatAge, cardLabel, presenceState,
    tableDiagnostics, roomDiagnostics, roomEvents, summarize, toCsv, safeId,
    roomIsDead, tableClosePlan, CLOSE_REASON, onlineRows, orphanLobbies, lobbyDeletable, ACTIVITY_LABEL,
    ONLINE_CATEGORIES, onlineCategory, clockNote, latencyNote, soloDiagnostics, soloSummary
} from './adminCore.js';
import {
    ACTION_LABEL, targetFor, validReason, REASON_MIN, REASON_MAX, DETAIL_MAX, BAN_DAYS, banActive, banUntilFor,
    toMs, ANN_LANGS, ANN_HOURS, annTextProblem, annUntilFor, pickAnnouncement, errorEntries
} from './moderationCore.js';
import { isBotSeat, realCount } from './slapOutcome.js';
import { ghostCount } from './ghostCards.js';

const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const PROJECT = 'ers-card-game';
const RTDB_NS = 'ers-card-game-default-rtdb';
const IDLE_MS = 30 * 60 * 1000;
const LOCK_AFTER = 5, LOCK_MS = 60 * 1000;
const ROOM_FEED_MAX = 200, GLOBAL_FEED_MAX = 400;
const LEVEL_WORD = { error: 'HATA', warn: 'UYARI', info: 'NOT', ok: 'SAĞLIKLI' };

// ── DOM, safely ────────────────────────────────────────────────────────────
/** h('div', { class: 'x', onclick: fn }, 'text', child) — text is always text. */
function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === null || v === undefined || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
        if (kid === null || kid === undefined || kid === false) continue;
        el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
}
const clear = (el) => { while (el && el.firstChild) el.removeChild(el.firstChild); return el; };
const shortId = (id) => (id ? `${String(id).slice(0, 8)}…` : '—');
const sr = (text) => h('span', { class: 'adm-sr' }, text);
const clock = (ms) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function toast(text, kind = 'ok') {
    const el = $('adm-toast');
    el.textContent = text;
    el.className = `adm-toast is-${kind} is-shown`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = 'adm-toast'; }, 3800);
}
async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Kopyalandı'); }
    catch (e) { toast('Kopyalanamadı — elle seç', 'error'); }
}
/**
 * confirmDialog(title, text)                    → Promise<boolean>
 * confirmDialog(title, text, { reason: true })  → Promise<string|null>
 *   v3.24.0: an admin action asks for the reason that goes into its
 *   admin_actions record; null when cancelled or when the reason is not
 *   REASON_MIN–REASON_MAX characters (the rules would refuse it anyway).
 */
function confirmDialog(title, text, opts = {}) {
    const dlg = $('adm-confirm');
    $('adm-confirm-title').textContent = title;
    $('adm-confirm-text').textContent = text;
    const wrap = $('adm-confirm-reason-wrap');
    const input = $('adm-confirm-reason');
    wrap.hidden = !opts.reason;
    input.value = opts.reasonDefault || '';
    return new Promise((resolve) => {
        dlg.addEventListener('close', () => {
            const ok = dlg.returnValue === 'ok';
            if (!opts.reason) { resolve(ok); return; }
            const r = input.value.trim();
            if (ok && !validReason(r)) toast(`Sebep ${REASON_MIN}–${REASON_MAX} karakter olmalı — işlem yapılmadı`, 'error');
            resolve(ok && validReason(r) ? r : null);
        }, { once: true });
        dlg.returnValue = '';
        dlg.showModal();
        if (opts.reason) input.focus();
    });
}

/** A status pill always carries its word — never colour alone. */
const pill = (level, text) => h('span', { class: `adm-pill is-${level}` }, text || LEVEL_WORD[level] || level);
function findingsList(findings) {
    if (!findings.length) return h('p', { class: 'adm-ok' }, '✓ Sorun bulunmadı');
    return h('ul', { class: 'adm-findings' }, findings.map(f =>
        h('li', { class: `is-${f.level}` }, pill(f.level), ' ', f.text, h('code', {}, ` ${f.code}`))));
}
const skeleton = (n = 3) => Array.from({ length: n }, () => h('div', { class: 'adm-skel', 'aria-hidden': 'true' }));
const emptyState = (title, text) => h('div', { class: 'adm-empty' }, h('strong', {}, title), h('p', { class: 'adm-muted' }, text));

// ── remembered filters (a per-viewer convenience; never required) ──────────
const PREF_KEY = 'ers_admin_prefs';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { return {}; } })();
function savePref(k, v) { prefs[k] = v; try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ } }
function bindCheck(id, key, fallback, onChange) {
    const el = $(id);
    el.checked = typeof prefs[key] === 'boolean' ? prefs[key] : fallback;
    el.addEventListener('change', () => { savePref(key, el.checked); onChange(); });
}

// ── state ──────────────────────────────────────────────────────────────────
const S = {
    user: null,
    offset: 0,
    connected: null,
    tables: new Map(), tablesAt: null, tablesErr: null,
    presence: new Map(),
    mirrors: new Map(),
    grants: [], grantsAt: null, grantsErr: null,
    names: new Map(),
    rooms: null, roomsAt: null, roomsErr: null, primed: false,
    online: null, onlineAt: null, onlineErr: null,   // online/{uid}/{conn} (v3.22.3)
    lobbies: null, lobbiesErr: null,                  // lobbyRooms, fetched on demand
    closing: new Set(),                               // table/room ids with a delete in flight
    rtt: null,                                        // ms, one small read's round trip (v3.22.5)
    // v3.24.0 (council ERS-36)
    actions: [], actionsAt: null, actionsErr: null,   // admin_actions, newest 300
    bans: new Map(), bansAt: null, bansErr: null,     // bans/{uid}
    matches: [], matchesAt: null, matchesErr: null,   // match_log, newest 200
    errors: [], errorsAt: null, errorsErr: null,      // client_errors, newest 100
    announcement: null, annErr: null,                 // config/announcement
    board: null,                                      // the score board being cleaned
    roomFeed: new Map(),      // roomId → events, newest last
    feed: [],                 // every room, newest last
    paused: false,
    selRoom: typeof prefs.room === 'string' ? safeId(prefs.room) : null,
    techOpen: false,
    unsubs: [],
    view: 'overview',
    selectedPlayer: null
};
const serverNow = () => Date.now() + S.offset;

// ── sign-in ────────────────────────────────────────────────────────────────
let fails = 0, lockedUntil = 0;
function authMessage(code) {
    return ({
        'auth/invalid-credential': 'Kullanıcı adı ya da şifre yanlış.',
        'auth/wrong-password': 'Kullanıcı adı ya da şifre yanlış.',
        'auth/user-not-found': 'Kullanıcı adı ya da şifre yanlış.',
        'auth/invalid-email': 'Geçersiz kullanıcı adı.',
        'auth/too-many-requests': 'Çok fazla deneme. Firebase bir süre kilitledi, biraz bekle.',
        'auth/network-request-failed': 'Sunucuya ulaşılamadı. Bağlantını kontrol et.',
        'auth/user-disabled': 'Bu hesap devre dışı.'
    })[code] || 'Giriş başarısız.';
}

$('adm-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('adm-login-error');
    if (Date.now() < lockedUntil) { err.textContent = `Çok fazla hatalı deneme. ${Math.ceil((lockedUntil - Date.now()) / 1000)} sn bekle.`; return; }
    const email = adminEmailFor($('adm-user').value);
    const pass = $('adm-pass').value;
    if (!email || !pass) { err.textContent = 'Kullanıcı adı ve şifre gerekli.'; return; }
    const btn = $('adm-login-btn');
    btn.disabled = true; err.textContent = '';
    try {
        await signInWithEmailAndPassword(auth, email, pass);
        fails = 0;
        $('adm-pass').value = '';
    } catch (ex) {
        fails++;
        if (fails >= LOCK_AFTER) { lockedUntil = Date.now() + LOCK_MS; fails = 0; }
        err.textContent = authMessage(ex && ex.code);
    } finally { btn.disabled = false; }
});

// The form is ours now: the button was disabled in the markup so nothing could
// submit it natively (and put the password in a URL) before this ran.
$('adm-login-btn').disabled = false;

$('adm-signout').addEventListener('click', () => signOut(auth));

// 30 idle minutes end the session.
let idleTimer = null;
function touch() {
    clearTimeout(idleTimer);
    if (S.user) idleTimer = setTimeout(() => { toast('30 dk hareketsizlik — oturum kapatıldı', 'warn'); signOut(auth); }, IDLE_MS);
}
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, touch, { passive: true }));

function showLogin(message) {
    $('adm-app').hidden = true;
    $('adm-login').hidden = false;
    $('adm-login-error').textContent = message || '';
}

onAuthStateChanged(auth, async (user) => {
    stopAll();
    S.user = null;
    if (!user) { showLogin(); return; }
    const isAdmin = await WalletAdmin.isAdmin(user.uid);
    if (!isAdmin) {
        // Not signed out on purpose: this may be a player's game session in
        // the same browser. It simply gets nothing here.
        showLogin('Bu hesap yönetici değil. Yönetici hesabıyla giriş yap (bu oturum oyunda açık kalır).');
        return;
    }
    S.user = user;
    $('adm-login').hidden = true;
    $('adm-app').hidden = false;
    $('adm-who').textContent = `👤 ${user.email ? user.email.split('@')[0] : shortId(user.uid)}`;
    touch();
    startAll();
    go(typeof prefs.view === 'string' ? prefs.view : 'overview');
});

// ── navigation ─────────────────────────────────────────────────────────────
document.querySelectorAll('.adm-tab').forEach(btn => btn.addEventListener('click', () => go(btn.dataset.view)));
function go(view) {
    if (!document.getElementById(`view-${view}`)) view = 'overview';
    S.view = view;
    savePref('view', view);
    document.querySelectorAll('.adm-tab').forEach(b => {
        const on = b.dataset.view === view;
        b.classList.toggle('is-active', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.adm-view').forEach(v => { v.hidden = v.id !== `view-${view}`; });
    render();
}

// ── data ───────────────────────────────────────────────────────────────────
function stopAll() {
    S.unsubs.forEach(u => { try { u(); } catch (e) { /* gone */ } });
    S.unsubs = [];
    S.tables.clear(); S.grants = []; S.rooms = null; S.primed = false;
    S.roomFeed.clear(); S.feed = [];
    S.tablesErr = S.grantsErr = S.roomsErr = S.onlineErr = S.lobbiesErr = null;
    S.tablesAt = S.grantsAt = S.roomsAt = S.onlineAt = null;
    S.online = null; S.lobbies = null; S.closing.clear(); S.rtt = null;
    S.actions = []; S.bans = new Map(); S.matches = []; S.errors = []; S.announcement = null; S.board = null;
    S.actionsAt = S.bansAt = S.matchesAt = S.errorsAt = null;
    S.actionsErr = S.bansErr = S.matchesErr = S.errorsErr = S.annErr = null;
    clearInterval(S.pingTimer); S.pingTimer = null;
}

function startAll() {
    S.unsubs.push(onValue(ref(rtdb, '.info/serverTimeOffset'), (s) => { S.offset = Number(s.val()) || 0; renderChrome(); }));
    S.unsubs.push(onValue(ref(rtdb, '.info/connected'), (s) => { S.connected = s.val() === true; renderChrome(); }));

    // Bounded (council ERS-28 O3): the newest 300 tables, not every table ever made.
    S.unsubs.push(onSnapshot(query(collection(db, 'multiplayer_tables'), orderBy('createdAt', 'desc'), limit(300)), (snap) => {
        S.tables.clear();
        snap.forEach(d => S.tables.set(d.id, { id: d.id, ...d.data() }));
        S.tablesAt = Date.now(); S.tablesErr = null;
        refreshPresence(false);
        scheduleRender();
    }, (e) => { S.tablesErr = (e && e.code) || 'error'; scheduleRender(); }));

    S.unsubs.push(onSnapshot(query(collection(db, 'coin_grants'), orderBy('at', 'desc'), limit(300)), (snap) => {
        S.grants = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        S.grants.forEach(g => { resolveName(g.to); resolveName(g.by); });
        S.grantsAt = Date.now(); S.grantsErr = null;
        scheduleRender();
    }, (e) => { S.grantsErr = (e && e.code) || 'error'; scheduleRender(); }));

    // Live rooms: READ ONLY (database.rules.json, admins/{uid} === true).
    S.unsubs.push(onValue(ref(rtdb, 'gameRooms'), (snap) => onRooms(snap.val()),
        (e) => { S.rooms = null; S.roomsErr = (e && (e.code || e.message)) || 'denied'; scheduleRender(); }));

    // Who is connected (v3.22.3). Bounded by concurrent players: the server
    // removes an entry when its tab's connection drops.
    S.unsubs.push(onValue(ref(rtdb, 'online'), (snap) => {
        S.online = snap.val() || {};
        Object.keys(S.online).forEach(resolveName);
        S.onlineAt = Date.now(); S.onlineErr = null;
        scheduleRender();
    }, (e) => { S.online = null; S.onlineErr = (e && (e.code || e.message)) || 'denied'; scheduleRender(); }));
    refreshLobbies();
    measureLatency();
    S.pingTimer = setInterval(measureLatency, 15000);

    // v3.24.0 (council ERS-36): the action log, suspensions, match history,
    // error reports and the menu announcement — each bounded.
    const listen = (q, onData, key) => S.unsubs.push(onSnapshot(q, (snap) => {
        onData(snap);
        S[key + 'At'] = Date.now(); S[key + 'Err'] = null;
        scheduleRender();
    }, (e) => { S[key + 'Err'] = (e && e.code) || 'error'; scheduleRender(); }));
    listen(query(collection(db, 'admin_actions'), orderBy('at', 'desc'), limit(300)), (snap) => {
        S.actions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        S.actions.forEach(a => resolveName(a.by));
    }, 'actions');
    listen(collection(db, 'bans'), (snap) => {
        S.bans = new Map();
        snap.forEach(d => { if (safeId(d.id)) S.bans.set(d.id, d.data()); });
        [...S.bans.keys()].forEach(resolveName);
    }, 'bans');
    listen(query(collection(db, 'match_log'), orderBy('endedAt', 'desc'), limit(200)), (snap) => {
        S.matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }, 'matches');
    listen(query(collection(db, 'client_errors'), orderBy('updatedAt', 'desc'), limit(100)), (snap) => {
        S.errors = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => safeId(d.id));
        S.errors.forEach(d => resolveName(d.id));
    }, 'errors');
    S.unsubs.push(onSnapshot(doc(db, 'config', 'announcement'), (snap) => {
        S.announcement = snap.exists() ? snap.data() : null; S.annErr = null; scheduleRender();
    }, (e) => { S.annErr = (e && e.code) || 'error'; scheduleRender(); }));
}

/** One read of this admin's own flag, timed. get() goes to the server when connected. */
async function measureLatency() {
    if (!S.user || S.connected === false) return;
    const uid = safeId(S.user.uid);
    if (!uid) return;
    const t0 = performance.now();
    try { await get(ref(rtdb, `admins/${uid}`)); S.rtt = performance.now() - t0; }
    catch (e) { S.rtt = null; }
    renderChrome();
}

/** lobbyRooms is read on demand (tables tab, after a close), not streamed. */
async function refreshLobbies() {
    try {
        const snap = await get(ref(rtdb, 'lobbyRooms'));
        S.lobbies = snap.val() || {}; S.lobbiesErr = null;
    } catch (e) { S.lobbies = null; S.lobbiesErr = (e && (e.code || e.message)) || 'denied'; }
    scheduleRender();
}

/** Every snapshot of /gameRooms: diff each room against the last one we saw. */
function onRooms(val) {
    const next = new Map(Object.entries(val || {}).filter(([id]) => safeId(id)));
    const at = serverNow();
    if (S.rooms && S.primed) {
        const ids = new Set([...S.rooms.keys(), ...next.keys()]);
        for (const id of ids) {
            const evs = roomEvents(S.rooms.get(id), next.has(id) ? next.get(id) : null, at);
            if (!evs.length) continue;
            const list = S.roomFeed.get(id) || [];
            for (const e of evs) { list.push(e); S.feed.push({ ...e, room: id }); }
            while (list.length > ROOM_FEED_MAX) list.shift();
            S.roomFeed.set(id, list);
        }
        while (S.feed.length > GLOBAL_FEED_MAX) S.feed.shift();
    }
    S.rooms = next; S.primed = true; S.roomsAt = Date.now(); S.roomsErr = null;
    scheduleRender();
}

const PRESENCE_TTL = 20000;
async function refreshPresence(force) {
    const uids = new Set();
    // Ids come out of player-written table data: only a clean id reaches a path.
    for (const t of S.tables.values()) for (const p of asList(t.players)) if (p && !isBotSeat(p) && safeId(p.uid)) uids.add(p.uid);
    const now = Date.now();
    const todo = [...uids].filter(u => force || !S.presence.has(u) || now - S.presence.get(u).at > PRESENCE_TTL);
    await Promise.all(todo.map(async (u) => {
        try { S.presence.set(u, { value: (await get(ref(rtdb, `presence/${u}`))).val(), at: Date.now() }); }
        catch (e) { S.presence.set(u, { value: null, at: Date.now() }); }
    }));
    if (force) {
        refreshLobbies();
        await Promise.all([...S.tables.keys()].filter(safeId).map(async (id) => {
            try { const s = await get(ref(rtdb, `lobbyRooms/${id}`)); S.mirrors.set(id, s.exists() ? s.val() : null); }
            catch (e) { S.mirrors.delete(id); }
        }));
    }
    if (todo.length || force) scheduleRender();
}
const presenceMap = () => Object.fromEntries([...S.presence].map(([u, v]) => [u, v.value]));

async function resolveName(uid) {
    if (!safeId(uid) || S.names.has(uid)) return;
    S.names.set(uid, null);
    try {
        const s = await getDoc(doc(db, 'leaderboard', uid));
        if (s.exists()) { S.names.set(uid, s.data().username); scheduleRender(); }
    } catch (e) { /* the name stays unknown */ }
}
const nameOf = (uid) => S.names.get(uid) || shortId(uid);

let renderQueued = false;
function scheduleRender() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); } }

// ── rendering ──────────────────────────────────────────────────────────────
function render() {
    if (!S.user) return;
    renderChrome();
    if (S.view === 'overview') renderOverview();
    if (S.view === 'rooms') renderRooms();
    if (S.view === 'tables') renderTables();
    if (S.view === 'online') renderOnline();
    if (S.view === 'multiplayer') renderMultiplayer();
    if (S.view === 'moderation') renderModeration();
    if (S.view === 'errors') renderErrors();
    if (S.view === 'audit') renderAudit();
}

/** Header chips, the tab counts, and the partial/offline banner. */
function renderChrome() {
    // v3.22.5: the clock skew is not a delay — say which way the device is off,
    // and show the real round trip next to it.
    const cn = clockNote(S.offset);
    $('adm-clock').textContent = cn.text;
    $('adm-clock').className = `adm-chip ${cn.kind}`;
    const ln = latencyNote(S.rtt);
    $('adm-ping').textContent = ln.text;
    $('adm-ping').className = `adm-chip ${ln.kind}`;
    const offline = S.connected === false || (typeof navigator !== 'undefined' && navigator.onLine === false);
    const conn = $('adm-conn');
    conn.textContent = S.connected === null ? '… bağlanıyor' : offline ? '○ bağlantı yok' : '● canlı';
    conn.className = `adm-chip ${offline ? 'is-bad' : S.connected ? 'is-good' : ''}`;
    $('adm-rooms-count').textContent = S.rooms ? String(S.rooms.size) : '';
    $('adm-tables-count').textContent = S.tables.size ? String(S.tables.size) : '';
    $('adm-online-count').textContent = S.online ? String(Object.keys(S.online).length) : '';
    const liveCount = S.rooms ? liveRoomEntries().filter(([, r]) => !r.gameOver).length : null;
    $('adm-mp-count').textContent = liveCount === null ? '' : String(liveCount);
    const activeBans = [...S.bans.values()].filter(b => banActive(b, serverNow())).length;
    $('adm-bans-count').textContent = activeBans ? String(activeBans) : '';
    const freshErrors = S.errors.filter(e => (toMillis(e.updatedAt) || 0) > serverNow() - 86400e3).length;
    $('adm-errors-count').textContent = freshErrors ? String(freshErrors) : '';

    const notes = [];
    if (offline) notes.push('Sunucuyla bağlantı yok — gösterilen veriler son bağlantı anına ait, akış duraklamış olabilir.');
    if (S.roomsErr) notes.push(`Canlı odalar okunamıyor (${S.roomsErr}). Realtime Database'de admins/${S.user ? S.user.uid : 'UID'} = true olmalı.`);
    if (S.tablesErr) notes.push(`Masalar okunamadı (${S.tablesErr}).`);
    if (S.grantsErr) notes.push(`Denetim kaydı okunamadı (${S.grantsErr}).`);
    if (S.onlineErr && !S.roomsErr) notes.push(`Çevrimiçi listesi okunamıyor (${S.onlineErr}) — database.rules.json v3.22.3 yayınlandı mı? (deploy-db-rules.bat)`);
    if (S.actionsErr) notes.push(`İşlem kaydı okunamıyor (${S.actionsErr}) — firestore.rules v3.24.0 yayınlandı mı? (deploy-rules.bat) Yayınlanmadan masa kapatma, askı ve duyuru reddedilir.`);
    const b = $('adm-banner');
    clear(b);
    b.hidden = !notes.length;
    notes.forEach(n => b.append(h('p', {}, '⚠ ', n)));
}

function tableFindings(t) {
    return tableDiagnostics(t, { presence: presenceMap(), now: serverNow(), mirror: S.mirrors.has(t.id) ? S.mirrors.get(t.id) : undefined });
}
function tableAge(t) { const c = toMillis(t.createdAt); return c === null ? null : serverNow() - c; }
function roomFindings(r) { return roomDiagnostics(r, { now: serverNow(), presence: presenceMap() }); }
const liveRoomEntries = () => (S.rooms ? [...S.rooms.entries()] : []);

function renderOverview() {
    const tables = [...S.tables.values()];
    const playing = tables.filter(t => t.gameState && t.gameState.status === 'playing');
    const waiting = tables.filter(t => t.gameState && t.gameState.status === 'waiting');
    const rooms = liveRoomEntries();
    const liveRooms = rooms.filter(([, r]) => !r.gameOver);
    const humansIn = liveRooms.reduce((a, [, r]) => a + asList(r.players).filter(p => p && !isBotSeat(p) && p.status !== 'disconnected').length, 0);
    const botsIn = liveRooms.reduce((a, [, r]) => a + asList(r.players).filter(isBotSeat).length, 0);
    const problemTables = tables.map(t => ({ t, f: tableFindings(t) })).filter(x => x.f.some(f => f.level !== 'info'));
    const problemRooms = rooms.map(([id, r]) => ({ id, r, f: roomFindings(r) })).filter(x => x.f.some(f => f.level !== 'info'));
    const today = dayNumber(serverNow());
    const sumDay = (d) => S.grants.filter(g => dayNumber(toMillis(g.at) || 0) === d).reduce((a, g) => a + (g.amount > 0 ? g.amount : 0), 0);
    const sent = sumDay(today), sentYesterday = sumDay(today - 1);
    const problemSolo = soloProblems();
    const problems = problemTables.length + problemRooms.length + problemSolo.length;

    // Every number carries its comparison (anti-pattern: a metric with no context).
    const tile = (label, value, sub, kind = '') => h('div', { class: `adm-stat ${kind}` }, h('span', {}, label), h('strong', {}, value), h('small', {}, sub));
    const stats = clear($('adm-stats'));
    stats.removeAttribute('aria-busy');
    stats.append(
        tile('Canlı oda', S.rooms ? String(liveRooms.length) : '—', S.rooms ? `${humansIn} insan · ${botsIn} bot oynuyor` : 'izleme kapalı', S.rooms ? '' : 'is-muted'),
        tile('Dikkat isteyen', String(problems), problems ? `${problemRooms.length} oda · ${problemTables.length} masa · ${problemSolo.length} bot maçı` : 'hepsi sağlıklı', problems ? 'is-warn' : 'is-ok'),
        tile('Masalar', String(playing.length), `${waiting.length} bekleyen · ${S.tables.size} toplam`),
        tile('Bugün gönderilen', `🪙 ${sent}`, `dün: 🪙 ${sentYesterday}`)
    );

    const probs = clear($('adm-problems'));
    if (!S.tablesAt && !S.rooms && !S.tablesErr) probs.append(...skeleton(3));
    else if (!problems) probs.append(emptyState('✓ Şu an sorun yok', 'Açık odalar ve masalar sağlıklı görünüyor.'));
    problemRooms.slice(0, 6).forEach(({ id, f }) => probs.append(
        h('button', { type: 'button', class: 'adm-row', onclick: () => openRoom(id) },
            h('span', { class: 'adm-row-title' }, '🔴 Oda ', h('span', { class: 'adm-mono' }, id), ' ', pill(summarize(f).worst, summarize(f).text)),
            h('span', { class: 'adm-muted' }, f[0].text))));
    problemSolo.slice(0, 6).forEach(({ r, f }) => probs.append(
        h('button', { type: 'button', class: 'adm-row', onclick: () => go('online') },
            h('span', { class: 'adm-row-title' }, '🤖 ', h('strong', {}, r.name || shortId(r.uid)), ' ', ACTIVITY_LABEL[r.activity] || '', ' ', pill(summarize(f).worst, summarize(f).text)),
            h('span', { class: 'adm-muted' }, f[0].text))));
    problemTables.slice(0, 6).forEach(({ t, f }) => probs.append(
        h('button', { type: 'button', class: 'adm-row', onclick: () => go('tables') },
            h('span', { class: 'adm-row-title' }, '🃏 Masa ', h('span', { class: 'adm-mono' }, t.id), ' ', pill(summarize(f).worst, summarize(f).text)),
            h('span', { class: 'adm-muted' }, f[0].text))));

    renderGlobalFeed();

    const rg = clear($('adm-recent-grants'));
    const recent = auditItems().slice(0, 6);
    if (!S.grantsAt && !S.grantsErr && !S.actionsAt) rg.append(...skeleton(2));
    else if (!recent.length) rg.append(emptyState('Henüz işlem yok', 'Jeton gönderimleri, masa kapatmalar, askılar ve duyurular burada görünür.'));
    recent.forEach(it => rg.append(it.g ? grantRow(it.g) : actionRow(it.a)));
}

function feedItem(e, withRoom) {
    return h('li', { class: `adm-ev is-${e.level}` },
        h('time', { class: 'adm-ev-time', datetime: new Date(e.at).toISOString() }, clock(e.at)),
        withRoom ? h('button', { type: 'button', class: 'adm-ev-room adm-mono', onclick: () => openRoom(e.room), 'aria-label': `Oda ${e.room}` }, e.room) : null,
        h('span', { class: 'adm-ev-icon', 'aria-hidden': 'true' }, e.icon),
        h('span', { class: 'adm-ev-text' }, e.text));
}
const showCards = () => $('adm-feed-cards').checked;
const visibleEvents = (list) => list.filter(e => showCards() || e.kind !== 'card');

function renderGlobalFeed() {
    const box = $('adm-global-feed');
    const fresh = $('adm-feed-fresh');
    const last = S.feed[S.feed.length - 1];
    fresh.textContent = last ? `son olay ${formatAge(serverNow() - last.at)} önce` : '';
    if (S.paused) return;
    clear(box);
    if (!S.rooms) { box.append(h('li', { class: 'adm-empty' }, S.roomsErr ? 'Canlı odalar okunamıyor — üstteki uyarıya bak.' : 'Odalar yükleniyor…')); return; }
    const evs = visibleEvents(S.feed).slice(-40).reverse();
    if (!evs.length) { box.append(h('li', { class: 'adm-empty' }, 'Bu sayfa açıldığından beri bir olay olmadı. Olaylar bir oda değiştikçe burada belirir (geçmiş tutulmaz: oda maç bitince silinir).')); return; }
    evs.forEach(e => box.append(feedItem(e, true)));
}
bindCheck('adm-feed-cards', 'feedCards', false, () => render());
$('adm-feed-pause').addEventListener('click', (e) => {
    S.paused = !S.paused;
    e.currentTarget.setAttribute('aria-pressed', String(S.paused));
    e.currentTarget.textContent = S.paused ? 'Devam et' : 'Duraklat';
    render();
});

function grantRow(g) {
    const when = toMillis(g.at);
    return h('div', { class: 'adm-row adm-row--static' },
        h('span', { class: 'adm-row-title' },
            h('span', { class: g.amount >= 0 ? 'adm-plus' : 'adm-minus' }, `${g.amount >= 0 ? '+' : '−'}${Math.abs(g.amount)} 🪙`),
            ' → ', h('strong', {}, nameOf(g.to))),
        h('span', { class: 'adm-muted' }, `${when ? new Date(when).toLocaleString('tr-TR') : '…'} · ${nameOf(g.by)} · ${g.note || 'sebep yok'}`));
}

// ── live rooms ─────────────────────────────────────────────────────────────
function openRoom(id) {
    const clean = safeId(id);
    if (!clean) return;
    S.selRoom = clean;
    savePref('room', clean);
    go('rooms');
}
function consoleLink(roomId) {
    const id = safeId(roomId);
    return id ? `https://console.firebase.google.com/project/${PROJECT}/database/${RTDB_NS}/data/~2FgameRooms~2F${id}` : null;
}
const lastMoveAge = (r) => { const t = toMillis(r.lastPlayTime); return t === null ? null : serverNow() - t; };

bindCheck('adm-rooms-problems', 'roomsProblems', false, () => renderRooms());
bindCheck('adm-rooms-finished', 'roomsFinished', false, () => renderRooms());

function renderRooms() {
    const list = $('adm-room-list');
    const detail = $('adm-room-detail');
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.room : null;
    clear(list);
    if (!S.rooms) {
        if (S.roomsErr) {
            list.append(emptyState('İzleme kapalı', 'Yetki yok.'));
            clear(detail).append(h('h3', {}, 'Canlı oda izleme kapalı'),
                h('p', {}, 'Sunucu bu hesabın odaları okumasına izin vermedi: ', h('code', {}, S.roomsErr)),
                h('p', { class: 'adm-muted' }, `Firebase Console → Realtime Database → Data → kök düğümde "admins" altına bu hesabın kimliğini ekle: admins/${S.user.uid} = true (boolean). Bu, yalnızca OKUMA izni verir.`));
        } else {
            list.append(...skeleton(4));
            clear(detail).append(...skeleton(2));
        }
        return;
    }
    const all = liveRoomEntries().map(([id, r]) => ({ id, r, f: roomFindings(r) }));
    let rows = all;
    if (!$('adm-rooms-finished').checked) rows = rows.filter(x => !x.r.gameOver);
    if ($('adm-rooms-problems').checked) rows = rows.filter(x => x.f.some(f => f.level !== 'info'));
    rows.sort((a, b) => summarize(b.f).error - summarize(a.f).error || summarize(b.f).warn - summarize(a.f).warn || (lastMoveAge(a.r) ?? 1e12) - (lastMoveAge(b.r) ?? 1e12));

    if (!rows.length) {
        list.append(emptyState(all.length ? 'Filtreye uyan oda yok' : 'Açık oda yok', all.length ? 'Filtreleri gevşet.' : 'Bir multiplayer maç başladığında burada belirir.'));
    }
    if (!S.selRoom || !S.rooms.has(S.selRoom)) S.selRoom = rows[0] ? rows[0].id : null;
    rows.forEach(({ id, r, f }) => {
        const sum = summarize(f);
        const players = asList(r.players);
        const humans = players.filter(p => p && !isBotSeat(p));
        const online = humans.filter(p => p.status !== 'disconnected').length;
        const age = lastMoveAge(r);
        list.append(h('button', {
            type: 'button', role: 'option', class: `adm-roomitem is-${sum.worst}${id === S.selRoom ? ' is-selected' : ''}`,
            'aria-selected': String(id === S.selRoom), dataset: { room: id },
            onclick: () => { S.selRoom = id; savePref('room', id); renderRooms(); }
        },
            h('span', { class: 'adm-roomitem-top' }, h('strong', { class: 'adm-mono' }, id), ' ', pill(sum.worst, sum.worst === 'ok' ? 'Sağlıklı' : sum.text)),
            h('span', { class: 'adm-muted' }, `${r.gameOver ? '🏁 bitti' : '▶ oynanıyor'} · 👤 ${online}/${humans.length} bağlı · ${age === null ? '—' : `son hamle ${formatAge(age)} önce`}`)));
    });
    if (focused) { const again = list.querySelector(`[data-room="${CSS.escape(focused)}"]`); if (again) again.focus(); }

    clear(detail);
    if (!S.selRoom || !S.rooms.has(S.selRoom)) {
        detail.append(emptyState('Bir oda seç', 'Soldaki listeden bir oda seçtiğinde koltuklar ve o odanın olay akışı burada görünür.'));
        return;
    }
    const r = S.rooms.get(S.selRoom);
    detail.append(roomDetail(S.selRoom, r, roomFindings(r), serverNow(), S.roomFeed.get(S.selRoom) || [], true));
}

function seatCard(p, i, r, now) {
    const bot = isBotSeat(p);
    const cards = realCount(asList(p.cards));
    const ghosts = ghostCount(asList(p.cards));
    const turn = i === r.activePlayerId && !r.gameOver;
    const off = p.status === 'disconnected';
    const status = bot ? '🤖 bot' : off ? `🔌 kopuk ${formatAge(now - (toMillis(p.disconnectedAt) || now))}` : '🟢 bağlı';
    return h('div', { class: `adm-seatcard${turn ? ' is-turn' : ''}${off ? ' is-off' : ''}` },
        h('div', { class: 'adm-seatcard-top' },
            h('span', { class: 'adm-seat-idx' }, `#${i}`),
            turn ? h('span', { class: 'adm-turn' }, 'SIRA') : null,
            p.uid === r.hostId ? h('span', { title: 'ev sahibi' }, '👑', sr('ev sahibi')) : null),
        h('strong', { class: 'adm-seat-name' }, p.name || '—'),
        h('span', { class: 'adm-muted' }, status),
        h('div', { class: 'adm-bar', role: 'img', 'aria-label': `${cards} kart, 52 üzerinden` }, h('span', { style: `width:${Math.min(100, Math.round(cards / 52 * 100))}%` })),
        h('span', { class: 'adm-seat-cards' }, `${cards} kart${ghosts ? ` · 👻 ${ghosts}` : ''}${p.streak ? ` · seri ${p.streak}` : ''}`),
        bot ? null : h('button', { type: 'button', class: 'adm-linkbtn adm-mono', onclick: () => copy(p.uid), title: 'kimliği kopyala' }, shortId(p.uid)));
}

function roomDetail(id, r, f, now, feed, live = false) {
    const players = asList(r.players);
    const pile = asList(r.pile), burn = asList(r.burnPile);
    const c = r.challenge || {};
    const contest = r.slapContest;
    const age = lastMoveAge(r);
    const kv = (k, v) => h('div', { class: 'adm-kv' }, h('span', {}, k), h('strong', {}, v));
    const evs = visibleEvents(feed).slice().reverse();
    const link = consoleLink(id);
    const tech = h('details', { class: 'adm-tech', open: S.techOpen || null, ontoggle: (e) => { S.techOpen = e.currentTarget.open; } },
        h('summary', {}, 'Teknik ayrıntılar'),
        // Council ERS-29 O1: the raw room shows every hand. An admin account
        // that also plays would be reading its opponents' cards.
        h('p', { class: 'adm-muted' }, '⚠ Ham veri oyuncuların ellerini de içerir. Yönetici hesabıyla oyun oynama; bunun için ayrı bir oyuncu hesabı kullan.'),
        h('div', { class: 'adm-kvs' },
            kv('Meydan okuma', c.active ? `${c.attackerId} → ${c.defenderId}, ${c.chancesLeft} hak` : 'yok'),
            kv('Şaplak yarışı', contest ? `${asList(contest.claims).length} iddia · bitiş ${formatAge(Math.abs(now - Number(contest.deadline || now)))} ${now > Number(contest.deadline || now) ? 'önce' : 'sonra'}` : 'yok'),
            kv('Yığın / yanan', `${realCount(pile)} / ${realCount(burn)}`),
            kv('Kurallar', r.houseRules || 'klasik'),
            kv('Tanrı', r.god ? String(r.god.id || r.god) : '—'),
            kv('Son kazanma / yanma', `${r.lastWinReason || '—'} / ${r.lastBurnReason || '—'}`)),
        h('div', { class: 'adm-toolbar' },
            h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => copy(JSON.stringify(r, null, 2)) }, 'Ham JSON\'u kopyala'),
            link ? h('a', { class: 'adm-btn adm-btn--ghost', href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Konsolda aç ↗') : null),
        h('pre', { class: 'adm-pre' }, JSON.stringify(r, null, 2)));

    return h('div', { class: 'adm-room' },
        h('header', { class: 'adm-room-head' },
            h('h3', {}, 'Oda ', h('span', { class: 'adm-mono' }, id)),
            h('span', { class: `adm-status ${r.gameOver ? 'is-done' : 'is-playing'}` }, r.gameOver ? '🏁 bitti' : '▶ oynanıyor'),
            h('span', { class: 'adm-muted' }, age === null ? '' : `son hamle ${formatAge(age)} önce`),
            h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => copy(id) }, 'Kodu kopyala'),
            live && roomIsDead(r, now) ? h('button', { type: 'button', class: 'adm-btn adm-btn--danger', disabled: S.closing.has(id) || null, onclick: () => deleteRoom(id) }, '🗑 Odayı sil') : null),
        r.gameOver ? h('p', { class: 'adm-winner' }, '🏆 ', Number.isInteger(r.winnerIndex) && r.winnerIndex >= 0 ? `Kazanan: ${(players[r.winnerIndex] || {}).name || `koltuk ${r.winnerIndex}`}` : 'Berabere') : null,
        h('div', { class: 'adm-seatgrid' }, players.map((p, i) => seatCard(p, i, r, now))),
        h('div', { class: 'adm-pilebar' }, h('span', { class: 'adm-muted' }, 'Yığının üstü: '),
            pile.length ? pile.slice(-6).map(card => h('span', { class: 'adm-card-chip' }, cardLabel(card))) : h('span', { class: 'adm-muted' }, 'boş')),
        findingsList(f),
        h('div', { class: 'adm-card-head' }, h('h4', {}, 'Olay akışı'),
            h('span', { class: 'adm-muted', title: 'Firebase hızlı art arda gelen değişiklikleri tek görüntüde birleştirebilir; o zaman iki olay tek satırda görünür ya da biri kaybolur.' }, 'anlık görüntü farkından türetilir'),
            h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => copy(evs.map(e => `${clock(e.at)} ${e.icon} ${e.text}`).join('\n')) }, 'Akışı kopyala')),
        evs.length ? h('ol', { class: 'adm-feed' }, evs.map(e => feedItem(e, false)))
            : h('p', { class: 'adm-muted' }, 'Bu oda için henüz olay yok — sayfa açıldıktan sonra olanlar burada belirir.'),
        tech);
}

$('adm-room-analyze').addEventListener('click', () => {
    const out = clear($('adm-room-result'));
    let data;
    try { data = JSON.parse($('adm-room-json').value); }
    catch (e) { out.append(h('p', { class: 'adm-error' }, `JSON okunamadı: ${e.message}`)); return; }
    // Accept a single room, or a whole `gameRooms` export (id → room).
    const rooms = data && data.players ? [['yapıştırılan', data]]
        : Object.entries(data || {}).filter(([, v]) => v && typeof v === 'object' && v.players);
    if (!rooms.length) { out.append(h('p', { class: 'adm-error' }, 'Bu JSON bir oyun odasına benzemiyor (players alanı yok).')); return; }
    for (const [id, r] of rooms) {
        const at = serverNow();
        const f = roomDiagnostics(r, { now: at });
        out.append(h('div', { class: 'adm-card adm-card--inset' }, roomDetail(safeId(id) || 'yapıştırılan', r, f, at, [])));
    }
});

// ── lobby tables ───────────────────────────────────────────────────────────
function seatChip(p, t) {
    const bot = isBotSeat(p);
    // v3.22.3: a connection marker (online/{uid}) is proof of online; presence/{uid} is only written on joining a table.
    const pres = bot ? 'bot' : (S.online && S.online[p.uid]) ? 'online' : presenceState((S.presence.get(p.uid) || {}).value);
    const word = bot ? 'bot' : p.status === 'disconnected' ? 'kopuk' : pres === 'online' ? 'çevrimiçi' : pres === 'offline' ? 'çevrimdışı' : 'bilinmiyor';
    const dot = bot ? '🤖' : p.status === 'disconnected' ? '🔌' : pres === 'online' ? '🟢' : pres === 'offline' ? '⚫' : '⚪';
    return h('span', { class: `adm-seat ${p.status === 'disconnected' ? 'is-off' : ''}`, title: `${word}${bot ? '' : ` · ${p.uid}`}` },
        h('span', { 'aria-hidden': 'true' }, dot), sr(`${word}: `), ' ', p.uid === t.hostId ? h('span', {}, '👑', sr('ev sahibi')) : null, ' ', p.name || shortId(p.uid));
}

bindCheck('adm-only-problems', 'onlyProblems', false, () => renderTables());
bindCheck('adm-hide-finished', 'hideOld', true, () => renderTables());
$('adm-tables-refresh').addEventListener('click', async () => { await refreshPresence(true); toast('Presence ve lobi aynaları yenilendi'); });

function renderTables() {
    const onlyProblems = $('adm-only-problems').checked;
    const hideOld = $('adm-hide-finished').checked;
    const list = clear($('adm-tables'));
    if (!S.tablesAt && !S.tablesErr) { list.append(...skeleton(3)); return; }
    list.removeAttribute('aria-busy');
    let rows = [...S.tables.values()].map(t => ({ t, f: tableFindings(t), age: tableAge(t) }));
    if (hideOld) rows = rows.filter(r => !(r.age !== null && r.age > 24 * 3600e3 && r.t.gameState && r.t.gameState.status !== 'playing'));
    if (onlyProblems) rows = rows.filter(r => r.f.some(f => f.level !== 'info'));
    rows.sort((a, b) => (summarize(a.f).error ? 0 : 1) - (summarize(b.f).error ? 0 : 1) || (a.age ?? 0) - (b.age ?? 0));
    renderOrphans();
    $('adm-tables-meta').textContent = `${rows.length} / ${S.tables.size} masa · güncellendi ${S.tablesAt ? clock(S.tablesAt) : '—'}`;
    if (!rows.length) { list.append(emptyState(S.tables.size ? 'Filtreye uyan masa yok' : 'Masa yok', S.tables.size ? 'Filtreleri gevşet.' : 'Bir oyuncu masa açtığında burada görünür.')); return; }

    const closable = rows.filter(({ t }) => closePlanFor(t).ok);
    const sweep = $('adm-tables-sweep');
    sweep.hidden = !closable.length;
    sweep.textContent = `🧹 Ölü masaları kapat (${closable.length})`;
    sweep.onclick = () => sweepTables(closable.map(x => x.t));

    rows.forEach(({ t, f, age }) => {
        const st = (t.gameState && t.gameState.status) || '?';
        const plan = closePlanFor(t);
        const roomId = t.gameState && t.gameState.roomId;
        const sum = summarize(f);
        const live = roomId && S.rooms && S.rooms.has(roomId);
        list.append(h('article', { class: `adm-card adm-table is-${sum.worst}` },
            h('header', { class: 'adm-table-head' },
                h('strong', { class: 'adm-mono' }, t.id),
                h('span', { class: `adm-status is-${st}` }, st === 'playing' ? '▶ oynanıyor' : st === 'waiting' ? '⏳ bekliyor' : st),
                pill(sum.worst, sum.worst === 'ok' ? 'Sağlıklı' : sum.text),
                h('span', { class: 'adm-muted' }, `açıldı ${formatAge(age)} önce`),
                t.god ? h('span', { class: 'adm-chip' }, `⚱ ${t.god}`) : null,
                t.houseRules ? h('span', { class: 'adm-chip', title: 'kural seti' }, `📜 ${t.houseRules}`) : null),
            h('div', { class: 'adm-seats' }, asList(t.players).map(p => seatChip(p, t))),
            findingsList(f),
            h('div', { class: 'adm-toolbar' },
                live ? h('button', { type: 'button', class: 'adm-btn adm-btn--primary', onclick: () => openRoom(roomId) }, `Odayı canlı izle (${roomId})`) : null,
                roomId && !live ? h('span', { class: 'adm-muted' }, `oda ${roomId} canlı listede yok`) : null,
                h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => copy(t.id) }, 'Masa kodunu kopyala'),
                h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => pickPlayerFromTable(t) }, 'Ev sahibine jeton'),
                plan.ok ? h('button', { type: 'button', class: 'adm-btn adm-btn--danger', disabled: S.closing.has(t.id) || null, onclick: () => closeTable(t) }, '🗑 Masayı kapat')
                    : h('span', { class: 'adm-muted', title: CLOSE_REASON[plan.reason] || '' }, plan.reason === 'young' ? '' : `kapatılamaz: ${CLOSE_REASON[plan.reason] || plan.reason}`))));
    });
}

function renderOrphans() {
    const box = clear($('adm-orphans'));
    if (S.lobbiesErr) { box.append(h('p', { class: 'adm-muted' }, `Lobi kayıtları okunamadı (${S.lobbiesErr}).`)); return; }
    if (!S.lobbies || !S.tablesAt) { box.append(...skeleton(1)); return; }
    // Only meaningful against the whole table list: the listener holds the newest 300.
    const ids = orphanLobbies(S.lobbies, S.tables);
    if (!ids.length) { box.append(emptyState('✓ Sahipsiz kayıt yok', 'Her lobi aynasının arkasında bir masa var.')); return; }
    ids.forEach(id => {
        const lb = S.lobbies[id] || {};
        const ok = lobbyDeletable(lb, { now: serverNow(), rooms: S.rooms || new Map(), online: S.online || {} }) && S.rooms !== null && S.online !== null;
        box.append(h('div', { class: 'adm-row adm-row--static' },
            h('span', { class: 'adm-row-title' }, h('span', { class: 'adm-mono' }, id), ' · ', (lb.gameState && lb.gameState.status) || '?', ' · ev sahibi ', lb.hostUsername || shortId(lb.hostId)),
            h('div', { class: 'adm-toolbar' }, ok
                ? h('button', { type: 'button', class: 'adm-btn adm-btn--danger', disabled: S.closing.has(id) || null, onclick: () => deleteLobby(id) }, '🗑 Kaydı sil')
                : h('span', { class: 'adm-muted' }, 'silinemez: odası canlı ya da ev sahibi bağlı'))));
    });
}

// ── cleanup (v3.22.3, council ERS-30) ──────────────────────────────────────
// Order matters: the room first (its rule reads its own lastPlayTime), then
// the lobby mirror (its rule reads the room), then the Firestore table. Each
// step is refused by the server unless the thing is dead; the page only
// avoids offering what would be refused, and reports every step.
function closePlanFor(t) {
    const roomId = t.gameState && typeof t.gameState.roomId === 'string' ? safeId(t.gameState.roomId) : null;
    const room = !roomId ? null : S.rooms ? (S.rooms.get(roomId) || null) : undefined;
    // Unknown is treated as present: the lobby rule would refuse anyway.
    const hostOnline = S.online ? !!S.online[t.hostId] : true;
    return tableClosePlan(t, { now: serverNow(), room, hostOnline });
}

// ── the action log (v3.24.0, council ERS-36) ───────────────────────────────
/**
 * Every admin power beyond coins is ONE batch: the admin_actions record, the
 * admin's admin_state pointer, and — for a Firestore target — the change
 * itself. The rules refuse the change unless the record written in the SAME
 * commit names this kind and this exact target (firestore.rules block 7).
 * A Realtime Database target cannot join that commit: its record is written
 * first and the delete follows — logged, but not atomic, and said so.
 */
async function adminCommit(kind, target, reason, { detail, apply } = {}) {
    if (!S.user || !target || !validReason(reason)) throw Object.assign(new Error('bad-action'), { code: 'invalid-argument' });
    const id = doc(collection(db, 'admin_actions')).id;
    const b = writeBatch(db);
    const rec = { kind, target, by: S.user.uid, reason: reason.trim(), at: serverTimestamp() };
    if (detail) rec.detail = String(detail).slice(0, DETAIL_MAX);
    b.set(doc(db, 'admin_actions', id), rec);
    b.set(doc(db, 'admin_state', S.user.uid), { lastActionId: id });
    if (apply) apply(b);
    await b.commit();
    return id;
}
const refusal = (e) => `Sunucu reddetti: ${(e && (e.code || e.message)) || e}`;

async function closeSteps(t, plan, reason) {
    const id = safeId(t.id);
    if (!id) throw new Error('bad-id');
    const why = `masa ${id} kapatılırken`;
    if (plan.room) {
        const rid = safeId(plan.room);
        if (rid) {
            await adminCommit('delete-room', targetFor('delete-room', rid), reason, { detail: why });
            await remove(ref(rtdb, `gameRooms/${rid}`));
        }
    }
    const lb = await get(ref(rtdb, `lobbyRooms/${id}`));
    if (lb.exists()) {
        await adminCommit('delete-lobby', targetFor('delete-lobby', id), reason, { detail: why });
        await remove(ref(rtdb, `lobbyRooms/${id}`));
    }
    await adminCommit('close-table', targetFor('close-table', id), reason, {
        detail: `${(t.gameState && t.gameState.status) || '?'} · ev sahibi ${t.hostUsername || shortId(t.hostId)}`,
        apply: (b) => b.delete(doc(db, 'multiplayer_tables', id))
    });
}

async function closeTable(t) {
    const plan = closePlanFor(t);
    if (!plan.ok) { toast(CLOSE_REASON[plan.reason] || plan.reason, 'error'); return; }
    const reason = await confirmDialog('Masayı kapat',
        `Masa ${t.id} (${(t.gameState && t.gameState.status) || '?'}) silinecek` +
        `${plan.room ? `, odası ${plan.room} ile birlikte` : ''}. Geri alınamaz; oyunculara bildirim gitmez.`,
        { reason: true, reasonDefault: 'ölü masa temizliği' });
    if (!reason) return;
    S.closing.add(t.id); render();
    try { await closeSteps(t, plan, reason); toast(`Masa ${t.id} kapatıldı`); }
    catch (e) { toast(refusal(e), 'error'); }
    finally { S.closing.delete(t.id); refreshLobbies(); render(); }
}

async function sweepTables(list) {
    const todo = list.filter(t => closePlanFor(t).ok);
    if (!todo.length) return;
    const reason = await confirmDialog('Ölü masaları kapat',
        `${todo.length} masa silinecek (bitmiş, 30 dk başlatılmamış ya da 2 saatten eski; odası canlı olan yok). Geri alınamaz.`,
        { reason: true, reasonDefault: 'ölü masa temizliği' });
    if (!reason) return;
    let done = 0, failed = 0;
    for (const t of todo) {
        S.closing.add(t.id);
        try { await closeSteps(t, closePlanFor(t), reason); done++; }
        catch (e) { failed++; console.warn('[admin] close failed', t.id, e && e.code); }
        finally { S.closing.delete(t.id); }
    }
    toast(`${done} masa kapatıldı${failed ? ` · ${failed} reddedildi` : ''}`, failed ? 'warn' : 'ok');
    refreshLobbies(); render();
}

async function deleteRoom(id) {
    const rid = safeId(id);
    const r = rid && S.rooms && S.rooms.get(rid);
    if (!r || !roomIsDead(r, serverNow())) { toast('Oda canlı — silinemez', 'error'); return; }
    const reason = await confirmDialog('Odayı sil', `Oda ${rid} (${r.gameOver ? 'bitmiş' : '15 dakikadır hamle yok'}) silinecek. Geri alınamaz.`,
        { reason: true, reasonDefault: 'ölü oda temizliği' });
    if (!reason) return;
    S.closing.add(rid); render();
    try {
        await adminCommit('delete-room', targetFor('delete-room', rid), reason);
        await remove(ref(rtdb, `gameRooms/${rid}`));
        toast(`Oda ${rid} silindi`);
    } catch (e) { toast(refusal(e), 'error'); }
    finally { S.closing.delete(rid); render(); }
}

async function deleteLobby(id) {
    const lid = safeId(id);
    if (!lid) return;
    const reason = await confirmDialog('Lobi kaydını sil', `Sahipsiz lobi kaydı ${lid} silinecek. Arkasında masa yok.`,
        { reason: true, reasonDefault: 'sahipsiz lobi kaydı' });
    if (!reason) return;
    S.closing.add(lid); render();
    try {
        await adminCommit('delete-lobby', targetFor('delete-lobby', lid), reason);
        await remove(ref(rtdb, `lobbyRooms/${lid}`));
        toast(`Kayıt ${lid} silindi`);
    } catch (e) { toast(refusal(e), 'error'); }
    finally { S.closing.delete(lid); refreshLobbies(); }
}

// ── multiplayer overview (v3.24.0) ─────────────────────────────────────────
function mpPlayers() {
    if (!S.online) return [];
    return onlineRows(S.online, { tables: S.tables, rooms: S.rooms || new Map(), names: S.names })
        .filter(r => onlineCategory(r) === 'multiplayer');
}
function renderMultiplayer() {
    const now = serverNow();
    const liveRooms = liveRoomEntries().filter(([, r]) => !r.gameOver);
    const waiting = [...S.tables.values()].filter(t => t.gameState && t.gameState.status === 'waiting');
    const players = mpPlayers();
    const day = S.matches.filter(m => (toMillis(m.endedAt) || 0) > now - 86400e3);
    const humansLive = liveRooms.reduce((a, [, r]) => a + asList(r.players).filter(p => p && !isBotSeat(p) && p.status !== 'disconnected').length, 0);
    const tile = (label, value, sub, kind = '') => h('div', { class: `adm-stat ${kind}` }, h('span', {}, label), h('strong', {}, value), h('small', {}, sub));
    const stats = clear($('adm-mp-stats'));
    stats.removeAttribute('aria-busy');
    stats.append(
        tile('Canlı maç', S.rooms ? String(liveRooms.length) : '—', S.rooms ? `${humansLive} insan oynuyor` : 'izleme kapalı', S.rooms ? '' : 'is-muted'),
        tile('Bekleyen masa', String(waiting.length), `${S.tables.size} masa toplam`),
        tile('Multiplayer\'da', S.online ? String(players.length) : '—', 'bağlı oyuncu (masada ya da maçta)'),
        tile('Son 24 saatte biten', String(day.length), `${day.reduce((a, m) => a + (Number(m.disconnects) || 0), 0)} kopma`));

    const live = clear($('adm-mp-live'));
    if (!S.rooms) live.append(emptyState(S.roomsErr ? 'İzleme kapalı' : 'Yükleniyor…', S.roomsErr ? 'Canlı odalar okunamıyor — üstteki uyarıya bak.' : ''));
    else if (!liveRooms.length) live.append(emptyState('Şu an maç yok', 'Bir multiplayer maç başladığında burada belirir.'));
    liveRooms.sort((a, b) => (lastMoveAge(a[1]) ?? 1e12) - (lastMoveAge(b[1]) ?? 1e12)).forEach(([id, r]) => {
        const sum = summarize(roomFindings(r));
        const age = lastMoveAge(r);
        live.append(h('button', { type: 'button', class: 'adm-row', onclick: () => openRoom(id) },
            h('span', { class: 'adm-row-title' }, h('span', { class: 'adm-mono' }, id), ' ', pill(sum.worst, sum.worst === 'ok' ? 'Sağlıklı' : sum.text)),
            h('span', { class: 'adm-muted' }, `${asList(r.players).filter(p => p && !isBotSeat(p)).map(p => p.name || '—').join(', ')} · ${age === null ? '—' : `son hamle ${formatAge(age)} önce`}`)));
    });

    const wait = clear($('adm-mp-waiting'));
    if (!S.tablesAt && !S.tablesErr) wait.append(...skeleton(2));
    else if (!waiting.length) wait.append(emptyState('Bekleyen masa yok', 'Bir oyuncu masa açtığında burada görünür.'));
    waiting.forEach(t => wait.append(h('button', { type: 'button', class: 'adm-row', onclick: () => go('tables') },
        h('span', { class: 'adm-row-title' }, h('span', { class: 'adm-mono' }, t.id), ` · ${asList(t.players).filter(p => p && !isBotSeat(p)).length} oyuncu`),
        h('span', { class: 'adm-muted' }, `ev sahibi ${t.hostUsername || shortId(t.hostId)} · açıldı ${formatAge(tableAge(t))} önce`))));

    const pl = clear($('adm-mp-players'));
    if (S.onlineErr) pl.append(emptyState('Liste okunamıyor', S.onlineErr));
    else if (!S.online) pl.append(...skeleton(2));
    else if (!players.length) pl.append(emptyState('Multiplayer\'da kimse yok', 'Masada ya da maçta bağlı bir oyuncu olduğunda burada görünür.'));
    else pl.append(onlineTable(players, now));

    renderMatchHistory(now);
}

function renderMatchHistory(now) {
    const box = clear($('adm-mp-history'));
    const meta = $('adm-mp-history-meta');
    const expired = S.matches.filter(m => (toMs(m.expireAt) ?? Infinity) < now);
    const sweep = $('adm-mp-sweep');
    sweep.hidden = !expired.length;
    sweep.textContent = `Süresi dolanları temizle (${expired.length})`;
    sweep.onclick = () => sweepMatches(expired);
    if (S.matchesErr) { meta.textContent = ''; box.append(emptyState('Maç geçmişi okunamıyor', `${S.matchesErr} — firestore.rules v3.24.0 yayınlandı mı? (deploy-rules.bat)`)); return; }
    if (!S.matchesAt) { box.append(...skeleton(2)); return; }
    meta.textContent = `${S.matches.length} maç · en yeni önce`;
    if (!S.matches.length) { box.append(emptyState('Henüz biten maç kaydı yok', 'v3.24.0 ile biten her multiplayer maç burada görünür.')); return; }
    box.append(h('table', { class: 'adm-tbl' },
        h('caption', { class: 'adm-sr' }, 'Biten multiplayer maçlar, en yeni önce'),
        h('thead', {}, h('tr', {}, ['Bitti', 'Masa', 'Oyuncular (kart)', 'Kazanan', 'Süre', 'Kopma', ''].map(x => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, S.matches.map(m => {
            const seats = asList(m.players);
            const winner = Number.isInteger(m.winner) && m.winner >= 0 ? seats[m.winner] : null;
            const ended = toMillis(m.endedAt);
            const dur = ended && m.startedAt ? ended - Number(m.startedAt) : null;
            return h('tr', {},
                h('td', {}, ended ? new Date(ended).toLocaleString('tr-TR') : '…'),
                h('td', { class: 'adm-mono' }, m.tableId || '—'),
                h('td', {}, h('span', { class: 'adm-online-where' }, seats.map(p => h('span', { class: 'adm-seat' },
                    p.bot ? '🤖 ' : '',
                    p.uid && safeId(p.uid) ? h('button', { type: 'button', class: 'adm-linkbtn', onclick: () => { go('players'); selectPlayer({ uid: p.uid, username: p.name }); } }, p.name) : p.name,
                    ` (${p.cards})`)))),
                h('td', {}, winner ? `🏆 ${winner.name}` : 'berabere'),
                h('td', {}, dur !== null && dur >= 0 ? formatAge(dur) : '—'),
                h('td', { class: 'adm-num' }, String(m.disconnects || 0)),
                h('td', {}, h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => deleteMatch(m) }, 'Sil')));
        }))));
}

async function deleteMatch(m) {
    const id = safeId(m.id);
    if (!id) return;
    const reason = await confirmDialog('Maç kaydını sil', `${m.tableId || id} maçının kaydı silinecek.`, { reason: true });
    if (!reason) return;
    try { await adminCommit('delete-match', targetFor('delete-match', id), reason, { apply: (b) => b.delete(doc(db, 'match_log', id)) }); toast('Maç kaydı silindi'); }
    catch (e) { toast(refusal(e), 'error'); }
}
/** Retention housekeeping: the rule lets an admin delete an EXPIRED record without a log entry. */
async function sweepMatches(list) {
    const ok = await confirmDialog('Süresi dolan maç kayıtları', `${list.length} kayıt 30 günü doldurdu ve silinecek (saklama süresi temizliği).`);
    if (!ok) return;
    let done = 0;
    for (const m of list) {
        const id = safeId(m.id);
        if (!id) continue;
        try { await deleteDoc(doc(db, 'match_log', id)); done++; } catch (e) { /* not expired after all: the rule refuses */ }
    }
    toast(`${done} kayıt silindi`);
}

// ── moderation (v3.24.0, council ERS-36) ───────────────────────────────────
BAN_DAYS.forEach(d => $('adm-ban-days').append(h('option', { value: String(d) }, `${d} gün`)));
$('adm-ban-days').value = String(BAN_DAYS[0]);
ANN_HOURS.forEach(n => $('adm-ann-hours').append(h('option', { value: String(n) }, n < 24 ? `${n} saat` : `${n / 24} gün`)));
$('adm-ann-hours').value = '24';

$('adm-ban-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const uid = $('adm-ban-uid').value.trim();
    if (await banPlayer(uid, Number($('adm-ban-days').value), $('adm-ban-reason').value.trim(), nameOf(uid))) {
        $('adm-ban-uid').value = ''; $('adm-ban-reason').value = '';
    }
});

/** The reason is what the player is shown; it is also the log's reason. */
async function banPlayer(uid, days, playerReason, name) {
    const target = targetFor('ban', uid);
    if (!target) { toast('Geçersiz oyuncu kimliği', 'error'); return false; }
    if (uid === S.user.uid) { toast('Kendi hesabını askıya alamazsın', 'error'); return false; }
    if (!validReason(playerReason)) { toast(`Oyuncunun göreceği sebep ${REASON_MIN}–${REASON_MAX} karakter olmalı`, 'error'); return false; }
    const until = banUntilFor(days, serverNow());
    const ok = await confirmDialog('Askıya al', `${name || uid} · ${days} gün (bitiş ${new Date(until).toLocaleString('tr-TR')})\nOyuncunun göreceği sebep: ${playerReason}`);
    if (!ok) return false;
    try {
        await adminCommit('ban', target, playerReason, {
            detail: `${days} gün`,
            apply: (b) => b.set(doc(db, 'bans', uid), { until: new Date(until), reason: playerReason, by: S.user.uid, at: serverTimestamp() })
        });
        toast(`${name || uid} ${days} gün askıya alındı`);
        return true;
    } catch (e) { toast(refusal(e), 'error'); return false; }
}
async function unbanPlayer(uid) {
    const target = targetFor('unban', uid);
    if (!target) return false;
    const reason = await confirmDialog('Askıyı kaldır', `${nameOf(uid)} hesabının askısı kaldırılacak.`, { reason: true });
    if (!reason) return false;
    try { await adminCommit('unban', target, reason, { apply: (b) => b.delete(doc(db, 'bans', uid)) }); toast('Askı kaldırıldı'); return true; }
    catch (e) { toast(refusal(e), 'error'); return false; }
}

const ANN_PROBLEM = { short: 'en az 3 karakter olmalı', long: 'en fazla 160 karakter olabilir', link: 'bağlantı, alan adı ya da @ içeremez', lines: 'tek satır olmalı', type: 'metin değil' };
$('adm-ann-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const problem = $('adm-ann-problem');
    problem.textContent = '';
    const texts = {};
    for (const l of ANN_LANGS) { const v = $(`adm-ann-${l}`).value.trim(); if (v) texts[l] = v; }
    if (!Object.keys(texts).length) { problem.textContent = 'En az bir dilde metin yaz.'; return; }
    for (const [l, t] of Object.entries(texts)) {
        const why = annTextProblem(t);
        if (why) { problem.textContent = `${l}: ${ANN_PROBLEM[why]}.`; return; }
    }
    const hours = Number($('adm-ann-hours').value) || 24;
    const until = annUntilFor(hours, serverNow());
    const level = $('adm-ann-level').value === 'warn' ? 'warn' : 'info';
    const first = Object.values(texts)[0];
    const reason = await confirmDialog('Duyuruyu yayınla',
        `${first}\n(${Object.keys(texts).join(', ')} · ${hours < 24 ? `${hours} saat` : `${hours / 24} gün`} · ${level === 'warn' ? 'uyarı' : 'bilgi'})`,
        { reason: true, reasonDefault: 'duyuru' });
    if (!reason) return;
    try {
        await adminCommit('announce', targetFor('announce'), reason, {
            detail: first.slice(0, 120),
            apply: (b) => b.set(doc(db, 'config', 'announcement'), { ...texts, level, until: new Date(until), by: S.user.uid, at: serverTimestamp() })
        });
        ANN_LANGS.forEach(l => { $(`adm-ann-${l}`).value = ''; });
        toast('Duyuru yayında');
    } catch (err) { toast(refusal(err), 'error'); }
});
async function clearAnnouncement() {
    const reason = await confirmDialog('Duyuruyu kaldır', 'Menüdeki duyuru hemen kalkar.', { reason: true, reasonDefault: 'duyuru bitti' });
    if (!reason) return;
    try { await adminCommit('clear-announcement', targetFor('clear-announcement'), reason, { apply: (b) => b.delete(doc(db, 'config', 'announcement')) }); toast('Duyuru kaldırıldı'); }
    catch (e) { toast(refusal(e), 'error'); }
}

function renderModeration() {
    const now = serverNow();
    const bans = clear($('adm-bans'));
    if (S.bansErr) bans.append(emptyState('Askılar okunamıyor', `${S.bansErr} — firestore.rules v3.24.0 yayınlandı mı? (deploy-rules.bat)`));
    else if (!S.bansAt) bans.append(...skeleton(1));
    else {
        const rows = [...S.bans.entries()].sort((a, b) => (toMs(b[1].until) || 0) - (toMs(a[1].until) || 0));
        if (!rows.length) bans.append(emptyState('Askıda hesap yok', 'Askıya alınan hesaplar burada listelenir.'));
        rows.forEach(([uid, b]) => {
            const active = banActive(b, now);
            bans.append(h('div', { class: 'adm-row adm-row--static' },
                h('span', { class: 'adm-row-title' }, active ? pill('error', 'ASKIDA') : pill('info', 'BİTTİ'), ' ', h('strong', {}, nameOf(uid)), ' ',
                    h('span', { class: 'adm-mono adm-muted' }, uid)),
                h('span', { class: 'adm-muted' }, `${active ? `bitiş ${new Date(toMs(b.until)).toLocaleString('tr-TR')}` : 'süresi doldu'} · sebep: ${b.reason || '—'} · ${nameOf(b.by)}`),
                h('div', { class: 'adm-toolbar' }, h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => unbanPlayer(uid) }, active ? 'Askıyı kaldır' : 'Kaydı sil'))));
        });
    }

    const cur = clear($('adm-ann-current'));
    const live = pickAnnouncement(S.announcement, 'tr', now);
    if (S.annErr) cur.append(h('p', { class: 'adm-error' }, `Duyuru okunamadı (${S.annErr}).`));
    else if (!live) cur.append(h('p', { class: 'adm-muted' }, 'Şu an yayında duyuru yok.'));
    else cur.append(h('div', { class: 'adm-card adm-card--inset' },
        h('p', {}, pill(live.level === 'warn' ? 'warn' : 'info', live.level === 'warn' ? 'UYARI' : 'BİLGİ'),
            ` yayında · bitiş ${new Date(toMs(S.announcement.until)).toLocaleString('tr-TR')}`),
        ANN_LANGS.filter(l => typeof S.announcement[l] === 'string').map(l => h('p', {}, h('code', {}, l), ' ', S.announcement[l])),
        h('div', { class: 'adm-toolbar' }, h('button', { type: 'button', class: 'adm-btn adm-btn--danger', onclick: clearAnnouncement }, 'Duyuruyu kaldır'))));

    renderBoard();
}

// Score boards: loaded on demand (they are public; a listener would be waste).
$('adm-daily-date').value = new Date().toISOString().slice(0, 10);
$('adm-daily-load').addEventListener('click', () => loadDaily($('adm-daily-date').value));
$('adm-lb-load').addEventListener('click', () => loadLeaderboard());
async function loadDaily(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Tarih seç', 'error'); return; }
    S.board = { kind: 'daily', date, rows: null }; renderBoard();
    try {
        const snap = await getDocs(query(collection(db, 'daily_challenges', date, 'scores'), orderBy('score', 'desc'), limit(50)));
        S.board = { kind: 'daily', date, rows: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (e) { S.board = { kind: 'daily', date, rows: [], err: (e && e.code) || 'error' }; }
    renderBoard();
}
async function loadLeaderboard() {
    S.board = { kind: 'leaderboard', rows: null }; renderBoard();
    try {
        const snap = await getDocs(query(collection(db, 'leaderboard'), orderBy('totalScore', 'desc'), limit(50)));
        S.board = { kind: 'leaderboard', rows: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    } catch (e) { S.board = { kind: 'leaderboard', rows: [], err: (e && e.code) || 'error' }; }
    renderBoard();
}
function renderBoard() {
    const box = clear($('adm-boards'));
    const B = S.board;
    if (!B) { box.append(h('p', { class: 'adm-muted' }, 'Bir tablo yükle.')); return; }
    if (!B.rows) { box.append(...skeleton(2)); return; }
    if (B.err) { box.append(h('p', { class: 'adm-error' }, `Okunamadı (${B.err}).`)); return; }
    if (!B.rows.length) { box.append(emptyState('Kayıt yok', B.kind === 'daily' ? `${B.date} için skor yok.` : 'Liderlik tablosu boş.')); return; }
    const daily = B.kind === 'daily';
    box.append(h('table', { class: 'adm-tbl' },
        h('caption', { class: 'adm-sr' }, daily ? `Günlük tablo ${B.date}` : 'Liderlik tablosu'),
        h('thead', {}, h('tr', {}, (daily ? ['#', 'Oyuncu', 'Skor', 'Kazandı', 'Refleks', 'Süre', ''] : ['#', 'Oyuncu', 'Skor', '']).map(x => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, B.rows.map((r, i) => h('tr', {},
            h('td', { class: 'adm-num' }, String(i + 1)),
            h('td', {}, safeId(r.id) ? h('button', { type: 'button', class: 'adm-linkbtn', onclick: () => { go('players'); selectPlayer({ uid: r.id, username: r.username }); } }, r.username || shortId(r.id)) : (r.username || '—')),
            h('td', { class: 'adm-num' }, String(daily ? r.score : r.totalScore)),
            daily ? h('td', {}, r.won ? '✓' : '—') : null,
            daily ? h('td', { class: 'adm-num' }, `${r.reflex} ms`) : null,
            daily ? h('td', {}, formatAge(Number(r.durationMs) || 0)) : null,
            h('td', {}, h('button', { type: 'button', class: 'adm-btn adm-btn--danger', onclick: () => deleteBoardEntry(B, r) }, 'Sil')))))));
}
async function deleteBoardEntry(B, r) {
    const uid = safeId(r.id);
    if (!uid) return false;
    const daily = B.kind === 'daily';
    const kind = daily ? 'delete-daily' : 'delete-leaderboard';
    const target = daily ? targetFor(kind, B.date, uid) : targetFor(kind, uid);
    if (!target) { toast('Geçersiz kayıt', 'error'); return false; }
    const reason = await confirmDialog(daily ? 'Günlük skoru sil' : 'Liderlik kaydını sil',
        `${r.username || uid} · ${daily ? r.score : r.totalScore}${daily ? ` (${B.date})` : ''}.` +
        (daily ? '' : ' Oyuncunun bir sonraki maçı kaydı yeniden yazar — tekrar ederse hesabı askıya al.'),
        { reason: true, reasonDefault: 'sahte skor' });
    if (!reason) return false;
    try {
        await adminCommit(kind, target, reason, {
            detail: `${r.username || ''} · ${daily ? r.score : r.totalScore}`,
            apply: (b) => b.delete(daily ? doc(db, 'daily_challenges', B.date, 'scores', uid) : doc(db, 'leaderboard', uid))
        });
        if (Array.isArray(B.rows)) B.rows = B.rows.filter(x => x.id !== r.id);
        renderBoard();
        toast('Silindi');
        return true;
    } catch (e) { toast(refusal(e), 'error'); return false; }
}

// ── error reports (v3.24.0) ────────────────────────────────────────────────
$('adm-errors-filter').addEventListener('input', () => renderErrors());
function renderErrors() {
    const box = clear($('adm-errors'));
    if (S.errorsErr) { box.append(emptyState('Raporlar okunamıyor', `${S.errorsErr} — firestore.rules v3.24.0 yayınlandı mı? (deploy-rules.bat)`)); return; }
    if (!S.errorsAt) { box.append(...skeleton(2)); return; }
    box.removeAttribute('aria-busy');
    const f = $('adm-errors-filter').value.trim().toLowerCase();
    const rows = S.errors.map(d => ({ d, entries: errorEntries(d) }))
        .filter(({ d, entries }) => !f || [nameOf(d.id), d.id, ...entries.map(e => `${e.src} ${e.m}`)].some(x => String(x).toLowerCase().includes(f)));
    $('adm-errors-meta').textContent = `${rows.length} oyuncu · ${rows.reduce((a, r) => a + (Number(r.d.count) || 0), 0)} hata toplam`;
    if (!rows.length) { box.append(emptyState(S.errors.length ? 'Filtreye uyan yok' : 'Hata raporu yok', S.errors.length ? 'Filtreyi değiştir.' : 'Giriş yapmış bir oyuncunun sayfasında hata olduğunda burada görünür.')); return; }
    const now = serverNow();
    rows.forEach(({ d, entries }) => box.append(h('article', { class: 'adm-card' },
        h('header', { class: 'adm-table-head' },
            h('button', { type: 'button', class: 'adm-linkbtn', onclick: () => { go('players'); selectPlayer({ uid: d.id, username: S.names.get(d.id) }); } }, nameOf(d.id)),
            h('span', { class: 'adm-muted' }, `${d.count || 0} hata · v${d.v || '?'} · son ${toMillis(d.updatedAt) ? `${formatAge(now - toMillis(d.updatedAt))} önce` : '—'}`),
            h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => clearErrors(d.id) }, 'Temizle')),
        h('ol', { class: 'adm-feed' }, entries.map(e => h('li', { class: 'adm-ev is-bad' },
            h('time', { class: 'adm-ev-time' }, new Date(Number(e.at) || 0).toLocaleString('tr-TR')),
            h('span', { class: 'adm-ev-icon', 'aria-hidden': 'true' }, '🐞'),
            h('span', { class: 'adm-ev-text' }, `${e.m} `, h('code', {}, `${e.src || '?'}:${e.line} · ${ACTIVITY_LABEL[e.mode] || e.mode}`))))))));
}
async function clearErrors(uid) {
    const id = safeId(uid);
    if (!id) return;
    const reason = await confirmDialog('Hata raporunu temizle', `${nameOf(id)} için kayıtlı hatalar silinecek.`, { reason: true, reasonDefault: 'incelendi' });
    if (!reason) return;
    try { await adminCommit('clear-errors', targetFor('clear-errors', id), reason, { apply: (b) => b.delete(doc(db, 'client_errors', id)) }); toast('Temizlendi'); }
    catch (e) { toast(refusal(e), 'error'); }
}

// ── online (v3.22.3) ───────────────────────────────────────────────────────
$('adm-online-filter').addEventListener('input', () => renderOnline());
let onlineCat = ['all', ...ONLINE_CATEGORIES.map(c => c[0])].includes(prefs.onlineCat) ? prefs.onlineCat : 'all';

const soloFindings = (r, now) => soloDiagnostics(r.match, r.activity, now);
/** Solo matches that need attention, for the overview (v3.22.5). */
function soloProblems() {
    if (!S.online) return [];
    const now = serverNow();
    return onlineRows(S.online, { names: S.names }).filter(r => r.match)
        .map(r => ({ r, f: soloFindings(r, now) })).filter(x => x.f.some(f => f.level !== 'info'));
}

function onlineTable(rows, now) {
    return h('table', { class: 'adm-tbl' },
        h('thead', {}, h('tr', {}, ['Oyuncu', 'Kimlik', 'Sekme', 'Bağlı', 'Ne yapıyor', 'Nerede', ''].map(x => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, rows.map(r => h('tr', {},
            h('td', {}, h('strong', {}, r.name || '—')),
            h('td', {}, h('button', { type: 'button', class: 'adm-linkbtn adm-mono', onclick: () => copy(r.uid), title: 'kimliği kopyala' }, `${r.uid} ⧉`)),
            h('td', { class: 'adm-num' }, String(r.tabs)),
            h('td', {}, formatAge(Math.max(0, now - r.since))),
            h('td', {}, r.activity ? ACTIVITY_LABEL[r.activity] : h('span', { class: 'adm-muted', title: 'v3.22.3 sekmesi — yenilenince görünür' }, 'bilinmiyor'),
                r.activity ? h('small', { class: 'adm-muted' }, ` · ${formatAge(Math.max(0, now - r.activityAt))}`) : null,
                // v3.22.5: a solo match, as counts, with its health checks.
                r.match ? h('div', { class: 'adm-solo' }, h('span', { class: 'adm-mono adm-muted' }, soloSummary(r.match)),
                    soloFindings(r, now).filter(f => f.level !== 'info').map(f => h('div', {}, pill(f.level), ' ', f.text, h('code', {}, ` ${f.code}`)))) : null),
            h('td', {}, h('span', { class: 'adm-online-where' },
                r.table ? h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => go('tables') }, `🃏 ${r.table}`) : null,
                r.room && S.rooms && S.rooms.has(r.room) ? h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => openRoom(r.room) }, '🔴 odayı izle') : null,
                !r.table && !r.room ? h('span', { class: 'adm-muted', title: onlineCategory(r) === 'solo' ? 'Tek oyunculu modlar tarayıcıda çalışır; sunucuda masa ya da oda açmaz.' : '' }, onlineCategory(r) === 'solo' ? 'tarayıcıda (masa yok)' : '—') : null)),
            h('td', {}, h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => { go('players'); selectPlayer({ uid: r.uid, username: r.name || '' }); } }, 'Profil / jeton'))))));
}
function renderOnline() {
    const box = clear($('adm-online'));
    if (S.onlineErr) {
        box.append(emptyState('Liste okunamıyor', `Sunucu reddetti (${S.onlineErr}). Realtime Database'de admins/${S.user.uid} = true olmalı ve v3.22.3 kuralları yayınlanmış olmalı.`));
        return;
    }
    if (!S.online) { box.append(...skeleton(3)); return; }
    box.removeAttribute('aria-busy');
    const all = onlineRows(S.online, { tables: S.tables, rooms: S.rooms || new Map(), names: S.names });
    const f = $('adm-online-filter').value.trim().toLowerCase();
    const found = f ? all.filter(r => [r.name, r.uid].some(x => String(x || '').toLowerCase().includes(f))) : all;
    const groups = ONLINE_CATEGORIES.map(([id, title, sub]) => ({ id, title, sub, rows: found.filter(r => onlineCategory(r) === id) }));

    // The category switch, with live counts (a per-viewer preference).
    const seg = clear($('adm-online-cats'));
    [['all', 'Tümü', found.length], ...groups.map(g => [g.id, g.title, g.rows.length])].forEach(([id, label, n]) =>
        seg.append(h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', 'aria-pressed': String(onlineCat === id),
            onclick: () => { onlineCat = id; savePref('onlineCat', id); renderOnline(); } }, `${label} (${n})`)));
    $('adm-online-meta').textContent = `${all.length} hesap bağlı · canlı`;

    if (!all.length) { box.append(h('div', { class: 'adm-card' }, emptyState('Şu an kimse bağlı değil', 'Giriş yapmış bir oyuncu sekmeyi açtığında burada belirir.'))); return; }
    const now = serverNow();
    const shown = onlineCat === 'all' ? groups : groups.filter(g => g.id === onlineCat);
    let any = false;
    for (const g of shown) {
        if (!g.rows.length && onlineCat === 'all') continue;
        any = true;
        box.append(h('section', { class: 'adm-card adm-online-group', 'aria-label': g.title },
            h('header', {}, h('h3', {}, `${g.title} · ${g.rows.length}`), h('span', { class: 'adm-muted' }, g.sub)),
            g.rows.length ? onlineTable(g.rows, now) : emptyState('Bu grupta kimse yok', f ? 'Filtreyi değiştir.' : 'Şu an bu türde oynayan yok.')));
    }
    if (!any) box.append(h('div', { class: 'adm-card' }, emptyState('Filtreye uyan yok', 'Filtreyi değiştir.')));
}

function pickPlayerFromTable(t) {
    go('players');
    selectPlayer({ uid: t.hostId, username: t.hostUsername || nameOf(t.hostId) });
}

// ── players & coins ────────────────────────────────────────────────────────
$('adm-search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('adm-search').value.trim();
    const box = clear($('adm-search-results'));
    if (!q) return;
    box.append(h('span', { class: 'adm-muted' }, 'Aranıyor…'));
    const found = await WalletAdmin.findPlayers(q);
    clear(box);
    if (!found.length) { box.append(h('span', { class: 'adm-error' }, 'Bu ad veya kimlikte oyuncu yok. (Ad, liderlik tablosundaki haliyle birebir yazılmalı.)')); return; }
    found.forEach(p => box.append(h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => selectPlayer(p) }, `${p.username || '—'} · ${shortId(p.uid)}`)));
    if (found.length === 1) selectPlayer(found[0]);
});

async function selectPlayer(p) {
    if (!p || !safeId(p.uid)) { toast('Geçersiz oyuncu kimliği', 'error'); return; }
    S.selectedPlayer = p;
    const box = $('adm-player');
    box.hidden = false;
    clear(box).append(...skeleton(2));
    const [wallet, board, pres, grants, stats, matches, errs] = await Promise.all([
        WalletAdmin.readWallet(p.uid).catch(() => undefined),
        getDoc(doc(db, 'leaderboard', p.uid)).then(s => (s.exists() ? s.data() : null)).catch(() => null),
        get(ref(rtdb, `presence/${p.uid}`)).then(s => s.val()).catch(() => null),
        getDocs(query(collection(db, 'coin_grants'), where('to', '==', p.uid), limit(100)))
            .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (toMillis(b.at) || 0) - (toMillis(a.at) || 0)))
            .catch(() => []),
        // v3.24.0: the match record (admin read), their finished matches, their error reports
        getDoc(doc(db, 'users', p.uid)).then(s => (s.exists() ? s.data() : null)).catch(() => undefined),
        getDocs(query(collection(db, 'match_log'), where('playerIds', 'array-contains', p.uid), limit(50)))
            .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (toMillis(b.endedAt) || 0) - (toMillis(a.endedAt) || 0)))
            .catch(() => []),
        getDoc(doc(db, 'client_errors', p.uid)).then(s => (s.exists() ? s.data() : null)).catch(() => null)
    ]);
    if (S.selectedPlayer !== p) return;
    renderPlayer(p, wallet, board, pres, grants, { stats, matches, errs });
}


function renderPlayer(p, wallet, board, pres, grants, extra = {}) {
    const box = clear($('adm-player'));
    const name = p.username || (board && board.username) || shortId(p.uid);
    const today = dayNumber(serverNow());
    const ps = presenceState(pres);
    const tile = (label, value, sub) => h('div', { class: 'adm-stat' }, h('span', {}, label), h('strong', {}, value), h('small', {}, sub || ''));
    box.append(h('header', { class: 'adm-player-head' },
        h('div', {}, h('h3', {}, name), h('button', { type: 'button', class: 'adm-linkbtn adm-mono', onclick: () => copy(p.uid) }, `${p.uid} ⧉`)),
        h('span', { class: `adm-chip ${ps === 'online' ? 'is-good' : ''}` }, ps === 'online' ? '🟢 çevrimiçi' : ps === 'offline' ? '⚫ çevrimdışı' : '⚪ bilinmiyor')));

    // v3.24.0: the match record (read-only) and moderation.
    const st = extra.stats;
    if (st === undefined) box.append(h('p', { class: 'adm-muted' }, 'Oyun istatistikleri okunamadı (firestore.rules v3.24.0 yayınlandı mı?).'));
    else if (st) box.append(h('div', { class: 'adm-stats' },
        tile('Maç', String(st.gamesPlayed || 0), 'oynanan'),
        tile('Galibiyet', String(st.gamesWon || 0), st.gamesPlayed ? `%${Math.round((st.gamesWon || 0) / st.gamesPlayed * 100)}` : '—'),
        tile('En iyi refleks', Number.isInteger(st.bestReflex) ? `${st.bestReflex} ms` : '—', 'kayıtlı en hızlı şaplak'),
        tile('Skor', String(st.totalScore || 0), board ? `liderlikte ${board.totalScore}` : 'liderlikte yok')));
    box.append(playerModeration(p, name, board));

    if (wallet === undefined) box.append(h('p', { class: 'adm-error' }, 'Cüzdan okunamadı (yetki ya da bağlantı).'));
    else if (wallet === null) box.append(h('div', { class: 'adm-card adm-card--warn' }, 'Bu oyuncunun henüz cüzdanı yok — v3.22.0 sonrasında en az bir kez giriş yapması gerekiyor. O zamana kadar jeton gönderilemez.'));
    else {
        const earned = wallet.earnDay === today ? wallet.earnedToday : 0;
        box.append(h('div', { class: 'adm-stats' },
            tile('Bakiye', `🪙 ${wallet.coins}`, `${wallet.owned.length - 1} skin sahibi`),
            tile('Bugün kazandı', `${earned} / ${EARN_DAILY_CAP}`, earned >= EARN_DAILY_CAP ? 'günlük tavan doldu' : `${EARN_DAILY_CAP - earned} kaldı`),
            tile('Çark', wallet.spinDay >= today ? 'çevrildi' : 'çevrilebilir', 'bugün (UTC)')));
        const owned = new Set(wallet.owned);
        box.append(h('div', { class: 'adm-skins', 'aria-label': 'Skinler' }, CARD_SKINS.map(s =>
            h('span', { class: `adm-skin ${owned.has(s.id) ? 'is-owned' : ''}`, title: `${s.cost} jeton` }, owned.has(s.id) ? '✓ ' : '', s.id, sr(owned.has(s.id) ? ' (sahip)' : ' (yok)')))));

        // The grant form.
        const amount = h('input', { type: 'number', class: 'adm-input', step: '1', id: 'adm-grant-amount', 'aria-describedby': 'adm-grant-help' });
        const note = h('input', { type: 'text', class: 'adm-input', maxlength: '120', id: 'adm-grant-note' });
        const presets = [50, 100, 250, 500, 1000].map(n => h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => { amount.value = String(n); amount.focus(); } }, `+${n}`));
        const send = h('button', { type: 'button', class: 'adm-btn adm-btn--primary', onclick: () => doGrant(p, name, wallet, amount, note, send) }, 'Jeton gönder');
        box.append(h('section', { class: 'adm-grant', 'aria-labelledby': 'h-grant' },
            h('h4', { id: 'h-grant' }, 'Jeton gönder / geri al'),
            h('div', { class: 'adm-toolbar' }, presets),
            h('div', { class: 'adm-formgrid' },
                h('label', { for: 'adm-grant-amount' }, 'Miktar'), amount,
                h('label', { for: 'adm-grant-note' }, 'Sebep (zorunlu)'), note),
            h('p', { id: 'adm-grant-help', class: 'adm-muted' }, `Negatif sayı jetonu geri alır. Tek işlem en fazla ${ADMIN_GRANT_MAX}; bir yönetici günde en fazla ${ADMIN_DAILY_CAP} verebilir.`),
            send));

        box.append(h('h4', {}, `Bu oyuncuya yapılan gönderimler (${grants.length})`));
        if (!grants.length) box.append(h('p', { class: 'adm-muted' }, 'Kayıt yok.'));
        grants.slice(0, 20).forEach(g => box.append(grantRow(g)));
    }

    const matches = extra.matches || [];
    box.append(h('h4', {}, `Son multiplayer maçları (${matches.length})`));
    if (!matches.length) box.append(h('p', { class: 'adm-muted' }, 'Kayıtlı maç yok (v3.24.0 sonrası biten maçlar görünür).'));
    matches.slice(0, 10).forEach(m => {
        const seats = asList(m.players);
        const me = seats.findIndex(x => x && x.uid === p.uid);
        const won = me >= 0 && m.winner === me;
        box.append(h('div', { class: 'adm-row adm-row--static' },
            h('span', { class: 'adm-row-title' }, won ? '🏆 kazandı' : '— kaybetti', ' · ', h('span', { class: 'adm-mono' }, m.tableId || m.id)),
            h('span', { class: 'adm-muted' }, `${toMillis(m.endedAt) ? new Date(toMillis(m.endedAt)).toLocaleString('tr-TR') : '…'} · ${seats.map(x => x.name).join(', ')} · ${m.disconnects || 0} kopma`)));
    });

    const errs = extra.errs;
    const entries = errorEntries(errs);
    if (entries.length) {
        box.append(h('h4', {}, `Sayfa hataları (${errs.count || entries.length})`));
        entries.slice(0, 3).forEach(e => box.append(h('div', { class: 'adm-row adm-row--static' },
            h('span', { class: 'adm-row-title' }, '🐞 ', e.m),
            h('span', { class: 'adm-muted adm-mono' }, `${e.src || '?'}:${e.line} · ${ACTIVITY_LABEL[e.mode] || e.mode} · ${new Date(Number(e.at) || 0).toLocaleString('tr-TR')}`))));
        box.append(h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: () => { $('adm-errors-filter').value = p.uid; go('errors'); } }, 'Tüm hatalar'));
    }
}

/** Suspension and leaderboard removal, from the player card. */
function playerModeration(p, name, board) {
    const ban = S.bans.get(p.uid);
    const active = banActive(ban, serverNow());
    const days = h('select', { class: 'adm-input', 'aria-label': 'Askı süresi' }, BAN_DAYS.map(d => h('option', { value: String(d) }, `${d} gün`)));
    const reason = h('input', { class: 'adm-input', maxlength: '120', placeholder: 'Oyuncunun göreceği sebep', 'aria-label': 'Askı sebebi' });
    return h('section', { class: 'adm-grant', 'aria-label': 'Moderasyon' },
        h('h4', {}, 'Moderasyon'),
        active ? h('p', {}, pill('error', 'ASKIDA'), ` bitiş ${new Date(toMs(ban.until)).toLocaleString('tr-TR')} · sebep: ${ban.reason}`)
            : h('p', { class: 'adm-muted' }, 'Askıda değil.'),
        h('div', { class: 'adm-toolbar' },
            active
                ? h('button', { type: 'button', class: 'adm-btn adm-btn--ghost', onclick: async () => { if (await unbanPlayer(p.uid)) selectPlayer(p); } }, 'Askıyı kaldır')
                : [days, reason, h('button', { type: 'button', class: 'adm-btn adm-btn--danger',
                    onclick: async () => { if (await banPlayer(p.uid, Number(days.value), reason.value.trim(), name)) selectPlayer(p); } }, '⛔ Askıya al')],
            board ? h('button', { type: 'button', class: 'adm-btn adm-btn--ghost',
                onclick: async () => { if (await deleteBoardEntry({ kind: 'leaderboard', rows: null }, { id: p.uid, username: board.username, totalScore: board.totalScore })) selectPlayer(p); } }, 'Liderlikten sil') : null));
}

async function doGrant(p, name, wallet, amountEl, noteEl, btn) {
    const raw = amountEl.value.trim();
    const n = Number(raw);
    const reason = noteEl.value.trim();
    if (!/^-?\d+$/.test(raw) || n === 0 || Math.abs(n) > ADMIN_GRANT_MAX) { toast(`-${ADMIN_GRANT_MAX} ile ${ADMIN_GRANT_MAX} arasında, 0 olmayan tam sayı gir`, 'error'); amountEl.focus(); return; }
    if (reason.length < 3) { toast('Sebep yaz — denetim kaydı için zorunlu', 'error'); noteEl.focus(); return; }
    if (wallet.coins + n < 0) { toast(`Bakiye ${wallet.coins}; ${-n} geri alınamaz`, 'error'); return; }
    const ok = await confirmDialog(n > 0 ? 'Jeton gönder' : 'Jeton geri al',
        `${name} · ${n > 0 ? '+' : '−'}${Math.abs(n)} 🪙\nBakiye: ${wallet.coins} → ${wallet.coins + n}\nSebep: ${reason}`);
    if (!ok) return;
    btn.disabled = true;
    try {
        const r = await WalletAdmin.grant(p.uid, n, reason, S.user.uid);
        if (r && r.ok) { toast(`Tamam: ${name} → 🪙 ${r.after}`); selectPlayer(p); }
        else if (r && r.reason === 'admin_daily_cap') toast(`Günlük yönetici tavanı: bugün en fazla ${r.left} daha gönderebilirsin`, 'error');
        else toast(`Reddedildi: ${(r && r.reason) || 'bilinmiyor'}`, 'error');
    } catch (e) {
        toast(`Sunucu reddetti: ${(e && e.code) || e}`, 'error');
    } finally { btn.disabled = false; }
}

// ── audit (coin grants + every other admin action, v3.24.0) ────────────────
/** One list: coin grants (their own trail since v3.22.0) and admin_actions. */
function auditItems() {
    const grants = S.grants.map(g => ({ at: toMillis(g.at) || 0, by: g.by, g }));
    const acts = S.actions.map(a => ({ at: toMillis(a.at) || 0, by: a.by, a }));
    return [...grants, ...acts].sort((x, y) => y.at - x.at);
}
/** Who an action was about, when its target names a player. */
function actionPlayer(a) {
    const m = String(a.target || '').match(/^(?:bans|leaderboard|client_errors)\/([A-Za-z0-9_-]+)$|^daily_challenges\/[\d-]+\/scores\/([A-Za-z0-9_-]+)$/);
    return m ? safeId(m[1] || m[2]) : null;
}
function actionRow(a) {
    const when = toMillis(a.at);
    const who = actionPlayer(a);
    return h('div', { class: 'adm-row adm-row--static' },
        h('span', { class: 'adm-row-title' }, ACTION_LABEL[a.kind] || a.kind, ' → ', who ? h('strong', {}, nameOf(who)) : h('span', { class: 'adm-mono' }, a.target)),
        h('span', { class: 'adm-muted' }, `${when ? new Date(when).toLocaleString('tr-TR') : '…'} · ${nameOf(a.by)} · ${a.reason || '—'}${a.detail ? ` · ${a.detail}` : ''}`));
}
function auditRows() {
    const f = $('adm-audit-filter').value.trim().toLowerCase();
    if (!f) return auditItems();
    return auditItems().filter(it => {
        const hay = it.g ? [nameOf(it.g.to), nameOf(it.g.by), it.g.to, it.g.by, it.g.note, 'jeton']
            : [ACTION_LABEL[it.a.kind], it.a.kind, it.a.target, nameOf(it.a.by), it.a.by, it.a.reason, it.a.detail, actionPlayer(it.a) ? nameOf(actionPlayer(it.a)) : ''];
        return hay.some(x => String(x || '').toLowerCase().includes(f));
    });
}
function renderAudit() {
    const box = clear($('adm-audit'));
    if (!S.grantsAt && !S.grantsErr && !S.actionsAt && !S.actionsErr) { box.append(...skeleton(3)); return; }
    box.removeAttribute('aria-busy');
    const rows = auditRows();
    const total = S.grants.length + S.actions.length;
    if (!rows.length) { box.append(emptyState(total ? 'Filtreye uyan kayıt yok' : 'Kayıt yok', total ? 'Filtreyi değiştir.' : 'İlk yönetici işlemi burada görünecek.')); return; }
    const playerLink = (uid) => (uid ? h('button', { type: 'button', class: 'adm-linkbtn', onclick: () => { go('players'); selectPlayer({ uid, username: S.names.get(uid) }); } }, nameOf(uid)) : null);
    box.append(h('p', { class: 'adm-muted' }, `${rows.length} kayıt · güncellendi ${clock(Math.max(S.grantsAt || 0, S.actionsAt || 0))}`),
        h('table', { class: 'adm-tbl' },
            h('caption', { class: 'adm-sr' }, 'Yönetici işlemleri, en yeni önce'),
            h('thead', {}, h('tr', {}, ['Zaman', 'Yönetici', 'İşlem', 'Hedef', 'Ayrıntı', 'Sebep'].map(x => h('th', { scope: 'col' }, x)))),
            h('tbody', {}, rows.map(it => it.g
                ? h('tr', {},
                    h('td', {}, it.at ? new Date(it.at).toLocaleString('tr-TR') : '…'),
                    h('td', {}, nameOf(it.g.by)),
                    h('td', { class: it.g.amount >= 0 ? 'adm-plus' : 'adm-minus' }, `🪙 ${it.g.amount >= 0 ? '+' : '−'}${Math.abs(it.g.amount)}`),
                    h('td', {}, playerLink(it.g.to)),
                    h('td', { class: 'adm-num' }, `${it.g.before} → ${it.g.after}`),
                    h('td', {}, it.g.note || '—'))
                : h('tr', {},
                    h('td', {}, it.at ? new Date(it.at).toLocaleString('tr-TR') : '…'),
                    h('td', {}, nameOf(it.a.by)),
                    h('td', {}, ACTION_LABEL[it.a.kind] || it.a.kind),
                    h('td', {}, playerLink(actionPlayer(it.a)) || h('span', { class: 'adm-mono' }, it.a.target)),
                    h('td', {}, it.a.detail || '—'),
                    h('td', {}, it.a.reason || '—'))))));
}
$('adm-audit-filter').value = typeof prefs.audit === 'string' ? prefs.audit : '';
$('adm-audit-filter').addEventListener('input', (e) => { savePref('audit', e.currentTarget.value); renderAudit(); });
$('adm-audit-csv').addEventListener('click', () => {
    const rows = [['time', 'admin_uid', 'admin', 'kind', 'target', 'player', 'amount', 'before', 'after', 'detail', 'reason', 'id']]
        .concat(auditRows().map(it => it.g
            ? [it.at ? new Date(it.at).toISOString() : '', it.g.by, nameOf(it.g.by), 'coin-grant', `wallets/${it.g.to}`, nameOf(it.g.to), it.g.amount, it.g.before, it.g.after, '', it.g.note, it.g.id]
            : [it.at ? new Date(it.at).toISOString() : '', it.a.by, nameOf(it.a.by), it.a.kind, it.a.target, actionPlayer(it.a) ? nameOf(actionPlayer(it.a)) : '', '', '', '', it.a.detail || '', it.a.reason, it.a.id]));
    const url = URL.createObjectURL(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `admin_audit_${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});

window.addEventListener('online', () => renderChrome());
window.addEventListener('offline', () => renderChrome());
// Ages ("son hamle 4 sn önce") tick without new data.
setInterval(() => { if (S.user && ['overview', 'rooms', 'tables', 'online', 'multiplayer', 'errors'].includes(S.view)) render(); }, 5000);
