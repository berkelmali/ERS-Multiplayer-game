/**
 * senet.js — Senet: the Game of Passing (v3.26.0, council ERS-40).
 *
 * Senet is Egypt's own game: thirty squares in three rows of ten, moves of
 * one to five cast with four sticks, and a road that ends in passing — the
 * name means "passing", and the game came to stand for the soul's crossing.
 * Here the casting sticks are ERS itself. An ordinary bot table is dealt as
 * always, and beside it lies a Senet board with one piece for every seat:
 *
 *   - Every pile a seat takes is a throw for its piece. A slapped pile throws
 *     by its pattern — the rarer the slap, the further it goes — and a
 *     face-card pile throws 1.
 *   - Land exactly on the House of Water (27) and the piece washes back to
 *     the House of Life (15), the square surviving boards mark with an ankh.
 *   - Land on another piece and the two swap places — the capture rule of the
 *     modern reconstructions (Bell, Kendall). The House of Life is the one
 *     square that holds any number of pieces.
 *   - The first piece past the thirtieth square passes, and its seat wins the
 *     match. Holding all fifty-two cards still wins too.
 *
 * WHAT IS DERIVED (#113). A throw is the Pantheon's damage table read in
 * squares: `round(THROW_SCALE × DAMAGE[rule] / DAMAGE.doubles)`, capped at 5,
 * the casting sticks' highest throw. That table is the measured rarity of
 * each pattern (pantheon.js), so the board values a Marriage exactly as the
 * Table of the Gods already does. THROW_SCALE alone is tuned, and with a tool
 * anyone can re-run (tools/sim-senet.mjs): at 2, a race lasts about half the
 * cards of the same table without a board.
 *
 * WHAT IT DOES NOT TOUCH. No line of game.js or ai.js: it reads the match
 * through `pileWon` (whose payload carries the pile as it was slapped) and
 * ends it with `GameState.endMatch`, the path the Duat and the Pantheon use.
 * Solo only — no room reads a board — and never the Daily Challenge. The
 * classic four rules are locked for the race, so the throws a player learns
 * are the same five numbers every time.
 *
 * THE SCREEN (council ERS-40, condition 5). The board moves when a pile is
 * won and at no other moment; nothing on it animates while a card is live.
 */
import EventBus from './eventbus.js';
import { GameState } from './game.js';
import { HouseRules } from './houseRules.js';
import { matchSlap, normalizeRules, DEFAULT_RULES } from './slapRules.js';
import { MatchContext } from './matchContext.js';
import { Localization } from './localization.js?v=3';
import { godSvg } from './godArt.js';
import { DAMAGE } from './pantheon.js';

export const SQUARES = 30;
export const START_SQUARE = 1;
/** Square 15: an ankh on surviving boards. Any number of pieces may stand here. */
export const HOUSE_OF_LIFE = 15;
/** Square 27: three lines of waves. Land on it exactly and you wash back to 15. */
export const HOUSE_OF_WATER = 27;
/** Four casting sticks throw one to five. */
export const THROW_MAX = 5;
/** A face-card pile is won by the rules, not by a slap: the smallest throw. */
export const CHALLENGE_THROW = 1;
/** Squares per Double. Tuned with tools/sim-senet.mjs: races of about half a match. */
export const THROW_SCALE = 2;
/** The patterns a race is played with: the classic four, locked. */
export const SENET_RULES = Object.freeze(normalizeRules({ ...DEFAULT_RULES }));
const STORE_KEY = 'ers_senet_v1';
const SEATS = [0, 1, 2, 3];

/** How far a slapped pile of `ruleId` moves its winner. */
export function throwFor(ruleId) {
    const d = DAMAGE[ruleId];
    if (!Number.isFinite(d)) return CHALLENGE_THROW;
    return Math.max(1, Math.min(THROW_MAX, Math.round(THROW_SCALE * d / DAMAGE.doubles)));
}

