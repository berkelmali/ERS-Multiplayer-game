/**
 * tools/build-content-pages.mjs — turn the hidden panels into real pages.
 *
 * WHY THIS EXISTS, measured before it was written:
 *
 *   · `public/` contained exactly ONE html file. About, Rules and Privacy were
 *     `display:none` panels inside it.
 *   · `index.html` contained **zero** `<a href>`. Every navigation was a
 *     `<button>` with a JS handler. For a person that works; for a crawler
 *     there is nothing to follow. Google's stated bar for showing ads is
 *     "enough valuable content ... and navigational elements", and the site
 *     had no navigational element that survives without JavaScript.
 *   · `firebase.json` rewrote `**` to `/index.html`, so every wrong URL
 *     answered 200 with the whole game instead of 404.
 *
 * That is the project's oldest defect class wearing a new hat: it renders, and
 * it does nothing.
 *
 * WHAT THIS DOES NOT DO: it does not copy any text. The pages are GENERATED
 * from the two files that already hold the content —
 *
 *     public/index.html        the structure, and the English text
 *     public/js/localization.js  the same text in tr, de, ru
 *
 * — so there is no second copy of the rules to keep in sync. `npm test`
 * section 65 regenerates every page in memory and fails if a file on disk
 * differs by one byte, which is the only thing that keeps a generator honest.
 *
 * Run: node tools/build-content-pages.mjs [--check]
 *   --check  writes nothing; exits non-zero if any file is missing or stale.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

/** The canonical origin. Used for <link rel="canonical"> and the sitemap. */
export const ORIGIN = 'https://ers-card-game.web.app';

/** Page id → the panel it is generated from, and its url slug. */
export const PAGES = Object.freeze([
    { slug: 'rules', panel: 'rules-panel' },
    { slug: 'about', panel: 'about-panel' },
    { slug: 'privacy', panel: 'privacy-panel' }
]);

/** Per-language chrome. Everything else on the page comes from localization. */
const CHROME = Object.freeze({
    en: { name: 'English', home: 'Play the game', nav: 'On this site', rules: 'Game Rules', about: 'About', privacy: 'Privacy Policy',
          desc: 'Egyptian Rat Screw in your browser — the full rules, how the site works, and what data it keeps.' },
    tr: { name: 'Türkçe', home: 'Oyunu oyna', nav: 'Bu sitede', rules: 'Oyun Kuralları', about: 'Hakkında', privacy: 'Gizlilik Politikası',
          desc: 'Tarayıcıda Egyptian Rat Screw — kuralların tamamı, sitenin nasıl çalıştığı ve hangi verileri tuttuğu.' },
    de: { name: 'Deutsch', home: 'Spiel starten', nav: 'Auf dieser Seite', rules: 'Spielregeln', about: 'Über das Spiel', privacy: 'Datenschutz',
          desc: 'Egyptian Rat Screw im Browser — die vollständigen Regeln, wie die Seite funktioniert und welche Daten sie speichert.' },
    ru: { name: 'Русский', home: 'Играть', nav: 'На этом сайте', rules: 'Правила игры', about: 'Об игре', privacy: 'Политика конфиденциальности',
          desc: 'Egyptian Rat Screw в браузере — полные правила, как устроен сайт и какие данные он хранит.' }
});

export const LANGS = Object.freeze(Object.keys(CHROME));

// ---------------------------------------------------------------------------
// A very small HTML scanner.
//
// No parser dependency, and no bare regex either: a regex that matches
// `<div ...>` up to the next `</div>` gets the FIRST close tag, not the
// matching one, and every panel here is nested three deep. So open/close tags
// of the same name are counted.
// ---------------------------------------------------------------------------

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** End index (exclusive) of the open tag that starts at `i`. */
function endOfOpenTag(html, i) {
    const gt = html.indexOf('>', i);
    if (gt === -1) throw new Error(`unterminated tag at ${i}`);
    return gt + 1;
}

/**
 * Given the index of `<name ...>`, returns { inner, end } where `inner` is the
 * element's inner HTML and `end` is the index just past its close tag.
 */
