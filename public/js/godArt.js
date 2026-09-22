/**
 * godArt.js — portraits of the gods of the Pantheon table, as inline SVG.
 *
 * Drawn in the manner of tomb painting: flat colour, hard black outline, a
 * profile facing right, a broad collar (wesekh) of beaded rows, and each god's
 * attribute on the head. One viewBox (0 0 120 120) for all six so the HUD and
 * the Pantheon hall can place them interchangeably.
 */
const INK = '#1a1410';

/** Medallion + collar shared by every god. */
function frame(key, bg, rim, collar, inner, uid) {
    const id = `${key}-${uid}`;
    const [c1, c2, c3] = collar;
    return `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" class="god-art" role="img" aria-hidden="true">
  <defs>
    <radialGradient id="bg-${id}" cx="40%" cy="35%" r="75%">
      <stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/>
    </radialGradient>
    <linearGradient id="rim-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff1b0"/><stop offset=".5" stop-color="${rim}"/><stop offset="1" stop-color="#6b4a0e"/>
    </linearGradient>
    <clipPath id="clip-${id}"><circle cx="60" cy="60" r="54"/></clipPath>
  </defs>
  <circle cx="60" cy="60" r="58" fill="url(#rim-${id})"/>
  <circle cx="60" cy="60" r="54" fill="url(#bg-${id})"/>
  <g clip-path="url(#clip-${id})">
    ${inner}
    <!-- wesekh collar -->
    <path d="M18 120 Q22 92 52 88 L74 88 Q100 92 104 120 Z" fill="${c1}" stroke="${INK}" stroke-width="1.6"/>
    <path d="M24 120 Q28 98 53 94 L73 94 Q96 98 99 120" fill="none" stroke="${c2}" stroke-width="4"/>
    <path d="M29 120 Q33 104 54 100 L72 100 Q92 104 94 120" fill="none" stroke="${c3}" stroke-width="4"/>
    <path d="M34 120 Q38 109 55 106 L71 106 Q88 109 89 120" fill="none" stroke="${c2}" stroke-width="3.4" stroke-dasharray="2.4 2"/>
  </g>
  <circle cx="60" cy="60" r="54" fill="none" stroke="${INK}" stroke-opacity=".55" stroke-width="1.2"/>
</svg>`;
}

/** The kohl-lined Egyptian eye, drawn at (x, y) facing right. */
function eye(x, y, iris = INK, s = 1) {
    return `
    <g transform="translate(${x} ${y}) scale(${s})">
      <path d="M-7 0 Q0 -5 8 0 Q0 4 -7 0 Z" fill="#fbf4e2" stroke="${INK}" stroke-width="1.3"/>
      <circle cx="1" cy="0" r="2.3" fill="${iris}"/>
      <path d="M8 0 L15 -1.2" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M-8 -5 Q0 -9 9 -5" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
    </g>`;
}

/**
 * Paint builders, one per god. Each takes a `uid` so two copies of the same
 * portrait on one page (the Pantheon hall and the table HUD) never share
 * gradient ids — a url(#id) that resolves into a display:none subtree paints
 * nothing in Chromium.
 */