/** The throw for a won pile: by its pattern when slapped, 1 when a face card won it. */
export function pileThrow(reason, ruleId) {
    return reason === 'slap' ? throwFor(ruleId) : CHALLENGE_THROW;
}

/** Every throw a race can produce, in the order the card lists them. */
export function throwTable() {
    return Object.keys(SENET_RULES).filter(id => SENET_RULES[id]).map(id => ({ id, steps: throwFor(id) }));
}

/** Where everyone stands before the first pile. */
export function startPositions() {
    return SEATS.map(() => START_SQUARE);
}

/**
 * One move, pure: `seat` throws `steps` from where it stands. Returns the new
 * positions (a copy) and everything that happened, so the caller can say it.
 *   water        the piece landed on the House of Water and went back to 15
 *   swappedWith  the seat whose piece stood on the landing square, or null;
 *                it now stands where the mover started
 *   bornOff      the piece passed the last square: its seat has won
 */
export function advance(positions, seat, steps) {
    const pos = positions.slice();
    const from = pos[seat];
    const out = { positions: pos, seat, steps, from, to: from, water: false, swappedWith: null, bornOff: false };
    if (!(steps > 0)) return out;
    let to = from + steps;
    if (to >= SQUARES) {
        pos[seat] = SQUARES;
        out.to = SQUARES;
        out.bornOff = true;
        return out;
    }
    if (to === HOUSE_OF_WATER) {
        out.water = true;
        to = HOUSE_OF_LIFE;
    } else if (to !== HOUSE_OF_LIFE) {
        const other = pos.findIndex((p, i) => i !== seat && p === to);
        if (other >= 0) {
            pos[other] = from;
            out.swappedWith = other;
        }
    }
    pos[seat] = to;
    out.to = to;
    return out;
}

/**
 * The road on the board: 1–10 left to right, 11–20 back right to left,
 * 21–30 left to right again — the S the pieces travel on surviving boards.
 */
export function cellOf(square) {
    const s = Math.max(1, Math.min(SQUARES, Math.trunc(square)));
    const row = Math.floor((s - 1) / 10);
    const i = (s - 1) % 10;
    return { row, col: row % 2 === 0 ? i : 9 - i };
}

// ── the board, drawn ────────────────────────────────────────────────────────
// A world object (DESIGN §4): painted like the tomb art in godArt.js — flat
// colour, ink outline. The frame around it is the shared panel surface.
const INK = '#1a1410';
const CELL = 30;
const PAD = 6;
/** The board's drawn size, in its own units: its aspect ratio on screen. */
export const BOARD_W = PAD * 2 + CELL * 10;
export const BOARD_H = PAD * 2 + CELL * 3;
/**
 * At this width and below the table is a phone's (style.css, the same 520px):
 * the board sits alone between the pile and your deck, sized to the gap.
 */
export const PHONE_MAX = 520;
/** One colour per seat, from the tomb painter's palette: gold, red ochre, faience, malachite. */
export const PIECE_COLOURS = Object.freeze(['#f0c94a', '#c8442c', '#3d7fd6', '#2f9a62']);
/**
 * Where each seat's piece sits inside a square: its own corner, always. A
 * piece that leaves a shared square therefore never nudges the ones that stay
 * (they would otherwise shuffle up a slot — movement on the board that no
 * throw of theirs caused).
 */
const SLOT = [[-6, -6], [6, -6], [-6, 6], [6, 6]];

function squareMark(s, x, y) {
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    if (s === HOUSE_OF_LIFE) {
        return `<g fill="none" stroke="${INK}" stroke-width="1.6" opacity=".55">
<ellipse cx="${cx}" cy="${cy - 5}" rx="3.4" ry="4.4"/><path d="M${cx - 6} ${cy + 0.5} H${cx + 6} M${cx} ${cy} V${cy + 10}"/></g>`;
    }
    if (s === HOUSE_OF_WATER) {
        const wave = (dy) => `M${x + 5} ${cy + dy} l3 -2.6 l3 2.6 l3 -2.6 l3 2.6 l3 -2.6 l3 2.6`;
        return `<path d="${wave(-5)} ${wave(0)} ${wave(5)}" fill="none" stroke="#1f4fa0" stroke-width="1.5" stroke-linejoin="round" opacity=".8"/>`;
    }
    if (s === SQUARES) {
        // Ra's sign: a ring with its centre, so it never reads as a piece.
        return `<g fill="none" stroke="#b3342a" stroke-width="1.6" opacity=".8">
<circle cx="${cx}" cy="${cy}" r="6.5"/><circle cx="${cx}" cy="${cy}" r="1.4" fill="#b3342a"/></g>`;
    }
    return '';
}

