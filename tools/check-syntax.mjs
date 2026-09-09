/**
 * tools/check-syntax.mjs — every JS file must parse.
 *
 * With no bundler, a syntax error in a module nobody imported during manual
 * testing still ships. `node --check` on the whole tree costs a second and
 * closes that hole.
 */

import { readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', '.firebase']);

function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...walk(p));
        else if (/\.m?js$/.test(name)) out.push(p);
    }
    return out;
}

const files = walk(root);
const bad = [];
for (const f of files) {
    try {
        execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
        bad.push({ file: relative(root, f), err: String(e.stderr || e.message).trim().split('\n').slice(0, 3).join(' ') });
    }
}

if (bad.length) {
    console.error(`✗ ${bad.length} file(s) failed to parse:`);
    for (const b of bad) console.error(`    ${b.file}\n      ${b.err}`);
    console.error('\ncheck-syntax: FAILED');
    process.exit(1);
}
console.log(`✓ ${files.length} JavaScript files parse cleanly\n\ncheck-syntax: OK`);
