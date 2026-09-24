/**
 * pharaohDeck.js — the Pharaoh's Deck card skin (v3.20.0, council ERS-24).
 *
 * The four cards painted into the lobby art (assets/menu.jpg), made into a
 * deck you can play: ivory parchment, a gold frame, a column of hieroglyphs
 * down each long edge, and the painting's figures on the court cards —
 *
 *   K  a pharaoh in the striped nemes, double-ended as painted
 *   Q  a queen in the flat-topped blue crown
 *   J  Anubis, the jackal
 *   A  the Eye of Horus (wadjet)
 *
 * The same figure serves every suit; its robe takes the suit's colour
 * (--pd-suit, set in style.css from .red / .black). Pips 2–10 keep the
 * engine's own suit sign.
 *
 * Why SVG and not a crop of the painting (ERS-24 Q2): the painting holds four
 * cards at ~150 px, tilted and soft-focused, and no pip card at all. The frame,
 * the parchment and the glyph columns — what makes the deck read as THAT deck —
 * are pure geometry and are drawn in CSS (style.css, "Pharaoh's Deck").
 *
 * Every fill is a class, never a colour: the palette lives in one CSS block, and
 * no <defs>/ids are used, so any number of these cards can sit on the pile (or
 * in a hidden screen) without one SVG's gradient reference resolving into
 * another's.
 *
 * The markup here is constant — nothing a player typed reaches innerHTML.
 */

import { godsCourtSvg, WINGED_SUN, STARS } from './godsDeck.js';

/** The shop id of the skin (cardSkins.js). */
export const PHARAOH_SKIN = 'pharaoh';

// The panel every court card sits in, as on the painted cards.
const PANEL = '<rect class="panel" x="2" y="2" width="96" height="136" rx="3"/>';

// One half of the king: the pharaoh in the striped nemes, crook and flail
// crossed on the chest (the Osiris pose). Mirrored at the waist (y = 70).
const KING_HEAD = `
<path class="gold o" d="M26 31 Q27 8 50 7 Q73 8 74 31 L81 62 L67 62 L62.5 38 L37.5 38 L33 62 L19 62 Z"/>
<path class="lapis" d="M31.5 19 Q50 9.5 68.5 19 L69.6 22.2 Q50 12.6 30.4 22.2 Z"/>
<path class="lapis" d="M29.4 26 Q50 15.4 70.6 26 L71.4 29.2 Q50 18.6 28.6 29.2 Z"/>
<path class="lapis" d="M22.4 43 L35.6 43 L35.2 46.2 L21.8 46.2 Z M20.8 51 L34.8 51 L34.4 54.2 L20.2 54.2 Z M64.4 43 L77.6 43 L78.2 46.2 L64.8 46.2 Z M65.2 51 L79.2 51 L79.8 54.2 L65.6 54.2 Z"/>
<path class="gdeep o" d="M36 24.5 Q50 19.5 64 24.5 L64 28.5 Q50 23.5 36 28.5 Z"/>
<path class="skin o" d="M38.2 28.4 Q50 24.6 61.8 28.4 L61.8 38 Q61 49.6 50 53 Q39 49.6 38.2 38 Z"/>
<path class="ln" d="M41 35.2 Q44.6 32.6 48.2 35.2 M51.8 35.2 Q55.4 32.6 59 35.2 M38.8 36.8 L41 35.2 M59 35.2 L61.4 36.8"/>
<circle class="ink" cx="44.8" cy="35.4" r="1.5"/><circle class="ink" cx="55.2" cy="35.4" r="1.5"/>
<path class="ln" d="M50 38.2 L48.8 43 L51.2 43.2 M46.6 46.8 Q50 48.4 53.4 46.8"/>
<path class="turq o" d="M50 12.5 Q46.4 15.8 48 20 L50 24 L52 20 Q53.6 15.8 50 12.5 Z"/>
<path class="gdeep o" d="M47.4 52 L52.6 52 L53.2 60 Q50 62 46.8 60 Z"/>`;

