/**
 * moderationCore.js — the pure half of the v3.24.0 admin powers (council
 * ERS-36). No Firebase, no DOM: the test suite loads it in node, and every
 * bound here is MIRRORED in firestore.rules (block 7) — test section 93 fails
 * the build if the two drift.
 *
 *   action log     every admin power beyond coins commits with an immutable
 *                  /admin_actions record naming a KIND and an exact TARGET.
 *                  targetFor() is the only place a target string is built,
 *                  and it builds one only from ids that pass safeId().
 *   bans           a suspension with an end date (at most BAN_MAX_DAYS). It
 *                  closes multiplayer tables and the score boards; coins and
 *                  solo play stay open.
 *   announcement   plain text, one per language, no links, at most
 *                  ANN_MAX_DAYS. A stolen admin password must not be able to
 *                  put a phishing link in front of every player.
 *   match log      what a finished multiplayer match leaves behind: who sat
 *                  where, who won, how long, how many dropped. Kept 30 days.
 *   error reports  the last five page errors of a signed-in player, as text
 *                  with no URLs, at most one write per 10 s.
 */
import { safeId } from './adminCore.js';
import { isBotSeat, realCount } from './slapOutcome.js';

export const ADMIN_ACTION_KINDS = Object.freeze([
    'close-table', 'delete-room', 'delete-lobby', 'delete-daily', 'delete-leaderboard',
    'ban', 'unban', 'announce', 'clear-announcement', 'delete-match', 'clear-errors'
]);
export const REASON_MIN = 3;
export const REASON_MAX = 120;
export const DETAIL_MAX = 200;

/** Human words for the audit page. */
export const ACTION_LABEL = Object.freeze({
    'close-table': '🗑 masa kapatıldı', 'delete-room': '🗑 oda silindi', 'delete-lobby': '🗑 lobi kaydı silindi',
    'delete-daily': '🧹 günlük skor silindi', 'delete-leaderboard': '🧹 liderlik kaydı silindi',
    ban: '⛔ askıya alındı', unban: '✅ askı kaldırıldı', announce: '📣 duyuru yayınlandı',
    'clear-announcement': '📣 duyuru kaldırıldı', 'delete-match': '🗑 maç kaydı silindi', 'clear-errors': '🐞 hata raporu temizlendi'
});

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The exact target string the rules compare against. null when any part is
 * not a clean id — a hostile id never becomes part of a path or a log target.
 */
export function targetFor(kind, a, b) {
    const id = (x) => safeId(x);
    switch (kind) {
        case 'close-table': return id(a) ? `multiplayer_tables/${a}` : null;
        case 'delete-room': return id(a) ? `rtdb:gameRooms/${a}` : null;
        case 'delete-lobby': return id(a) ? `rtdb:lobbyRooms/${a}` : null;
        case 'delete-daily': return typeof a === 'string' && DATE_KEY.test(a) && id(b) ? `daily_challenges/${a}/scores/${b}` : null;
        case 'delete-leaderboard': return id(a) ? `leaderboard/${a}` : null;
        case 'ban': case 'unban': return id(a) ? `bans/${a}` : null;
        case 'announce': case 'clear-announcement': return 'config/announcement';
        case 'delete-match': return id(a) ? `match_log/${a}` : null;
        case 'clear-errors': return id(a) ? `client_errors/${a}` : null;
        default: return null;
    }
}

export function validReason(r) {
    return typeof r === 'string' && r.trim().length >= REASON_MIN && r.length <= REASON_MAX;
}

// ── bans ────────────────────────────────────────────────────────────────────
export const BAN_MAX_DAYS = 30;
export const BAN_DAYS = Object.freeze([1, 3, 7, 30]);
const DAY = 86400000;

