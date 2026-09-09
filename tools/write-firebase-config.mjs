/**
 * tools/write-firebase-config.mjs — materialise public/js/firebaseConfig.js.
 *
 * WHY THIS EXISTS: `public/js/firebaseConfig.js` is in .gitignore and is NOT
 * tracked, so a fresh `git clone` — which is exactly what CI does — has an
 * app whose every module imports a file that isn't there. Deploying that
 * checkout produces a site that fails on the first import and renders nothing.
 *
 * So CI writes the file from the `FIREBASE_WEB_CONFIG` secret before deploying.
 * The `assertConfigPresent` guard in the deploy workflow makes it impossible to
 * ship without it.
 *
 * ON "SECRET": the Firebase *web* config is not a credential. It ships to every
 * visitor's browser in plain text; access is controlled by the security rules,
 * not by hiding these values. It is kept in a GitHub secret here purely to
 * honour the repo's existing decision to keep the file untracked — not because
 * leaking it would matter. If you would rather simplify, `git add -f
 * public/js/firebaseConfig.js` is a legitimate choice and this script becomes
 * unnecessary.
 *
 * Usage:
 *   FIREBASE_WEB_CONFIG='{"apiKey":"…","projectId":"…", …}' node tools/write-firebase-config.mjs
 */

import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public/js/firebaseConfig.js');

const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId', 'databaseURL'];
const OPTIONAL = ['storageBucket', 'messagingSenderId', 'measurementId'];

const raw = process.env.FIREBASE_WEB_CONFIG;
if (!raw) {
    console.error('write-firebase-config: FIREBASE_WEB_CONFIG is not set.');
    console.error('Set it to the Firebase web config object as JSON. See DEPLOY.md.');
    process.exit(1);
}

let cfg;
try {
    cfg = JSON.parse(raw);
} catch (e) {
    console.error('write-firebase-config: FIREBASE_WEB_CONFIG is not valid JSON —', e.message);
    process.exit(1);
}

const missing = REQUIRED.filter(k => typeof cfg[k] !== 'string' || cfg[k].length === 0);
if (missing.length) {
    console.error(`write-firebase-config: missing required field(s): ${missing.join(', ')}`);
    process.exit(1);
}

// A config still carrying the template placeholders would deploy a site that
// looks fine and fails at the first Firebase call. Catch it here instead.
const placeholders = Object.entries(cfg).filter(([, v]) => typeof v === 'string' && v.startsWith('YOUR_'));
if (placeholders.length) {
    console.error(`write-firebase-config: placeholder values left in: ${placeholders.map(([k]) => k).join(', ')}`);
    process.exit(1);
}

const fields = [...REQUIRED, ...OPTIONAL]
    .filter(k => typeof cfg[k] === 'string' && cfg[k].length > 0)
    .map(k => `    ${k}: ${JSON.stringify(cfg[k])}`)
    .join(',\n');

const out = `// GENERATED — do not edit, do not commit.
// Written by tools/write-firebase-config.mjs from the FIREBASE_WEB_CONFIG
// secret. Locally this file is yours and is kept untracked (.gitignore).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

export const firebaseConfig = {
${fields}
};

export const app = initializeApp(firebaseConfig);
export const rtdb = getDatabase(app);
export const functions = getFunctions(app);
`;

writeFileSync(target, out);
console.log(`write-firebase-config: wrote public/js/firebaseConfig.js for project "${cfg.projectId}"`);

if (!existsSync(target)) {
    console.error('write-firebase-config: file missing after write.');
    process.exit(1);
}
