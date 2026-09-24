/**
 * godsDeck.js — the Deck of the Gods' figures (v3.21.0, council ERS-25).
 *
 * The Pharaoh's Deck's sister, turned from day to night: a lapis-lazuli ground
 * (style.css, .card-skin-gods) and gods on the court cards —
 *
 *   K  Osiris, green-faced, in the atef crown, crook and flail crossed —
 *      double-ended like the Pharaoh's king
 *   Q  Isis, the throne on her head, her wings spread
 *   J  Horus, the falcon, in the double crown, with the was-sceptre
 *   A  Khepri, the scarab, lifting the sun
 *
 * Same rules as pharaohDeck.js: every fill is a class the deck's tokens paint,
 * no ids, no <defs>, nothing a player typed. pharaohDeck.js's decorator draws
 * these when a skin's `art` is 'gods'; the winged sun and the stars — this
 * deck's own effect — are laid on there too (WINGED_SUN below).
 */

const PANEL = '<rect class="panel" x="2" y="2" width="96" height="136" rx="3"/>';

// Osiris from the chest up: atef crown (the white crown between two plumes,
// on ram's horns), green face, the curled beard of a god.
const OSIRIS_HEAD = `
<path class="white o" d="M39 29 Q34 17 37.5 3.5 Q41.5 15.5 44.5 29 Z"/>
<path class="white o" d="M61 29 Q66 17 62.5 3.5 Q58.5 15.5 55.5 29 Z"/>
<path class="ln-g" d="M38.4 10 L42 12 M37.8 16 L42.8 18 M38.6 22 L43.6 24 M61.6 10 L58 12 M62.2 16 L57.2 18 M61.4 22 L56.4 24"/>
<path class="white o" d="M42.5 29.5 Q40.5 14 50 3 Q59.5 14 57.5 29.5 Z"/>
<circle class="gold o" cx="50" cy="3.6" r="2.4"/>
<path class="st-g1" d="M45.6 20 Q50 17.6 54.4 20"/>
<path class="gold o" d="M31 30.5 Q40.5 25 50 30 Q59.5 25 69 30.5 L68 34 Q59 29 50 33.4 Q41 29 32 34 Z"/>
<path class="turq o" d="M50 23 Q47 25.6 48.3 29 L50 32.4 L51.7 29 Q53 25.6 50 23 Z"/>
<path class="green o" d="M40.4 33 L59.6 33 L59.6 41 Q59 51 50 53.6 Q41 51 40.4 41 Z"/>
<path class="ln" d="M42.6 39.4 Q45.8 37 49 39.4 M51 39.4 Q54.2 37 57.4 39.4 M40.8 40.8 L42.6 39.4 M57.4 39.4 L59.4 40.8"/>
<circle class="ink" cx="45.9" cy="39.6" r="1.4"/><circle class="ink" cx="54.1" cy="39.6" r="1.4"/>
<path class="ln" d="M50 42 L49 46.4 L51 46.6 M47 49.4 Q50 50.8 53 49.4"/>
<path class="gdeep o" d="M47.8 52.6 L52.2 52.6 L52.6 60 Q53.6 63.4 50.8 63.6 L49.2 63.6 Q46.4 63.4 47.4 60 Z"/>`;

const OSIRIS_HALF = `
<path class="linen o" d="M13 70 Q14 53 32 48.5 L68 48.5 Q86 53 87 70 Z"/>
<path class="ln-g" d="M20 66 Q50 58 80 66 M24 60 Q50 53 76 60"/>
<path class="st-t" d="M29 52.5 Q50 61 71 52.5"/>
<path class="st-g" d="M26 56.8 Q50 66.4 74 56.8"/>
<path class="st-c" d="M23.4 61 Q50 71.6 76.6 61"/>
<g transform="translate(50 1) scale(0.84) translate(-50 0)">${OSIRIS_HEAD}</g>
<path class="st-gw" d="M35 69 L60 51 Q64 47.6 61.4 45"/>
<path class="st-lw" d="M35 69 L57 53.2"/>
<path class="st-gw" d="M65 69 L42 52"/>
<path class="st-g1" d="M42 52 L35 56.5 M42 52 L36.6 58.6 M42 52 L38.4 60.4"/>
<ellipse class="green o" cx="44" cy="62.4" rx="4.2" ry="3"/>
<ellipse class="green o" cx="56" cy="62.4" rx="4.2" ry="3"/>`;

