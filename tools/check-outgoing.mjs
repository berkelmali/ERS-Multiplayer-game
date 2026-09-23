/**
 * tools/check-outgoing.mjs — what is about to become PUBLIC, checked once more.
 *
 * The repository is public. The pre-commit hook guards each commit as it is
 * made; this guards the whole range about to be pushed (commits made before the
 * hook existed, or with it bypassed), because a pushed secret stays in history.
 * Usage: node tools/check-outgoing.mjs [base] [head]   (default origin/main HEAD)
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const SECRET = /AIza[0-9A-Za-z_-]{35}|"private_key"\s*:|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{20,}/;
export const FORBIDDEN_FILE = /(^|\/)firebaseConfig\.js$|adminsdk[^/]*\.json$|service-?account[^/]*\.json$|credential[^/]*\.json$|(^|\/)\.env(\.[^/]*)?$|\.(pem|p12|pfx|key)$|(^|\/)YAPILACAKLAR\.md$|(^|\/)\.memoryfires\//i;

export function scan(patch, files) {
    const badFiles = files.filter(f => FORBIDDEN_FILE.test(f));
    const badLines = patch.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++') && SECRET.test(l)).length;
    return { badFiles, badLines };
}

function main() {
    const [base = 'origin/main', head = 'HEAD'] = process.argv.slice(2);
    const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const range = `${base}..${head}`;
    const commits = git('rev-list', '--count', range).trim();
    const files = git('log', '--name-only', '--pretty=format:', range).split('\n').map(s => s.trim()).filter(Boolean);
    const { badFiles, badLines } = scan(git('log', '-p', range), [...new Set(files)]);
    console.log(`check-outgoing: ${commits} commit(s) in ${range}, ${new Set(files).size} file(s) touched`);
    if (badFiles.length) console.log('  !! forbidden file(s):\n     ' + [...new Set(badFiles)].join('\n     '));
    if (badLines) console.log(`  !! ${badLines} added line(s) look like a secret (values not printed)`);
    if (badFiles.length || badLines) { console.log('check-outgoing: REFUSED -- nothing was pushed.'); process.exit(1); }
    console.log('check-outgoing: OK');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
