/**
 * seatSkins.js — the card skin you equipped, seen by the whole table
 * (v3.23.1, council ERS-33). Pure and import-free.
 *
 * Until now a skin was drawn only for the cards YOU laid (ui.js). Online, your
 * seat in the room now carries one field, `players/{i}/cardSkin`: an id from the
 * shop's catalogue. Every client draws the cards a seat lays in that seat's skin.
 *
 * What this does NOT do, and the council said so before it was built:
 *  - It cannot check ownership. The wallet is in Firestore; the room is in the
 *    Realtime Database, which cannot read it. A patched client can write any id
 *    from the list. The field is cosmetic, player names are already
 *    self-declared, and one line here (or a rules `.validate`) removes it.
 *  - It is never trusted as markup. A reader only ever maps the value through
 *    the catalogue's closed list (cleanSkinId); anything else draws nothing.
 *  - Opponents' skins are STATIC: the class and an art deck's figures, none of
 *    the live particle effects (those stay on your own cards).
 *  - No rules change: the room's write rule already lets a seated player
 *    write inside the room, exactly as activeEmoji does.
 */

/** The field written under `gameRooms/{room}/players/{seat}`. */
export const SKIN_FIELD = 'cardSkin';

/** A room value, made safe: an id from the catalogue's closed list, or null. */
export function cleanSkinId(value, ids) {
    return typeof value === 'string' && value !== 'classic' && Array.isArray(ids) && ids.includes(value) ? value : null;
}

/**
 * The skins at a table, by VISUAL seat (0 = you, always null here: your own
 * cards are dressed from your wallet, not from the room).
 */
export function seatSkinsFromRoom(players, localIndex, ids) {
    const out = [null, null, null, null];
    if (!Array.isArray(players) || !Number.isInteger(localIndex)) return out;
    for (let i = 0; i < 4; i++) {
        const visual = (i - localIndex + 4) % 4;
        if (visual === 0) continue;
        out[visual] = cleanSkinId(players[i] && players[i][SKIN_FIELD], ids);
    }
    return out;
}

/** What to write for `effective` (the wallet-checked equipped skin): an id, or null to clear. */
export function wantedSkin(effective, ids) {
    return cleanSkinId(effective, ids);
}

/**
 * Should this client write its seat's field now? `mine` is what the room holds,
 * `want` what the wallet says. Never more often than every `gapMs`, so a room
 * that rewrites the seat cannot turn this into a write loop.
 */
export function skinPushPlan({ mine, want, lastAt = 0, now, gapMs = 4000 }) {
    const has = typeof mine === 'string' ? mine : null;
    if ((has || null) === (want || null)) return null;
    if (now - lastAt < gapMs) return null;
    return want ? 'set' : 'clear';
}

/** The table's skins, read by ui.js when a card is laid. Offline it stays empty. */
export const SeatSkins = {
    seats: [null, null, null, null],
    set(players, localIndex, ids) { this.seats = seatSkinsFromRoom(players, localIndex, ids); },
    clear() { this.seats = [null, null, null, null]; },
    get(visualSeat) { return this.seats[visualSeat] || null; }
};