export const OSIRIS_SVG = `<svg class="pd-art" viewBox="0 0 100 140" aria-hidden="true" focusable="false">
${PANEL}
<g>${OSIRIS_HALF}</g>
<g transform="rotate(180 50 70)">${OSIRIS_HALF}</g>
<rect class="gold o" x="4" y="67.6" width="92" height="4.8" rx="1"/>
<path class="st-t1" d="M6 70 H94"/>
</svg>`;

// One of Isis's wings, drawn on the left; the right is its mirror.
const ISIS_WING = `
<path class="gold o" d="M40 77 Q24 69 5 77 L6.5 85 Q24 78 40 84 Z"/>
<path class="turq o" d="M40 84 Q24 78 6.5 85 L9 95 Q26 87.5 40 92 Z"/>
<path class="lapis o" d="M40 92 Q26 87.5 9 95 L13.5 107 Q29 97 40 100 Z"/>
<path class="ln-g" d="M12 79.4 L13.4 83.2 M19 77.6 L20 81.8 M26 76.8 L26.6 80.8 M33 77.8 L33.2 82 M15 87.6 L16.6 92.2 M22 85.8 L23.4 90.4 M29 85.4 L30 89.8 M18.6 97.4 L20.4 102.6 M25.4 94.8 L27 99.4 M32 94 L33.2 98.4"/>`;

export const ISIS_SVG = `<svg class="pd-art" viewBox="0 0 100 140" aria-hidden="true" focusable="false">
${PANEL}
<g>${ISIS_WING}</g>
<g transform="translate(100 0) scale(-1 1)">${ISIS_WING}</g>
<path class="suit o" d="M36 86 Q50 93 64 86 L71 138 L29 138 Z"/>
<path class="ln-g" d="M42 96 L39 138 M50 97 L50 138 M58 96 L61 138"/>
<path class="gold o" d="M34.4 106 Q50 111 65.6 106 L66.2 111 Q50 116 33.8 111 Z"/>
<path class="skin o" d="M45.4 56 L54.6 56 L55.2 68 L44.8 68 Z"/>
<path class="gold o" d="M31 74 Q50 61 69 74 L70 86 Q50 96 30 86 Z"/>
<path class="st-t" d="M34 76.2 Q50 66 66 76.2"/>
<path class="st-c" d="M32.2 81 Q50 71.6 67.8 81"/>
<path class="st-l" d="M31 85.6 Q50 94.6 69 85.6"/>
<path class="ink o" d="M35.5 30 Q50 20 64.5 30 L66.5 60 L57.4 60 L56.6 38 L43.4 38 L42.6 60 L33.5 60 Z"/>
<path class="gold o" d="M36.2 33.6 Q50 27.4 63.8 33.6 L63.8 36.6 Q50 30.4 36.2 36.6 Z"/>
<path class="gold o" d="M42.5 25 L42.5 12 L49.5 12 L49.5 18.5 L57.5 18.5 L57.5 25 Z"/>
<path class="st-l1" d="M44.5 14.5 L47.5 14.5 M44.5 17.5 L47.5 17.5"/>
<path class="skin o" d="M41.6 36.6 L58.4 36.6 L58.4 45 Q57.8 55.4 50 58.4 Q42.2 55.4 41.6 45 Z"/>
<path class="ln" d="M43.6 43.6 Q46.6 41.4 49.2 43.6 M50.8 43.6 Q53.4 41.4 56.4 43.6 M42 44.8 L43.6 43.6 M56.4 43.6 L58 44.8"/>
<circle class="ink" cx="46.4" cy="43.8" r="1.25"/><circle class="ink" cx="53.6" cy="43.8" r="1.25"/>
<path class="ln" d="M50 46.2 L49.1 50 L50.9 50.2"/>
<path class="carn o" d="M47 53.4 Q50 52.3 53 53.4 Q50 55.8 47 53.4 Z"/>
<path class="turq o" d="M50 30.8 Q47.6 33 48.6 35.6 L50 38.2 L51.4 35.6 Q52.4 33 50 30.8 Z"/>
</svg>`;