/**
 * The board: thirty squares on a wooden frame, and the four pieces already
 * standing where `positions` says — placed, not slid there, so a new race
 * opens without a single moving thing on the table.
 */
export function boardSvg(positions = startPositions()) {
    const w = BOARD_W;
    const h = BOARD_H;
    let squares = '';
    for (let s = 1; s <= SQUARES; s++) {
        const { row, col } = cellOf(s);
        const x = PAD + col * CELL;
        const y = PAD + row * CELL;
        const fill = s === HOUSE_OF_WATER ? '#cfe1f2' : (s === HOUSE_OF_LIFE ? '#f6e7b8' : ((row + col) % 2 ? '#e9dcc0' : '#f4ead2'));
        squares += `<rect x="${x + 1}" y="${y + 1}" width="${CELL - 2}" height="${CELL - 2}" rx="3" fill="${fill}" stroke="${INK}" stroke-opacity=".45" stroke-width="1"/>`
            + squareMark(s, x, y);
    }
    return `<svg class="senet-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img">
<title class="senet-svg-title"></title>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="7" fill="#7a4f2a" stroke="${INK}" stroke-width="1.2"/>
${squares}
<g>${piecePoints(positions).map(p => `<circle class="senet-piece${p.seat === 0 ? ' you' : ''}" data-seat="${p.seat}" r="5.6" cx="0" cy="0" style="transform: translate(${p.x}px, ${p.y}px)" fill="${PIECE_COLOURS[p.seat]}" stroke="${INK}" stroke-width="1.3"/>`).join('')}</g>
</svg>`;
}

/** Where each seat's piece is drawn: its own corner of the square it stands on. */
export function piecePoints(positions) {
    return SEATS.map(seat => {
        const { row, col } = cellOf(positions[seat]);
        const [dx, dy] = SLOT[seat];
        return { seat, x: PAD + col * CELL + CELL / 2 + dx, y: PAD + row * CELL + CELL / 2 + dy };
    });
}

// ── the strip: the same road, unfolded ──────────────────────────────────────
// A short phone has no room for three rows between the pile and your deck.
// The road is one path whichever way it is folded, so there it is drawn
// straight: thirty cells in a row, a heavier line where the board would turn.
const STRIP_CELL = 10;
const STRIP_CELL_H = 28;
const STRIP_PAD = 3;
export const STRIP_W = STRIP_PAD * 2 + STRIP_CELL * SQUARES;
export const STRIP_H = STRIP_PAD * 2 + STRIP_CELL_H;
/** Each seat runs in its own lane of the strip, so shared cells never stack. */
const LANE = 7;

/** Where each seat's piece is drawn on the strip: its square's column, its own lane. */
export function stripPoints(positions) {
    return SEATS.map(seat => {
        const sq = Math.max(1, Math.min(SQUARES, Math.trunc(positions[seat])));
        return { seat, x: STRIP_PAD + (sq - 1) * STRIP_CELL + STRIP_CELL / 2, y: STRIP_PAD + LANE / 2 + seat * LANE };
    });
}