export function toMs(t) {
    if (t === null || t === undefined) return null;
    if (typeof t === 'number') return t;
    if (t instanceof Date) return t.getTime();
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.seconds === 'number') return t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1e6);
    return null;
}
/** A suspension counts until its end date — never after. */
export function banActive(ban, now = Date.now()) {
    const until = ban ? toMs(ban.until) : null;
    return until !== null && until > now;
}
/**
 * The end date to write. A minute short of the full span: `now` is this
 * device's estimate of server time, and the rule compares against the real
 * one — a 30-day ban computed a few ms fast would be refused at the edge.
 */
export const EDGE_MARGIN_MS = 60 * 1000;
export function banUntilFor(days, now = Date.now()) {
    const d = Math.max(1, Math.min(BAN_MAX_DAYS, Math.trunc(Number(days) || 0)));
    return now + d * DAY - EDGE_MARGIN_MS;
}
/** Same margin for the announcement's end (at most ANN_MAX_DAYS). */
export function annUntilFor(hours, now = Date.now()) {
    const hh = Math.max(1, Math.min(ANN_MAX_DAYS * 24, Math.trunc(Number(hours) || 0)));
    return now + hh * 3600000 - EDGE_MARGIN_MS;
}

// ── announcement ────────────────────────────────────────────────────────────
export const ANN_LANGS = Object.freeze(['tr', 'en', 'de', 'ru']);
export const ANN_LEVELS = Object.freeze(['info', 'warn']);
export const ANN_TEXT_MIN = 3;
export const ANN_TEXT_MAX = 160;
export const ANN_MAX_DAYS = 7;
export const ANN_HOURS = Object.freeze([1, 6, 24, 72, 168]);
// MIRRORED in firestore.rules noLink(): the same two patterns, full-string,
// with look-alike '@' and dots. A text must also be ONE line — RE2's '.' does
// not cross a newline, so the rule would miss a link on a second line.
export const ANN_LINK_PATTERNS = Object.freeze(['.*(://|[wW][wW][wW]|[@＠]|[hH][tT][tT][pP]).*', '.*[a-zA-Z0-9-][.․．。﹒][a-zA-Z]{2,}.*']);
const LINK_RES = ANN_LINK_PATTERNS.map(p => new RegExp('^' + p + '$', 'u'));

/** Why a text would be refused: null when it is fine. */
export function annTextProblem(t) {
    if (typeof t !== 'string') return 'type';
    if (t.length < ANN_TEXT_MIN) return 'short';
    if (t.length > ANN_TEXT_MAX) return 'long';
    if (/[\n\r]/.test(t)) return 'lines';
    if (LINK_RES.some(re => re.test(t))) return 'link';
    return null;
}

/**
 * What the menu shows: the player's language, else English, else Turkish,
 * else any. null when there is nothing live.
 */
export function pickAnnouncement(ann, lang, now = Date.now()) {
    if (!ann || typeof ann !== 'object') return null;
    const until = toMs(ann.until);
    if (until === null || until <= now) return null;
    const order = [lang, 'en', 'tr', ...ANN_LANGS];
    const code = order.find(l => ANN_LANGS.includes(l) && typeof ann[l] === 'string' && ann[l].length > 0);
    if (!code) return null;
    return { text: ann[code], lang: code, level: ANN_LEVELS.includes(ann.level) ? ann.level : 'info', id: String(toMs(ann.at) || until) };
}

// ── match log ───────────────────────────────────────────────────────────────
export const MATCH_KEEP_DAYS = 30;
const NAME_OK = /^[\p{L}\p{N} _.\-]{1,24}$/u;

/** A name the rules' validName accepts: disallowed characters become '_'. */
export function logName(n) {
    const s = String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '_').slice(0, 24).trim();
    return NAME_OK.test(s) ? s : 'Oyuncu';
}
const asArr = (x) => (Array.isArray(x) ? x : Object.values(x || {}));

/**
 * The record a finished room leaves (firestore.rules match_log). endedAt is
 * the server's; expireAt is 30 days on the client's clock (the rule allows
 * 29–31, so a skewed clock still writes). null when the room is not a
 * finished multiplayer match this uid played in.
 */