export const HORUS_SVG = `<svg class="pd-art" viewBox="0 0 100 140" aria-hidden="true" focusable="false">
${PANEL}
<path class="lapis o" d="M60 33 L77 39 L80 74 L64 74 Z"/>
<path class="gold" d="M62.6 43 L77.6 46 L77.9 49.2 L62.9 46.2 Z M63.4 53 L78.4 56 L78.7 59.2 L63.7 56.2 Z M64.2 63 L79.2 66 L79.4 69.2 L64.5 66.2 Z"/>
<path class="suit o" d="M27 88 Q50 97 81 86 L82 114 L25 114 Z"/>
<path class="linen o" d="M25 118 L82 118 L86 138 L21 138 Z"/>
<path class="ln-g" d="M33 120 L30 138 M43 120 L42 138 M65 120 L67 138 M74 120 L77 138"/>
<path class="gold o" d="M47 118 L60 118 L62 138 L45 138 Z"/>
<path class="gold o" d="M24 112 L83 112 L83.4 119 L23.6 119 Z"/>
<path class="gold o" d="M28 74.5 Q52 60 79 72.5 L81 86.5 Q50 98.5 27 88.5 Z"/>
<path class="st-t" d="M31 77 Q52 65 76.5 75.5"/>
<path class="st-c" d="M28.8 82.4 Q52 71 78.6 81"/>
<path class="skin-d o" d="M30 86 Q21 94 20.4 106 L26 107 Q27 96 35 90 Z"/>
<path class="st-gw" d="M17 137 L17 40 Q13.5 34 19 30.5 L23.6 33"/>
<path class="st-lw" d="M17 137 L17 120 M17 100 L17 84 M17 64 L17 46"/>
<path class="st-gw" d="M13 137 L21 137"/>
<ellipse class="skin-d o" cx="21" cy="106.4" rx="4.4" ry="3.4"/>
<path class="brown o" d="M52.5 60 L66 58 L70 71 L55 74 Z"/>
<path class="red o" d="M47.5 31 L47.5 17 L59 17 L59 4 L66.5 4 L66.5 32 Z"/>
<path class="st-g" d="M50 19.4 Q42.6 15.6 44.4 9.6 Q46 6.4 49.4 8"/>
<path class="white o" d="M49 31 Q46 19 52.6 7.6 Q57.6 14.6 58.6 31 Z"/>
<path class="brown o" d="M50 30 Q64.5 26 68 36 L68.4 49 Q64.6 58 56.4 58.6 L52 61 L48.4 51.6 L42 50.4 L42.4 44.4 L47 38 Z"/>
<path class="linen o" d="M47 38 L56 34.6 L58.6 41 L53 47 L45.4 49.4 L42.4 44.4 Z"/>
<path class="gold o" d="M42.4 44.4 Q35.4 43.6 33.6 48.6 Q35.2 52.8 39.2 50.6 L42 50.4 Z"/>
<circle class="gold o" cx="51" cy="40.2" r="2.6"/>
<circle class="ink" cx="51" cy="40.2" r="1.2"/>
<path class="ln" d="M48.4 40.6 L44.6 41.8 M51 42.8 Q50.4 48 47 51.4"/>
</svg>`;

