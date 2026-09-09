#!/usr/bin/env node
/**
 * tools/check-orphan-classes.mjs — markup may not name a class that no
 * stylesheet defines.
 *
 * ── Why this gate exists ─────────────────────────────────────────────────────
 * `check-lobby.mjs` catches CSS that styles nothing. This is the OTHER
 * direction, and it turned out to be the expensive one.
 *
 * v3.8.0 added a "player card" to the account panel — an avatar, an eyebrow
 * label, four statistics in a grid — and shipped the markup with NO STYLESHEET
 * RULES AT ALL. Seven classes were named in index.html and defined nowhere:
 *
 *     .profile-identity  .profile-emblem   .profile-eyebrow  .profile-stats
 *     .profile-stat      .profile-intro    .profile-history-note
 *
 * The browser drew exactly what it was told to: bare inline text. The ♠ avatar
 * was a 12px glyph. Every statistic ran its label into its value — "Skor1",
 * "Oynanan maç0" — because a <span> and a <strong> with no rules are inline
 * siblings with nothing between them. The win-rate line was clipped by the card
 * below it. This shipped through v3.8.0 and v3.9.0 and was found by a user
 * looking at the screen, which is the most expensive way to find anything.
 *
 * Nothing could have caught it. The unit suite reads logic, not layout.
 * `check-locales` proved every one of those labels TRANSLATED correctly — into
 * a panel where they were unreadable. `check-lobby` scans stylesheets for dead
 * selectors and by construction cannot see a class that is in no stylesheet.
 *
 * ── The rule, and why it has exactly one exemption ───────────────────────────
 * A class named in markup must be defined in a stylesheet, UNLESS every element
 * carrying it also carries an inline `style` attribute. That exemption is not a
 * convenience: `.spinner`, `.invite-code-badge` and `.boot-error-tech` are all
 * fully styled inline on purpose — the boot error screen in particular must
 * render before any stylesheet has loaded, which is the entire point of it. For
 * those, the class is a label, not a selector, and the element is not naked.
 *
 * Measured on the v3.9.0 tree: 138 classes in markup, 15 with no CSS rule, 8 of
 * them inline-styled — leaving exactly the 7 above. Zero false positives. That
 * ratio is what makes this gate safe to fail the build on; a gate that cries
 * wolf gets switched off (see DECISIONS #15).
 *
 * JavaScript-built markup counts too. `profileUI.js` and `botNemesis.js` write
 * rows with `class="..."` in template literals, and a class invented there is
 * exactly as invisible as one invented in index.html.
 *
 *   node tools/check-orphan-classes.mjs
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/** Platform-safe "am I the program being run?". The `file://` + argv spelling
 *  is always false on Windows and silently turned the CSP gate into a no-op for
 *  two releases — see tools/csp-hash.mjs and DECISIONS #27. */