const PAINT = {
    /* Bastet — the cat of Bubastis. Black, gold earring, green eye. */
    bastet: (uid) => frame('bastet', ['#3f6a5a', '#152c26'], '#d4af37', ['#1f6b68', '#e3b93c', '#9a4a2c'], `
    <path d="M38 96 Q34 70 44 54 L42 20 L56 40 Q62 38 68 40 L80 22 L80 48 Q92 56 94 66 Q96 74 88 76 L78 78 Q72 90 74 96 Z"
          fill="#1b1716" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M46 26 L54 40 L47 44 Z" fill="#6b3d3d"/>
    <path d="M78 27 L78 45 L71 41 Z" fill="#6b3d3d"/>
    <path d="M88 66 Q92 67 94 66" stroke="#6b3d3d" stroke-width="2" stroke-linecap="round"/>
    <path d="M86 70 L100 68 M86 72 L100 74" stroke="#cfc6b8" stroke-width=".8"/>
    ${eye(74, 57, '#39c46e', 0.9)}
    <circle cx="52" cy="70" r="5" fill="none" stroke="#e3b93c" stroke-width="2.2"/>
    <path d="M40 84 Q60 80 76 86" fill="none" stroke="#e3b93c" stroke-width="2.4"/>`, uid),

    /* Thoth — the ibis, lord of writing and reckoning, with the lunar disk. */
    thoth: (uid) => frame('thoth', ['#4a5f8a', '#18223a'], '#d4af37', ['#2c4f8a', '#f4f4f6', '#e3b93c'], `
    <circle cx="58" cy="22" r="11" fill="#e9e6da" stroke="${INK}" stroke-width="1.4"/>
    <path d="M46 26 Q58 38 70 26" fill="none" stroke="#e3b93c" stroke-width="3"/>
    <path d="M34 96 L34 44 Q40 32 56 32 Q70 32 74 44 L74 96 Z" fill="#2c4f8a" stroke="${INK}" stroke-width="1.6"/>
    <path d="M36 50 H72 M36 58 H72 M36 66 H72 M36 74 H72 M36 82 H72 M36 90 H72" stroke="#f4f4f6" stroke-width="3.2"/>
    <path d="M50 88 Q48 64 56 48 Q64 38 72 44 Q78 50 76 60 Q74 70 66 74 Q62 82 62 90 Z" fill="#141210" stroke="${INK}" stroke-width="1.6"/>
    <path d="M74 52 Q92 56 102 76 Q104 80 101 80 Q92 64 74 60 Z" fill="#141210" stroke="${INK}" stroke-width="1.2"/>
    ${eye(68, 52, '#e3b93c', 0.7)}`, uid),

    /* Hathor — lady of love and music: cow horns cradling the red sun. */
    hathor: (uid) => frame('hathor', ['#b86b5a', '#4a1f1a'], '#d4af37', ['#1f6b68', '#e3b93c', '#b3342a'], `
    <path d="M30 34 Q28 12 50 8" fill="none" stroke="#efe6cf" stroke-width="7" stroke-linecap="round"/>
    <path d="M30 34 Q28 12 50 8" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="0" opacity=".5"/>
    <path d="M86 34 Q90 12 68 8" fill="none" stroke="#efe6cf" stroke-width="7" stroke-linecap="round"/>
    <circle cx="58" cy="18" r="12" fill="#c8321f" stroke="${INK}" stroke-width="1.5"/>
    <path d="M66 14 Q72 18 66 24" fill="none" stroke="#e3b93c" stroke-width="2"/>
    <path d="M30 96 Q26 60 34 44 Q44 30 62 32 Q80 34 82 50 L82 96 Z" fill="#141210" stroke="${INK}" stroke-width="1.6"/>
    <path d="M60 44 Q74 42 80 50 L84 60 Q88 64 84 66 L82 70 Q84 74 80 76 Q78 80 72 80 L66 82 Q62 86 62 92 L56 92 Q56 70 60 44 Z"
          fill="#c98a5a" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M76 75 Q79 76 81 75" stroke="#8f2d2a" stroke-width="2" stroke-linecap="round"/>
    ${eye(72, 56, INK, 0.8)}
    <path d="M30 60 Q34 76 38 92 M36 56 Q40 74 44 92 M42 52 Q46 72 50 92" stroke="#2a2420" stroke-width="1.4"/>
    <circle cx="62" cy="66" r="3.4" fill="#e3b93c" stroke="${INK}" stroke-width="1"/>`, uid),

    /* Anubis — the jackal who weighs the heart against the feather. */
    anubis: (uid) => frame('anubis', ['#6b5a2a', '#241d0c'], '#d4af37', ['#1c2d4b', '#e3b93c', '#1f6b68'], `
    <path d="M26 96 L28 52 Q34 40 44 40 L70 44 L72 96 Z" fill="#1c2d4b" stroke="${INK}" stroke-width="1.6"/>
    <path d="M30 56 L70 58 M30 64 L70 66 M30 72 L70 74 M30 80 L70 82 M30 88 L70 90" stroke="#e3b93c" stroke-width="3.4"/>
    <path d="M42 90 Q40 66 46 52 L44 16 L58 38 L62 14 L68 42 Q80 48 90 54 L106 62 Q108 68 102 70 L84 72 Q74 78 66 80 Q62 86 62 92 Z"
          fill="#141210" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M47 24 L54 38 L48 40 Z" fill="#3a2a18"/>
    <path d="M62 22 L65 40 L60 38 Z" fill="#3a2a18"/>
    <path d="M86 70 L102 68" stroke="#e3b93c" stroke-width="1.6" stroke-linecap="round"/>
    ${eye(72, 53, '#e3b93c', 0.8)}
    <path d="M60 56 Q58 70 64 78" fill="none" stroke="#e3b93c" stroke-width="1.4" opacity=".7"/>`, uid),

    /* Set — lord of the desert storm: curved snout, square-topped ears. */
    set: (uid) => frame('set', ['#c46b32', '#4a1d0c'], '#d4af37', ['#8a2c1c', '#e3b93c', '#1c2d4b'], `
    <path d="M22 72 Q40 60 60 66 M18 84 Q44 70 70 78 M26 60 Q44 50 62 56" fill="none" stroke="#f0c27a" stroke-width="1.6" opacity=".45"/>
    <path d="M44 92 Q40 68 48 56 L46 26 L50 18 L56 18 L56 48 L60 48 L62 22 L66 16 L72 16 L68 50 Q80 54 88 60 Q100 66 104 76 Q104 82 98 80 Q90 76 82 76 Q74 80 68 82 Q64 88 64 94 Z"
          fill="#8a2c1c" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M46 18 H58 M62 16 H74" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    ${eye(74, 60, '#f0c27a', 0.8)}
    <path d="M84 72 Q92 72 98 78" fill="none" stroke="#4a1d0c" stroke-width="1.4"/>`, uid),

    /* Ra — the falcon of the sun, crowned with the disk and the cobra. */
    ra: (uid) => frame('ra', ['#e0a640', '#6b3a0c'], '#fff0a6', ['#1f6b68', '#e3b93c', '#b3342a'], `
    <g opacity=".5" stroke="#fff3c0" stroke-width="2">
      <path d="M58 20 L58 2 M40 26 L28 12 M76 26 L88 12 M34 40 L18 34 M82 40 L98 34"/>
    </g>
    <circle cx="58" cy="22" r="15" fill="#e8421f" stroke="${INK}" stroke-width="1.6"/>
    <circle cx="54" cy="18" r="5" fill="#ff8a5a" opacity=".6"/>
    <path d="M66 38 Q74 30 70 22 Q76 24 76 32 Q76 40 70 42 Z" fill="#e3b93c" stroke="${INK}" stroke-width="1.2"/>
    <path d="M28 96 L30 50 Q38 38 52 38 L72 42 L72 96 Z" fill="#1f6b68" stroke="${INK}" stroke-width="1.6"/>
    <path d="M32 56 L70 58 M32 64 L70 66 M32 72 L70 74 M32 80 L70 82 M32 88 L70 90" stroke="#e3b93c" stroke-width="3.4"/>
    <path d="M44 92 Q40 64 52 52 Q62 42 76 45 Q86 49 90 57 L95 59 Q100 61 99 66 Q97 71 93 73 Q91 68 87 67 Q81 77 71 80 Q66 86 66 92 Z"
          fill="#efe4c8" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M52 52 Q62 42 77 45 Q86 49 89 56 Q79 53 70 56 Q60 59 52 52 Z" fill="#2c4f8a" stroke="${INK}" stroke-width="1"/>
    <path d="M88 57 Q97 58 99.5 64 Q99.5 70 94 73.5 Q94.5 67.5 90 66 Z" fill="${INK}"/>
    <circle cx="88.5" cy="60" r="2.2" fill="#e3b93c" stroke="${INK}" stroke-width=".8"/>
    ${eye(75, 59, '#8a4a12', 0.8)}
    <path d="M73 63 Q74 72 67 79" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
`, uid),
    /* The tomb's guardians (v3.18.0, Firavunun Mezarı). */

    /* A mummy: linen bands, a painted death-mask gaze through the wrappings. */
    mummy: (uid) => frame('mummy', ['#5a4a32', '#1c160e'], '#d4af37', ['#8a6a3a', '#e3b93c', '#1f6b68'], `
    <path d="M36 96 Q30 60 40 40 Q52 24 70 28 Q86 32 88 52 Q90 66 84 78 L82 96 Z" fill="#d9cba6" stroke="${INK}" stroke-width="1.6"/>
    <path d="M38 44 Q60 36 86 48 M36 54 Q62 46 88 58 M36 64 Q62 58 88 68 M36 74 Q60 70 86 78 M38 84 Q60 80 84 88" fill="none" stroke="#a8966c" stroke-width="3"/>
    <path d="M40 40 Q60 50 84 42" fill="none" stroke="#8f7c52" stroke-width="1.4"/>
    <path d="M58 52 Q70 48 82 54 L82 62 Q70 66 58 62 Z" fill="#241a10"/>
    ${eye(70, 57, '#e3b93c', 0.7)}
    <path d="M44 30 Q56 24 70 30" fill="none" stroke="#a8966c" stroke-width="3"/>`, uid),

    /* A cobra: Wadjet rearing, hood spread, gold-banded. */
    cobra: (uid) => frame('cobra', ['#2f6a4a', '#0c2418'], '#d4af37', ['#1c2d4b', '#e3b93c', '#b3342a'], `
    <path d="M60 104 Q56 90 60 76" fill="none" stroke="#141210" stroke-width="13" stroke-linecap="round"/>
    <path d="M60 104 Q56 90 60 76" fill="none" stroke="#e3b93c" stroke-width="3" stroke-dasharray="4 5"/>
    <path d="M30 54 Q22 28 44 18 Q60 12 76 18 Q98 28 90 54 Q80 74 60 78 Q40 74 30 54 Z" fill="#17362a" stroke="${INK}" stroke-width="1.6"/>
    <path d="M40 52 Q36 36 48 28 Q60 24 72 28 Q84 36 80 52 Q72 66 60 68 Q48 66 40 52 Z" fill="#e3b93c" stroke="${INK}" stroke-width="1.2"/>
    <path d="M46 40 H74 M44 48 H76 M48 56 H72 M52 63 H68" stroke="#b3342a" stroke-width="3"/>
    <ellipse cx="60" cy="24" rx="12" ry="9" fill="#141210" stroke="${INK}" stroke-width="1.2"/>
    <circle cx="55" cy="22" r="2.4" fill="#e8421f"/><circle cx="65" cy="22" r="2.4" fill="#e8421f"/>
    <path d="M60 32 L60 38 M60 38 L57 42 M60 38 L63 42" stroke="#b3342a" stroke-width="1.4" stroke-linecap="round"/>`, uid),

    /* The pharaoh: striped nemes, the uraeus at the brow, the braided beard. */
    pharaoh: (uid) => frame('pharaoh', ['#3a4f8a', '#10182e'], '#fff0a6', ['#1f6b68', '#e3b93c', '#1c2d4b'], `
    <path d="M24 98 L30 40 Q40 18 62 18 Q82 18 88 36 L92 60 L86 98 Z" fill="#e3b93c" stroke="${INK}" stroke-width="1.6"/>
    <path d="M30 46 L88 46 M29 56 L90 56 M28 66 L91 66 M27 76 L90 76 M26 86 L88 86" stroke="#2c4f8a" stroke-width="4.6"/>
    <path d="M38 32 Q44 24 60 22 M34 40 Q46 30 62 28" stroke="#2c4f8a" stroke-width="4" fill="none"/>
    <path d="M50 96 Q46 70 52 52 Q60 40 74 42 Q84 44 86 54 L88 62 Q92 66 88 68 L86 72 Q88 76 84 78 Q82 82 76 82 L72 84 Q70 86 70 90 L66 96 Z"
          fill="#b77a4a" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M52 42 Q70 34 86 44 L86 50 Q70 42 54 48 Z" fill="#e3b93c" stroke="${INK}" stroke-width="1"/>
    <path d="M84 40 Q88 30 84 26 Q80 30 82 36 Q80 40 84 40 Z" fill="#e3b93c" stroke="${INK}" stroke-width="1"/>
    ${eye(76, 57, INK, 0.8)}
    <path d="M78 77 Q82 78 84 77" stroke="#7a2a20" stroke-width="2" stroke-linecap="round"/>
    <path d="M72 86 L74 100 Q76 104 80 100 L78 86 Z" fill="#2a2016" stroke="${INK}" stroke-width="1"/>
    <path d="M73 90 H79 M74 94 H79 M75 98 H79" stroke="#e3b93c" stroke-width="1"/>`, uid)
};

