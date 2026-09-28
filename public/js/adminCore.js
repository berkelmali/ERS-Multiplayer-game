/**
 * adminCore.js — the pure half of the admin page (v3.22.1). No Firebase, no
 * DOM: the test suite loads it in node.
 *
 *   adminEmailFor     the login box takes a USERNAME or an email. A username
 *                     becomes `<name>@ADMIN_EMAIL_DOMAIN`: an admin account is
 *                     an ordinary Firebase Authentication account created by
 *                     hand in the console with that address. Being signed in
 *                     proves nothing on its own — the rules still demand an
 *                     `admins/{uid}` document for every admin read and write.
 *   tableDiagnostics  health checks for a multiplayer lobby table
 *                     (Firestore `multiplayer_tables`), with presence.
 *   roomDiagnostics   health checks for a live game room (the RTDB
 *                     `gameRooms/{id}` node) — the 52-card invariant, a turn
 *                     held by a seat that cannot act, a contest that never
 *                     closed, a host who is gone.
 *
 * Every finding is { level: 'error' | 'warn' | 'info', code, text } — the
 * text is Turkish because the admin page is the operator's tool.
 */
import { isBotSeat, realCount, TURN_TIMEOUT_MS } from './slapOutcome.js';
import { getRankName, getSuitSymbol } from './ruleDoc.js';

export const ADMIN_EMAIL_DOMAIN = 'admin.ers-card-game.web.app';
export const STALE_WAITING_MS = 30 * 60 * 1000;     // a lobby nobody started
export const STALE_PLAYING_MS = 2 * 60 * 60 * 1000;  // a match that never ended
export const TURN_STUCK_MS = TURN_TIMEOUT_MS + 10000; // the timer should have fired by now
export const CONTEST_STUCK_MS = 5000;               // fairSlap's own stale limit
export const FINISHED_LINGER_MS = 5 * 60 * 1000;

/** A username (letters, digits, `. _ -`) or an email → the address to sign in with. */
export function adminEmailFor(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    if (raw.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw.toLowerCase() : null;
    if (!/^[A-Za-z0-9._-]{2,40}$/.test(raw)) return null;
    return `${raw.toLowerCase()}@${ADMIN_EMAIL_DOMAIN}`;
}

/**
 * INJECTION GUARD for every id that becomes part of a database path.
 * There is no SQL here — Firestore and RTDB queries are parameterised
 * (`where('username', '==', x)` never splices text into a query). The
 * equivalent risk is PATH injection: an id carrying `/`, `.`, `#`, `$`, `[`
 * or `]` would address a different node (`presence/${uid}` with
 * uid = "x/../admins" is another path). Table data is written by players, so
 * every id read out of it goes through this before it touches a path.
 * Firebase uids, table codes, room ids and push ids all fit this alphabet.
 */
export function safeId(id) {
    const s = String(id === null || id === undefined ? '' : id);
    return /^[A-Za-z0-9_-]{1,128}$/.test(s) ? s : null;
}

/** RTDB returns arrays with holes as objects; give back a plain dense array. */
export function asList(x) {
    if (Array.isArray(x)) return x.filter(v => v !== null && v !== undefined);
    if (x && typeof x === 'object') return Object.keys(x).sort((a, b) => Number(a) - Number(b)).map(k => x[k]).filter(v => v !== null && v !== undefined);
    return [];
}

/** Firestore Timestamp, millis, or ISO string → millis (or null). */
export function toMillis(t) {
    if (t === null || t === undefined) return null;
    if (typeof t === 'number') return t;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.seconds === 'number') return t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1e6);
    const n = Date.parse(t);
    return Number.isFinite(n) ? n : null;
}

