#!/usr/bin/env node
/**
 * check-score-bounds.mjs — keeps firestore.rules and dailyScore.js honest
 * about the same numbers.
 *
 * The daily board's only real protection is the `validScore()` function in
 * firestore.rules. The client mirrors it in `SCORE_BOUNDS`/`SCORE_FIELDS` so a
 * malformed record is caught locally with a readable reason instead of coming
 * back as an opaque PERMISSION_DENIED. Two copies of a boundary is exactly the
 * arrangement that rots: somebody widens the client bound, forgets the rules,
 * and every submission starts failing in production for reasons nobody can
 * reproduce locally.
 *
 * So this fails the build the moment they disagree. Same guard pattern as
 * `sync-rules.mjs`, applied to numbers instead of code.
 *
 * Usage: node tools/check-score-bounds.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// pathToFileURL, not the bare path: on Windows a dynamic import of
// "D:\...\dailyScore.js" is read as the URL scheme "d:" and rejected with
// ERR_UNSUPPORTED_ESM_URL_SCHEME. The ONLY portable argument to import() is a
// file:// URL. readFileSync below is fine with a plain path — import() is not.
const { SCORE_BOUNDS, SCORE_FIELDS, BOARD_PROFILES } =
    await import(pathToFileURL(join(root, 'public/js/dailyScore.js')).href);

const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');

const problems = [];
const ok = [];

/** Isolate validScore()'s body, so a number elsewhere in the file can't satisfy a check. */
const fnStart = rules.indexOf('function validScore(');
if (fnStart === -1) {
    console.error('✗ firestore.rules has no validScore() — the daily board block is unprotected.');
    process.exit(1);
}
const body = rules.slice(fnStart, rules.indexOf('\n      }', fnStart));

function expect(label, re, want) {
    const m = body.match(re);
    if (!m) {
        problems.push(`${label}: no matching rule found in validScore()`);
        return;
    }
    const got = Number(m[1]);
    if (got !== want) problems.push(`${label}: firestore.rules says ${got}, dailyScore.js says ${want}`);
    else ok.push(`${label} = ${want}`);
}

const B = SCORE_BOUNDS;
expect('score min', /d\.score\s*>=\s*(-?\d+)/, B.scoreMin);
expect('score max', /d\.score\s*<=\s*(\d+)/, B.scoreMax);
expect('reflex min', /d\.reflex\s*>=\s*(\d+)/, B.reflexMin);
expect('reflex max', /d\.reflex\s*<=\s*(\d+)/, B.reflexMax);
expect('durationMs min', /d\.durationMs\s*>=\s*(\d+)/, B.durationMin);
expect('durationMs max', /d\.durationMs\s*<=\s*(\d+)/, B.durationMax);
expect('startingCards min', /d\.startingCards\s*>=\s*(\d+)/, B.startingCardsMin);
expect('startingCards max', /d\.startingCards\s*<=\s*(\d+)/, B.startingCardsMax);
expect('username max', /d\.username\.size\(\)\s*<=\s*(\d+)/, B.usernameMax);
expect('clock skew (forward)', /d\.at\s*<=\s*request\.time\.toMillis\(\)\s*\+\s*(\d+)/, B.clockSkewMs);
expect('clock skew (backward)', /d\.at\s*>=\s*request\.time\.toMillis\(\)\s*-\s*(\d+)/, B.clockSkewMs);

/** Field lists: hasOnly and hasAll must both name exactly SCORE_FIELDS. */
function fieldList(kind) {
    const m = body.match(new RegExp(`${kind}\\(\\[([\\s\\S]*?)\\]\\)`));
    if (!m) return null;
    return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
for (const kind of ['hasOnly', 'hasAll']) {
    const got = fieldList(kind);
    if (!got) { problems.push(`${kind}: not found in validScore()`); continue; }
    const a = [...got].sort().join(',');
    const b = [...SCORE_FIELDS].sort().join(',');
    if (a !== b) problems.push(`${kind} fields differ\n    rules:  ${a}\n    client: ${b}`);
    else ok.push(`${kind} names all ${got.length} fields`);
}

/** Profile enum. */
const pm = body.match(/d\.profile in \[([\s\S]*?)\]/);
if (!pm) problems.push('profile enum: not found in validScore()');
else {
    const got = pm[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    const a = [...got].sort().join(',');
    const b = [...BOARD_PROFILES].sort().join(',');
    if (a !== b) problems.push(`profile enum differs\n    rules:  ${a}\n    client: ${b}`);
    else ok.push(`profile enum matches (${got.join(', ')})`);
}

/**
 * The update rule must require a STRICT improvement. Without it a client can
 * overwrite a good entry with a worse one, and "never downgrade" goes back to
 * being a client-side courtesy.
 */
if (!/allow update:[\s\S]{0,400}?request\.resource\.data\.score\s*>\s*resource\.data\.score/.test(rules)) {
    problems.push('update rule does not require request.resource.data.score > resource.data.score');
} else ok.push('update requires a strictly higher score');

/** The board must not be described as verified while the flag says otherwise. */
const daily = readFileSync(join(root, 'public/js/dailyChallenge.js'), 'utf8');
const flag = daily.match(/VERIFIED_BOARD:\s*(true|false)/);
if (!flag) problems.push('dailyChallenge.js no longer declares VERIFIED_BOARD');
else if (flag[1] === 'true' && !/functions\/[\w./-]*daily/i.test(daily)) {
    problems.push('VERIFIED_BOARD is true but no server-side scoring path is referenced — '
        + 'the panel would stop warning players about a board nothing verifies.');
} else ok.push(`VERIFIED_BOARD = ${flag[1]}`);

for (const line of ok) console.log('  ✓ ' + line);
if (problems.length) {
    console.error('\n✗ firestore.rules and dailyScore.js disagree:\n');
    for (const p of problems) console.error('  · ' + p);
    console.error('\nFix both, in the same commit. The rules are the boundary; the client mirror\n'
        + 'exists only to give a readable error before the request is sent.\n');
    process.exit(1);
}
console.log('\ncheck-score-bounds: OK');