function elementAt(html, start) {
    const nameMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(start, start + 40));
    if (!nameMatch) throw new Error(`not a tag at ${start}`);
    const name = nameMatch[1].toLowerCase();
    const openEnd = endOfOpenTag(html, start);
    if (VOID.has(name) || html[openEnd - 2] === '/') return { name, inner: '', innerStart: openEnd, end: openEnd };

    const open = new RegExp(`<${name}(?=[\\s/>])`, 'gi');
    const close = new RegExp(`</${name}\\s*>`, 'gi');
    let depth = 1;
    let cursor = openEnd;
    while (depth > 0) {
        close.lastIndex = cursor;
        const c = close.exec(html);
        if (!c) throw new Error(`unclosed <${name}> from ${start}`);
        open.lastIndex = cursor;
        let o;
        let opens = 0;
        while ((o = open.exec(html)) && o.index < c.index) opens++;
        depth += opens - 1;
        cursor = c.index + c[0].length;
        if (depth === 0) return { name, inner: html.slice(openEnd, c.index), innerStart: openEnd, end: cursor };
    }
    throw new Error('unreachable');
}

/** Finds `<x ... id="theId" ...>` and returns the element. */
function elementById(html, id) {
    const at = html.indexOf(`id="${id}"`);
    if (at === -1) throw new Error(`no element with id="${id}"`);
    const start = html.lastIndexOf('<', at);
    return elementAt(html, start);
}

/** Finds the first descendant carrying `class="...cls..."`. */
function firstByClass(html, cls) {
    const re = new RegExp(`<[a-zA-Z][^>]*class="[^"]*\\b${cls}\\b[^"]*"`, 'i');
    const m = re.exec(html);
    if (!m) throw new Error(`no element with class ${cls}`);
    return elementAt(html, m.index);
}

/**
 * Replaces the inner HTML of every element carrying data-i18n with that key's
 * translation — the same rule `Localization.apply()` follows at runtime,
 * including its fallback: a key the language does not define keeps the English
 * text that is already in the markup. Matching that behaviour matters; a
 * generator that invented its own fallback would publish pages the app itself
 * would never render.
 */
function localize(html, dict) {
    const re = /<[a-zA-Z][a-zA-Z0-9-]*\s[^>]*data-i18n="([^"]+)"[^>]*>/g;
    let out = '';
    let cursor = 0;
    let m;
    while ((m = re.exec(html))) {
        const el = elementAt(html, m.index);
        const value = dict[m[1]];
        out += html.slice(cursor, el.innerStart);
        out += value === undefined ? el.inner : value;
        cursor = el.end - `</${el.name}>`.length;
        // Nested data-i18n elements are inside the text we just replaced, so
        // resume scanning after this element rather than inside it.
        re.lastIndex = el.end;
        out += html.slice(cursor, el.end);
        cursor = el.end;
    }
    return out + html.slice(cursor);
}

/** Buttons are app controls; a static page must not carry dead ones. */
function stripButtons(html) {
    let out = html;
    for (;;) {
        const at = out.search(/<button[\s>]/i);
        if (at === -1) return out;
        const el = elementAt(out, at);
        out = out.slice(0, at) + out.slice(el.end);
    }
}

/**
 * The panels sit under an `<h2>` panel title, so their section headings are
 * `<h3>`. On a standalone page the panel title becomes the `<h1>`, which would
 * leave the document jumping h1 → h3 with no h2 between. Promote one level.
 * Only section headings use these tags inside `.rules-content`.
 */
function promoteHeadings(html) {
    return html.replace(/<h3(?=[\s>])/gi, '<h2').replace(/<\/h3\s*>/gi, '</h2>');
}

