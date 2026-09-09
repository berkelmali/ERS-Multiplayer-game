#!/usr/bin/env node
/**
 * tools/check-promises.mjs — an event somebody is waiting for must be an event
 * somebody sends.
 *
 * ── Why this gate exists ─────────────────────────────────────────────────────
 * Nine gates guard this project and every one of them reads either source text
 * or layout. None of them asks the question that matters most to a player:
 * *does the thing you promised actually happen?*
 *
 * `resurrected` is what that blind spot cost. The rules panel carries a section
 * headed "👁️ Spectator Mode & Slap Back" which tells the player, in four
 * languages: "Eliminated? Don't leave yet ... you can still attempt to Slap
 * Back In at any time. A successful slap resurrects you with the pile!" Around
 * that promise the codebase had built:
 *
 *   · a listener in ui.js       — the notification and the log line
 *   · a listener in victoryScreen.js — tearing the defeat screen back down
 *   · a listener in multiplayerMode.js — counting it
 *   · a statistic on the victory screen  ("Slap Backs", four languages)
 *   · an MVP badge for two or more       (`mvpComeback`)
 *   · a counter in GameState.stats       (`resurrections`)
 *
 * and **nothing, anywhere, that emitted the event**. Four separate locks kept
 * it from ever firing: game.js ended the offline match the instant the human
 * ran dry, game.js refused a slap from an eliminated seat, firebaseSync threw
 * away an eliminated seat's winning slap, and victoryScreen set the pile to
 * `pointer-events: none` — so even a fully working game engine could not have
 * been reached by a finger.
 *
 * Every existing gate passed the whole time. `check-locales` went further and
 * *certified* it: all four of those strings translate correctly, in four
 * languages, for a feature that did not exist. A gate can only ever prove the
 * thing it looks at.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * Every event name passed to `.on(...)` must appear in at least one `.emit(...)`
 * somewhere under public/js. Nothing is allowlisted; both sides are read from
 * the source.
 *
 * ── What is NOT failed on, and why ───────────────────────────────────────────
 * The mirror case — emitted but nobody listening — is reported and does not
 * fail the build. The asymmetry is deliberate and it is the whole judgement in
 * this file. An event nobody listens to is a hook waiting for a feature: it
 * costs a few bytes and misleads nobody. A listener nobody fires is a promise
 * the player has been shown. Only one of the two can put "Slap Backs" on a
 * screen and keep it at zero forever.
 *
 *   node tools/check-promises.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/** Platform-safe "am I the program being run?" — the `file://` + argv spelling
 *  is always false on Windows and silently turned the CSP gate into a no-op for
 *  two releases (DECISIONS #27). */
export function isMainModule(metaUrl, argv1) {
    if (!argv1) return false;
    try { return metaUrl === pathToFileURL(argv1).href; } catch { return false; }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Source with comments removed. Every scan in this project that skipped this
 *  step ended up matching its own documentation (DECISIONS #25) — and this file
 *  names `resurrected` in its own header a dozen times. */
export function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

/**
 * Event names by role.
 *
 * `.off('x')` is deliberately NOT a listener: ui.js calls `EventBus.off('resurrected')`
 * immediately before re-registering, and counting that as a subscription would
 * let a file satisfy the rule by unsubscribing.
 *
 * Only literal names are read. A computed name (`emit(\`x-${y}\`)`) would make
 * the emitter side unknowable, so if one is ever introduced this gate must be
 * revisited rather than quietly guessed at — asserted below.
 */
export function eventRoles(src) {
    const code = stripComments(src);
    const listened = new Set(), emitted = new Set();
    for (const m of code.matchAll(/\.on\(\s*['"`]([A-Za-z][\w:-]*)['"`]/g)) listened.add(m[1]);
    for (const m of code.matchAll(/\.emit\(\s*['"`]([A-Za-z][\w:-]*)['"`]/g)) emitted.add(m[1]);
    const computed = /\.(?:on|emit)\(\s*(?:`[^`]*\$\{|[A-Za-z_$][\w$]*\s*[,)])/.test(code);
    return { listened, emitted, computed };
}

function main() {
    const jsDir = join(root, 'public/js');
    const files = readdirSync(jsDir).filter(f => f.endsWith('.js'));

    const listeners = new Map();   // event -> [file]
    const emitters = new Map();    // event -> [file]
    const computedIn = [];
    const add = (map, key, file) => {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(file);
    };

    for (const f of files) {
        const { listened, emitted, computed } = eventRoles(readFileSync(join(jsDir, f), 'utf8'));
        for (const e of listened) add(listeners, e, f);
        for (const e of emitted) add(emitters, e, f);
        if (computed) computedIn.push(f);
    }

    let failed = 0;
    const fail = (msg, detail) => {
        failed++;
        console.error(`  x ${msg}`);
        if (detail) for (const d of detail) console.error(`      ${d}`);
    };

    // 1 — the rule.
    const orphans = [...listeners.keys()].filter(e => !emitters.has(e)).sort();
    if (orphans.length) {
        fail(`every listened-for event has an emitter (${orphans.length} promise(s) nothing keeps)`,
            orphans.map(e => `'${e}' — waited for in ${listeners.get(e).join(', ')}; emitted nowhere`)
                .concat(['this is how "Slap Backs" sat on the victory screen at 0 for four releases']));
    } else {
        console.log(`  ✓ ${listeners.size} listened-for events, every one of them emitted somewhere`);
    }

    // 2 — a computed event name would make rule 1 unprovable rather than false.
    //     Better to stop and be rewritten than to keep reporting a clean bill.
    if (computedIn.length) {
        fail('every event name is a literal this gate can follow',
            computedIn.map(f => `${f} builds an event name at runtime — rule 1 cannot see it`));
    }

    // 3 — reported, never failed. See the header for why the two directions are
    //     not symmetric.
    const unheard = [...emitters.keys()].filter(e => !listeners.has(e)).sort();
    if (unheard.length) {
        console.log(`  ℹ ${unheard.length} event(s) emitted with nobody listening — hooks, not defects:`);
        console.log(`      ${unheard.join(', ')}`);
    }

    if (failed) {
        console.error(`\ncheck-promises: FAILED (${failed})`);
        process.exit(1);
    }
    console.log('\ncheck-promises: OK');
    return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) main();
