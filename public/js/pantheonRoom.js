/**
 * pantheonRoom.js — the Table of the Gods in a multiplayer room (v3.18.0).
 *
 * Pure functions over the room object, called INSIDE the same RTDB
 * transactions that award a slap or burn a card (firebaseSync.js). That is
 * the only way every client agrees on the god's life: it changes in the one
 * write that caused it, never in four clients' separate guesses.
 *
 * A room without `god` is untouched: every function returns immediately, so
 * an ordinary table runs exactly the code it ran before.
 *
 * Multiplayer scope, stated: the god's powers fire on the piles it takes by
 * SLAP (as they do offline), Anubis's second burn on wrong slaps, and Ra's
 * noon. Damage comes from every valid slap by another seat — a person's in
 * full, a bot's by half, as offline priests.
 *
 * v3.19.0 — ghost cards: a slap that wounds the god (and leaves it alive)
 * gives it clones of the slapped cards, on top of its hand, in the same
 * write (ghostCards.js; council ERS-20). `godGhosts` stamps it for effects.
 */
import { god, godRules, slapDamage, NINE_LIVES, SET_STEAL, DAMAGE, HERO_SEAT } from './pantheon.js';
import { rulesToKey } from './slapRules.js';
import { ghostClones, addGhosts } from './ghostCards.js';

const isBot = (p) => !!(p && typeof p.uid === 'string' && p.uid.startsWith('bot_'));

/**
 * Seats the god at the last bot seat of a room being dealt. Returns the room
 * fields to write, or null when the table is full of people (no seat for a god).
 */
export function seatGod(godId, roomPlayers, godName) {
    const g = god(godId);
    if (!g) return null;
    let seat = -1;
    roomPlayers.forEach((p, i) => { if (isBot(p)) seat = i; });
    if (seat < 0) return null;
    roomPlayers[seat].name = godName || godId;
    return {
        god: godId,
        godSeat: seat,
        godHp: g.hp,
        godMaxHp: g.hp,
        godHeals: 0,
        godNoon: false,
        godDamage: [0, 0, 0, 0],
        godLastHit: null,
        godGhosts: null,
        houseRules: rulesToKey(godRules(godId))
    };
}

/** Life taken by a slap from `seat`: a person counts as the hero, a bot as a priest. */
export function roomSlapDamage(data, seat, ruleId) {
    if (!data || !data.god || seat === data.godSeat) return 0;
    const p = data.players && data.players[seat];
    return slapDamage(data.god, ruleId, isBot(p) ? 1 : HERO_SEAT);
}

/**
 * After applySlapWin: wound the god, or let the god's slap work its power.
 * `slapped` is the pile as it stood when the slap landed ({pile, indices}).
 */
export function applyGodSlapWin(data, seat, ruleId, now = Date.now(), slapped = null) {
    if (!data || !data.god || data.gameOver) return data;
    const g = god(data.god);
    if (!g) return data;
    if (seat === data.godSeat) {
        if (g.power === 'nineLives' && (data.godHeals || 0) < NINE_LIVES) {
            data.godHeals = (data.godHeals || 0) + 1;
            heal(data, DAMAGE.doubles, now);
        } else if (g.power === 'love' && ruleId === 'marriage') {
            heal(data, 2 * DAMAGE.doubles, now);
        } else if (g.power === 'sandstorm') {
            sandstorm(data, now);
        }
        return data;
    }
    const dmg = roomSlapDamage(data, seat, ruleId);
    if (dmg <= 0) return data;
    data.godHp = Math.max(0, (data.godHp || 0) - dmg);
    const d = Array.isArray(data.godDamage) ? [...data.godDamage] : [0, 0, 0, 0];
    d[seat] = (d[seat] || 0) + dmg;
    data.godDamage = d;
    data.godLastHit = { seat, amount: -dmg, at: now };
    if (g.power === 'noon' && !data.godNoon && data.godHp > 0 && data.godHp <= data.godMaxHp / 2) {
        data.godNoon = true;
        heal(data, Math.round(1.5 * DAMAGE.doubles), now);
    }
    if (data.godHp <= 0) { fall(data, seat); return data; }
    if (slapped && !data.gameOver) {
        const godSeat = data.players && data.players[data.godSeat];
        if (godSeat && !godSeat.eliminated) {
            const hand = [...(godSeat.cards || [])];
            const n = addGhosts(hand, ghostClones(slapped.pile, slapped.indices));
            if (n > 0) {
                godSeat.cards = hand;
                data.godGhosts = { n, at: now };
            }
        }
    }
    return data;
}

/** After applySlapBurn: Anubis weighs the heart — a second card, never the last. */
export function applyGodBurn(data, seat) {
    if (!data || !data.god || data.gameOver || seat === data.godSeat) return data;
    if (god(data.god)?.power !== 'weighing') return data;
    const p = data.players && data.players[seat];
    if (!p || !Array.isArray(p.cards) || p.cards.length < 2) return data;
    const cards = [...p.cards];
    data.burnPile = [...(data.burnPile || []), cards.shift()];
    p.cards = cards;
    return data;
}

function heal(data, n, now) {
    data.godHp = Math.min(data.godMaxHp, (data.godHp || 0) + n);
    data.godLastHit = { seat: data.godSeat, amount: n, at: now };
}

function sandstorm(data, now) {
    const players = data.players || [];
    let from = -1;
    players.forEach((p, i) => {
        if (i === data.godSeat || !p || p.eliminated) return;
        if (from === -1 || (p.cards || []).length > (players[from].cards || []).length) from = i;
    });
    if (from < 0) return;
    const hand = [...(players[from].cards || [])];
    const n = Math.min(SET_STEAL, Math.max(0, hand.length - 1));
    if (n <= 0) return;
    const stolen = hand.splice(0, n);
    players[from].cards = hand;
    players[data.godSeat].cards = [...(players[data.godSeat].cards || []), ...stolen];
    data.godLastHit = { seat: from, amount: 0, stolen: n, at: now };
}

/** The god falls: the match is over, and the person who wounded it most wins it. */
function fall(data, killer) {
    data.gameOver = true;
    data.status = 'finished';
    data.godFallen = true;
    let best = -1;
    (data.players || []).forEach((p, i) => {
        if (i === data.godSeat || isBot(p)) return;
        const mine = data.godDamage[i] || 0, top = best === -1 ? -1 : (data.godDamage[best] || 0);
        // A tie goes to whoever landed the killing blow.
        if (best === -1 || mine > top || (mine === top && i === killer)) best = i;
    });
    data.winnerId = best;
}
