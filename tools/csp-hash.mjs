#!/usr/bin/env node
/**
 * tools/csp-hash.mjs — keep firebase.json's CSP in step with index.html's
 * inline scripts, by computing the hashes instead of copying them.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * `public/index.html` carries one inline <script>: the boot safety net, which
 * shows "Uygulama başlatılamadı / Could not start" when the module graph never
 * evaluates. It has to be inline. Its whole value is working when nothing else
 * loads, and an external file would be fetched over the very connection whose
 * death it exists to report — its failure mode would be the event it guards.
 *
 * But `firebase.json` sets a CSP with no 'unsafe-inline' in script-src, so from
 * v3.7.0 to v3.7.4 the browser refused to run it on every production page load.
 * The recovery screen could never appear. Two gates stayed green: one checked
 * the script's POSITION, the other ran in a local server that sent no policy.
 *
 * The fix is a hash — and a hash is over the script's EXACT BYTES. Pasting one
 * out of a browser error message would re-create the defect this project just
 * spent v3.7.4 eliminating: a value duplicated in two places with nothing
 * keeping them in step, where drift shows up only in production, silently.
 *
 * So the hash is generated from the file, and the suite fails when the two
 * disagree. Same guarantee as functions/slapOutcome.js's byte-mirror, same
 * reason.
 *
 *   node tools/csp-hash.mjs           # report, exit 1 if stale
 *   node tools/csp-hash.mjs --write   # rewrite firebase.json
 *
 * `--write` is for the moment you edit the boot net. `npm run verify` runs the
 * reporting form, so a stale hash stops a release rather than a player.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Is this module the program being run, rather than something imported?
 *
 * The obvious spelling — `import.meta.url === \`file://${process.argv[1]}\`` —
 * is WRONG ON WINDOWS, and wrong in the worst possible direction: it is always
 * false there, so `main()` never runs, the tool exits 0 having done nothing,
 * and a gate built on it passes unconditionally.
 *
 *   import.meta.url  ->  file:///D:/neww/ers-web/tools/csp-hash.mjs
 *   `file://` + argv ->  file://D:\neww\ers-web\tools\csp-hash.mjs
 *
 * Three slashes against two, forward slashes against backslashes. That is how
 * this gate shipped in v3.7.5 and ran on the operator's machine exactly zero
 * times while reporting success — the same "renders but does nothing" shape it
 * was written to eliminate, inside the file written to eliminate it.
 *
 * `pathToFileURL` produces the same spelling Node gives `import.meta.url`, on
 * every platform. Exported so the suite can test it with a Windows-shaped
 * argv from Linux, where the bug is otherwise invisible.
 */
