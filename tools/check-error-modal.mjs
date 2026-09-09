/**
 * check-error-modal.mjs — v3.7.0
 *
 * Pins the one structural property of the error screen that four unrelated
 * files can silently break, and that no unit test can see.
 *
 * Background. `#confirm-modal` and `#invite-modal` are `class="screen
 * modal-overlay"`. That is not a style choice, it is a dependency:
 * `.modal-overlay` declares background, blur, centering and z-index but NO
 * `display` and NO `position` — both come from `.screen`. The coupling has two
 * separate teeth, and the error screen must avoid both:
 *
 *   1. `.modal-overlay` WITHOUT `.screen` renders as `display:block;
 *      position:static` — a permanently visible full-width blurred bar sitting
 *      in normal document flow on every screen, including first paint.
 *   2. `.screen` is bulk-cleared by lobbyUI.js, profileUI.js (twice) and
 *      victoryScreen.js, each running
 *      `querySelectorAll('.screen').forEach(s => s.classList.remove('active'))`.
 *      An error screen carrying `.screen` would be erased by any subsequent
 *      navigation — including the one its own Retry button triggers.
 *
 * So `#error-modal` deliberately belongs to neither system: body-level, its own
 * `position:fixed`, its own `.open` toggle. This gate fails the build if that
 * ever changes, because the symptom — an error screen that does not appear, or
 * one that never goes away — is invisible to all 895 unit tests. This project
 * has shipped "renders but does nothing" six times; the point of a gate is that
 * the seventh costs nothing to catch.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const failures = [];
const checks = [];
const ok = (msg) => checks.push(msg);
const fail = (msg) => failures.push(msg);

const screenJs = read('public/js/errorScreen.js');
const bannerJs = read('public/js/connectionBanner.js');
const css = read('public/style.css');
const html = read('public/index.html');

/* 1. The overlay must not carry either class that ties it to the .screen system. */
const classAssign = screenJs.match(/el\.className\s*=\s*'([^']*)'/);
if (!classAssign) {
    fail('errorScreen.js: could not find the className assignment for #error-modal');
} else {
    const classes = classAssign[1].split(/\s+/).filter(Boolean);
    if (classes.includes('screen')) {
        fail('#error-modal carries .screen — four files bulk-clear .active on every .screen, ' +
             'so the error screen would be erased by its own Retry navigation');
    } else if (classes.includes('modal-overlay')) {
        fail('#error-modal carries .modal-overlay without .screen — .modal-overlay supplies no ' +
             'display and no position, so this renders as a permanently visible blurred bar');
    } else {
        ok('#error-modal belongs to neither the .screen nor the .modal-overlay system');
    }
}

/* 2. It must be toggled by .open, never by .active — .active is what the bulk
      clears remove. */