/** "12 sn", "4 dk", "3 sa", "2 gün" — or "—". */
export function formatAge(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} sn`;
    if (s < 3600) return `${Math.floor(s / 60)} dk`;
    if (s < 86400) return `${Math.floor(s / 3600)} sa`;
    return `${Math.floor(s / 86400)} gün`;
}

export function cardLabel(c) {
    if (!c || typeof c !== 'object') return '?';
    return `${getRankName(c.rank)}${getSuitSymbol(c.suit)}${c.ghost ? '👻' : ''}`;
}

/** A presence node is a string ("online"/"offline") or an object carrying a ping. */
export function presenceState(p) {
    if (p === 'online' || p === 'offline') return p;
    if (p && typeof p === 'object') return p.status || (p.ping ? 'online' : 'unknown');
    return 'unknown';
}

const finding = (level, code, text) => ({ level, code, text });
const LEVEL_ORDER = { error: 0, warn: 1, info: 2 };
const sortFindings = (f) => f.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

/**
 * A lobby table (Firestore). `presence` maps uid → presence node; `mirror` is
 * the RTDB `lobbyRooms/{id}` node when it could be read (else undefined).
 */
export function tableDiagnostics(table, { presence = {}, now = Date.now(), mirror } = {}) {
    const out = [];
    const t = table || {};
    const status = t.gameState && t.gameState.status;
    const players = asList(t.players);
    const humans = players.filter(p => p && !isBotSeat(p));
    const ids = Object.keys(t.playerIds || {});
    const age = toMillis(t.createdAt) !== null ? now - toMillis(t.createdAt) : null;

    if (!t.hostId || !ids.includes(t.hostId)) out.push(finding('error', 'host-unseated', 'Ev sahibi oturan oyuncular arasında değil — masa kimsenin yönetemeyeceği durumda.'));
    else if (presenceState(presence[t.hostId]) === 'offline' && status !== 'finished') out.push(finding('warn', 'host-offline', 'Ev sahibi çevrimdışı. Oyun sürüyorsa host devri (failover) bekleniyor.'));

    const forged = players.filter(p => p && !safeId(p.uid));
    if (forged.length) out.push(finding('error', 'bad-id', `${forged.length} koltukta geçersiz kimlik var (ör. "/" ya da ".." içeriyor) — istemci tarafında sahtelenmiş veri olabilir. Bu kimlikler hiçbir veritabanı yoluna sokulmaz.`));

    const seen = new Set();
    for (const p of humans) {
        if (seen.has(p.uid)) out.push(finding('error', 'double-seat', `${p.name || p.uid} iki koltukta oturuyor.`));
        seen.add(p.uid);
    }
    const humanIds = humans.map(p => p.uid);
    const missing = humanIds.filter(u => !ids.includes(u));
    const extra = ids.filter(u => !humanIds.includes(u));
    if (missing.length) out.push(finding('warn', 'ids-missing', `playerIds eksik: ${missing.length} oyuncu kurallara göre masaya yazamaz.`));
    if (extra.length) out.push(finding('warn', 'ids-extra', `playerIds fazla: ${extra.length} kimlik artık koltukta değil ama masaya yazabiliyor.`));

    const online = humans.filter(p => p.status !== 'disconnected' && presenceState(presence[p.uid]) !== 'offline');
    if (status === 'playing') {
        if (!t.gameState.roomId) out.push(finding('error', 'no-room', 'Masa "oynanıyor" ama oda kimliği yok — oyuncular odaya gidemez.'));
        if (!online.length) out.push(finding('error', 'ghost-table', 'Oynanıyor görünüyor ama çevrimiçi hiçbir insan yok (hayalet masa).'));
        if (age !== null && age > STALE_PLAYING_MS) out.push(finding('warn', 'stale-playing', `Masa ${formatAge(age)} önce açıldı ve hâlâ oynanıyor görünüyor.`));
    }
    if (status === 'waiting') {
        if (age !== null && age > STALE_WAITING_MS) out.push(finding('info', 'stale-waiting', `${formatAge(age)} boyunca başlatılmamış bekleyen masa.`));
        const dropped = humans.filter(p => p.status === 'disconnected');
        if (dropped.length) out.push(finding('info', 'waiting-dropped', `Bekleme odasında ${dropped.length} bağlantısı kopmuş oyuncu var.`));
    }
    const count = t.gameState && t.gameState.playerCount;
    const liveCount = humans.filter(p => p.status !== 'disconnected').length;
    if (Number.isInteger(count) && count !== liveCount) out.push(finding('info', 'count-drift', `playerCount ${count}, gerçekte ${liveCount} bağlı insan.`));

    if (mirror === null) out.push(finding('warn', 'mirror-missing', 'RTDB lobi aynası (lobbyRooms) yok — diğer oyuncular anlık geçiş almaz.'));
    else if (mirror && mirror.gameState) {
        if (mirror.gameState.status !== status) out.push(finding('warn', 'mirror-status', `Lobi aynası "${mirror.gameState.status}", Firestore "${status}" diyor.`));
        if ((mirror.gameState.roomId || null) !== ((t.gameState && t.gameState.roomId) || null)) out.push(finding('warn', 'mirror-room', 'Lobi aynası farklı bir odayı gösteriyor.'));
    }
    return sortFindings(out);
}

/**
 * A live game room (RTDB `gameRooms/{id}`), as the console exports it or as
 * the live listener hands it over. `now` is SERVER time (lastPlayTime is).
 */
export function roomDiagnostics(room, { now = Date.now(), presence = {} } = {}) {
    const out = [];
    const r = room || {};
    const players = asList(r.players);
    const pile = asList(r.pile), burn = asList(r.burnPile);

    if (players.length !== 4) out.push(finding('error', 'seat-count', `Odada ${players.length} koltuk var, 4 olmalı.`));

    const inHands = players.reduce((a, p) => a + realCount(asList(p && p.cards)), 0);
    const total = inHands + realCount(pile) + realCount(burn);
    if (total !== 52) out.push(finding('error', 'card-count', `Gerçek kart sayısı ${total} (eller ${inHands}, yığın ${realCount(pile)}, yanan ${realCount(burn)}) — 52 olmalı. Kart kaybı ya da çoğalması.`));

    const forged = players.filter(p => p && !safeId(p.uid));
    if (forged.length) out.push(finding('error', 'bad-id', `${forged.length} koltukta geçersiz kimlik var — istemci tarafında sahtelenmiş veri olabilir.`));
    const humans = players.filter(p => p && !isBotSeat(p));
    const ids = Object.keys(r.playerIds || {});
    for (const p of humans) if (!ids.includes(p.uid)) out.push(finding('warn', 'ids-missing', `${p.name || p.uid} playerIds'te yok — hamleleri kurallarca reddedilir.`));
    if (!r.hostId || !ids.includes(r.hostId)) out.push(finding('warn', 'host-unseated', 'Ev sahibi odada oturmuyor; botları ve süreyi kim yönetiyor belirsiz.'));
    else {
        const host = players.find(p => p && p.uid === r.hostId);
        if ((host && host.status === 'disconnected') || presenceState(presence[r.hostId]) === 'offline') out.push(finding('warn', 'host-offline', 'Ev sahibi bağlı değil: botlar ve tur süresi durur, host devri gerekir.'));
    }
    const liveHumans = humans.filter(p => p.status !== 'disconnected');
    if (!r.gameOver && humans.length && !liveHumans.length) out.push(finding('error', 'ghost-room', 'Bağlı hiçbir insan yok ama oyun bitmemiş (hayalet oda).'));

    const lingering = humans.filter(p => p.status === 'disconnected' && toMillis(p.disconnectedAt) !== null && now - toMillis(p.disconnectedAt) > 30000);
    if (lingering.length && !r.gameOver) out.push(finding('warn', 'not-botted', `${lingering.length} oyuncu 30 sn'den uzun süredir kopuk ve hâlâ bota çevrilmemiş.`));

    if (!r.gameOver) {
        const a = r.activePlayerId;
        if (!Number.isInteger(a) || a < 0 || a >= players.length) out.push(finding('error', 'turn-range', `Sıra geçersiz bir koltukta (${a}).`));
        else {
            const seat = players[a];
            const hand = realCount(asList(seat && seat.cards));
            const inChallenge = r.challenge && r.challenge.active;
            if (hand === 0 && !inChallenge) out.push(finding('error', 'turn-empty', `Sıra kartı olmayan koltukta (${a}: ${seat && seat.name}). Oyun ilerleyemez.`));
        }
        const last = toMillis(r.lastPlayTime);
        if (last !== null && now - last > TURN_STUCK_MS) out.push(finding('warn', 'turn-stuck', `Son hamle ${formatAge(now - last)} önce — ${TURN_TIMEOUT_MS / 1000} sn'lik tur süresi çoktan dolmuş olmalıydı.`));
        const c = r.challenge || {};
        if (c.active && !(Number(c.chancesLeft) > 0)) out.push(finding('warn', 'challenge-spent', 'Meydan okuma açık ama kalan hak yok — çözülmemiş.'));
    } else {
        const done = toMillis(r.lastPlayTime);
        if (done !== null && now - done > FINISHED_LINGER_MS) out.push(finding('info', 'finished-linger', `Oyun ${formatAge(now - done)} önce bitti, oda hâlâ duruyor.`));
    }
    const contest = r.slapContest;
    if (contest && Number(contest.deadline) && now > Number(contest.deadline) + CONTEST_STUCK_MS) out.push(finding('error', 'contest-stuck', `Şaplak yarışı ${formatAge(now - Number(contest.deadline))} önce kapanmalıydı — kart oynamak kilitli.`));
    if (r.status === 'abandoned') out.push(finding('info', 'abandoned', 'Oda terk edildi olarak işaretli.'));
    return sortFindings(out);
}