const KING_HALF = `
<path class="suit o" d="M13 70 Q14 53 32 48.5 L68 48.5 Q86 53 87 70 Z"/>
<path class="st-t" d="M29 52.5 Q50 61 71 52.5"/>
<path class="st-g" d="M26 56.8 Q50 66.4 74 56.8"/>
<path class="st-c" d="M23.4 61 Q50 71.6 76.6 61"/>
<g transform="translate(50 1) scale(0.84) translate(-50 0)">${KING_HEAD}</g>
<path class="st-gw" d="M35 69 L60 51 Q64 47.6 61.4 45"/>
<path class="st-lw" d="M35 69 L57 53.2"/>
<path class="st-gw" d="M65 69 L42 52"/>
<path class="st-g1" d="M42 52 L35 56.5 M42 52 L36.6 58.6 M42 52 L38.4 60.4"/>
<ellipse class="skin o" cx="44" cy="62.4" rx="4.2" ry="3"/>
<ellipse class="skin o" cx="56" cy="62.4" rx="4.2" ry="3"/>`;

export const KING_SVG = `<svg class="pd-art" viewBox="0 0 100 140" aria-hidden="true" focusable="false">
${PANEL}
<g>${KING_HALF}</g>
<g transform="rotate(180 50 70)">${KING_HALF}</g>
<rect class="gold o" x="4" y="67.6" width="92" height="4.8" rx="1"/>
<path class="st-l1" d="M6 70 H94"/>
</svg>`;

export const QUEEN_SVG = `<svg class="pd-art" viewBox="0 0 100 140" aria-hidden="true" focusable="false">
${PANEL}
<path class="linen o" d="M24 86 Q50 98 76 86 Q81 112 88 138 L12 138 Q19 112 24 86 Z"/>
<path class="ln-g" d="M36 100 L31 138 M44 101 L42 138 M56 101 L58 138 M64 100 L69 138"/>
<path class="suit o" d="M44 97 L56 97 L60 138 L40 138 Z"/>
<path class="gold o" d="M26.5 106 Q50 113 73.5 106 L74.3 111 Q50 118 25.7 111 Z"/>
<path class="skin o" d="M45 58 L55 58 L55.6 70 L44.4 70 Z"/>
<path class="gold o" d="M22 74 Q50 57 78 74 L80 87 Q50 101 20 87 Z"/>
<path class="st-t" d="M26 76.5 Q50 63 74 76.5"/>
<path class="st-c" d="M23.4 81.5 Q50 69 76.6 81.5"/>
<path class="st-l" d="M21.8 86.4 Q50 97 78.2 86.4"/>
<path class="lapis o" d="M34.5 35 L29.5 11 Q50 4.5 70.5 11 L65.5 35 Z"/>
<path class="gold o" d="M33.4 29.6 L66.6 29.6 L65.8 34.6 L34.2 34.6 Z"/>
<path class="st-t1" d="M31.8 18.6 Q50 13.2 68.2 18.6"/>
<path class="skin o" d="M38.2 34.6 L61.8 34.6 L61.8 45.6 Q61 58.4 50 61.6 Q39 58.4 38.2 45.6 Z"/>
<path class="turq o" d="M50 23 Q46.8 26 48.2 29.6 L50 33.4 L51.8 29.6 Q53.2 26 50 23 Z"/>
<path class="ln" d="M41.4 42.4 Q44.8 40 48.2 42.4 M51.8 42.4 Q55.2 40 58.6 42.4 M39.2 43.8 L41.4 42.4 M58.6 42.4 L60.8 43.8"/>
<circle class="ink" cx="45" cy="42.6" r="1.4"/><circle class="ink" cx="55" cy="42.6" r="1.4"/>
<path class="ln" d="M50 45.2 L48.9 49.6 L51.1 49.8"/>
<path class="carn o" d="M46.6 53.4 Q50 52.2 53.4 53.4 Q50 56 46.6 53.4 Z"/>
<circle class="gold o" cx="37.2" cy="49" r="2.4"/><circle class="gold o" cx="62.8" cy="49" r="2.4"/>
<path class="skin o" d="M73 84 Q79 100 72 118 L67.6 117 Q73.6 100 69 86 Z"/>
<path class="st-t" d="M69.5 119 L77 92"/>
<path class="turq o" d="M77 92 Q70 85 72 77 Q76.5 83 77 92 Q77.3 81 81.3 74.5 Q84.3 83 77 92 Z"/>
<ellipse class="skin o" cx="69.6" cy="118.6" rx="3.6" ry="2.8"/>
</svg>`;