if (/classList\.add\(\s*['"]active['"]\s*\)/.test(screenJs)) {
    fail('errorScreen.js toggles .active; use .open, which no bulk clear touches');
} else if (/classList\.add\(\s*['"]open['"]\s*\)/.test(screenJs)) {
    ok('#error-modal is toggled with .open');
} else {
    fail('errorScreen.js never adds .open — the modal would never become visible');
}

/* 3. The CSS contract: hidden by default, shown by .open, fixed positioning. */
const overlayRule = css.match(/\.ers-error-overlay\s*\{([^}]*)\}/);
if (!overlayRule) {
    fail('style.css has no .ers-error-overlay rule — the modal has no layout at all');
} else {
    const body = overlayRule[1];
    if (!/position:\s*fixed/.test(body)) fail('.ers-error-overlay must be position:fixed (it owns its own layout)');
    else if (!/display:\s*none/.test(body)) fail('.ers-error-overlay must default to display:none');
    else ok('.ers-error-overlay is position:fixed and hidden by default');
}
if (/\.ers-error-overlay\.open\s*\{[^}]*display:\s*flex/.test(css)) {
    ok('.ers-error-overlay.open reveals the modal');
} else {
    fail('.ers-error-overlay.open must set display:flex, or the modal can never appear');
}

/* 4. The card must not depend on an opacity reveal rule. The invite modal
      shipped invisible for two versions because `.modal-content { opacity: 0 }`
      had its only reveal scoped to a different modal's id. */
const cardRule = css.match(/\.ers-error-card\s*\{([^}]*)\}/);
if (!cardRule) {
    fail('style.css has no .ers-error-card rule');
} else if (/opacity:\s*0/.test(cardRule[1])) {
    fail('.ers-error-card starts at opacity:0 — this is exactly the v3.5.0 invisible-invite-modal defect');
} else {
    ok('.ers-error-card is opaque as soon as it is displayed');
}

/* 5. The error screen must be able to cover a stuck spinner. */
const zOverlay = overlayRule && overlayRule[1].match(/z-index:\s*(\d+)/);
if (!zOverlay) {
    fail('.ers-error-overlay has no z-index');
} else if (Number(zOverlay[1]) <= 9999) {
    fail(`.ers-error-overlay z-index ${zOverlay[1]} is not above #loading-overlay (9999); ` +
         'the error screen must be able to appear over a stuck spinner');
} else {
    ok(`.ers-error-overlay sits above #loading-overlay (z-index ${zOverlay[1]})`);
}

/* 6. The toast host must NOT be inside a .screen. This is the defect that made
      every lobby, menu and reconnect message invisible for the app's whole
      history, and nothing but a source check can catch it. */
const gcStart = html.indexOf('<div id="game-container"');
const notifAt = html.indexOf('<div id="notifications">');
if (notifAt === -1) {
    fail('index.html has no #notifications element');
} else if (gcStart !== -1 && notifAt > gcStart && notifAt < html.indexOf('<!-- LOADING OVERLAY -->')
           && html.slice(gcStart, notifAt).lastIndexOf('<div id="game-container"') !== -1
           && !/<!-- TOAST HOST/.test(html.slice(Math.max(0, notifAt - 900), notifAt))) {
    fail('#notifications appears to be inside #game-container again — every message raised from ' +
         'the lobby, menu or reconnect popup would be written into a display:none subtree');
} else {
    ok('#notifications is outside #game-container');
}
if (/#notifications\s*\{[^}]*position:\s*fixed/.test(css)) {
    ok('#notifications is position:fixed (viewport-anchored on every screen)');
} else {
    fail('#notifications must be position:fixed now that it is body-level');
}

/* 7. The connection banner has the same body-level requirement. */
if (/<div id="connection-banner">/.test(html)) {
    const bannerAt = html.indexOf('<div id="connection-banner">');
    const gcEnd = html.indexOf('<!-- TOAST HOST');
    if (gcEnd !== -1 && bannerAt > gcEnd) ok('#connection-banner is body-level');
    else fail('#connection-banner must sit outside #game-container');
} else {
    fail('index.html has no #connection-banner element, but connectionBanner.js targets one');
}
if (/export const CONNECTION_GRACE_MS = \d+;/.test(bannerJs) && /CONNECTION_GRACE_MS;/.test(bannerJs)) {
    ok('connection banner has a grace period before it shows');
} else {
    fail('connectionBanner.js has no grace period — ordinary socket churn would flicker the banner');
}

/* 8. The boot net must be inline and in <head>, ahead of the module tag. */
const headEnd = html.indexOf('</head>');
const moduleTag = html.indexOf('<script type="module"');
const bootNet = html.indexOf('window.__ersBooted');
if (bootNet === -1) {
    fail('index.html has no inline boot safety net');
} else if (bootNet > headEnd) {
    fail('the boot safety net is not in <head>; it must be registered before the module tag');
} else if (bootNet > moduleTag) {
    fail('the boot safety net appears after the module tag and cannot catch its failure');
} else if (/<script[^>]+src=[^>]*>\s*[\s\S]{0,200}__ersBooted/.test(html)) {
    fail('the boot safety net must be inline — an external file has the same failure mode');
} else {
    ok('the boot safety net is inline in <head>, ahead of the module tag');
}
if (/<div id="boot-error">/.test(html)) {
    ok('#boot-error markup is static in the served HTML');
} else {
    fail('#boot-error must exist as static markup — it has to work when no JS module evaluated');
}

for (const c of checks) console.log('  ✓ ' + c);
if (failures.length) {
    console.error('\ncheck-error-modal: FAILED');
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
}
console.log('\ncheck-error-modal: OK');
