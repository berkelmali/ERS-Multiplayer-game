/**
 * tools/print-firebase-config.mjs — turn your local config into the CI secret.
 *
 * Setting up CI means putting the Firebase web config into a GitHub secret as
 * JSON. Retyping it by hand is the single most error-prone step in the whole
 * setup — one wrong character in `appId` and the deployed site authenticates
 * against nothing, with no build error anywhere.
 *
 * You already have the values, in public/js/firebaseConfig.js. This prints them
 * as the exact JSON that FIREBASE_WEB_CONFIG expects.
 *
 *   npm run config:print
 *
 * Then paste the output into GitHub → Settings → Secrets and variables →
 * Actions → New repository secret → FIREBASE_WEB_CONFIG.
 *
 * The file is parsed as text rather than imported, because importing it would
 * pull the Firebase SDK from the network and call initializeApp().
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'public/js/firebaseConfig.js');

if (!existsSync(file)) {
    console.error('print-firebase-config: public/js/firebaseConfig.js not found.');
    console.error('This file is untracked by design — it only exists on a machine that has been set up.');
    console.error('Copy firebaseConfig.example.js to firebaseConfig.js and fill it in first.');
    process.exit(1);
}

const src = readFileSync(file, 'utf8');
const m = src.match(/firebaseConfig\s*=\s*(\{[\s\S]*?\n\})/);
if (!m) {
    console.error('print-firebase-config: could not find the firebaseConfig object literal.');
    process.exit(1);
}

let cfg;
try {
    cfg = new Function(`return (${m[1]});`)();
} catch (e) {
    console.error('print-firebase-config: could not evaluate the config object —', e.message);
    process.exit(1);
}

const placeholders = Object.entries(cfg).filter(([, v]) => typeof v === 'string' && v.startsWith('YOUR_'));
if (placeholders.length) {
    console.error(`print-firebase-config: this config is still the template (${placeholders.map(([k]) => k).join(', ')}).`);
    process.exit(1);
}

// Single line: GitHub's secret field is a textarea, but a single line makes it
// obvious nothing was truncated on paste.
console.log(JSON.stringify(cfg));