export const KHEPRI_SVG = `<svg class="pd-art" viewBox="0 0 100 140" aria-hidden="true" focusable="false">
<circle class="carn o" cx="50" cy="31" r="15"/>
<circle class="st-g1" cx="50" cy="31" r="11.6"/>
<path class="gold o" d="M38 63 Q20 57 6 64 L8 71 Q22 65 38 70 Z"/>
<path class="turq o" d="M38 70 Q22 65 8 71 L11.5 79.5 Q24 72.5 38 77 Z"/>
<path class="lapis o" d="M38 77 Q24 72.5 11.5 79.5 L16.5 88 Q27 80.5 38 83 Z"/>
<path class="gold o" d="M62 63 Q80 57 94 64 L92 71 Q78 65 62 70 Z"/>
<path class="turq o" d="M62 70 Q78 65 92 71 L88.5 79.5 Q76 72.5 62 77 Z"/>
<path class="lapis o" d="M62 77 Q76 72.5 88.5 79.5 L83.5 88 Q73 80.5 62 83 Z"/>
<path class="st-g" d="M44.6 53 L37.6 45.6 L41 41.4 M55.4 53 L62.4 45.6 L59 41.4"/>
<path class="st-g" d="M40 86 L31.6 94 L33 101 M60 86 L68.4 94 L67 101 M39.4 73 L30 71.6 M60.6 73 L70 71.6"/>
<path class="lapis o" d="M43.6 55.6 Q50 47.8 56.4 55.6 L55.4 59.4 L44.6 59.4 Z"/>
<path class="st-g1" d="M46 52.4 L48 49.6 M54 52.4 L52 49.6"/>
<path class="lapis o" d="M38 60 Q50 55 62 60 L62.4 67.6 L37.6 67.6 Z"/>
<path class="turq o" d="M37.6 67.6 Q36.4 94 50 102.6 Q63.6 94 62.4 67.6 Z"/>
<path class="ln-g" d="M50 67.6 L50 102"/>
<circle class="gold" cx="44.4" cy="78" r="1.5"/><circle class="gold" cx="55.6" cy="78" r="1.5"/>
<circle class="gold" cx="44" cy="88" r="1.2"/><circle class="gold" cx="56" cy="88" r="1.2"/>
<circle class="st-g" cx="50" cy="115" r="5.4"/>
<path class="st-g" d="M41.6 121.4 H58.4"/>
</svg>`;

/** The Deck of the Gods' figure for a rank, or null for pip cards (2–10). */
export function godsCourtSvg(rank) {
    switch (rank) {
        case 11: return HORUS_SVG;
        case 12: return ISIS_SVG;
        case 13: return OSIRIS_SVG;
        case 14: return KHEPRI_SVG;
        default: return null;
    }
}

/**
 * The winged sun (Behdet): the disc between two uraei, wings spread. Laid in
 * the effect layer behind the figure; unfolds as the card lands (style.css,
 * pdWings) and settles to a watermark.
 */
export const WINGED_SUN = `<svg class="pd-art" viewBox="0 0 100 34" aria-hidden="true" focusable="false">
<path class="gold" d="M43 13 Q25 3.6 2 7.6 Q16 13 18.6 17.6 Q30 20 43 21.4 Z"/>
<path class="gdeep" d="M43 21.4 Q30 20 18.6 17.6 Q23 24 26 26 Q35 26.4 43 27 Z"/>
<path class="gold" d="M57 13 Q75 3.6 98 7.6 Q84 13 81.4 17.6 Q70 20 57 21.4 Z"/>
<path class="gdeep" d="M57 21.4 Q70 20 81.4 17.6 Q77 24 74 26 Q65 26.4 57 27 Z"/>
<circle class="carn" cx="50" cy="17" r="7.4"/>
<path class="turq" d="M41.6 25 Q40.4 19 43 15.6 L44.4 16.6 Q42.6 19.4 43.4 25 Z M58.4 25 Q59.6 19 57 15.6 L55.6 16.6 Q57.4 19.4 56.6 25 Z"/>
</svg>`;

/** Where the stars sit, and when each lights (a wave from the centre out). */
export const STARS = Object.freeze([
    [50, 12, 0.34], [22, 18, 0.28], [78, 20, 0.24], [30, 34, 0.14], [70, 30, 0.16],
    [50, 50, 0.00], [18, 55, 0.22], [82, 52, 0.20], [34, 72, 0.12], [66, 76, 0.10],
    [26, 88, 0.26], [74, 90, 0.30]
]);
