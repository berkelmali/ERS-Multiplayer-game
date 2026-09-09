#!/usr/bin/env node
/**
 * tools/check-lobby.mjs — the lobby's stylesheet must style things that exist,
 * and must not undo the screen it is styling.
 *
 * ── Why this gate exists ─────────────────────────────────────────────────────
 * `public/lobby.css` arrived in v3.8.0 as 5KB of new CSS with no test touching
 * it, and it shipped three rules that matched nothing:
 *
 *     .lobby-edition                  -> 0 occurrences in index.html
 *     #main-menu .lobby-suit          -> 0 occurrences in index.html
 *     #main-menu h1 > span:first-child -> the <h1> had no <span>
 *
 * An "edition" line, a large suit glyph and a two-tone title were written,
 * reviewed, deployed, and never once drawn. That is this project's most
 * expensive recurring defect — code that renders but does nothing — arriving in
 * a new file precisely because no gate knew the file was there.
 *
 * CSS makes it worse than JS does: a selector that matches nothing throws no
 * error, logs nothing, and looks correct in the source forever.
 *
 * ── What is checked, and why each rule is mechanical ─────────────────────────
 * 1. Every class/id a lobby selector names must EXIST: in index.html's markup,
 *    or be added at runtime by a module under public/js/ (`classList.add`,
 *    `className =`, `classList.toggle`). Nothing is allowlisted by hand — a
 *    class absent from both is dead by construction, and the check maintains
 *    itself as the markup changes.
 *
 * 2. No full-viewport scrim above the artwork. `#parallax-scene` is z-index 1
 *    and `.screen` is 5; anything opaque in between exists only to dim the
 *    picture. v3.8.0's `body.menu-screen::after` at z-index 2 with
 *    `rgba(5,10,19,.94)` flattened five themed backgrounds into one blue-black.
 *    Readability scrims belong inside the content column.
 *
 * 3. No `!important` colour on the secondary buttons. Their hues are set inline
 *    in index.html, and only `!important` can beat an inline style — so a
 *    forced grey is never an accident, and it is the opposite of what the
 *    screen is for.
 *
 * 4. The play buttons keep a glow. `.vibrant-play` carries the theme colour out
 *    into the room; replacing it with a flat drop shadow is what turned an
 *    arcade lobby into a settings page.
 *
 *   node tools/check-lobby.mjs
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/** Platform-safe "am I the program being run?". See tools/csp-hash.mjs — the
 *  `file://` + argv spelling is always false on Windows, which silently turned
 *  a gate into a no-op for two releases. */