/** Collapses the blank lines left behind by the strips, for a readable file. */
function tidy(html) {
    return html.split('\n').filter((l, i, a) => l.trim() !== '' || (a[i - 1] || '').trim() !== '').join('\n').trim();
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// The page shell
// ---------------------------------------------------------------------------

/**
 * Self-contained, but NOT invented.
 *
 * v3.16.0 gave these pages a generic dark stylesheet — system font, flat grey
 * cards. Side by side with the in-app Rules panel it read as a different
 * product, and that is what came back from the live site: "the design is much
 * worse than our own rules tab". It was.
 *
 * So every value below is LIFTED from public/style.css rather than chosen here:
 *
 *   Outfit 400/700/900        body { font-family: 'Outfit' }  — same Google
 *                             Fonts link index.html already uses, and already
 *                             admitted by the CSP (style-src / font-src).
 *   glass card                .rules-content   — var(--panel-bg), 1px
 *                             var(--panel-border), radius 16, the two-part
 *                             shadow, backdrop blur 12px
 *   section card              .rules-section   — rgba(255,255,255,.04),
 *                             border .07, radius 10, padding 12/14
 *   section heading           .rules-section h3 — .95rem/700/--primary/.5px
 *   page title                .panel-title     — 900, uppercase, 1.5px, hairline
 *   ground + artwork          --bg-color #0d1117 and assets/menu.jpg, the image
 *                             the menu is built on, behind a scrim
 *
 * The page still does NOT link style.css: those panels live under `.screen`,
 * which is display:none until the app reveals it, so inheriting the real
 * stylesheet would publish a blank page — the exact opposite of the point.
 * Copying the tokens is the compromise, and section 65 pins the ones that
 * matter so a theme change here cannot silently drift from the app.
 */
const STYLE = `
    :root {
        --bg: #0d1117;
        --fg: #e6edf3;
        --muted: rgba(230, 237, 243, 0.62);
        --primary: #58a6ff;
        --gold: #f59e0b;
        --gold-bright: #ffd700;
        --panel-bg: rgba(22, 27, 34, 0.75);
        --panel-border: rgba(255, 255, 255, 0.08);
        --panel-shadow: rgba(0, 0, 0, 0.6);
        --panel-glow: rgba(88, 166, 255, 0.15);
    }
    * { box-sizing: border-box; }
    /* The ground lives on <html>, NOT on body. body::before below is a negative
       z-index child; body does not create a stacking context, so that layer is
       painted into the ROOT context — above html's background but BELOW body's.
       Give body a background and it covers the artwork completely, which is
       exactly what the first draft of this page did: the image loaded, returned
       200, and was never seen. */
    html { background: var(--bg); }
    body {
        margin: 0;
        min-height: 100vh;
        color: var(--fg);
        font-family: 'Outfit', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 16px;
        line-height: 1.7;
        background: transparent;
    }
    /* The menu artwork, fixed and dimmed. It is what makes this page belong to
       the game rather than merely link to it. Behind a scrim, because the text
       has to stay readable on top of a photograph. */
    body::before {
        content: "";
        position: fixed;
        inset: 0;
        z-index: -1;
        background:
            linear-gradient(rgba(13, 17, 23, 0.72) 0%, rgba(13, 17, 23, 0.9) 45%, rgba(13, 17, 23, 0.97) 100%),
            /* 62%, not "top": the artwork has the painted EGYPTIAN RAT SCREW
               wordmark across its upper third, and at "top" it sits directly
               behind this page's own header text. Pushed down, the header reads
               against the table and the pyramids instead. */
            url("/assets/menu.jpg") center 62% / cover no-repeat;
    }
    .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 72px; }

    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
    a:focus-visible { outline: 3px solid var(--primary); outline-offset: 3px; border-radius: 4px; }

    /* --- header ------------------------------------------------------------ */
    .site-head { display: flex; flex-wrap: wrap; align-items: baseline;
                 justify-content: space-between; gap: 10px 20px; margin-bottom: 28px; }
    .wordmark {
        font-weight: 900; font-size: 0.95rem; letter-spacing: 2.5px;
        text-transform: uppercase;
        background: linear-gradient(180deg, var(--gold-bright), var(--gold));
        -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    .wordmark:hover { text-decoration: none; filter: brightness(1.15); }
    .site-nav { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 0.9rem; }
    .site-nav [aria-current] { color: var(--fg); font-weight: 700; }

    /* --- the card, lifted from .rules-content ------------------------------ */
    .panel {
        background: var(--panel-bg);
        border: 1px solid var(--panel-border);
        border-radius: 16px;
        padding: 1.75rem;
        box-shadow: 0 16px 40px var(--panel-shadow), 0 0 20px var(--panel-glow);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
    }
    h1 {
        font-size: 1.6rem; font-weight: 900; letter-spacing: 1.5px;
        text-transform: uppercase; text-align: center; text-wrap: balance;
        margin: 0 0 1.5rem; padding-bottom: 0.75rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    /* .rules-section, to the pixel */
    .rules-section {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 10px;
        padding: 14px 16px;
        margin: 0 0 10px;
    }
    .rules-section:last-child { margin-bottom: 0; }
    h2 {
        font-size: 0.95rem; font-weight: 700; letter-spacing: 0.5px;
        color: var(--primary); margin: 0 0 6px; line-height: 1.4;
    }
    p { margin: 0 0 0.6rem; }
    p:last-child { margin-bottom: 0; }
    ul { margin: 10px 0 0; padding-left: 20px; }
    li { margin-bottom: 4px; }
    li:last-child { margin-bottom: 0; }
    strong { color: #fff; }
    .privacy-updated { color: var(--muted); font-size: 0.85rem; margin: 0 0 1rem; }

    /* --- call to action, from .btn.primary --------------------------------- */
    .play {
        display: inline-block; margin: 1.75rem 0 0;
        background: var(--primary); color: #fff;
        font-weight: 700; font-size: 1rem;
        padding: 12px 26px; border-radius: 12px;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
        transition: transform 0.25s cubic-bezier(0.25, 1, 0.5, 1), background 0.25s;
    }
    .play:hover { background: #3fb950; transform: translateY(-2px); text-decoration: none; }
    .cta { text-align: center; }

    /* --- footer ------------------------------------------------------------ */
    .site-foot {
        margin-top: 28px; padding-top: 18px;
        border-top: 1px solid var(--panel-border);
        display: flex; flex-wrap: wrap; align-items: center;
        justify-content: space-between; gap: 10px 20px;
        font-size: 0.85rem; color: var(--muted);
    }
    .langs { display: flex; flex-wrap: wrap; gap: 6px; }
    .langs a {
        border: 1px solid var(--panel-border); border-radius: 999px;
        padding: 3px 11px; color: var(--muted);
    }
    .langs a:hover { color: var(--fg); border-color: var(--primary); text-decoration: none; }

    @media (max-width: 480px) {
        body { font-size: 15px; }
        .wrap { padding: 22px 14px 56px; }
        .panel { padding: 1.25rem; border-radius: 14px; }
        h1 { font-size: 1.3rem; letter-spacing: 1px; }
        .site-head { gap: 8px; }
    }
    @media (prefers-reduced-motion: reduce) {
        .play { transition: none; }
        .play:hover { transform: none; }
    }
`.trim();

function shell({ lang, slug, title, body }) {
    const c = CHROME[lang];
    const self = `${ORIGIN}/${lang}/${slug}`;
    const alts = LANGS.map((l) =>
        `    <link rel="alternate" hreflang="${l}" href="${ORIGIN}/${l}/${slug}">`).join('\n');
    const nav = PAGES.map(({ slug: s }) =>
        s === slug
            ? `<span aria-current="page">${esc(c[s])}</span>`
            : `<a href="/${lang}/${s}">${esc(c[s])}</a>`).join('\n                ');
    const langs = LANGS.filter((l) => l !== lang)
        .map((l) => `<a href="/${l}/${slug}" hreflang="${l}">${esc(CHROME[l].name)}</a>`).join('\n                ');

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>${esc(title)} — Egyptian Rat Screw</title>
    <meta name="description" content="${esc(c.desc)}">
    <link rel="canonical" href="${self}">
${alts}
    <link rel="alternate" hreflang="x-default" href="${ORIGIN}/en/${slug}">
    <link rel="icon" type="image/png" href="/assets/logo.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
${STYLE}
    </style>
</head>
<body>
    <div class="wrap">
        <header class="site-head">
            <a class="wordmark" href="/">Egyptian Rat Screw</a>
            <nav class="site-nav" aria-label="${esc(c.nav)}">
                ${nav}
            </nav>
        </header>
        <main class="panel">
            <h1>${esc(title)}</h1>
${body}
            <div class="cta"><a class="play" href="/">${esc(c.home)}</a></div>
        </main>
        <footer class="site-foot">
            <span>Berk Elmalı · Egyptian Rat Screw</span>
            <div class="langs">
                ${langs}
            </div>
        </footer>
    </div>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------

/**
 * Loads the four dictionaries out of the app's own localization module.
 *
 * `keys` must be supplied and the values SNAPSHOTTED, not read lazily.
 * `Localization.get()` reads a module-level `currentLang` that `setLanguage()`
 * mutates, so a lazy accessor handed back for 'en' answers in whatever language
 * was selected last — all four dictionaries become the same one. The probe
 * below is what caught that on the first run of this file.
 */
async function loadDictionaries(keys) {
    // localization.js is a browser module; `setLanguage` calls `apply()`, which
    // walks the DOM. A two-line stub is enough, and is checked below.
    globalThis.document = { querySelectorAll: () => [] };
    const { Localization } = await import('../public/js/localization.js');
    const dicts = {};
    for (const lang of LANGS) {
        if (!Localization.setLanguage(lang)) throw new Error(`localization.js has no '${lang}'`);
        const d = Object.create(null);
        for (const k of keys) {
            const v = Localization.get(k);
            if (v !== k) d[k] = v;                    // get() echoes unknown keys
        }
        dicts[lang] = d;
    }
    // Prove the loader works before trusting anything it returns: if the stub
    // had silently broken setLanguage, every language would read English and
    // this file would happily publish four identical page sets.
    const probe = 'rWinTitle';
    const seen = new Set(LANGS.map((l) => dicts[l][probe]));
    if (seen.size !== LANGS.length || [...seen].some((v) => v === undefined)) {
        throw new Error(`localization probe failed: '${probe}' did not differ across all ${LANGS.length} languages`);
    }
    return dicts;
}

/** Returns { 'en/rules.html': '<!DOCTYPE html>…', … } for every language. */
export async function buildAll() {
    const index = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
    const keys = [...new Set([...index.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]))];
    const dicts = await loadDictionaries(keys);
    const out = {};

    for (const { slug, panel } of PAGES) {
        const panelEl = elementById(index, panel);
        const titleKey = /<h2[^>]*data-i18n="([^"]+)"/.exec(panelEl.inner)?.[1];
        if (!titleKey) throw new Error(`${panel} has no <h2 data-i18n>`);
        const content = firstByClass(panelEl.inner, 'rules-content').inner;

        for (const lang of LANGS) {
            const d = dicts[lang];
            const title = d[titleKey] ?? /<h2[^>]*>([^<]*)</.exec(panelEl.inner)[1];
            const body = tidy(promoteHeadings(stripButtons(localize(content, d))))
                .split('\n').map((l) => '            ' + l.trim()).join('\n');
            out[`${lang}/${slug}.html`] = shell({ lang, slug, title, body });
        }
    }
    return out;
}

