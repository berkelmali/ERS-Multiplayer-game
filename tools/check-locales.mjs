/**
 * tools/check-locales.mjs — every language must define every key.
 *
 * A missing translation does not throw — and it does NOT return undefined
 * either, which is what this file used to claim. `Localization.get(key)` is
 * `translations[currentLang][key] || key`, so a miss returns THE KEY. It ships
 * as visible camelCase in the middle of a sentence ("errReasonOffline" sitting
 * in a Turkish error screen), and every `Localization.get('x') || "English"`
 * idiom in the codebase is unreachable, because get() never returns a falsy
 * value for a non-empty key. That is exactly the class of defect a human
 * reviewer skims past, so it is checked mechanically instead.
 *
 * Also verifies that every `data-i18n` attribute in index.html has a matching
 * key — the other half of the same failure, where the markup asks for a
 * translation nobody wrote.
 *
 * Exits non-zero on any gap, so CI fails.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'public/js/localization.js'), 'utf8');
const html = readFileSync(join(root, 'public/index.html'), 'utf8');

// Pull out the `translations` object literal and evaluate just that. Importing
// the module would drag in `document`, which does not exist in Node.
const start = src.indexOf('const translations');
const end = src.indexOf('\nlet currentLang');
if (start < 0 || end < 0) {
    console.error('check-locales: could not locate the translations object.');
    process.exit(1);
}
const translations = new Function(src.slice(start, end) + '; return translations;')();

const langs = Object.keys(translations);
const base = Object.keys(translations.en);
let failed = false;

console.log(`Locales: ${langs.join(', ')} — ${base.length} keys in en`);

for (const lang of langs) {
    const keys = new Set(Object.keys(translations[lang]));
    const missing = base.filter(k => !keys.has(k));
    const extra = [...keys].filter(k => !base.includes(k));
    const empty = [...keys].filter(k => typeof translations[lang][k] !== 'string' || translations[lang][k].length === 0);

    if (missing.length || extra.length || empty.length) {
        failed = true;
        console.error(`  ✗ ${lang}`);
        if (missing.length) console.error(`      missing (${missing.length}): ${missing.join(', ')}`);
        if (extra.length) console.error(`      not in en (${extra.length}): ${extra.join(', ')}`);
        if (empty.length) console.error(`      empty or non-string: ${empty.join(', ')}`);
    } else {
        console.log(`  ✓ ${lang} — complete`);
    }
}

// A key defined TWICE inside one language block is invisible to the parity
// check above — the object literal simply keeps the last value. That is how a
// German string once ended up sitting in the English block: the parity check
// was happy, and only the wrong text on screen would have revealed it. Scanning
// the raw source is the only way to see it.
const blocks = [...src.matchAll(/\n    (en|tr|de|ru): \{/g)].map(m => ({ lang: m[1], at: m.index }));
for (let i = 0; i < blocks.length; i++) {
    const from = blocks[i].at;
    const to = i + 1 < blocks.length ? blocks[i + 1].at : src.length;
    // The `^\s{8}` form this used to carry only saw keys that begin a line with
    // exactly eight spaces. Several blocks pack dozens of keys onto ONE long
    // line, and every one of those was invisible: `resurrectedMsg` was defined
    // twice in all four languages — once on its own line and again inside the
    // packed line — and this gate printed "no key is defined twice" over it.
    // The later definition wins, so `ui.js` rendered a different sentence than
    // the one anybody editing line 48 thought they were changing. A gate that
    // reports clean over the defect it exists to find is worse than no gate.
    //
    // Matching on the delimiter before the key (line start, `{`, or `, `)
    // instead of on indentation sees both layouts.
    const blockSrc = src.slice(from, to);
    const keys = [...blockSrc.matchAll(/(?:^|[{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)]
        .map(m => m[1])
        .filter(k => k !== 'en' && k !== 'tr' && k !== 'de' && k !== 'ru');
    const dupes = [...new Set(keys.filter(k => keys.indexOf(k) !== keys.lastIndexOf(k)))];
    if (dupes.length) {
        failed = true;
        console.error(`  ✗ ${blocks[i].lang} defines the same key twice: ${dupes.join(', ')}`);
    }
}
if (!failed) console.log('  ✓ no key is defined twice inside a language block');

const usedInHtml = [...new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]))];
const unknown = usedInHtml.filter(k => !base.includes(k));
if (unknown.length) {
    failed = true;
    console.error(`  ✗ index.html asks for keys that do not exist: ${unknown.join(', ')}`);
} else {
    console.log(`  ✓ index.html — all ${usedInHtml.length} data-i18n keys resolve`);
}

/* Pass 4 (v3.7.0) — every Localization.get('literal') in the JS must resolve.
 *
 * Passes 1-3 check language parity, duplicate keys, and data-i18n attributes in
 * index.html. None of them looks at a single line of JavaScript, so a key
 * referenced from a module and added to NO language block passed every gate and
 * shipped as visible camelCase text. That gap mattered the moment the error
 * screen arrived: its whole job is to put a sentence in front of the player,
 * and an unresolved key would put a variable name there instead — a silent
 * failure inside the feature built to end silent failures. */