export function matchRecordFromRoom(room, roomId, uid, now = Date.now()) {
    const m = typeof roomId === 'string' ? roomId.match(/^room_([A-Z0-9]{4,8})_(\d{10,14})$/) : null;
    if (!m || !room || room.gameOver !== true) return null;
    const seats = asArr(room.players).filter(Boolean).slice(0, 4);
    if (seats.length < 2) return null;
    const playerIds = Object.keys(room.playerIds || {}).filter(safeId).slice(0, 4);
    if (!playerIds.includes(uid)) return null;
    const winner = Number.isInteger(room.winnerId) ? room.winnerId : Number.isInteger(room.winnerIndex) ? room.winnerIndex : -1;
    return {
        roomId,
        tableId: m[1],
        players: seats.map(p => ({
            uid: isBotSeat(p) ? '' : (safeId(p.uid) || ''),
            name: logName(p.name),
            bot: isBotSeat(p),
            cards: Math.min(60, realCount(asArr(p.cards)))
        })),
        playerIds,
        winner: winner >= -1 && winner <= 3 ? winner : -1,
        startedAt: Number(m[2]),
        expireAt: new Date(now + MATCH_KEEP_DAYS * DAY),
        // A person who dropped: still seated but disconnected, or seated at
        // the start (playerIds) and handed to a bot since.
        disconnects: Math.min(4, playerIds.filter(u => !seats.some(p => p.uid === u && p.status !== 'disconnected')).length),
        god: typeof room.god === 'string' ? room.god.slice(0, 24) : (room.god && typeof room.god.id === 'string' ? room.god.id.slice(0, 24) : null),
        houseRules: typeof room.houseRules === 'string' ? room.houseRules.slice(0, 120) : ''
    };
}

// ── error reports ───────────────────────────────────────────────────────────
export const ERR_SLOTS = 5;
export const ERR_MSG_MAX = 200;
export const ERR_SRC_MAX = 80;
export const ERR_MIN_GAP_MS = 11000;   // the rule allows one write per 10 s
export const ERR_MODES = Object.freeze(['menu', 'bots', 'daily', 'legends', 'match']);

/**
 * Which errors are ours. Extensions and other origins throw into the page too;
 * "Script error." is the browser hiding a cross-origin one. Neither says
 * anything about this game.
 */
export function shouldReport(message, filename, origin) {
    const m = String(message || '');
    if (!m || m === 'Script error.' || /ResizeObserver loop/.test(m)) return false;
    if (filename && origin && !String(filename).startsWith(origin)) return false;
    return true;
}

/** No URLs, no query strings, bounded: an error report is text about code. */
export function sanitizeError({ message, filename, line, mode, at }) {
    const strip = (s) => String(s || '').replace(/https?:\/\/[^\s)]+/g, (u) => {
        try { return new URL(u).pathname.split('/').pop() || 'url'; } catch (e) { return 'url'; }
    }).replace(/\s+/g, ' ').trim();
    const m = strip(message).slice(0, ERR_MSG_MAX) || 'unknown error';
    let src = '';
    try { src = filename ? new URL(filename).pathname.split('/').pop() : ''; } catch (e) { src = String(filename || '').split('/').pop(); }
    return {
        m,
        src: src.split('?')[0].slice(0, ERR_SRC_MAX),
        line: Math.max(0, Math.min(1000000, Math.trunc(Number(line) || 0))),
        at: Math.trunc(Number(at) || Date.now()),
        mode: ERR_MODES.includes(mode) ? mode : 'menu'
    };
}

/** The ring: the n-th report (1-based) goes to slot e{(n-1) % 5}. */
export function errorSlot(count) {
    return `e${(Math.max(1, Math.trunc(Number(count) || 1)) - 1) % ERR_SLOTS}`;
}

/** The slots of a report doc, newest first. */
export function errorEntries(docData) {
    if (!docData || typeof docData !== 'object') return [];
    const out = [];
    for (let i = 0; i < ERR_SLOTS; i++) {
        const e = docData[`e${i}`];
        if (e && typeof e === 'object' && typeof e.m === 'string') out.push(e);
    }
    return out.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
}