/** The sitemap lists the game plus every generated page, with its alternates. */
export function buildSitemap() {
    const urls = [{ loc: `${ORIGIN}/`, alts: null }];
    for (const { slug } of PAGES) {
        for (const lang of LANGS) urls.push({ loc: `${ORIGIN}/${lang}/${slug}`, slug, lang });
    }
    const body = urls.map((u) => {
        const alts = u.slug
            ? LANGS.map((l) => `        <xhtml:link rel="alternate" hreflang="${l}" href="${ORIGIN}/${l}/${u.slug}"/>`).join('\n') +
              `\n        <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/en/${u.slug}"/>\n`
            : '';
        return `    <url>\n        <loc>${u.loc}</loc>\n${alts}    </url>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${body}
</urlset>
`;
}

/** Every file this generator owns: relative path under public/ → content. */
export async function buildEverything() {
    return { ...(await buildAll()), 'sitemap.xml': buildSitemap() };
}

// --- CLI -------------------------------------------------------------------
//
// Behind a run-directly guard, because test_gameLogic.mjs IMPORTS this module
// to regenerate the pages in memory and compare. Without the guard, running
// the test suite would rewrite twelve files as a side effect of checking them,
// and the check could never fail.
//
// `pathToFileURL`, not a template string: `import.meta.url === 'file://' +
// process.argv[1]` is always false on Windows (argv[1] is `D:\neww\...`), so
// the hand-rolled version of this guard silently never runs the CLI — the same
// trap this project hit in v3.7.x.

async function main() {
    const check = process.argv.includes('--check');
    const files = await buildEverything();
    let stale = 0;

    for (const [rel, content] of Object.entries(files)) {
        const path = join(PUBLIC, rel);
        const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
        if (current === content) continue;
        stale++;
        if (check) {
            console.log(`  STALE  public/${rel}${current === null ? '  (missing)' : ''}`);
        } else {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, content, 'utf8');
            console.log(`  wrote  public/${rel}  (${content.length} bytes)`);
        }
    }

    if (check) {
        console.log(stale === 0
            ? `OK  ${Object.keys(files).length} generated files match their sources`
            : `FAIL  ${stale} file(s) do not match; run: node tools/build-content-pages.mjs`);
        process.exit(stale === 0 ? 0 : 1);
    }
    console.log(stale === 0
        ? `Nothing to do: ${Object.keys(files).length} files already current.`
        : `Done: ${stale} file(s) written, ${Object.keys(files).length} total.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