/** The strip, with its pieces placed where `positions` says (placed, not slid). */
export function stripSvg(positions = startPositions()) {
    let cells = '';
    for (let sq = 1; sq <= SQUARES; sq++) {
        const x = STRIP_PAD + (sq - 1) * STRIP_CELL;
        const fill = sq === HOUSE_OF_WATER ? '#cfe1f2' : (sq === HOUSE_OF_LIFE ? '#f6e7b8' : (sq % 2 ? '#f4ead2' : '#e9dcc0'));
        cells += `<rect x="${x}" y="${STRIP_PAD}" width="${STRIP_CELL}" height="${STRIP_CELL_H}" fill="${fill}" stroke="${INK}" stroke-opacity=".35" stroke-width=".6"/>`;
        if (sq === HOUSE_OF_WATER) {
            cells += `<path d="M${x + 1.5} ${STRIP_PAD + 11} l1.75 -1.6 l1.75 1.6 l1.75 -1.6 l1.75 1.6 M${x + 1.5} ${STRIP_PAD + 17} l1.75 -1.6 l1.75 1.6 l1.75 -1.6 l1.75 1.6" fill="none" stroke="#1f4fa0" stroke-width=".9" opacity=".8"/>`;
        }
        if (sq === SQUARES) {
            cells += `<circle cx="${x + STRIP_CELL / 2}" cy="${STRIP_PAD + STRIP_CELL_H / 2}" r="3.4" fill="none" stroke="#b3342a" stroke-width="1" opacity=".8"/>`;
        }
        if (sq === 10 || sq === 20) {
            cells += `<path d="M${x + STRIP_CELL} ${STRIP_PAD} V${STRIP_PAD + STRIP_CELL_H}" stroke="${INK}" stroke-width="1.6" opacity=".7"/>`;
        }
    }
    return `<svg class="senet-svg" viewBox="0 0 ${STRIP_W} ${STRIP_H}" xmlns="http://www.w3.org/2000/svg" role="img">
<title class="senet-svg-title"></title>
<rect x="0.5" y="0.5" width="${STRIP_W - 1}" height="${STRIP_H - 1}" rx="4" fill="#7a4f2a" stroke="${INK}" stroke-width="1"/>
${cells}
<g>${stripPoints(positions).map(p => `<circle class="senet-piece${p.seat === 0 ? ' you' : ''}" data-seat="${p.seat}" r="3" cx="0" cy="0" style="transform: translate(${p.x}px, ${p.y}px)" fill="${PIECE_COLOURS[p.seat]}" stroke="${INK}" stroke-width=".8"/>`).join('')}</g>
</svg>`;
}

/** The smallest board still legible on a phone, and the widest one worth drawing. */
export const PHONE_BOARD_MIN = 150;
export const PHONE_BOARD_MAX = 300;
/** The narrowest strip still legible: under this, nothing is drawn and the log carries the race. */
export const PHONE_STRIP_MIN = 200;
/**
 * On your turn your deck lifts and swells (style.css, @keyframes activePulse:
 * translateY(-10px) at a scale of up to 1.12). The board must clear the deck
 * at its highest, not where it rests — measured on a phone, a fit taken from
 * the resting deck put the board under the lifted one.
 */
export const DECK_LIFT_PX = 10;
export const DECK_PULSE_SCALE = 1.12;

/** The top of your deck at the height of its pulse, from its resting top and height. */
export function liftedDeckTop(restingTop, deckHeight) {
    return restingTop - DECK_LIFT_PX - (DECK_PULSE_SCALE - 1) / 2 * deckHeight;
}

/**
 * How wide the board may be drawn on a phone so the HUD fits in the gap
 * between the bottom of the pile and the top of your deck — and never covers
 * the pile, which is the slap target (council ERS-40, the screen of condition
 * 5). `gap` is that distance in CSS pixels; `chrome` is the HUD's padding (8)
 * and a 4 px margin above and below. Returns 0 when not even the smallest
 * legible board fits: then no board is drawn and the log carries the race.
 */
export function phoneBoardWidth(gap, chrome = 16) {
    const h = gap - chrome;
    const w = Math.floor(Math.min(PHONE_BOARD_MAX, h * BOARD_W / BOARD_H));
    return w >= PHONE_BOARD_MIN ? w : 0;
}

/**
 * What a phone draws in that gap: the board when it fits legibly, else the
 * strip, else nothing (the log carries the race). { kind, width }.
 */
