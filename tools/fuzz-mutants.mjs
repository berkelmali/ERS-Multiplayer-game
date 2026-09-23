#!/usr/bin/env node
/**
 * fuzz-mutants.mjs — does the fuzzer actually catch what it claims to?
 *
 * Every fix the fuzzer (tools/fuzz-pantheon.mjs) found or guards is undone
 * here, one at a time, in a throwaway copy of public/js + tools; the fuzzer
 * then runs against the broken copy and MUST fail. A mutant that survives is
 * an invariant that checks nothing — the failure mode of the first version of
 * the harness (council ERS-22: "one mutant per before/after invariant").
 *
 *   node tools/fuzz-mutants.mjs [--only name-substring]
 *
 * Exit 1 when any mutant escapes.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const only = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1] : null; })();

// [name, file, from, to, fuzzer args] — or [name, [[file, from, to], ...], args]
// for a fix that lives in two places.
const MUTANTS = [
    ['F1: a seat that takes cards stays eliminated', 'public/js/slapOutcome.js',
        'if (hand.length > 0) winner.eliminated = false;', '', ['--mode', 'mp', '--duels', '6', '--gods', 'ra,set']],
    ['the stamp names the wrong seat', 'public/js/slapOutcome.js',
        'data.lastPile = { winner: winnerId,', 'data.lastPile = { winner: (winnerId + 1) % 4,', ['--mode', 'mp', '--duels', '2', '--gods', 'ra']],
    ['a won pile keeps its ghosts', 'public/js/slapOutcome.js',
        'if (isGhost(c)) vanished++;\n        else kept.push(c);', 'kept.push(c);', ['--mode', 'mp', '--duels', '4', '--gods', 'ra']],
    ['a hand of ghosts only is kept', 'public/js/slapOutcome.js',
        'if (!p || !Array.isArray(p.cards) || p.cards.length === 0 || realCount(p.cards) > 0) return 0;', 'return 0;', ['--mode', 'mp', '--duels', '1', '--gods', 'ra']],
    ['a god may hold more than 13 ghosts', 'public/js/ghostCards.js',
        'const room = Math.max(0, heldMax - ghostCount(hand));', 'const room = Infinity;', ['--mode', 'mp', '--duels', '1', '--gods', 'ra']],
    ['G1: an eliminated seat may not slap (the fifth lock)', 'public/js/firebaseSync.js',
        'if (emptySlapLocked(data, playerIndex)) return;', 'if (data.players[playerIndex].eliminated) return;', ['--mode', 'mp', '--duels', '1', '--gods', 'ra']],
    ['ERS-22 (c): no lock on an empty hand', 'public/js/firebaseSync.js',
        'if (emptySlapLocked(data, playerIndex)) return;', '', ['--mode', 'host', '--duels', '6', '--gods', 'anubis,set']],
    ['the host registers its listeners after the room listener', 'public/js/multiplayerMode.js',
        "        EventBus.on('gameSynced', this.syncListener);\n", "        import('./eventbus.js').then(m => m.default.on('gameSynced', this.syncListener));\n", ['--mode', 'host', '--duels', '6', '--gods', 'bastet']],
    ['quit() removes the sync listener after nulling it', 'public/js/multiplayerMode.js',
        "            EventBus.off('gameSynced', this.syncListener);\n", "            Promise.resolve().then(() => EventBus.off('gameSynced', this.syncListener));\n", ['--mode', 'host', '--duels', '2', '--gods', 'bastet']],
    ['"every human is out" counts empty hands', [
        ['public/js/multiplayerMode.js', 'const humansStillPlaying = realHumans.some(p => !p.eliminated);', 'const humansStillPlaying = realHumans.some(p => p.cards && p.cards.length > 0 && !p.eliminated);'],
        ['public/js/firebaseSync.js', 'if (humans.length === 0 || humans.some(p => !p.eliminated)) return;', 'if (humans.length === 0 || humans.some(p => (p.cards || []).length > 0 && !p.eliminated)) return;']],
        ['--mode', 'host', '--duels', '8', '--gods', 'anubis,set']],
    ['K1: the turn timer asks a second copy of FirebaseSync', 'public/js/multiplayerMode.js',
        "import('./firebaseSync.js?v=7').then(fs => fs.FirebaseSync.pushTimeout(activeActual)", "import('./firebaseSync.js').then(fs => fs.FirebaseSync.pushTimeout(activeActual)", ['--mode', 'host', '--duels', '6', '--gods', 'bastet']],
    ['K5: a slap window over an empty table still awards', 'public/js/firebaseSync.js',
        'if (!this.evaluateSlap(data.pile || [])) return false;', '', ['--mode', 'mp', '--duels', '1', '--gods', 'ra']],
    ['fence: anyone may play a bot\'s card', 'public/js/firebaseSync.js',
        "if (!this._mayDrive(data, playerIndex)) return;   // ERS-23 fence: bots are the host's", '', ['--mode', 'mp', '--duels', '1', '--gods', 'ra']],
    ['fence: anyone may slap for a bot', 'public/js/firebaseSync.js',
        "                if (!this._mayDrive(data, playerIndex)) return;\n\n                // v3.19.2 — an eliminated seat MAY slap.", "\n                // v3.19.2 — an eliminated seat MAY slap.", ['--mode', 'mp', '--duels', '1', '--gods', 'ra']],
    ['fence: anyone may time a turn out', 'public/js/firebaseSync.js',
        'if (data.hostId !== AuthSystem.currentUser?.uid) return;\n                if (NetQuality.serverNow()', 'if (NetQuality.serverNow()', ['--mode', 'mp', '--duels', '1', '--gods', 'ra']],
    ['fence: a turn is timed out before its 15 s', 'public/js/firebaseSync.js',
        'if (NetQuality.serverNow() - (data.lastPlayTime || 0) < TURN_TIMEOUT_MS) return;', '', ['--mode', 'mp', '--duels', '6', '--gods', 'ra,set']],
    ['fence: anyone may end the match for "every human is out"', 'public/js/firebaseSync.js',
        '            if (data.hostId !== uid) return;\n            const humans', '            const humans', ['--mode', 'mp', '--duels', '1', '--gods', 'ra']],
    ['fence: anyone may convert a seat to a bot', 'public/js/firebaseSync.js',
        'if (data.hostId !== me && p.uid !== me) return;', '', ['--mode', 'mp', '--duels', '1', '--gods', 'ra']],
    ['a host that lost the database keeps driving', 'public/js/multiplayerMode.js',
        'data.hostId === user.uid && FirebaseSync.isConnected !== false', 'data.hostId === user.uid', ['--mode', 'mp', '--duels', '1', '--gods', 'ra']],
    ['ERS-22 (c): the Duat is not exempt from the lock', 'public/js/game.js',
        'if (emptyHand && !MatchContext.pricesWrongSlaps && this.emptySlapLock', 'if (emptyHand && this.emptySlapLock', ['--mode', 'duat', '--duels', '30']],
    ['v3.19.3: the third miss does not end the journey', 'public/js/duat.js',
        'if (this.tries <= 0) {', 'if (false) {', ['--mode', 'duat', '--duels', '30']],
    ['v3.19.3: the shades are sharpened only in Apep\'s hour', 'public/js/duat.js',
        '        if (!this.armed) return;\n        const tier', '        if (!this.armed || !on) return;\n        const tier', ['--mode', 'duat', '--duels', '10']],
    ['a play lands on a closed, unsettled slap window', 'public/js/firebaseSync.js',
        'if (data.slapContest && this._settleContest(data, NetQuality.serverNow())) return data;\n\n                if (data.activePlayerId !== playerIndex) return data;', 'if (data.activePlayerId !== playerIndex) return data;', ['--mode', 'mp', '--duels', '1', '--gods', 'ra']],
    ['a timeout ignores the slap window', 'public/js/firebaseSync.js',
        'if (data.slapContest && !FairSlap.isExpired(data.slapContest, NetQuality.serverNow())) return;\n                if (data.slapContest && this._settleContest(data, NetQuality.serverNow())) return data;\n', '', ['--mode', 'mp', '--duels', '1', '--gods', 'ra']],
    ['no host failover', 'public/js/multiplayerMode.js',
        'FirebaseSync.claimOrphanedHost(data);', '', ['--mode', 'host', '--duels', '10', '--gods', 'thoth,anubis']],
    ['G3: the bot driver reads cards.length of a seat with no cards field', 'public/js/multiplayerMode.js',
        '(data.players[idx].cards || []).length > 0', 'data.players[idx].cards.length > 0', ['--mode', 'host', '--duels', '60']],
    ['G2: a second knock-out shows no defeat screen', 'public/js/multiplayerMode.js',
        'if (playerId === 0) this.eliminationShown = false;', '', ['--mode', 'host', '--duels', '40']],
    ['F3: a turn nobody can take is held', 'public/js/firebaseSync.js',
        '    _passIfUnable(data, playerIndex) {\n', '    _passIfUnable(data, playerIndex) {\n        return false;\n', ['--mode', 'host', '--duels', '10', '--gods', 'ra,set']],
];

let escaped = 0;
for (const m of MUTANTS) {
    const [name] = m;
    const edits = Array.isArray(m[1]) ? m[1] : [[m[1], m[2], m[3]]];
    const args = Array.isArray(m[1]) ? m[2] : m[4];
    if (only && !name.includes(only)) continue;
    const dir = mkdtempSync(join(tmpdir(), 'ers-mut-'));
    try {
        cpSync(join(ROOT, 'public', 'js'), join(dir, 'public', 'js'), { recursive: true });
        cpSync(join(ROOT, 'tools'), join(dir, 'tools'), { recursive: true });
        cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
        let anchored = true;
        for (const [file, from, to] of edits) {
            const path = join(dir, file);
            const src = readFileSync(path, 'utf8');
            if (!src.includes(from)) { console.log(`ANCHOR  ${name} — the text to mutate is gone from ${file}; update this mutant`); anchored = false; break; }
            writeFileSync(path, src.replace(from, to));
        }
        if (!anchored) { escaped++; continue; }
        const t0 = Date.now();
        const r = spawnSync(process.execPath, [join(dir, 'tools', 'fuzz-pantheon.mjs'), ...args], { encoding: 'utf8', timeout: 300000 });
        const caught = r.status === 1;
        const why = caught ? ((r.stdout.match(/✗ ([^—\n]+)/) || [])[1] || (r.stdout.match(/FAIL scenario: ([^—\n]+)/) || [])[1] || 'failed').trim() : `exit ${r.status}${r.signal ? ' ' + r.signal : ''}`;
        console.log(`${caught ? 'caught ' : 'ESCAPED'} ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s) — ${why}`);
        if (!caught) escaped++;
    } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(escaped ? `\nmutants: ${escaped} escaped` : '\nmutants: every one caught');
process.exit(escaped ? 1 : 0);