export function isMainModule(metaUrl, argv1) {
    if (!argv1) return false;
    try { return metaUrl === pathToFileURL(argv1).href; } catch { return false; }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** CSS with comments removed. Every scan in this project that skipped this step
 *  ended up matching its own documentation. */
export function stripCss(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Every class and id token named by a selector, in source order. */
export function selectorTokens(css) {
    const out = new Set();
    for (const m of stripCss(css).matchAll(/([^{}]+)\{/g)) {
        const sel = m[1].trim();
        if (!sel || sel.startsWith('@')) continue;
        for (const tok of sel.matchAll(/[.#][A-Za-z_][\w-]*/g)) out.add(tok[0]);
    }
    return [...out];
}

/** Does the markup carry this class or id? */
export function inMarkup(token, html) {
    const name = token.slice(1);
    if (token[0] === '#') return html.includes(`id="${name}"`);
    return new RegExp(`class="[^"]*\\b${name.replace(/[-]/g, '\\-')}\\b`).test(html);
}

/** Does any module add this class at runtime? Ids are never created this way in
 *  this codebase, so only classes qualify. */
export function addedByScript(token, scripts) {
    if (token[0] !== '.') return false;
    const name = token.slice(1);
    const re = new RegExp(
        `classList\\.(?:add|toggle|remove)\\([^)]*['"\`]${name}['"\`]|className\\s*=\\s*['"\`][^'"\`]*\\b${name}\\b`);
    return scripts.some(src => re.test(src));
}

function main() {
    // v3.9.0: lobby.css is gone — the lobby went back to the v3.7 design and
    // its overrides went with it. The REGRESSIONS it introduced can be made
    // just as easily in style.css, so the gate follows the rules rather than
    // the filename: it reads every stylesheet public/index.html actually links.
    const html0 = readFileSync(join(root, 'public/index.html'), 'utf8');
    const linked = [...html0.matchAll(/<link[^>]+href="([^"]+\.css)(?:\?[^"]*)?"/g)]
        .map(m => m[1]).filter(h => !/^https?:/.test(h));
    const sheets = linked.filter(f => existsSync(join(root, 'public', f)));
    if (!sheets.length) {
        console.error('check-lobby: index.html links no local stylesheet.');
        process.exit(1);
    }
    const css = sheets.map(f => readFileSync(join(root, 'public', f), 'utf8')).join('\n');
    const bare = stripCss(css);
    const html = readFileSync(join(root, 'public/index.html'), 'utf8');
    const jsDir = join(root, 'public/js');
    const scripts = readdirSync(jsDir).filter(f => f.endsWith('.js'))
        .map(f => readFileSync(join(jsDir, f), 'utf8'));

    let failed = 0;
    const fail = (msg, detail) => {
        failed++;
        console.error(`  x ${msg}`);
        if (detail) console.error(`      ${detail}`);
    };
    const pass = (msg) => console.log(`  \u2713 ${msg}`);

    // 1 — no selector may name something that does not exist.
    //
    //     Scoped to SMALL, dedicated stylesheets. style.css is 134KB of a
    //     decade's markup, hundreds of whose selectors target elements built
    //     at runtime by modules this scan cannot follow; running the check
    //     against it would produce a wall of false positives, and a gate that
    //     cries wolf gets switched off. lobby.css was 5KB and shipped three
    //     rules matching nothing — that is the shape this catches, and it arms
    //     itself the moment another focused stylesheet appears.
    const small = sheets.filter(f => readFileSync(join(root, 'public', f), 'utf8').length < 40000);
    if (!small.length) {
        pass(`no small stylesheet to scan for dead selectors (${sheets.join(', ')} exceed the limit)`);
    } else {
        const dead = [];
        for (const f of small) {
            const src = readFileSync(join(root, 'public', f), 'utf8');
            for (const t of selectorTokens(src)) {
                if (!inMarkup(t, html) && !addedByScript(t, scripts)) dead.push(`${f}:${t}`);
            }
        }
        if (dead.length) {
            fail('every selector in a dedicated stylesheet names something that exists',
                 `dead: ${dead.join(', ')} — absent from index.html and never added by public/js/*.js`);
        } else {
            pass(`${small.join(', ')} — no dead selectors`);
        }
    }

    // 2 — nothing opaque may sit between the artwork and the interface.
    //     Matched on the declaration block, not on the file, so a scrim inside
    //     #main-menu (which rides at .screen's z-index 5) stays legal.
    const bodyScrim = /body\.menu-screen::(?:after|before)\s*\{([^}]*)\}/g;
    let scrimTrouble = null;
    for (const m of bare.matchAll(bodyScrim)) {
        const body = m[1];
        const z = /z-index:\s*(\d+)/.exec(body);
        // The alpha channel is whatever follows the LAST comma (or the `/` in
        // the space-separated form). Greedy `[^)]*` backtracks to that comma on
        // purpose. An earlier spelling put `\.?` OUTSIDE the capture group, so
        // `.94` was read as `94`, filtered out as "not an alpha", and the
        // v3.8.0 scrim sailed through its own regression test — caught only
        // because the mutation round replayed the real file. A gate's blind
        // spot is worse than no gate.
        const alpha = [
            ...body.matchAll(/rgba?\([^)]*,\s*([0-9]*\.?[0-9]+)\s*\)/g),
            ...body.matchAll(/rgba?\([^)]*\/\s*([0-9]*\.?[0-9]+%?)\s*\)/g)
        ].map(a => (a[1].endsWith('%') ? parseFloat(a[1]) / 100 : parseFloat(a[1])))
         .filter(n => Number.isFinite(n) && n <= 1);
        const maxAlpha = alpha.length ? Math.max(...alpha) : 0;
        if (z && Number(z[1]) >= 2 && Number(z[1]) < 5 && maxAlpha > 0.5) {
            scrimTrouble = `z-index ${z[1]}, opacity up to ${maxAlpha}`;
        }
    }
    if (scrimTrouble) {
        fail('no full-viewport scrim sits between the artwork (z:1) and the interface (z:5)',
             `${scrimTrouble} — this can only dim the themed background`);
    } else {
        pass('the artwork is not covered by a body-level scrim');
    }

    // 3 — the secondary buttons keep the colours index.html gives them.
    const subBlocks = [...bare.matchAll(/\.sleek-sub[^{}]*\{([^}]*)\}/g)].map(m => m[1]).join('\n');
    const forcedColour = /(?:^|[;\s])(color|border-color|background(?:-color)?)\s*:[^;]*!important/i.test(subBlocks);
    if (forcedColour) {
        fail('the secondary buttons are not forced to one colour',
             '`!important` on colour beats the inline hues in index.html — Shop gold, Daily sky, Slap IQ mint');
    } else {
        pass('secondary buttons keep their per-button colours');
    }

    // 4 — the play buttons still throw light.
    // Either spelling counts: v3.7 puts the glow on the `.vibrant-play` class,
    // v3.8.0 targeted `#btn-play-bots` by id. What must survive is a box-shadow
    // carrying the THEME colour — the thing that makes the button light the
    // room — not the selector that happens to carry it this release.
    const playGlow = [/\.btn\.vibrant-play[^{}]*\{[^}]*box-shadow:[^;]*/,
                      /#btn-play-bots[^{}]*\{[^}]*box-shadow:[^;]*/]
        .map(re => (re.exec(bare) || [''])[0])
        .some(decl => /var\(--primary\)|color-mix\([^)]*--primary/.test(decl));
    if (!playGlow) {
        fail('the primary play button still carries the theme glow',
             'a flat drop shadow in place of `0 0 Npx var(--primary)` is what made the lobby read as a form');
    } else {
        pass('the play button carries the theme colour into the room');
    }

    // 5 — motion is opt-out, always.
    if (!/prefers-reduced-motion/.test(bare)) {
        fail('reduced motion is honoured', 'no @media (prefers-reduced-motion: reduce) block');
    } else {
        pass('reduced motion is honoured');
    }

    if (failed) {
        console.error(`\ncheck-lobby: FAILED (${failed})`);
        process.exit(1);
    }
    console.log('\ncheck-lobby: OK');
    return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) main();