export function phoneLayout(gap, chrome = 16) {
    const board = phoneBoardWidth(gap, chrome);
    if (board > 0) return { kind: 'board', width: board };
    const w = Math.floor(Math.min(PHONE_BOARD_MAX, (gap - chrome) * STRIP_W / STRIP_H));
    return w >= PHONE_STRIP_MIN ? { kind: 'strip', width: w } : { kind: 'none', width: 0 };
}

// ── the mode ────────────────────────────────────────────────────────────────
export const SenetMode = {
    armed: false,
    positions: startPositions(),
    piles: 0,             // piles YOU have taken this race: the best is the fewest
    passed: -1,           // the seat that bore off, or -1
    layout: 'board',      // 'board' | 'strip' | 'none' — what the HUD draws (phones only vary)
    store: { passings: 0, bestPiles: 0 },
    _initialized: false,

    init() {
        if (this._initialized) return;
        this._initialized = true;
        this.hud = document.getElementById('senet-hud');
        this._load();
        const start = document.getElementById('btn-senet-start');
        if (start) start.addEventListener('click', () => this.begin());
        EventBus.on('gameStarted', () => { if (this.armed) this.resetRace(); });
        EventBus.on('pileWon', (e) => this.onPileWon(e));
        EventBus.on('languageChanged', () => { this.renderHub(); if (this.armed) this.renderHud(); });
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('resize', () => { if (this.armed) this._fit(); });
        }
        this.renderHub();
    },

    renderHub() {
        const L = (k) => Localization.get(k);
        const emblem = document.getElementById('senet-emblem');
        if (emblem && !emblem.firstChild) emblem.innerHTML = godSvg('senet');
        // The throws are generated, never typed into a sentence: change the
        // damage table and the card changes with it (P5).
        const list = document.getElementById('senet-throws');
        if (list) {
            list.textContent = '';
            for (const t of throwTable()) {
                const li = document.createElement('li');
                li.textContent = `${L('ruleName_' + t.id)} ${t.steps}`;
                list.appendChild(li);
            }
            const face = document.createElement('li');
            face.textContent = `${L('senetFacePile')} ${CHALLENGE_THROW}`;
            list.appendChild(face);
        }
        const best = document.getElementById('senet-best');
        if (!best) return;
        const bits = [];
        if (this.store.passings > 0) bits.push(L('senetPassings').replace('{n}', this.store.passings));
        if (this.store.bestPiles > 0) bits.push(L('senetBest').replace('{n}', this.store.bestPiles));
        best.textContent = bits.join(' · ');
    },

    async begin() {
        // A second tap while the modules load must not deal a second table.
        if (this.armed || this._starting) return;
        this._starting = true;
        let mods;
        try {
            mods = await Promise.all([import('./gameManager.js'), import('./ui.js')]);
        } finally {
            this._starting = false;
        }
        const [{ GameManager }, { UIManager }] = mods;
        this.armed = true;
        this._gm = GameManager;
        this._savedRules = { ...HouseRules.local };
        HouseRules.setLocal({ ...SENET_RULES }, { force: true });
        HouseRules.lock('senet');
        document.getElementById('legends-panel').classList.remove('active');
        document.body.classList.remove('menu-screen');
        document.body.classList.add('game-screen');
        document.getElementById('game-container').classList.add('active');
        UIManager.resetOfflineUI();
        GameManager.rematchOptions = () => ({ untimed: true });
        GameManager.startBotGame({ untimed: true });
        EventBus.emit('gameStateChanged', 'gameplay');
    },

    resetRace() {
        this.positions = startPositions();
        this.piles = 0;
        this.passed = -1;
        document.body.classList.add('senet-race');
        // One colour list (PIECE_COLOURS): the table's name labels take the
        // same colours through these, so a phone needs no legend.
        SEATS.forEach(seat => document.body.style.setProperty(`--senet-c${seat}`, PIECE_COLOURS[seat]));
        this.layout = 'board';
        if (this.hud) this.hud.hidden = false;
        this._draw();
        this._fit();
        this.renderHud();
        this._say(Localization.get('senetStartLine'), { max: SQUARES });
    },

    /** A pile was won: its winner's piece throws. The only moment the board moves. */
    onPileWon({ winnerId, reason, pile } = {}) {
        if (!this.armed || this.passed >= 0 || GameState.gameOver) return;
        if (!SEATS.includes(winnerId)) return;
        const rule = reason === 'slap' ? (matchSlap(pile || [], HouseRules.active()) || {}).id : null;
        const steps = pileThrow(reason, rule);
        const move = advance(this.positions, winnerId, steps);
        this.positions = move.positions;
        if (winnerId === 0) this.piles++;
        this._announce(move, reason, rule);
        this.renderHud();
        if (move.bornOff) this._pass(winnerId);
    },

    _pass(seat) {
        this.passed = seat;
        if (seat === 0) {
            this.store.passings++;
            if (!this.store.bestPiles || this.piles < this.store.bestPiles) this.store.bestPiles = this.piles;
            this._save();
        }
        GameState.endMatch(seat);
    },

    /**
     * Says what the throw did, on the HUD line and in the log (council ERS-40,
     * condition 4: no piece moves backwards without a sentence saying why).
     * A "you" and a "they" form for each, because the verb changes with the
     * person in Turkish, German and Russian.
     */
    _announce(move, reason, rule) {
        const L = (k) => Localization.get(k);
        const you = move.seat === 0;
        const who = this.seatName(move.seat);
        if (move.bornOff) {
            this._say(L(you ? 'senetPassYou' : 'senetPassThey'), { who, max: SQUARES });
            this._float('☥', move.seat);
            return;
        }
        if (move.water) {
            this._say(L(you ? 'senetWaterYou' : 'senetWaterThey'), { who, life: HOUSE_OF_LIFE });
            this._float('≋', move.seat);
            return;
        }
        if (move.swappedWith !== null) {
            const key = you ? 'senetSwapYou' : (move.swappedWith === 0 ? 'senetSwapOnYou' : 'senetSwapThey');
            this._say(L(key), { who, other: this.seatName(move.swappedWith), to: move.to, from: move.from });
            this._float('⇄', move.seat);
            return;
        }
        const what = reason === 'slap' && rule ? L('ruleName_' + rule) : L('senetFacePile');
        this._say(L(you ? 'senetMoveYou' : 'senetMoveThey'), { who, what, n: move.steps, to: move.to });
        this._float(`+${move.steps}`, move.seat);
    },

    seatName(seat) {
        if (seat === 0) return Localization.get('senetYou');
        if (MatchContext.seatNames && MatchContext.seatNames[seat]) return MatchContext.seatNames[seat];
        return Localization.get('bot' + seat);
    },

    renderHud() {
        if (!this.hud || !this.armed) return;
        const L = (k) => Localization.get(k);
        const title = document.getElementById('senet-title');
        if (title) title.textContent = L('senetHudTitle')
            .replace('{n}', this.positions[0]).replace('{max}', SQUARES);
        const points = this.layout === 'strip' ? stripPoints(this.positions) : piecePoints(this.positions);
        for (const p of points) {
            const el = this.hud.querySelector(`.senet-piece[data-seat="${p.seat}"]`);
            if (el) el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        }
        const legend = document.getElementById('senet-legend');
        if (legend) {
            legend.textContent = '';
            for (const seat of SEATS) {
                const li = document.createElement('li');
                li.className = 'senet-seat' + (seat === 0 ? ' you' : '');
                const dot = document.createElement('span');
                dot.className = 'senet-dot';
                dot.style.background = PIECE_COLOURS[seat];
                li.append(dot, document.createTextNode(`${this.seatName(seat)} ${this.positions[seat]}`));
                legend.appendChild(li);
            }
        }
        const svgTitle = this.hud.querySelector('.senet-svg-title');
        if (svgTitle) svgTitle.textContent = SEATS.map(s => `${this.seatName(s)} ${this.positions[s]}`).join(', ');
    },

    /**
     * Phones only: measure the gap between the pile and your deck and size the
     * board to it. Wider screens hang the HUD beside the deck (style.css) and
     * need nothing measured.
     */
    _fit() {
        if (!this.hud) return;
        this.hud.style.removeProperty('--senet-board-w');
        this.hud.style.removeProperty('--senet-hud-bottom');
        this.hud.classList.remove('senet-folded');
        if (window.innerWidth > PHONE_MAX) { this._setLayout('board'); return; }
        const pile = document.getElementById('center-pile');
        const deck = document.getElementById('human-deck');
        if (!pile || !deck) return;
        // Not laid out yet (a rematch can start while the end screen is up):
        // measure again on the next frame instead of reading zeros.
        if (deck.getBoundingClientRect().height === 0) {
            if (!this._refit && typeof requestAnimationFrame === 'function') {
                this._refit = true;
                requestAnimationFrame(() => { this._refit = false; if (this.armed) this._fit(); });
            }
            return;
        }
        // The deck's resting top is its zone's top edge (the zone is not
        // transformed; the deck is, on your turn). Hang the drawing 4 px above
        // the deck at its highest, and no closer than 4 px to the pile.
        const zone = this.hud.parentElement;
        if (!zone) return;
        const zr = zone.getBoundingClientRect();
        const top = liftedDeckTop(zr.top, deck.offsetHeight);
        const fit = phoneLayout(top - pile.getBoundingClientRect().bottom);
        if (fit.kind === 'none') {
            this.hud.classList.add('senet-folded');
            return;
        }
        this._setLayout(fit.kind);
        this.hud.style.setProperty('--senet-board-w', `${fit.width}px`);
        this.hud.style.setProperty('--senet-hud-bottom', `${Math.round(zr.bottom - top + 4)}px`);
    },

    /** Switches the drawing (board or strip); the pieces are placed, not slid. */
    _setLayout(kind) {
        if (this.layout === kind) return;
        this.layout = kind;
        this._draw();
        this.renderHud();
    },

    _draw() {
        const host = document.getElementById('senet-board');
        if (!host) return;
        host.innerHTML = this.layout === 'strip' ? stripSvg(this.positions) : boardSvg(this.positions);
    },

    _say(text, vars = {}) {
        if (!text) return;
        let line = text;
        for (const [k, v] of Object.entries(vars)) line = line.split(`{${k}}`).join(String(v));
        const el = document.getElementById('senet-line');
        if (el) el.textContent = line;
        import('./ui.js').then(({ UIManager }) => UIManager.addLog(`☥ ${line}`, 'highlight')).catch(() => {});
    },

    _float(text, seat) {
        if (!this.hud) return;
        const el = document.createElement('span');
        el.className = 'senet-float';
        el.style.color = PIECE_COLOURS[seat] || '#f0d98a';
        el.textContent = text;
        this.hud.appendChild(el);
        setTimeout(() => el.remove(), 1100);
    },

    stop() {
        if (!this.armed) return;
        this.armed = false;
        this.passed = -1;
        if (this._gm) this._gm.rematchOptions = null;
        HouseRules.unlock();
        if (this._savedRules) {
            HouseRules.setLocal(this._savedRules, { force: true });
            this._savedRules = null;
        }
        document.body.classList.remove('senet-race');
        SEATS.forEach(seat => document.body.style.removeProperty(`--senet-c${seat}`));
        if (this.hud) {
            this.hud.hidden = true;
            this.hud.querySelectorAll('.senet-float').forEach(el => el.remove());
        }
        this.renderHub();
    },

    _load() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (raw) {
                const got = JSON.parse(raw) || {};
                const n = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
                this.store = { passings: n(got.passings), bestPiles: n(got.bestPiles) };
            }
        } catch { /* private window: the race starts fresh */ }
    },

    _save() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(this.store)); } catch { /* see _load */ }
    }
};