export function isMainModule(metaUrl, argv1) {
    if (!argv1) return false;
    try { return metaUrl === pathToFileURL(argv1).href; } catch { return false; }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** CSS with comments removed. Every scan in this project that skipped this
 *  step ended up matching its own documentation (DECISIONS #25). */
export function stripCss(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Every class name any selector in this CSS mentions.
 * Deliberately loose: `.a.b`, `.a .b`, `.a:hover`, `.a::after` and
 * `.a[data-x]` all count as defining `a`. A gate that fails the build must
 * err toward "this is defined", never toward a false accusation.
 */
export function definedClasses(css) {
    const out = new Set();
    for (const m of stripCss(css).matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) out.add(m[1]);
    return out;
}

/**
 * A legal CSS identifier that is not an interpolation stump.
 *
 * `class="log-${type}"` becomes `class="log-"` once interpolations are gone,
 * and `log-` is a PREFIX completed at runtime, never a class in its own right.
 * A real class never ends in a hyphen, so that is the whole test.
 */
export function isClassName(name) {
    return /^-?[A-Za-z_][\w-]*$/.test(name) && !name.endsWith('-');
}

/**
 * Classes a module uses to FIND an element rather than to style it:
 * `querySelector('.x')`, `closest('.x')`, `matches('.x')`,
 * `getElementsByClassName('x')`.
 *
 * The second and last legitimate reason a class can carry no rule. The error
 * screen's buttons are the case in point: they take their looks from
 * `btn primary` / `btn secondary`, and `.ers-error-retry` exists purely so
 * `errorScreen.js` can reach the right one. That class has a job; it is not
 * naked markup. Like the inline-style exemption, this is derived from the
 * source, never from a hand-maintained list — an allowlist is how a gate
 * starts lying (DECISIONS #15).
 */
export function queriedClasses(src) {
    const out = new Set();
    const pats = [
        /querySelector(?:All)?\(\s*['"`]([^'"`]*)['"`]/g,
        /\.closest\(\s*['"`]([^'"`]*)['"`]/g,
        /\.matches\(\s*['"`]([^'"`]*)['"`]/g,
        /getElementsByClassName\(\s*['"`]([\w-]+)['"`]/g
    ];
    for (const re of pats) {
        for (const m of src.matchAll(re)) {
            for (const t of m[1].matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) out.add(t[1]);
            if (re.source.startsWith('getElementsByClassName')) out.add(m[1]);
        }
    }
    return out;
}

/**
 * Remove `${...}` template interpolations, innermost first, so that a class
 * attribute built at runtime still yields its STATIC tokens and nothing else.
 *
 *     class="profile-match ${won ? 'a' : 'b'}"   ->   class="profile-match "
 *     class="mini-card${c.red ? ' red' : ''}"    ->   class="mini-card"
 *
 * Without this the tokenizer reads `${won`, `?`, `'a'` and `:` as class names
 * and reports fifty imaginary orphans — which is precisely the shape of gate
 * that gets switched off (DECISIONS #15).
 *
 * The honest cost: a class that exists ONLY inside such an expression (`red`
 * above) is invisible to this gate. That is the safe direction to miss in — a
 * false accusation would fail a correct build, and this gate blocks deploys.
 * The defect it exists for, a static class with no rule, is fully covered.
 */
export function stripInterpolations(src) {
    let out = src, prev;
    do { prev = out; out = out.replace(/\$\{[^{}]*\}/g, ''); } while (out !== prev);
    return out;
}

/**
 * Every `class="..."` occurrence in a source, with whether the SAME tag also
 * carries an inline `style` attribute.
 *
 * The tag is the unit, not the file: one naked `.profile-stat` matters even if
 * another element elsewhere carries that class inline-styled. So a class is
 * exempt only when EVERY tag bearing it is inline-styled, which is what the
 * caller computes from these records.
 *
 * @returns {{cls: string, styled: boolean}[]}
 */
export function classUses(source) {
    const src = stripInterpolations(source);
    const uses = [];
    // A tag: `<name ...attrs...>`. Attribute values may hold `>` inside quotes,
    // so consume quoted runs explicitly rather than stopping at the first `>`.
    for (const tag of src.matchAll(/<[A-Za-z][\w-]*((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
        const attrs = tag[1];
        const cls = /\sclass="([^"]*)"/.exec(attrs);
        if (!cls) continue;
        const styled = /\sstyle="[^"]*[^\s"][^"]*"/.test(attrs);
        for (const name of cls[1].split(/\s+/).filter(Boolean)) {
            // After interpolation stripping, anything left that is not a legal
            // CSS identifier is debris, not a class name. Skip it rather than
            // accuse it.
            if (!isClassName(name)) continue;
            uses.push({ cls: name, styled });
        }
    }
    return uses;
}

/** Classes a module attaches at runtime, e.g. `el.classList.add('x')`. These
 *  never appear in a `class="..."` attribute, so they are collected separately
 *  and checked the same way — with no inline-style exemption available. */
export function scriptedClasses(src) {
    const out = new Set();
    for (const m of src.matchAll(/classList\.(?:add|toggle|remove)\(\s*['"`]([\w-]+)['"`]/g)) out.add(m[1]);
    for (const m of stripInterpolations(src).matchAll(/className\s*=\s*['"`]([^'"`]*)['"`]/g)) {
        for (const n of m[1].split(/\s+/).filter(Boolean)) {
            if (isClassName(n)) out.add(n);
        }
    }
    return out;
}

function main() {
    const htmlPath = join(root, 'public/index.html');
    const html = readFileSync(htmlPath, 'utf8');

    // Follow index.html to its stylesheets rather than naming them, so a new
    // stylesheet is covered the moment it is linked. This is the lesson
    // check-lobby learned in v3.9.0: bind the gate to the rule, not the file.
    const linked = [...html.matchAll(/<link[^>]+href="([^"]+\.css)(?:\?[^"]*)?"/g)]
        .map(m => m[1]).filter(h => !/^https?:/.test(h));
    const sheets = linked.filter(f => existsSync(join(root, 'public', f)));
    if (!sheets.length) {
        console.error('check-orphan-classes: index.html links no local stylesheet.');
        process.exit(1);
    }
    const defined = definedClasses(sheets.map(f => readFileSync(join(root, 'public', f), 'utf8')).join('\n'));

    const jsDir = join(root, 'public/js');
    const jsFiles = readdirSync(jsDir).filter(f => f.endsWith('.js'));

    // where: class -> { naked: Set<source>, everStyled: boolean, everNaked: boolean }
    const seen = new Map();
    const record = (cls, styled, where) => {
        if (!seen.has(cls)) seen.set(cls, { naked: new Set(), everNaked: false });
        const e = seen.get(cls);
        if (!styled) { e.everNaked = true; e.naked.add(where); }
    };

    const queried = new Set();
    for (const u of classUses(html)) record(u.cls, u.styled, 'index.html');
    for (const f of jsFiles) {
        const src = readFileSync(join(jsDir, f), 'utf8');
        for (const u of classUses(src)) record(u.cls, u.styled, `js/${f}`);
        for (const c of scriptedClasses(src)) record(c, false, `js/${f}`);
        for (const c of queriedClasses(src)) queried.add(c);
    }

    const orphans = [];
    for (const [cls, e] of seen) {
        if (defined.has(cls)) continue;
        if (queried.has(cls)) continue;          // a JS hook: it has a job that is not styling
        if (!e.everNaked) continue;              // always inline-styled: a label, not a selector
        orphans.push(`.${cls} (${[...e.naked].sort().join(', ')})`);
    }
    orphans.sort();

    if (orphans.length) {
        console.error('  x every class named in markup is defined by a stylesheet');
        console.error(`      ${orphans.length} orphan(s) — named but never styled, and not inline-styled either:`);
        for (const o of orphans) console.error(`        ${o}`);
        console.error('      This is how the v3.8.0 player card shipped as bare text.');
        console.error(`      Stylesheets searched: ${sheets.join(', ')}`);
        console.error('\ncheck-orphan-classes: FAILED');
        process.exit(1);
    }

    console.log(`  \u2713 ${seen.size} classes in markup: styled by ${sheets.join(', ')}, inline-styled, or used as a JS hook`);
    console.log('\ncheck-orphan-classes: OK');
    return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) main();