export const JACK_SVG = `<svg class="pd-art" viewBox="0 0 100 140" aria-hidden="true" focusable="false">
${PANEL}
<path class="gold o" d="M61 33 L78 39 L81 74 L65 74 Z"/>
<path class="lapis" d="M63.6 43 L78.6 46 L78.9 49.2 L63.9 46.2 Z M64.4 53 L79.4 56 L79.7 59.2 L64.7 56.2 Z M65.2 63 L80.2 66 L80.4 69.2 L65.5 66.2 Z"/>
<path class="suit o" d="M27 88 Q50 97 81 86 L82 114 L25 114 Z"/>
<path class="linen o" d="M25 118 L82 118 L86 138 L21 138 Z"/>
<path class="ln-g" d="M33 120 L30 138 M43 120 L42 138 M65 120 L67 138 M74 120 L77 138"/>
<path class="lapis o" d="M47 118 L60 118 L62 138 L45 138 Z"/>
<path class="gold o" d="M24 112 L83 112 L83.4 119 L23.6 119 Z"/>
<path class="gold o" d="M28 74.5 Q52 60 79 72.5 L81 86.5 Q50 98.5 27 88.5 Z"/>
<path class="st-t" d="M31 77 Q52 65 76.5 75.5"/>
<path class="st-c" d="M28.8 82.4 Q52 71 78.6 81"/>
<path class="skin-d o" d="M30 86 Q21 94 20.4 106 L26 107 Q27 96 35 90 Z"/>
<path class="st-gw" d="M17 137 L17 40 Q13.5 34 19 30.5 L23.6 33"/>
<path class="st-lw" d="M17 137 L17 120 M17 100 L17 84 M17 64 L17 46"/>
<path class="st-gw" d="M13 137 L21 137"/>
<ellipse class="skin-d o" cx="21" cy="106.4" rx="4.4" ry="3.4"/>
<path class="ink o" d="M55 8 L62.5 31 L52.5 29 Z"/>
<path class="ink o" d="M64 5 L69.5 31 L60.5 29.5 Z"/>
<path class="carn" d="M56.3 13 L60.4 27.6 L55.4 26.6 Z M64.6 11 L67.6 27.8 L62.6 27 Z"/>
<path class="ink o" d="M51.5 26.5 Q66 21.5 72.5 33 L73 46 Q70 57 60 60 L52.5 62 L49 51.5 L37.5 51.5 Q29.5 51 28.5 46.2 L31 43 L47.5 38.4 Z"/>
<path class="ink o" d="M52.5 60 L66 58 L70 71 L55 74 Z"/>
<path class="gold" d="M50 36.6 L60.2 33.6 L57.6 38.4 Z"/>
<path class="st-g1" d="M47 39.4 L60.6 35.4 M36 47.8 L46 45.6"/>
<circle class="gold" cx="30.4" cy="45.4" r="1.3"/>
</svg>`;

export const ACE_SVG = `<svg class="pd-art" viewBox="0 0 100 140" aria-hidden="true" focusable="false">
<path class="lapis o" d="M19 46 Q50 25 83 39 L82 45.4 Q50 32.4 20.4 52 Z"/>
<path class="linen o" d="M20 64 Q50 42.6 81 61 Q52 79.6 20 64 Z"/>
<circle class="gold o" cx="50" cy="61.2" r="10.6"/>
<circle class="lapis" cx="50" cy="61.2" r="7.4"/>
<circle class="ink" cx="50" cy="61.2" r="3.6"/>
<circle class="linen" cx="47" cy="58.4" r="1.6"/>
<path class="lapis o" d="M80.4 60 L94 60.4 L94 64.6 L77.4 64.6 Z"/>
<path class="lapis o" d="M43.4 73.6 L40.6 99 L45.8 99 L48.6 74.6 Z"/>
<path class="st-lw" d="M57 74.4 Q60.6 95.6 71 97.6 Q82.4 99 83 89.4 Q83.4 81.6 75.6 82.2 Q70.6 83 72.4 88"/>
<path class="st-g1" d="M22.4 51.6 Q50 34.4 81.6 43.4"/>
</svg>`;