const jsDir = join(root, 'public', 'js');
const usedInJs = new Map();   // key -> first file that asks for it
for (const file of readdirSync(jsDir).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(join(jsDir, file), 'utf8');
    // The trailing \) is load-bearing: several call sites build a key by
    // concatenation — Localization.get('ruleName_' + key) — and the prefix
    // alone is not a key. Only complete literal arguments are checkable here;
    // the concatenated ones are covered by the data-i18n pass and by tests.
    for (const m of src.matchAll(/Localization\.get\(\s*['"]([A-Za-z0-9_.]+)['"]\s*\)/g)) {
        if (!usedInJs.has(m[1])) usedInJs.set(m[1], 'public/js/' + file);
    }
}
const missingInJs = [...usedInJs.entries()].filter(([k]) => !base.includes(k));
if (missingInJs.length) {
    failed = true;
    for (const [k, file] of missingInJs) {
        console.error(`  ✗ ${file} asks for '${k}', which no language defines — it would render as literal "${k}"`);
    }
} else {
    console.log(`  ✓ public/js — all ${usedInJs.size} Localization.get() keys resolve`);
}

/* Pass 5 — a string with a {placeholder} must keep it in every language, and a
 * {placeholder} substituted in JS must exist in a string that call site fetches.
 *
 * `botReplacedMsg` shipped broken for exactly this reason. `ui.js:361-363` does
 *     rawMsg.replace('{old}', oldName).replace('{new}', newName)
 * and the English string it fetched was "was replaced by a bot" — no
 * placeholders, so both replaces did nothing and the player read a sentence with
 * its subject missing, in all four languages. The sentence that HAD the
 * placeholders existed a hundred lines above and was shadowed by a duplicate.
 * Pass 4 catches the duplicate; this pass catches the shape of the damage, which
 * can also arrive through a translator quietly dropping a brace. */
const tokensIn = (str) => new Set([...String(str).matchAll(/\{(\w+)\}/g)].map(m => m[1]));

let phFailed = false;
for (const key of base) {
    const enVal = translations.en[key];
    if (typeof enVal !== 'string') continue;
    const want = tokensIn(enVal);
    if (!want.size) continue;
    for (const lang of Object.keys(translations)) {
        const got = tokensIn(translations[lang][key]);
        const lost = [...want].filter(t => !got.has(t));
        if (lost.length) {
            failed = phFailed = true;
            console.error(`  ✗ ${lang}.${key} drops the placeholder(s) {${lost.join('}, {')}} that en supplies — the value would render with a hole in it`);
        }
    }
}

/* The substitution half is scoped to the STATEMENT, not the file. A first draft
 * collected every `.replace('{x}'` and every literal key per file and compared
 * the sets — which fired on resultCard.js, streakTracker.js and ui.js, all three
 * false: those fetch their key through a variable (`captionKey`, `templateKey`),
 * so the literal-key list could not see it. A checker that cries wolf gets
 * switched off, so it now only speaks when it can tie a specific literal key to
 * a specific substitution: either chained directly, or assigned to a name that
 * is then replaced on. Computed keys are left alone rather than guessed at. */
for (const file of readdirSync(jsDir).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(join(jsDir, file), 'utf8');
    const claims = [];   // { key, token }

    // a) Localization.get('KEY') ... .replace('{tok}')  — one expression
    for (const m of src.matchAll(/Localization\.get\(\s*['"]([A-Za-z0-9_.]+)['"]\s*\)[^;\n]{0,120}?\.replace\(\s*['"]\{(\w+)\}['"]/g))
        claims.push({ key: m[1], token: m[2] });

    // b) const X = Localization.get('KEY') ... ; then X.replace('{tok}')
    for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*Localization\.get\(\s*['"]([A-Za-z0-9_.]+)['"]/g)) {
        const [, name, key] = m;
        const after = src.slice(m.index, m.index + 700);
        for (const r of after.matchAll(new RegExp(`\\b${name}\\s*\\.replace\\(\\s*['"]\\{(\\w+)\\}['"]`, 'g')))
            claims.push({ key, token: r[1] });
    }

    for (const { key, token } of claims) {
        if (!base.includes(key)) continue;
        if (!tokensIn(translations.en[key]).has(token)) {
            failed = phFailed = true;
            console.error(`  ✗ public/js/${file} substitutes {${token}} into '${key}', but that string contains no {${token}} — the replace is a no-op and the text renders with a hole`);
        }
    }
}
if (!phFailed) console.log('  ✓ every {placeholder} survives translation and every substitution has one to fill');

if (failed) {
    console.error('\ncheck-locales: FAILED');
    process.exit(1);
}
console.log('\ncheck-locales: OK');
