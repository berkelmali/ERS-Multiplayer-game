/**
 * tools/sync-rules.mjs — regenerates functions/slapRules.js from the client copy.
 *
 * Firebase deploys functions/ in isolation and cannot import a module from
 * outside it, so the server needs its own copy of the slap rule registry. Before
 * v3.0.0 that copy was kept in sync by a comment asking future maintainers
 * nicely. This script plus the drift test in test_gameLogic.mjs replace the
 * request with a guarantee: the test FAILS if the two files diverge, and this
 * script is the one-command fix.
 *
 *   node tools/sync-rules.mjs      (or: npm run sync:rules)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(root, 'public/js/slapRules.js');
const SERVER = join(root, 'functions/slapRules.js');

const HEADER = `/**
 * functions/slapRules.js — SERVER-SIDE MIRROR of public/js/slapRules.js.
 *
 * ⚠️ EVERYTHING BELOW THE END OF THIS COMMENT IS BYTE-FOR-BYTE IDENTICAL to
 *    public/js/slapRules.js, and \`test_gameLogic.mjs\` FAILS THE BUILD if it
 *    ever stops being. Do not hand-edit this file: change the client copy and
 *    re-run \`node tools/sync-rules.mjs\`.
 *
 * Why a copy at all: Firebase deploys the functions/ directory in isolation and
 * cannot import a module living outside it. Before v3.0.0 this was a manual
 * duplicate kept in sync by a comment asking nicely; the drift test replaces
 * that promise with a check.
 *
 * Rank encoding (matches game.js): 2–10 numeric, 11=J, 12=Q, 13=K, 14=A.
 */
`;

/**
 * v3.7.4 — slapOutcome.js is mirrored the same way, and for a sharper reason.
 *
 * The slap OUTCOME (who takes the pile, what burns, who is eliminated, who
 * wins) used to exist as two hand-written copies: firebaseSync.js's transaction
 * body, which is what actually runs, and functions/gameLogic.js's "faithful
 * port", which is what every test pointed at. Now there is one body and both
 * import it. Mirroring it here is what lets the server keep importing it while
 * Firebase deploys functions/ in isolation.
 */
/**
 * `name` is carried explicitly, and that is not redundant.
 *
 * It used to be derived: `sv.slice(sv.indexOf('functions/'))`. On Linux that
 * yields "functions/slapRules.js". On WINDOWS `path.join` produces
 * `...\functions\slapRules.js` with backslashes, so `indexOf('functions/')`
 * returns -1, `slice(-1)` returns the LAST CHARACTER, and the deploy log read:
 *
 *     s already in sync — nothing to do.
 *
 * Twice, once per mirror, with no indication which file it meant. Exactly the
 * failure this project already has a rule against — an unmatched marker returns
 * -1, `slice` accepts it happily, and the result is garbage that still looks
 * like output. It survived because the cloud suite runs on Linux, where the
 * slice is correct; only the operator's own platform saw it.
 */
const MIRRORS = [
    {
        name: 'functions/slapRules.js',
        client: join(root, 'public/js/slapRules.js'),
        server: join(root, 'functions/slapRules.js'),
        header: HEADER
    },
    {
        name: 'functions/slapOutcome.js',
        client: join(root, 'public/js/slapOutcome.js'),
        server: join(root, 'functions/slapOutcome.js'),
        header: `/**
 * functions/slapOutcome.js — SERVER-SIDE MIRROR of public/js/slapOutcome.js.
 *
 * ⚠️ EVERYTHING BELOW THE END OF THIS COMMENT IS BYTE-FOR-BYTE IDENTICAL to
 *    public/js/slapOutcome.js, and \`test_gameLogic.mjs\` FAILS THE BUILD if it
 *    ever stops being. Do not hand-edit this file: change the client copy and
 *    re-run \`node tools/sync-rules.mjs\`.
 */
`
    }
];

let changed = 0;
for (const { name, client: c, server: sv, header } of MIRRORS) {
    const src = readFileSync(c, 'utf8');
    const headerEnd = src.indexOf('*/');
    if (headerEnd === -1) {
        // The same -1 trap, one line down: without this the mirror would be
        // written from `src.slice(1)` — the whole file minus its first byte —
        // and the byte-identity assertion would then fail with no hint why.
        console.error(`sync-rules: ${c} has no header comment to strip. Refusing to mirror it.`);
        process.exit(1);
    }
    const next = header + src.slice(headerEnd + 2);
    const before = (() => { try { return readFileSync(sv, 'utf8'); } catch { return null; } })();
    if (before === next) {
        console.log(`${name} already in sync -- nothing to do.`);
    } else {
        writeFileSync(sv, next);
        changed++;
        console.log(`${name} regenerated from its client copy.`);
    }
}
if (changed) console.log(`${changed} mirror(s) updated.`);