const SUIT_SIGN = Object.freeze({ spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' });

/** The figure for a rank, or null for pip cards (2–10). */
export function courtSvg(rank) {
    switch (rank) {
        case 11: return JACK_SVG;
        case 12: return QUEEN_SVG;
        case 13: return KING_SVG;
        case 14: return ACE_SVG;
        default: return null;
    }
}

/** The decks that dress a card, by the skin's `art` (cardSkins.js). */
export const ART_DECKS = Object.freeze({
    pharaoh: { figure: courtSvg, night: false },
    gods: { figure: godsCourtSvg, night: true }
});

/** The stars' layer (the Deck of the Gods): fixed places, a wave of delays. */
const STARS_HTML = STARS.map(([x, y, d]) => `<i style="left:${x}%;top:${y}%;--d:${d}s"></i>`).join('');

/**
 * Dresses one card element in an art deck. Idempotent: a second call (the
 * shop's hover cycle rebuilds the class list and the centre text, then calls
 * this again) replaces the layers rather than stacking them.
 *
 *   .pd-deck             the class every structural rule in style.css keys on
 *   .pd-layer.pd-fx      the sun disc and the light sweep (behind the art),
 *                        and by night the winged sun
 *   .pd-layer.pd-stars   by night: twelve stars
 *   .pd-layer.pd-glyphs  the two hieroglyph columns
 *   .card-center         the figure, for J/Q/K/A
 */
export function decorateArtCard(cardEl, card, art) {
    const deck = ART_DECKS[art];
    if (!cardEl || !card || !deck || typeof document === 'undefined') return;
    for (const old of cardEl.querySelectorAll('.pd-layer')) old.remove();
    cardEl.classList.remove('pd-court', 'pd-ace');
    cardEl.classList.add('pd-deck');

    const fx = document.createElement('div');
    fx.className = 'pd-layer pd-fx';
    fx.innerHTML = '<div class="pd-sun"></div>'
        + (deck.night ? `<div class="pd-wings">${WINGED_SUN}</div>` : '')
        + '<div class="pd-sweep"></div>';

    const glyphs = document.createElement('div');
    glyphs.className = 'pd-layer pd-glyphs';
    glyphs.innerHTML = '<div class="pd-col pd-col-l"></div><div class="pd-col pd-col-r"></div>';

    cardEl.prepend(glyphs);
    if (deck.night) {
        const stars = document.createElement('div');
        stars.className = 'pd-layer pd-stars';
        stars.innerHTML = STARS_HTML;
        cardEl.prepend(stars);
    }
    cardEl.prepend(fx);

    const figure = deck.figure(card.rank);
    const center = cardEl.querySelector('.card-center');
    if (figure && center) {
        const sign = SUIT_SIGN[card.suit] || '';
        // A court card carries its suit beside the figure, as painted (the
        // king, double-ended, carries it at both ends).
        const pips = card.rank === 14 ? ''
            : `<span class="pd-pip pd-pip-a">${sign}</span>` + (card.rank === 13 ? `<span class="pd-pip pd-pip-b">${sign}</span>` : '');
        center.innerHTML = figure + pips;
        cardEl.classList.add(card.rank === 14 ? 'pd-ace' : 'pd-court');
    }
}

/** The Pharaoh's Deck (v3.20.0): kept as its own name for the call sites and tests. */
export function decoratePharaohCard(cardEl, card) {
    decorateArtCard(cardEl, card, 'pharaoh');
}