export const GOD_ORDER = Object.freeze(['bastet', 'thoth', 'hathor', 'anubis', 'set', 'ra']);

/**
 * Emblems for the Legends modes (v3.18.0): the same medallion and rim as the
 * gods, without the collar — a place, not a person.
 */
function emblem(key, bg, rim, inner, uid) {
    const id = `${key}-${uid}`;
    return `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" class="god-art" role="img" aria-hidden="true">
  <defs>
    <radialGradient id="bg-${id}" cx="50%" cy="35%" r="80%">
      <stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/>
    </radialGradient>
    <linearGradient id="rim-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff1b0"/><stop offset=".5" stop-color="${rim}"/><stop offset="1" stop-color="#6b4a0e"/>
    </linearGradient>
    <radialGradient id="glow-${id}" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffd27a" stop-opacity=".9"/><stop offset="1" stop-color="#ff8a3a" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="clip-${id}"><circle cx="60" cy="60" r="54"/></clipPath>
  </defs>
  <circle cx="60" cy="60" r="58" fill="url(#rim-${id})"/>
  <circle cx="60" cy="60" r="54" fill="url(#bg-${id})"/>
  <g clip-path="url(#clip-${id})">${inner.replace(/GLOW/g, `url(#glow-${id})`)}</g>
  <circle cx="60" cy="60" r="54" fill="none" stroke="${INK}" stroke-opacity=".55" stroke-width="1.2"/>
</svg>`;
}

const EMBLEMS = {
    /* The Duat: Ra's night barque on the waters of the underworld, under stars. */
    duat: (uid) => emblem('duat', ['#24366e', '#070a1c'], '#d4af37', `
    <g fill="#fff3c0">
      <circle cx="24" cy="30" r="1.2"/><circle cx="40" cy="18" r="1"/><circle cx="84" cy="22" r="1.3"/>
      <circle cx="98" cy="40" r="1"/><circle cx="32" cy="46" r=".9"/><circle cx="70" cy="14" r=".9"/><circle cx="90" cy="58" r=".8"/>
    </g>
    <circle cx="60" cy="54" r="13" fill="#e8421f" stroke="${INK}" stroke-width="1.4"/>
    <circle cx="56" cy="50" r="4" fill="#ff8a5a" opacity=".6"/>
    <path d="M22 66 Q60 84 98 66 L94 62 Q60 76 26 62 Z" fill="#e3b93c" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M22 66 Q16 58 20 50 M98 66 Q104 58 100 50" fill="none" stroke="#e3b93c" stroke-width="3" stroke-linecap="round"/>
    <path d="M46 64 L46 70 M60 66 L60 73 M74 64 L74 70" stroke="${INK}" stroke-width="1.2" opacity=".6"/>
    <path d="M8 86 L16 80 L24 86 L32 80 L40 86 L48 80 L56 86 L64 80 L72 86 L80 80 L88 86 L96 80 L104 86 L112 80"
          fill="none" stroke="#6f8fe0" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M8 98 L16 92 L24 98 L32 92 L40 98 L48 92 L56 98 L64 92 L72 98 L80 92 L88 98 L96 92 L104 98 L112 92"
          fill="none" stroke="#3c5aa8" stroke-width="2.4" stroke-linejoin="round"/>`, uid),

    /* The tomb: a pyramid with its door open and a torch burning inside. */
    tomb: (uid) => emblem('tomb', ['#e0a640', '#5a2e0c'], '#d4af37', `
    <path d="M0 96 Q60 88 120 96 L120 120 L0 120 Z" fill="#b9853a"/>
    <path d="M60 18 L104 94 L16 94 Z" fill="#d9a55a" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M60 18 L104 94 L60 94 Z" fill="#b7843f"/>
    <path d="M34 64 H86 M26 78 H94 M44 48 H76 M52 34 H68" stroke="#8a5a22" stroke-width="1.2" opacity=".7"/>
    <circle cx="60" cy="80" r="16" fill="GLOW"/>
    <path d="M52 94 L52 74 Q60 66 68 74 L68 94 Z" fill="#1a1008" stroke="${INK}" stroke-width="1.4"/>
    <path d="M60 86 Q56 80 60 74 Q64 80 60 86 Z" fill="#ffb347"/>
    <path d="M60 84 Q58.5 81 60 78 Q61.5 81 60 84 Z" fill="#fff0a6"/>
    <path d="M59 86 L59 93 M61 86 L61 93" stroke="#6b3d18" stroke-width="1.6"/>`, uid)
};

let _uid = 0;
/** A fresh copy of a god's portrait as an SVG string. */
export function godSvg(godId) {
    const paint = PAINT[godId] || EMBLEMS[godId];
    return paint ? paint(`u${++_uid}`) : '';
}