/**
 * THE ROOM FEED (v3.22.2). What happened in a room between two snapshots of
 * it, in the operator's words: "Ayşe yığını aldı (şaplak, 7 kart)", "Ali'nin
 * bağlantısı koptu", "Oyun bitti — kazanan Ayşe". Derived the same way
 * firebaseSync.js derives the table's own animations — by comparing hands,
 * pile and burn pile — so it needs no extra writes from the players and adds
 * no path anybody could forge a story into. `prev` undefined = the room is new
 * to the page; `next` null = the room is gone.
 *
 * Each event: { at, kind, level: 'info'|'good'|'warn'|'bad', icon, text, seat }.
 * `kind` 'card' (one card played) is the noisy one; the page hides it by default.
 */
const nameOfSeat = (room, i) => {
    const p = asList(room && room.players)[i];
    return (p && p.name) || `Koltuk ${i}`;
};
const handSize = (p) => realCount(asList(p && p.cards));

export function roomEvents(prev, next, at = Date.now()) {
    const ev = [];
    const push = (kind, level, icon, text, seat = null) => ev.push({ at, kind, level, icon, text, seat });

    if (!prev && !next) return ev;
    if (!prev) {
        const ps = asList(next.players);
        const bots = ps.filter(isBotSeat).length;
        push('room-open', 'info', '🚪', `Oda açıldı — ${ps.length - bots} insan, ${bots} bot${next.god ? `, tanrı: ${next.god.id || next.god}` : ''}`);
        return ev;
    }
    if (!next) { push('room-closed', 'info', '🧹', 'Oda kapandı (silindi)'); return ev; }

    const a = asList(prev.players), b = asList(next.players);
    // Seats: connection, bot takeover, host.
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const was = a[i], now = b[i];
        if (!was || !now) continue;
        if (!isBotSeat(was) && isBotSeat(now)) push('bot-takeover', 'warn', '🤖', `${was.name || `Koltuk ${i}`} koltuğunu bota devretti`, i);
        else if (was.status !== 'disconnected' && now.status === 'disconnected') push('disconnect', 'bad', '🔌', `${now.name || `Koltuk ${i}`} bağlantısı koptu`, i);
        else if (was.status === 'disconnected' && now.status !== 'disconnected') push('reconnect', 'good', '🔁', `${now.name || `Koltuk ${i}`} geri bağlandı`, i);
    }
    if (prev.hostId !== next.hostId && next.hostId) {
        const i = b.findIndex(p => p && p.uid === next.hostId);
        push('host', 'warn', '👑', `Ev sahibi değişti → ${i >= 0 ? nameOfSeat(next, i) : 'bilinmeyen'}`, i >= 0 ? i : null);
    }

    // Cards: who played, who took the pile, who burned.
    const pileA = realCount(asList(prev.pile)), pileB = realCount(asList(next.pile));
    const burnA = realCount(asList(prev.burnPile)), burnB = realCount(asList(next.burnPile));
    const delta = b.map((p, i) => handSize(p) - handSize(a[i]));
    if (pileA > 0 && pileB === 0) {
        let w = -1, best = 0;
        delta.forEach((d, i) => { if (d > best) { best = d; w = i; } });
        const why = next.lastWinReason === 'challenge' ? 'meydan okuma' : next.lastWinReason === 'slap' ? 'şaplak' : (next.lastWinReason || 'yığın');
        if (w >= 0) push('pile-won', 'good', next.lastWinReason === 'slap' ? '🖐' : '⚔', `${nameOfSeat(next, w)} yığını aldı (${why}, ${best} kart)`, w);
    } else if (burnB > burnA) {
        const i = delta.findIndex(d => d < 0);
        const why = next.lastBurnReason === 'timeout' ? 'süre doldu' : 'yanlış şaplak';
        push('burn', 'bad', '🔥', `${i >= 0 ? nameOfSeat(next, i) : 'Bir oyuncu'}: ${why} — ${burnB - burnA} kart yandı`, i >= 0 ? i : null);
    } else if (pileB === pileA + 1) {
        const i = delta.findIndex(d => d === -1);
        const top = asList(next.pile).slice(-1)[0];
        if (i >= 0) push('card', 'info', '🂠', `${nameOfSeat(next, i)} kart oynadı: ${cardLabel(top)}`, i);
    }

    // Slap contest opened, a challenge began.
    if (!prev.slapContest && next.slapContest) {
        const claims = asList(next.slapContest.claims);
        const c = claims[0];
        push('slap', 'info', '✋', c ? `${nameOfSeat(next, c.index)} şaplak attı (${Math.round(c.reactionMs)} ms) — yarış açıldı` : 'Şaplak yarışı açıldı');
    }
    const ca = prev.challenge || {}, cb = next.challenge || {};
    if (!ca.active && cb.active) push('challenge', 'info', '⚔', `Meydan okuma: ${nameOfSeat(next, cb.attackerId)} → ${nameOfSeat(next, cb.defenderId)} (${cb.chancesLeft} hak)`);

    // Eliminations, then the end.
    b.forEach((p, i) => {
        if (handSize(a[i]) > 0 && handSize(p) === 0 && !(pileA > 0 && pileB === 0)) push('out', 'warn', '💀', `${nameOfSeat(next, i)} kartsız kaldı`, i);
    });
    if (!prev.gameOver && next.gameOver) {
        const w = next.winnerIndex;
        push('game-over', 'good', '🏆', Number.isInteger(w) && w >= 0 ? `Oyun bitti — kazanan ${nameOfSeat(next, w)}` : 'Oyun bitti — berabere', Number.isInteger(w) && w >= 0 ? w : null);
    }
    if (prev.status !== 'abandoned' && next.status === 'abandoned') push('abandoned', 'bad', '🏳', 'Oda terk edildi');
    return ev;
}