export function isMainModule(metaUrl, argv1) {
    if (!argv1) return false;
    try { return metaUrl === pathToFileURL(argv1).href; } catch { return false; }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = join(root, 'public/index.html');
const CONFIG = join(root, 'firebase.json');

/** Directives that govern <script> elements. An inline block needs the hash in
 *  script-src-elem where that is declared, and in script-src as the fallback
 *  for browsers that do not implement the -elem form. */
export const SCRIPT_DIRECTIVES = ['script-src', 'script-src-elem'];

/**
 * Every inline <script> in the document, in source order.
 *
 * Deliberately narrow: a tag carrying `src=` is external and needs no hash.
 *
 * This walks the document rather than running a regex over it, because HTML
 * COMMENTS mention script tags. The first version of this function was a plain
 * `/<script([^>]*)>([\s\S]*?)<\/script>/g`, and it immediately reported two
 * inline scripts on a file that has one: it matched the literal `<script>`
 * inside the comment above the boot-error button and paired it with the real
 * closing tag 85 lines later, hashing 5KB of markup as if it were code.
 *
 * That comment is still there, with the literal tag intact, and the suite
 * asserts this function ignores it — a mistake made once is cheaper as a
 * permanent fixture than as a lesson.
 *
 * Walking also avoids the alternative fix (strip comments, then match), which
 * would corrupt the hash of any script whose body legitimately contains `<!--`.
 */
export function inlineScripts(html) {
    const out = [];
    let i = 0;
    while (i < html.length) {
        const comment = html.indexOf('<!--', i);
        const tag = html.toLowerCase().indexOf('<script', i);
        if (tag === -1) break;
        if (comment !== -1 && comment < tag) {
            const end = html.indexOf('-->', comment + 4);
            i = end === -1 ? html.length : end + 3;
            continue;
        }
        const openEnd = html.indexOf('>', tag);
        if (openEnd === -1) break;
        const attrs = html.slice(tag + '<script'.length, openEnd);
        const close = html.toLowerCase().indexOf('</script', openEnd);
        if (close === -1) break;
        if (!/\ssrc\s*=/i.test(attrs)) out.push(html.slice(openEnd + 1, close));
        i = close + 1;
    }
    return out;
}

/** The CSP source expression for one inline script's exact bytes. */
export function hashOf(body) {
    return "'sha256-" + createHash('sha256').update(body, 'utf8').digest('base64') + "'";
}

/** Rewrite one directive so it carries exactly `hashes` and nothing stale. */
export function withHashes(directive, hashes) {
    const kept = directive
        .split(/\s+/)
        .filter(Boolean)
        .filter(tok => !/^'sha(256|384|512)-/.test(tok));
    return [...kept, ...hashes].join(' ');
}

function main() {
    const write = process.argv.includes('--write');
    const html = readFileSync(HTML, 'utf8');
    const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));

    const bodies = inlineScripts(html);
    const hashes = bodies.map(hashOf);

    if (!bodies.length) {
        console.error('csp-hash: no inline <script> found in public/index.html.');
        console.error('          If the boot safety net was moved out, this gate and');
        console.error('          check-error-modal both need revisiting — do not just delete it.');
        process.exit(1);
    }

    let changed = false;
    const stale = [];

    for (const entry of (cfg.hosting?.headers || [])) {
        if (entry.source !== '**') continue;
        for (const header of (entry.headers || [])) {
            if (header.key !== 'Content-Security-Policy') continue;
            const parts = header.value.split(';').map(s => s.trim()).filter(Boolean);
            const rebuilt = parts.map(part => {
                const name = part.split(/\s+/)[0];
                if (!SCRIPT_DIRECTIVES.includes(name)) return part;
                const next = withHashes(part, hashes);
                if (next !== part) { changed = true; stale.push(name); }
                return next;
            });
            header.value = rebuilt.join('; ');
        }
    }

    for (const d of SCRIPT_DIRECTIVES) {
        const present = (cfg.hosting?.headers || []).some(e => e.source === '**' &&
            (e.headers || []).some(h => h.key === 'Content-Security-Policy' &&
                h.value.split(';').some(p => p.trim().startsWith(d + ' '))));
        if (!present) {
            console.error(`csp-hash: the CSP on source "**" declares no ${d}.`);
            process.exit(1);
        }
    }

    console.log(`csp-hash: ${bodies.length} inline script(s) in public/index.html`);
    hashes.forEach((h, i) => console.log(`  [${i}] ${h}  (${bodies[i].length} bytes)`));

    if (!changed) {
        console.log('csp-hash: firebase.json is in step — nothing to do.');
        return 0;
    }

    if (!write) {
        console.error('\ncsp-hash: STALE — ' + [...new Set(stale)].join(', ') + ' do not carry these hashes.');
        console.error('          The boot safety net would be BLOCKED in production, exactly as it');
        console.error('          was from v3.7.0 to v3.7.4. Regenerate with:');
        console.error('              node tools/csp-hash.mjs --write');
        process.exit(1);
    }

    // Two trailing newline styles exist in this repo; keep the file's own.
    const raw = readFileSync(CONFIG, 'utf8');
    writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
    console.log('csp-hash: firebase.json updated (' + [...new Set(stale)].join(', ') + ').');
    return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) main();
