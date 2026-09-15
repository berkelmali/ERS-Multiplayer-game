/**
 * tools/check-links.mjs — nothing may reference a file that isn't there.
 *
 * This project has no bundler, so nothing resolves imports at build time. A
 * renamed module or a typo'd path produces a 404 in the browser and a blank
 * screen in production, with no failure anywhere earlier in the pipeline. This
 * script is that missing step.
 *
 * Checks three kinds of reference:
 *   1. `src` / `href` in index.html
 *   2. every relative ES-module import (static and dynamic) under public/js
 *   3. every `url(...)` in style.css
 *
 * It also fails on anything the Hosting config would silently drop: files under
 * public/ that `firebase.json`'s `ignore` list excludes but the app requests.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const problems = [];

const exists = (p) => existsSync(p) && statSync(p).isFile();

// v3.16.0 — `cleanUrls: true` means Hosting answers `/en/rules` with the file
// `public/en/rules.html`. Read the flag rather than assume it: if cleanUrls is
// ever turned off, every extensionless link on the site breaks at once, and
// this gate should be what says so instead of the live 404 page.
const hostingCfg = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8')).hosting || {};
const cleanUrls = hostingCfg.cleanUrls === true;

/** Does Hosting have a file to answer this in-site reference with? */
const servable = (ref) =>
    exists(join(pub, ref)) ||
    exists(join(pub, ref, 'index.html')) ||
    (cleanUrls && !/\.[a-z0-9]+$/i.test(ref) && exists(join(pub, `${ref}.html`)));

/** Every in-site reference a page makes, normalised. */
function* localRefs(src) {
    for (const m of src.matchAll(/(?:src|href)="(?!https?:|data:|mailto:|#)([^"]+)"/g)) {
        const ref = m[1].split('?')[0].split('#')[0].replace(/^\//, '');
        if (ref !== '') yield [ref, m[1]];          // href="/" is the site root
    }
}

// --- 1. index.html -------------------------------------------------------
const html = readFileSync(join(pub, 'index.html'), 'utf8');
for (const [ref, raw] of localRefs(html)) {
    if (!servable(ref)) problems.push(`index.html → ${raw}`);
}

// --- 1b. the generated content pages --------------------------------------
// These are the only other pages that carry links, and their links are what
// turn twelve files into one navigable site. A typo in the generator's nav
// would leave a crawler exactly where it was before this release: on a page
// with nothing to follow.
const generatedPages = readdirSync(pub, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(join(pub, d.name))
        .filter((f) => f.endsWith('.html'))
        .map((f) => `${d.name}/${f}`));

for (const page of generatedPages) {
    for (const [ref, raw] of localRefs(readFileSync(join(pub, page), 'utf8'))) {
        if (!servable(ref)) problems.push(`${page} → ${raw}`);
    }
}

// --- 2. ES-module imports ------------------------------------------------
function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...walk(p));
        else if (name.endsWith('.js')) out.push(p);
    }
    return out;
}

const IMPORT_RE = /(?:from\s+["'](\.\.?\/[^"']+)["']|import\(\s*["'](\.\.?\/[^"']+)["'])/g;
for (const file of walk(join(pub, 'js'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
        const ref = (m[1] || m[2]).split('?')[0];
        const target = normalize(join(dirname(file), ref));
        if (!exists(target)) {
            problems.push(`${relative(root, file)} → ${ref}`);
        }
    }
}

// --- 3. CSS url() --------------------------------------------------------
const css = readFileSync(join(pub, 'style.css'), 'utf8');
for (const m of css.matchAll(/url\(\s*["']?(?!https?:|data:)([^"')]+)/g)) {
    const ref = m[1].trim().split('?')[0].replace(/^\//, '');
    if (!exists(join(pub, ref))) problems.push(`style.css → ${m[1].trim()}`);
}

// --- 4. Hosting would drop it -------------------------------------------
// firebase.json ignores `**/*.json` and `**/.*` inside the public root. A file
// the app fetches at runtime that matches one of those deploys as a 404.
const ignoredButReferenced = [];
for (const m of html.matchAll(/(?:src|href)="(?!https?:|data:|#)([^"]+)"/g)) {
    const ref = m[1].split('?')[0];
    if (ref.endsWith('.json') || ref.split('/').some(seg => seg.startsWith('.'))) {
        ignoredButReferenced.push(ref);
    }
}

let failed = false;
if (problems.length) {
    failed = true;
    console.error(`✗ ${problems.length} broken reference(s):`);
    for (const p of problems) console.error(`    ${p}`);

    // By far the most common cause, and the one with a one-line fix: this file
    // is gitignored, so any fresh clone hits it.
    if (problems.every(p => p.endsWith('firebaseConfig.js'))) {
        console.error('\n  → public/js/firebaseConfig.js is untracked by design.');
        console.error('    Local:  cp public/js/firebaseConfig.example.js public/js/firebaseConfig.js');
        console.error('    CI:     FIREBASE_WEB_CONFIG=… npm run config:write');
    }
} else {
    console.log('✓ every local reference resolves');
}

if (ignoredButReferenced.length) {
    failed = true;
    console.error('✗ referenced but excluded by firebase.json "ignore" (would 404 in production):');
    for (const p of ignoredButReferenced) console.error(`    ${p}`);
} else {
    console.log('✓ nothing the app loads is excluded from the Hosting upload');
}

if (failed) {
    console.error('\ncheck-links: FAILED');
    process.exit(1);
}
console.log('\ncheck-links: OK');