/** A short one-line summary of a finding list: "2 hata · 1 uyarı" or "Sağlıklı". */
export function summarize(findings) {
    const n = { error: 0, warn: 0, info: 0 };
    for (const f of findings || []) n[f.level]++;
    const parts = [];
    if (n.error) parts.push(`${n.error} hata`);
    if (n.warn) parts.push(`${n.warn} uyarı`);
    if (n.info) parts.push(`${n.info} not`);
    return { ...n, text: parts.length ? parts.join(' · ') : 'Sağlıklı', worst: n.error ? 'error' : n.warn ? 'warn' : n.info ? 'info' : 'ok' };
}

/** CSV for the audit log; every cell quoted, formula-leading cells defused. */
export function toCsv(rows) {
    const cell = (v) => {
        let s = v === null || v === undefined ? '' : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // spreadsheet formula injection
        return '"' + s.replace(/"/g, '""') + '"';
    };
    return rows.map(r => r.map(cell).join(',')).join('\r\n');
}

// ─── v3.22.3: cleanup and the online list (council ERS-30) ─────────────────
// These mirror the server rules exactly; the rules decide, the page only
// avoids offering a button the server would refuse. Tested against each other:
//   · a room is dead           → database.rules.json gameRooms (ROOM_STALE_MS)
//   · a table may be closed    → firestore.rules adminMayClose()
//                                (finished · waiting > STALE_WAITING_MS · any > STALE_PLAYING_MS)
//   · a lobby mirror may go    → database.rules.json lobbyRooms (room dead, or host offline)
export const ROOM_DEAD_MS = 15 * 60 * 1000;

/** Over, or nobody has moved in it for 15 minutes (a live room moves every <= 15 s). */
export function roomIsDead(room, now = Date.now()) {
    if (!room) return true;
    if (room.gameOver === true) return true;
    return typeof room.lastPlayTime === 'number' && room.lastPlayTime < now - ROOM_DEAD_MS;
}

/**
 * Can the admin close this table, and what goes with it?
 *   room        the gameRooms node when the table names one (undefined = not known)
 *   hostOnline  whether online/{hostId} has an entry
 * → { ok, reason, room: roomId to delete or null }
 */
export function tableClosePlan(table, { now = Date.now(), room, hostOnline = false } = {}) {
    const t = table || {};
    const status = t.gameState && t.gameState.status;
    const created = toMillis(t.createdAt);
    const age = created === null ? null : now - created;
    const roomId = t.gameState && typeof t.gameState.roomId === 'string' ? t.gameState.roomId : null;
    const old = status === 'finished'
        || (status === 'waiting' && age !== null && age > STALE_WAITING_MS)
        || (age !== null && age > STALE_PLAYING_MS);
    if (!old) return { ok: false, reason: 'young', room: null };
    // Council ERS-30 O1: Firestore cannot see the room, so the page must. Unknown is not dead.
    if (roomId && room === undefined) return { ok: false, reason: 'room-unknown', room: null };
    if (roomId && room !== null && !roomIsDead(room, now)) return { ok: false, reason: 'room-live', room: null };
    if (status !== 'playing' && hostOnline) return { ok: false, reason: 'host-online', room: null };
    return { ok: true, reason: null, room: roomId && room ? roomId : null };
}

export const CLOSE_REASON = Object.freeze({
    young: 'Masa henüz ölü sayılmıyor (bekleyen 30 dk, diğerleri 2 saat dolmadı).',
    'room-live': 'Odası hâlâ canlı — içinde oynanan bir maç var.',
    'room-unknown': 'Canlı odalar okunamadığı için odanın durumu bilinmiyor.',
    'host-online': 'Ev sahibi şu an bağlı — bekleme odasında olabilir.'
});

/** What the page says for each activity word the rules allow (ONLINE_ACTIVITIES). */
export const ACTIVITY_LABEL = Object.freeze({
    menu: '🏠 menüde', bots: '🤖 bot maçında', daily: '📅 günlük meydan okumada',
    legends: '⚱ efsaneler modunda', match: '🔴 multiplayer maçında'
});

/**
 * online/{uid}/{conn} → one row per connected account, newest first.
 * `activity` is the word from the tab that changed most recently.
 * `tables` (id → table) and `rooms` (id → room) place each player; `names` is uid → name.
 */
export function onlineRows(online, { tables = new Map(), rooms = new Map(), names = new Map() } = {}) {
    const rows = [];
    for (const [uid, conns] of Object.entries(online || {})) {
        if (!safeId(uid) || !conns || typeof conns !== 'object') continue;
        // A tab is { at, t, s } (v3.22.4) or a bare number (a v3.22.3 tab still open).
        const tabs = Object.values(conns).map(v => (typeof v === 'number' ? { at: v, t: v, s: null, g: null }
            : v && typeof v === 'object' && typeof v.at === 'number'
                ? { at: v.at, t: typeof v.t === 'number' ? v.t : v.at, s: ACTIVITY_LABEL[v.s] ? v.s : null, g: v.g && typeof v.g === 'object' ? v.g : null }
                : null)).filter(Boolean);
        if (!tabs.length) continue;
        const latest = tabs.reduce((a, b) => (b.t > a.t ? b : a));
        let table = null, room = null, seatName = null;
        for (const t of tables.values()) {
            const st = t.gameState && t.gameState.status;
            if (st === 'finished') continue;
            const seat = asList(t.players).find(p => p && p.uid === uid);
            if (seat) { table = t.id; room = (t.gameState && t.gameState.roomId) || null; seatName = typeof seat.name === 'string' ? seat.name : null; break; }
        }
        if (!room) for (const [id, r] of rooms) if (!r.gameOver && r.playerIds && r.playerIds[uid]) { room = id; break; }
        rows.push({ uid, name: names.get(uid) || seatName || null, tabs: tabs.length, since: Math.min(...tabs.map(x => x.at)),
            activity: latest.s, activityAt: latest.t, match: latest.g, table, room });
    }
    return rows.sort((a, b) => b.since - a.since);
}

/**
 * v3.22.5 — the three groups the online list is split into. Multiplayer is
 * anything with a table or a room (a waiting room counts: the player is in the
 * multiplayer flow), or a tab that says it is in a match. Solo is a bot match,
 * the Daily Challenge or Legends: they run in the browser and leave NO table or
 * room behind, which is why they never appear under Masalar / Canlı odalar.
 */
export const ONLINE_CATEGORIES = Object.freeze([
    ['multiplayer', '🔴 Multiplayer', 'masada, bekleme odasında ya da maçta'],
    ['solo', '🤖 Tek oyunculu', 'bot maçı, günlük meydan okuma, efsaneler — sunucuda masa/oda açmaz'],
    ['menu', '🏠 Menüde', 'oyunda değil (ya da eski sürüm sekmesi)']
]);
export function onlineCategory(row) {
    if (!row) return 'menu';
    if (row.table || row.room || row.activity === 'match') return 'multiplayer';
    if (row.activity === 'bots' || row.activity === 'daily' || row.activity === 'legends') return 'solo';
    return 'menu';
}

/**
 * `.info/serverTimeOffset` is server time MINUS this device's time. It is not
 * a delay: nothing waits on it, and serverNow() already corrects for it. The
 * chip says which way the device clock is off, so it is never read as lag.
 */
export function clockNote(offsetMs) {
    const o = Math.round(Number(offsetMs) || 0);
    if (Math.abs(o) < 500) return { text: '🕒 saat uyumlu', kind: 'is-good' };
    const sec = (Math.abs(o) / 1000).toFixed(1).replace('.', ',');
    return { text: `🕒 cihaz saati ${sec} sn ${o < 0 ? 'ileri' : 'geri'}`, kind: Math.abs(o) > 5000 ? 'is-bad' : '' };
}

/** Round trip of one tiny server read — the delay the admin actually feels. */
export function latencyNote(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return { text: '📶 gecikme —', kind: '' };
    const v = Math.round(ms);
    return { text: `📶 gecikme ${v} ms`, kind: v < 150 ? 'is-good' : v < 400 ? '' : 'is-bad' };
}

/**
 * v3.22.5 — health checks for a solo match summary (online/{uid}/{conn}/g).
 * The admin cannot see the cards, only counts, so these are the breakages a
 * count can show: a card gone missing, a match that stopped moving, a page
 * that is throwing errors. Legends deal ghost cards and a god, so the 52 check
 * is skipped there.
 */
export const SOLO_STALL_MS = 45 * 1000;   // the slowest turn timer is 20 s; bots move well within it
export function soloDiagnostics(g, activity, now = Date.now()) {
    const out = [];
    if (!g || typeof g !== 'object') return out;
    const hands = asList(g.h).map(n => Number(n) || 0);
    const total = hands.reduce((a, n) => a + n, 0) + (Number(g.p) || 0) + (Number(g.b) || 0);
    if (activity !== 'legends' && total !== 52) out.push(finding('error', 'card-count', `Kart sayısı ${total} — 52 olmalı. Bir kart kayboldu ya da çoğaldı.`));
    if (g.o !== true && typeof g.u === 'number' && now - g.u > SOLO_STALL_MS) out.push(finding('warn', 'stalled', `${formatAge(now - g.u)} boyunca maçta hiçbir şey değişmedi — oyun donmuş olabilir (ya da sekme arka planda).`));
    if (Number(g.e) > 0) out.push(finding('warn', 'page-errors', `Bu maç sırasında sekmede ${g.e} hata oluştu.`));
    const turn = Number(g.a);
    if (g.o !== true && turn >= 0 && turn <= 3 && hands[turn] === 0 && total > 0) out.push(finding('warn', 'turn-empty', `Sıra kartı olmayan koltukta (#${turn}).`));
    if (g.o === true) out.push(finding('info', 'over', 'Maç bitti; oyuncu sonuç ekranında.'));
    return sortFindings(out);
}

/** One line an admin can read at a glance: hands, pile, turn, moves. */
export function soloSummary(g) {
    if (!g || typeof g !== 'object') return '';
    return `kartlar ${asList(g.h).map(n => Number(n) || 0).join('·')} · yığın ${Number(g.p) || 0} · yanık ${Number(g.b) || 0} · sıra #${Number(g.a)} · ${Number(g.n) || 0} hamle`;
}

/** Lobby mirrors (RTDB lobbyRooms) with no Firestore table behind them. */
export function orphanLobbies(lobbies, tables) {
    return Object.keys(lobbies || {}).filter(id => safeId(id) && !(tables && tables.has(id)));
}

/** The RTDB lobby rule, mirrored: may this mirror be deleted by an admin? */
export function lobbyDeletable(lobby, { now = Date.now(), rooms = new Map(), online = {} } = {}) {
    if (!lobby) return false;
    const gs = lobby.gameState || {};
    const roomId = typeof gs.roomId === 'string' ? gs.roomId : null;
    if (roomId && rooms.has(roomId) && !roomIsDead(rooms.get(roomId), now)) return false;
    if (gs.status === 'playing') return true;
    const host = lobby.hostId;
    return !!host && !(online && online[host]);
}
