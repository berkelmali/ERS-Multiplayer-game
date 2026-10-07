/**
 * tools/smoke.mjs — does the app actually boot and play?
 *
 * The unit suite proves the rule engine, the arbitration maths and the scoring
 * are correct. None of that catches the failure that matters most in a project
 * with no build step: a renamed export, a typo'd import, a missing DOM id — the
 * app loads to a blank screen and every unit test still passes.
 *
 * So this drives a real browser through the real screens: settings, the House
 * Rules invariant, the Daily Challenge panel, the Slap IQ dial, a full offline
 * match, and all three states of the slap coach. It asserts zero console errors
 * throughout.
 *
 * Runs with NO network. It serves public/ itself and intercepts the Firebase
 * CDN with tools/firebase-stub.mjs, so it is identical locally and in CI.
 *
 * It also serves the RESPONSE HEADERS from firebase.json — above all the
 * Content-Security-Policy. That was missing until v3.7.5, and the gap hid a
 * real outage for five releases: the inline boot safety net added in v3.7.0
 * was blocked by CSP on every single production page load, so the screen that
 * exists to say "the app could not start" could itself never start. Two gates
 * called it healthy — check-error-modal because it only asserts the script's
 * POSITION, and this file because its server sent no policy to violate.
 *
 * A test environment that is more permissive than production does not test
 * production. Any header the live site sends, this server sends.
 *
 *   npm run smoke
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { chromium } from 'playwright';
import { inflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const STUB = readFileSync(join(root, 'tools/firebase-stub.mjs'), 'utf8');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml'
};

// The app cannot start without this file, and it is untracked on purpose.
// Fail with the fix rather than with a wall of import errors.
if (!existsSync(join(pub, 'js/firebaseConfig.js'))) {
    console.error('smoke: public/js/firebaseConfig.js is missing.');
    console.error('       Locally: copy firebaseConfig.example.js to firebaseConfig.js.');
    console.error('       In CI:   run tools/write-firebase-config.mjs first.');
    process.exit(1);
}

/**
 * The response headers the live site sends, read from firebase.json.
 *
 * Only `source: "**"` entries are applied — those match every request, so they
 * need no glob engine and cover the policy headers. Narrower sources (the
 * per-extension cache rules) are deliberately skipped: getting those subtly
 * wrong here would be worse than not modelling them, and no assertion depends
 * on caching. If a policy header is ever moved to a narrow source, this
 * function stops seeing it — so check-csp asserts the CSP lives on `**`.
 */
function hostingHeaders() {
    const cfg = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'));
    const out = {};
    for (const entry of (cfg.hosting?.headers || [])) {
        if (entry.source !== '**') continue;
        for (const h of (entry.headers || [])) out[h.key] = h.value;
    }
    return out;
}
const HOSTING_HEADERS = hostingHeaders();

if (!HOSTING_HEADERS['Content-Security-Policy']) {
    console.error('smoke: firebase.json declares no Content-Security-Policy on source "**".');
    console.error('       Serving the app without it would make this suite weaker than production.');
    process.exit(1);
}

const server = createServer(async (req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = normalize(join(pub, rel));
    if (!file.startsWith(pub)) { res.writeHead(403).end(); return; }
    try {
        const body = await readFile(file);
        res.writeHead(200, {
            ...HOSTING_HEADERS,
            'Content-Type': MIME[extname(file)] || 'application/octet-stream'
        });
        res.end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const consoleErrors = [];
const smokeState = {};
let failures = 0;

// PW_CHROMIUM_PATH is an escape hatch for sandboxes and CI images that ship a
// preinstalled Chromium whose build number does not match the npm-resolved
// Playwright. Unset (the normal case) Playwright finds its own browser.
const browser = await chromium.launch({
    args: ['--no-sandbox'],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {})
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });

await ctx.route('**://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
await ctx.route('**://fonts.googleapis.com/**', r =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await ctx.route('**://fonts.gstatic.com/**', r => r.abort());
// Several megabytes of BGM the test never listens to.
await ctx.route('**/audio/*.mp3', r => r.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' }));
// v3.14.0 — the ad tag is now really requested, so it is stubbed rather than
// left to reach Google from a test machine. The stub is deliberately dumb: it
// only drains the queue, so `adsbygoogle.push` cannot throw and mask a real
// failure, and the wire watcher below still sees the request that was made.
await ctx.route('**://pagead2.googlesyndication.com/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript',
        // The stub's `push` makes a REQUEST, because that is the only part of
        // the real tag this file needs to reproduce. A push that silently
        // returned 1 made the "no ad request during a match" claim untestable:
        // a mutant that re-filled a panel mid-match passed, because nothing
        // ever reached the wire watcher. The request is intercepted by this
        // same route, so nothing leaves the machine.
        body: `window.adsbygoogle = window.adsbygoogle || [];
               window.adsbygoogle.push = function(){
                 fetch('https://pagead2.googlesyndication.com/pagead/ads?stub=1').catch(function(){});
                 return 1;
               };` }));

const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(e.message));

// A CSP violation is NEVER noise, and it has to be exempted from the noise
// filter explicitly. The policy text lists `https://*.firebaseio.com`, so the
// bare /firebase/i pattern at the bottom of this file matched the violation
// message and swallowed it whole — the same shape as check-locales' 8-space
// regex: a filter written for one thing that silently covered something else.
// That is why serving the real headers still produced a green run at first.
const NEVER_IGNORABLE = /Content Security Policy|Refused to (execute|load|connect|frame)/i;

// v3.4.0, still the point in v3.14.0. Until this release PUBLISHER_ID was empty
// and the claim was absolute: no script tag, no request, no cookie. Now ads are
// on, and the claim that replaced it is narrower but harder: requests happen on
// menus and NEVER while a match is running. Either claim is only worth
// something if something watches the wire, so this listens from before the
// first navigation and every step below runs under it.
const AD_HOST = /googlesyndication|googleadservices|googletagservices|adservice\.google|doubleclick|fundingchoices/i;
const adRequests = [];
page.on('request', r => { if (AD_HOST.test(r.url())) adRequests.push(r.url()); });

const step = async (name, fn) => {
    try {
        await fn();
        console.log(`  ok   ${name}`);
    } catch (e) {
        failures++;
        console.error(`  FAIL ${name}\n         ${e.message.split('\n')[0]}`);
    }
};

/** Waits for main.js to finish DOMContentLoaded wiring, not for the network. */
const waitForBoot = () => page.waitForFunction(
    () => !!document.getElementById('slap-coach') && document.querySelectorAll('.house-rules-grid .rule-row').length > 0,
    null, { timeout: 20000 }
);

await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
await waitForBoot();
await page.waitForTimeout(300);

console.log('\n— boot —');
await step('app initialised', async () => {
    const ok = await page.evaluate(() => !!document.getElementById('slap-coach'));
    if (!ok) throw new Error('main.js did not finish initialising');
});
await step('version label is current', async () => {
    const v = await page.evaluate(() => document.getElementById('game-version')?.innerText || '');
    if (!/v\d+\.\d+\.\d+/.test(v)) throw new Error('no version string: ' + v);
    console.log(`         ${v}`);
});

console.log('\n— settings / house rules —');
await step('settings opens', async () => {
    await page.click('#btn-settings');
    await page.waitForSelector('#settings-panel.active', { timeout: 5000 });
});
await step('one row per rule, generated from the registry', async () => {
    const rows = await page.evaluate(() =>
        [...document.querySelectorAll('.house-rules-grid .rule-row')].map(r => ({
            id: r.querySelector('input').id,
            name: r.querySelector('.rule-name').textContent.trim(),
            cards: r.querySelectorAll('.mini-card').length
        })));
    if (rows.length < 7) throw new Error('expected the full registry, got ' + rows.length + ' rows');
    for (const r of rows) {
        if (r.cards < 2) throw new Error(`${r.id} has no card preview`);
        if (!r.name) throw new Error(`${r.id} has no label`);
    }
    console.log(`         ${rows.map(r => r.name).join(' · ')}`);
});
await step('core rules start on, opt-in rules start off', async () => {
    const state = await page.evaluate(() =>
        [...document.querySelectorAll('.house-rules-grid .rule-row')].map(r => ({
            id: r.querySelector('input').id.replace('rule-', ''),
            on: r.querySelector('input').checked,
            optional: r.classList.contains('optional')
        })));
    const wrongOn = state.filter(r => !r.optional && !r.on).map(r => r.id);
    const wrongOff = state.filter(r => r.optional && r.on).map(r => r.id);
    if (wrongOn.length) throw new Error('core rules off by default: ' + wrongOn.join(', '));
    if (wrongOff.length) throw new Error('opt-in rules on by default: ' + wrongOff.join(', '));
    const opt = state.filter(r => r.optional).map(r => r.id);
    if (opt.length === 0) throw new Error('no opt-in rules rendered');
    console.log(`         core: ${state.filter(r => !r.optional).length} · opt-in: ${opt.join(', ')}`);
});
await step('an opt-in rule can be switched on and sticks', async () => {
    await page.click('#rule-triple');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ersSettings')).houseRules.triple);
    if (saved !== true) throw new Error('opt-in toggle not persisted');
    await page.click('#rule-triple'); // back off, so later steps see the classic set
});
await step('a toggle persists', async () => {
    await page.click('#rule-tens');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ersSettings')).houseRules.tens);
    if (saved !== false) throw new Error('toggle not saved');
});
await step('turning every rule off is refused', async () => {
    await page.evaluate(() => {
        document.querySelectorAll('.house-rules-grid input').forEach(i => { if (i.checked) i.click(); });
    });
    const any = await page.evaluate(() =>
        [...document.querySelectorAll('.house-rules-grid input')].some(i => i.checked));
    if (!any) throw new Error('all rules ended up off — the invariant is broken');
});
await step('reset restores the classic set — core on, opt-in off', async () => {
    await page.click('#btn-rules-reset');
    const state = await page.evaluate(() =>
        [...document.querySelectorAll('.house-rules-grid .rule-row')].map(r => ({
            id: r.querySelector('input').id.replace('rule-', ''),
            on: r.querySelector('input').checked,
            optional: r.classList.contains('optional')
        })));
    // "Classic" is not "everything on" — the opt-in tier must come back OFF.
    const bad = state.filter(r => r.on === r.optional).map(r => r.id);
    if (bad.length) throw new Error('wrong state after reset: ' + bad.join(', '));
    await page.click('#btn-back');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
});

console.log('\n— daily challenge —');
await step('panel shows date, seed and mark', async () => {
    await page.click('#btn-daily');
    await page.waitForSelector('#daily-panel.active', { timeout: 5000 });
    await page.waitForTimeout(400);
    const d = await page.evaluate(() => ({
        date: document.getElementById('daily-date').innerText,
        seed: document.getElementById('daily-seed').innerText,
        cells: document.querySelectorAll('#daily-sigil svg rect').length,
        board: document.getElementById('daily-leaderboard').innerHTML.length
    }));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) throw new Error('bad date: ' + d.date);
    if (d.seed.length < 3) throw new Error('bad seed: ' + d.seed);
    if (d.cells < 4) throw new Error('seed mark looks empty: ' + d.cells + ' cells');
    if (d.board < 5) throw new Error('board did not render');
    console.log(`         ${d.date} ${d.seed} · ${d.cells} cell mark`);
});

await step('the panel names the position you are inheriting', async () => {
    const b = await page.evaluate(() => {
        const el = document.getElementById('daily-scenario');
        if (!el || el.style.display === 'none') return null;
        return {
            profile: el.querySelector('.ds-tag')?.textContent.trim(),
            cards: parseInt(el.querySelector('.ds-cards strong')?.textContent || '0', 10),
            desc: (el.querySelector('.ds-desc')?.textContent || '').trim().length,
            diff: (el.querySelector('.ds-diff')?.textContent || '').trim(),
            diffTier: [...(el.querySelector('.ds-diff')?.classList || [])]
                .find(c => c.startsWith('ds-diff-')) || '',
            rules: (el.querySelector('.ds-rules')?.textContent || '').trim()
        };
    });
    if (!b) throw new Error('scenario brief not rendered');
    if (!b.profile) throw new Error('no profile name');
    if (!(b.cards >= 1 && b.cards <= 40)) throw new Error('implausible starting hand: ' + b.cards);
    if (b.desc < 20) throw new Error('profile has no description');
    // v3.1.2: the panel must name today's tier and say the rules are fixed.
    if (!b.diff) throw new Error('the panel does not say how hard today is');
    if (!['ds-diff-medium', 'ds-diff-hard'].includes(b.diffTier)) {
        throw new Error('unknown difficulty tier on the brief: ' + b.diffTier);
    }
    if (b.rules.length < 5) throw new Error('the panel does not say the rules are the classic locked set');
    console.log(`         ${b.profile} — ${b.cards} cards · ${b.diff} · ${b.rules}`);
    smokeState.dailyCards = b.cards;
});

// THE integration test for the whole feature: a daily run must actually START
// from the generated position, not from a fresh deal that merely looks similar.
await step('starting the daily resumes that exact position', async () => {
    await page.click('#btn-daily-play');
    await page.waitForSelector('#game-container.active', { timeout: 10000 });
    await page.waitForTimeout(700);
    const g = await page.evaluate(() => ({
        hands: window.GameState.players.map(h => h.length),
        pile: window.GameState.pile.length
    }));
    const total = g.hands.reduce((a, b) => a + b, 0) + g.pile;
    if (total !== 52) throw new Error('cards do not add up to 52: ' + JSON.stringify(g));
    if (g.pile < 3) throw new Error('daily started on an empty pile — the scenario was ignored');
    if (g.hands.some(n => n === 0)) throw new Error('someone starts eliminated: ' + g.hands.join('/'));
    if (g.hands[0] !== smokeState.dailyCards) {
        throw new Error(`panel promised ${smokeState.dailyCards} cards, game dealt ${g.hands[0]}`);
    }
    if (g.hands.every(n => n === 13)) throw new Error('this is a plain deal, not a scenario');
    console.log(`         hands ${g.hands.join('/')} · pile ${g.pile}`);
});

// v3.1.2: the rule set must be the classic one AND unchangeable for the whole
// run. Settings lives in the main menu, so a player cannot walk to it mid-run —
// this covers the console-tampering path and pins the invariant for whoever adds
// an in-game pause menu later. See houseRules.js::lockedBy.
await step('the daily run owns the rule set and will not give it up', async () => {
    const live = await page.evaluate(() => {
        const H = window.HouseRules;
        if (!H) return { missing: true };
        const before = H.key();
        // Exactly what devtools tampering would do.
        H.setLocal({ doubles: true, sandwich: false, tens: false, marriage: false });
        return {
            locked: H.isLocked(), owner: H.lockedBy, classic: H.isClassic(),
            before, after: H.key()
        };
    });
    if (live.missing) throw new Error('window.HouseRules is not exposed');
    if (!live.locked) throw new Error('the rule set is unlocked during a scored daily run');
    if (live.owner !== 'daily') throw new Error('unexpected lock owner: ' + live.owner);
    if (!live.classic) throw new Error('the daily run is not on the classic rule set');
    if (live.after !== live.before) {
        throw new Error(`the rule set moved under the lock: ${live.before} -> ${live.after}`);
    }
    console.log(`         locked by "${live.owner}", pinned at ${live.before}`);
});

// v3.3.0: the scored run must not inherit personal settings. The turn clock is
// the one that mattered: it read Settings.config.difficulty while the daily set
// the bots' tier elsewhere, so Easy gave 20 s per turn and Hard 10 s on the same
// seed. Measured cost of one timeout burn: 45 points.
await step('the scored run keeps its own clock, whatever the player set', async () => {
    const seen = await page.evaluate(async () => {
        const { Settings } = await import('/js/settings.js');
        const { MatchContext } = await import('/js/matchContext.js');
        const out = { override: MatchContext.difficultyOverride, scored: MatchContext.scored, clocks: {} };
        const saved = Settings.config.difficulty;
        for (const d of ['easy', 'medium', 'hard']) {
            Settings.config.difficulty = d;
            out.clocks[d] = window.GameState.getTimeoutDuration();
        }
        Settings.config.difficulty = saved;
        return out;
    });
    if (!seen.override) throw new Error('the run set no difficulty override');
    if (seen.scored !== true) throw new Error('a scored run did not declare itself scored');
    const values = [...new Set(Object.values(seen.clocks))];
    if (values.length !== 1) {
        throw new Error('the clock followed the player setting: ' + JSON.stringify(seen.clocks));
    }
    console.log(`         override "${seen.override}", clock ${values[0]}ms for easy/medium/hard alike`);
});

await step('...and the pacing a scored run pays out in score is fixed too', async () => {
    const d = await page.evaluate(async () => {
        const { transitionDelayMs } = await import('/js/matchContext.js');
        const { MatchContext } = await import('/js/matchContext.js');
        return {
            scoredFast: transitionDelayMs('slap', true, MatchContext.scored),
            normalFast: transitionDelayMs('slap', true, false)
        };
    });
    if (d.scoredFast !== 1000) throw new Error('fastAnimations still shortens a scored run: ' + d.scoredFast);
    if (d.normalFast !== 700) throw new Error('fastAnimations stopped working outside a scored run');
    console.log(`         scored ${d.scoredFast}ms · ordinary ${d.normalFast}ms`);
});

// v3.1.1: quitting a SCORED daily run has to cost you. Before this, walking out
// of a bad run recorded nothing, so the day's score was really a best-of-N over
// however many attempts you had patience for.
await step('abandoning a scored daily run records it as a loss', async () => {
    await page.evaluate(() => localStorage.removeItem('ersDailyChallenge'));

    await page.evaluate(() => window.GameState.quitGame());
    await page.click('#btn-quit');
    await page.waitForTimeout(300);
    await page.click('#btn-confirm-leave');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
    await page.waitForTimeout(300);

    const rec = await page.evaluate(() => {
        const raw = localStorage.getItem('ersDailyChallenge');
        return raw ? JSON.parse(raw) : null;
    });
    if (!rec) throw new Error('walking out of a scored run recorded nothing — the quit loophole is open');
    if (rec.won !== false) throw new Error('an abandoned run was not recorded as a loss');
    if (rec.abandoned !== true) throw new Error('the record does not mark itself as abandoned');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date || '')) throw new Error('abandoned record has no day key');
    if (!(rec.score >= 0)) throw new Error('abandoned record has no score');
    console.log(`         recorded ${rec.score} · loss · ${rec.startingCards} card start`);
});

// The daily board is written from the browser and nothing server-side checks
// it. While that is true the panel must say so, in the player's language.
await step('the board carries its unverified warning', async () => {
    await page.click('#btn-daily');
    await page.waitForSelector('#daily-panel.active', { timeout: 5000 });
    await page.waitForTimeout(400);
    const t = await page.evaluate(() => {
        const el = document.getElementById('daily-board-trust');
        if (!el) return { missing: true };
        // NOT offsetParent. This file states the reason twice, three hundred
        // lines below and again at the toast recorder: a `position: fixed`
        // element reports a null offsetParent BY SPECIFICATION, whether or not
        // it is on screen — so the predicate goes blind the day this warning,
        // or any ancestor of it, becomes fixed. And what it guards is an
        // honesty claim: that the board is not presented as trustworthy while
        // VERIFIED_BOARD is false. A blind check there fails open.
        //
        // `blindProof` measures that rather than asserting it: the same
        // element, temporarily fixed, seen by both predicates.
        const cs = getComputedStyle(el);
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;top:10px;left:10px;width:20px;height:20px';
        document.body.appendChild(probe);
        const blindProof = { old: probe.offsetParent !== null, now: probe.getClientRects().length > 0 };
        probe.remove();
        return {
            blindProof,
            shown: el.getClientRects().length > 0
                && cs.display !== 'none' && cs.visibility !== 'hidden'
                && Number(cs.opacity) > 0.01,
            badge: (el.querySelector('.dbt-badge')?.textContent || '').trim(),
            body: (el.querySelector('.dbt-body')?.textContent || '').trim(),
            aboveBoard: !!(el.compareDocumentPosition(document.getElementById('daily-leaderboard'))
                & Node.DOCUMENT_POSITION_FOLLOWING)
        };
    });
    if (t.missing) throw new Error('#daily-board-trust is gone from the page');
    // The measurement, before the assertion that depends on it.
    if (t.blindProof.old !== false || t.blindProof.now !== true)
        throw new Error('the predicate swap is not doing what it claims: ' + JSON.stringify(t.blindProof));
    if (!t.shown) throw new Error('the board is presented as trustworthy while VERIFIED_BOARD is false');
    if (t.badge.length < 4) throw new Error('warning has no heading');
    if (t.body.length < 40) throw new Error('warning does not explain what is wrong');
    if (!t.aboveBoard) throw new Error('the warning sits below the ranking, where it is read after the fact');
    console.log(`         "${t.badge}" · ${t.body.length} chars, above the board`);

    await page.click('#btn-daily-back');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
});

console.log('\n— practice mode —');
await step('practice teaches the classic four, then the opt-in three, clearly apart', async () => {
    await page.click('#btn-practice');
    await page.waitForSelector('#tutorial-screen.active', { timeout: 5000 });
    await page.click('#btn-tutorial-start');

    const tiers = [];
    // Walk the lesson: wait for a step to arm, read its tier line, slap it.
    for (let i = 0; i < 7; i++) {
        // The step is armed when its coaching line appears — no new window global
        // needed, and it is the same signal the player sees.
        await page.waitForSelector('#tutorial-coach.visible', { timeout: 15000 });
        const t = await page.evaluate(() => {
            const el = document.getElementById('tutorial-tier');
            return { text: (el?.textContent || '').trim(), optional: !!el?.classList.contains('optional'),
                     dots: [...document.querySelectorAll('.tutorial-dot')].map(d => d.classList.contains('optional')) };
        });
        tiers.push(t);
        await page.click('#tutorial-pile', { force: true });
        await page.waitForTimeout(1100);
    }

    const flags = tiers.map(t => t.optional);
    if (flags.length !== 7) throw new Error('expected 7 taught patterns, walked ' + flags.length);
    if (flags.slice(0, 4).some(Boolean)) throw new Error('a classic step was marked optional: ' + JSON.stringify(flags));
    if (!flags.slice(4).every(Boolean)) throw new Error('an opt-in step was not marked: ' + JSON.stringify(flags));
    if (!tiers[4].text.includes('★')) throw new Error('the opt-in tier line carries no marker: ' + tiers[4].text);
    if (tiers[0].text === tiers[4].text) throw new Error('both tiers show the same line');
    const dots = tiers[0].dots;
    if (dots.filter(Boolean).length !== 3) throw new Error('the progress row does not mark 3 opt-in steps: ' + JSON.stringify(dots));

    console.log(`         classic: ${JSON.stringify(tiers[0].text.slice(0, 30))}`);
    console.log(`         opt-in:  ${JSON.stringify(tiers[4].text.slice(0, 46))}`);
    await page.click('#btn-tutorial-exit');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
});

console.log('\n— rules page —');
await step('the opt-in patterns are documented, generated from the registry', async () => {
    await page.click('#btn-rules');
    await page.waitForSelector('#rules-panel.active', { timeout: 5000 });

    const r = await page.evaluate(() => {
        const host = document.getElementById('optional-rules');
        if (!host) return { missing: true };
        const rows = [...host.querySelectorAll('.opt-rule')].map(li => ({
            name: li.querySelector('.opt-rule-head strong')?.textContent.trim() || '',
            desc: li.querySelector('.opt-rule-desc')?.textContent.trim() || '',
            cards: li.querySelectorAll('.mini-card').length
        }));
        // The block must live INSIDE the Slap Rules section, not as a section of
        // its own — the placement council ERS-04 argued for.
        const section = host.closest('.rules-section');
        const heading = section?.querySelector('h3')?.getAttribute('data-i18n') || '';
        return { rows, heading, title: host.querySelector('.opt-rules-title')?.textContent.trim() || '' };
    });

    if (r.missing) throw new Error('#optional-rules is not in the page');
    if (r.heading !== 'rSlapTitle') throw new Error('block is not inside the Slap Rules section: ' + r.heading);
    if (r.rows.length !== 3) throw new Error('expected 3 opt-in rules, got ' + r.rows.length);
    for (const row of r.rows) {
        if (!row.name) throw new Error('a rule rendered with no name');
        if (!row.desc || row.desc === row.name) throw new Error(`"${row.name}" has no description`);
        if (row.cards === 0) throw new Error(`"${row.name}" has no pattern preview`);
    }
    console.log(`         ${r.title}`);
    console.log(`         ${r.rows.map(x => `${x.name} (${x.cards} cards)`).join(' · ')}`);
});
await step('the descriptions follow the language', async () => {
    const before = await page.evaluate(() =>
        document.querySelector('#optional-rules .opt-rule-desc')?.textContent.trim() || '');
    await page.evaluate(async () => {
        const { Localization } = await import('/js/localization.js?v=3');
        Localization.setLanguage('tr');
    });
    await page.waitForTimeout(250);
    const after = await page.evaluate(() =>
        document.querySelector('#optional-rules .opt-rule-desc')?.textContent.trim() || '');
    if (!after) throw new Error('description vanished after the language change');
    if (after === before) throw new Error('description did not follow the language change');
    console.log(`         en → tr: ${JSON.stringify(after.slice(0, 46) + '…')}`);
    await page.evaluate(async () => {
        const { Localization } = await import('/js/localization.js?v=3');
        Localization.setLanguage('en');
    });
    await page.waitForTimeout(200);
    await page.click('#btn-rules-back');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
});

console.log('\n— slap iq —');
await step('dial renders with real stats', async () => {
    await page.evaluate(() => {
        localStorage.setItem('ersSlapForensics', JSON.stringify({
            v: 1,
            totals: { attempts: 24, hits: 19, misses: 5 },
            hits: { doubles: 9, sandwich: 4, tens: 4, marriage: 2 },
            missedChances: { doubles: 2, sandwich: 6, tens: 3, marriage: 1 },
            missCodes: { sandwichGapTooWide: 3 },
            reflex: [310, 355, 402, 288, 466, 330, 375, 412, 298, 344]
        }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot();
    await page.waitForTimeout(300);
    await page.click('#btn-slapiq');
    await page.waitForSelector('#slapiq-panel.active', { timeout: 5000 });
    const g = await page.evaluate(() => ({
        cls: document.querySelector('.iq-gauge')?.className || '',
        num: document.querySelector('.iq-num')?.textContent || '',
        bars: document.querySelectorAll('.iq-rule .bar i').length
    }));
    if (!/grade-[SABCD]/.test(g.cls)) throw new Error('dial did not grade: ' + g.cls);
    if (!/^\d+$/.test(g.num)) throw new Error('score is not numeric: ' + g.num);
    if (g.bars === 0) throw new Error('no per-rule breakdown');
    console.log(`         score ${g.num}, ${g.bars} patterns`);
    await page.click('#btn-slapiq-back');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
});

console.log('\n— offline match —');
await step('a match deals 52 cards', async () => {
    await page.click('#btn-play-bots');
    await page.waitForSelector('#game-container.active', { timeout: 10000 });
    await page.waitForTimeout(1200);
    const counts = await page.evaluate(() =>
        [0, 1, 2, 3].map(i => parseInt(document.getElementById('p' + i + '-count').innerText, 10)));
    const total = counts.reduce((a, b) => a + b, 0);
    if (total !== 52) throw new Error('deal is ' + total + ' cards: ' + counts.join('/'));
});
await step('each bot seat shows its own temperament, and the player none', async () => {
    const t = await page.evaluate(() => {
        const read = (id) => {
            const el = document.getElementById(id);
            if (!el) return null;
            return {
                cls: [...el.classList].filter(c => c.startsWith('bot-tell')).join(' '),
                period: el.style.getPropertyValue('--tell-period'),
                sway: el.style.getPropertyValue('--tell-sway')
            };
        };
        return { p1: read('left-deck'), p2: read('top-deck'), p3: read('right-deck'), human: read('human-deck') };
    });
    for (const seat of ['p1', 'p2', 'p3']) {
        if (!t[seat]) throw new Error(seat + ' deck not found');
        if (!/bot-tell-(blitz|chaos|viper)/.test(t[seat].cls)) {
            throw new Error(seat + ' has no personality tell: ' + JSON.stringify(t[seat]));
        }
        if (!/^\d+ms$/.test(t[seat].period)) throw new Error(seat + ' has no cadence: ' + t[seat].period);
    }
    if (t.human && t.human.cls) throw new Error('the player seat should not have a tell: ' + t.human.cls);
    const periods = new Set(['p1', 'p2', 'p3'].map(k => t[k].period));
    if (periods.size < 2) throw new Error('all three bots share one cadence — the tell says nothing');
    console.log(`         ${['p1', 'p2', 'p3'].map(k => `${t[k].cls.split(' ').pop().replace('bot-tell-', '')} ${t[k].period}/${t[k].sway}`).join(' · ')}`);
});
await step('a match ending mid-apply does not leave the tell glowing', async () => {
    // The race council ERS-05 found. applyBotTells() is fire-and-forget from a
    // synchronous gameStarted handler and awaits two dynamic imports;
    // clearBotTells() is synchronous. A gameOver inside that window used to
    // clear the tells and then have the resumed apply put them straight back.
    //
    // No gameplay sequence drives the two back to back reliably (the imports
    // are cached after the first match), so they are driven directly — which is
    // why window.UI is exposed, exactly as window.GameState and window.HouseRules
    // already are.
    const stuck = await page.evaluate(async () => {
        window.UI.applyBotTells();   // starts, awaits its imports — not awaited here
        window.UI.clearBotTells();   // the match ends inside that window
        await new Promise(r => setTimeout(r, 250));
        return ['left-deck', 'top-deck', 'right-deck']
            .filter(id => document.getElementById(id).classList.contains('bot-tell'));
    });
    if (stuck.length) throw new Error('tell survived the clear on: ' + stuck.join(', '));
    console.log('         apply overtaken by clear → nothing left behind');

    // And the normal path still works afterwards, so the guard did not simply
    // break the feature.
    await page.evaluate(async () => {
        window.UI.applyBotTells();
        await new Promise(r => setTimeout(r, 250));
    });
    const back = await page.evaluate(() => ['left-deck', 'top-deck', 'right-deck']
        .filter(id => document.getElementById(id).classList.contains('bot-tell')).length);
    if (back !== 3) throw new Error('the tell did not come back on a clean apply: ' + back + '/3');
    console.log('         and a clean apply still restores all three');
});
await step('the tell never reacts to what is happening on the table', async () => {
    // The guarantee the council made shipping conditional on: a tell that moves
    // when the pile does is a readout of what the bots are about to do.
    // Only the tell's own classes and variables are compared — `active` and the
    // turn-progress ring legitimately change as the turn moves, and folding
    // those into the comparison would make this fail for the wrong reason.
    const snap = () => page.evaluate(() => ['left-deck', 'top-deck', 'right-deck'].map(id => {
        const el = document.getElementById(id);
        return [...el.classList].filter(c => c.startsWith('bot-tell')).sort().join(',')
            + '|' + el.style.getPropertyValue('--tell-period')
            + '|' + el.style.getPropertyValue('--tell-sway');
    }).join(' ;; '));

    const before = await snap();

    // 1. a card is played
    await page.click('#human-deck', { force: true });
    await page.waitForTimeout(500);
    const afterPlay = await snap();

    // 2. the pile goes live THROUGH THE REAL PATH. Assigning GameState.pile
    //    directly would not do: it emits no `cardPlayed`, so a tell wired to
    //    that event would sail past this check. (It did, the first time this
    //    was written.) So the human's next card is stacked to complete a
    //    Double and then actually played — the exact moment the rejected
    //    design would have lit up. Claimed straight away so no bot slap is
    //    left armed to fire during a later step.
    await page.evaluate(() => {
        window.GameState.pile = [{ rank: 7, suit: 'clubs' }];
        window.GameState.players[0].unshift({ rank: 7, suit: 'hearts' });
        window.GameState.activePlayerId = 0;
        window.GameState.lastSlapWinTime = 0;
    });
    await page.click('#human-deck', { force: true });
    await page.waitForTimeout(120);
    const live = await page.evaluate(() => window.GameState.isValidSlap());
    if (!live) throw new Error('the pile did not actually become slappable — the check would prove nothing');
    const afterLive = await snap();
    await page.click('#center-pile', { force: true });
    await page.waitForTimeout(900);
    const afterWin = await snap();

    const stages = { before, afterPlay, afterLive, afterWin };
    for (const [name, v] of Object.entries(stages)) {
        if (v !== before) {
            throw new Error(`the tell changed at "${name}":\n  was ${before}\n  now ${v}`);
        }
    }
    console.log('         unchanged across a play, a live pile and a won pile');
});

await step('playing a card reaches the pile', async () => {
    // force: the deck carries a permanent pulse animation, so Playwright's
    // stability check never settles. We are testing the app, not the keyframe.
    await page.click('#human-deck', { force: true });
    await page.waitForTimeout(600);
    const n = await page.evaluate(() => window.GameState.pile.length);
    if (n < 1) throw new Error('pile still empty');
});

const coachSays = async (pile) => {
    await page.evaluate((p) => {
        window.GameState.pile = p;
        window.GameState.lastPlayTime = Date.now() - 400;
        window.GameState.lastSlapWinTime = 0;
    }, pile);
    await page.click('#center-pile', { force: true });
    await page.waitForTimeout(400);
    return page.evaluate(() => {
        const el = document.getElementById('slap-coach');
        return { text: el.textContent, cls: el.className };
    });
};

await step('coach explains an invalid slap', async () => {
    const c = await coachSays([{ rank: 3, suit: 'clubs' }, { rank: 9, suit: 'hearts' }]);
    if (!c.cls.includes('bad')) throw new Error('not reported as invalid: ' + JSON.stringify(c));
    console.log(`         ${JSON.stringify(c.text)}`);
});
await step('coach names a valid slap', async () => {
    const c = await coachSays([{ rank: 7, suit: 'clubs' }, { rank: 7, suit: 'hearts' }]);
    if (!c.cls.includes('good')) throw new Error('not reported as valid: ' + JSON.stringify(c));
    console.log(`         ${JSON.stringify(c.text)}`);
});
await step('the speedometer says how that compares to your own history', async () => {
    // The Slap IQ step above seeded ten past reaction times (median ~344ms) and
    // coachSays slaps at ~400ms, so this should read as slower than usual.
    // Below reflexDelta.js's sample floor the chip is simply absent — that case
    // is covered by the unit suite, which can set the history exactly.
    await page.evaluate(() => { document.querySelectorAll('.reflex-speedometer').forEach(el => el.remove()); });
    await coachSays([{ rank: 9, suit: 'clubs' }, { rank: 9, suit: 'hearts' }]);
    const s = await page.evaluate(() => {
        const el = document.querySelector('.reflex-speedometer');
        if (!el) return null;
        const chip = el.querySelector('.reflex-personal');
        return { all: el.textContent.trim(), chip: chip?.textContent.trim() || '', cls: chip?.className || '' };
    });
    if (!s) throw new Error('no speedometer appeared for a valid slap');
    if (!s.chip) throw new Error('no personal comparison on: ' + s.all);
    if (!/rp-(faster|slower)/.test(s.cls)) throw new Error('chip has no direction: ' + s.cls);
    console.log(`         ${JSON.stringify(s.all)}`);
});
await step('walking out of a match takes the tell with it', async () => {
    // Quitting emits no gameOver — it runs main.js's confirm-modal path and
    // lands on gameStateChanged: 'menu'. A gameOver-only clear left the halos
    // on the bot decks, which is how this was found on the live site after
    // v3.2.1 deployed. The suite drove matches to their end and never out of one.
    const before = await page.evaluate(() => ['left-deck', 'top-deck', 'right-deck']
        .filter(id => document.getElementById(id).classList.contains('bot-tell')).length);
    if (before !== 3) throw new Error('no tell to clear — the match was not set up: ' + before + '/3');

    await page.click('#btn-quit');
    await page.waitForTimeout(300);
    await page.click('#btn-confirm-leave');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
    await page.waitForTimeout(300);

    const left = await page.evaluate(() => ['left-deck', 'top-deck', 'right-deck']
        .filter(id => document.getElementById(id).classList.contains('bot-tell')));
    if (left.length) throw new Error('tell survived the quit on: ' + left.join(', '));
    console.log('         quit → all three seats cleared');

    // Put the table back for the step that follows.
    await page.click('#btn-play-bots');
    await page.waitForSelector('#game-container.active', { timeout: 10000 });
    await page.waitForTimeout(900);
});

// v3.23.3 — a quit is a loss. CardSkins.applyQuitPenalty() announces it as
// coinsAwarded { winnerId: -2 }; v2.9.0 wrote it to the permanent record and
// ended the win streak, and a rewrite lost both listeners. Nothing here reads
// source: it signs a fake player in, puts a spy where the record is written
// (ScoreSystem.recorder), and walks out of real matches through the real
// button and the real confirm modal.
await step('quitting a match is a recorded loss and ends the streak; finished, guest and refused cases stay quiet', async () => {
    const setup = () => page.evaluate(async () => {
        const { ScoreSystem } = await import('/js/scoreSystem.js');
        const { AuthSystem } = await import('/js/auth.js');
        const { StreakTracker } = await import('/js/streakTracker.js');
        window.__rec = { calls: [], orig: ScoreSystem.recorder, user: AuthSystem.currentUser, errs: [], origErr: console.error };
        ScoreSystem.recorder = async (_u, o) => { window.__rec.calls.push(o); return { totalScore: 0, username: 'Smoke', gamesPlayed: 1, gamesWon: 0, bestReflex: null }; };
        AuthSystem.currentUser = { uid: 'smoke-uid', email: 'smoke@example.test' };
        StreakTracker.currentStreak = 3;
    });
    const quit = async () => {
        await page.click('#btn-quit');
        await page.waitForTimeout(250);
        const text = await page.evaluate(() => document.querySelector('#confirm-modal .modal-subtext').innerText);
        await page.click('#btn-confirm-leave');
        await page.waitForSelector('#main-menu.active', { timeout: 5000 });
        await page.waitForTimeout(300);
        return text;
    };
    const play = async () => {
        await page.click('#btn-play-bots');
        await page.waitForSelector('#game-container.active', { timeout: 10000 });
        await page.waitForTimeout(700);
    };
    const state = () => page.evaluate(async () => {
        const { StreakTracker } = await import('/js/streakTracker.js');
        return { calls: window.__rec.calls.slice(), streak: StreakTracker.currentStreak };
    });

    try {
        await setup();

        // 1. signed in, mid-match: the modal says so, and exactly one loss is written.
        const said = await quit();
        if (!/loss on your record/i.test(said)) throw new Error('the quit warning does not mention the record: ' + said);
        let st = await state();
        if (st.calls.length !== 1 || st.calls[0].won !== false)
            throw new Error('a quit did not write exactly one loss: ' + JSON.stringify(st.calls));
        if (st.streak !== 0) throw new Error('the win streak survived the quit: ' + st.streak);
        // ...and a late gameOver for the same match cannot write it a second time.
        // (gameOver paints a permanent banner, which quitGame() takes down again — as it does live.)
        await page.evaluate(async () => {
            (await import('/js/eventbus.js')).default.emit('gameOver', 1);
            (await import('/js/gameManager.js')).GameManager.quitGame();
        });
        await page.waitForTimeout(450);
        st = await state();
        if (st.calls.length !== 1) throw new Error('one match was written twice: ' + JSON.stringify(st.calls));

        // 2. a guest has no record: nothing is written, and the warning does not claim one.
        await page.evaluate(async () => { (await import('/js/auth.js')).AuthSystem.currentUser = null; });
        await play();
        const guestSaid = await quit();
        if (/on your record/i.test(guestSaid)) throw new Error('a guest was told about a record: ' + guestSaid);
        st = await state();
        if (st.calls.length !== 1) throw new Error('a guest quit wrote a record: ' + JSON.stringify(st.calls));

        // 3. a match that ends normally records one win; leaving after it records nothing more.
        await page.evaluate(async () => { (await import('/js/auth.js')).AuthSystem.currentUser = { uid: 'smoke-uid', email: 'smoke@example.test' }; });
        await play();
        await page.evaluate(async () => {
            window.GameState.gameOver = true; // what game.js sets just before it announces the end
            (await import('/js/eventbus.js')).default.emit('gameOver', 0);
        });
        await page.waitForTimeout(250);
        st = await state();
        if (st.calls.length !== 2 || st.calls[1].won !== true)
            throw new Error('a won match did not write exactly one win: ' + JSON.stringify(st.calls));
        await quit();
        st = await state();
        if (st.calls.length !== 2) throw new Error('leaving a finished match wrote again: ' + JSON.stringify(st.calls));

        // 4. a refused write (the 10 s cooldown, offline) is logged and never shown.
        await page.evaluate(async () => {
            const { ScoreSystem } = await import('/js/scoreSystem.js');
            ScoreSystem.recorder = async () => { window.__rec.calls.push({ refused: true }); const e = new Error('cooldown'); e.code = 'permission-denied'; throw e; };
            window.__rec.errs = [];
            console.error = (...a) => window.__rec.errs.push(a.join(' '));
        });
        await play();
        await page.evaluate(async () => { (await import('/js/streakTracker.js')).StreakTracker.currentStreak = 2; });
        await quit();
        await page.waitForTimeout(150);
        const refused = await page.evaluate(async () => ({
            calls: window.__rec.calls.length, errs: window.__rec.errs.slice(),
            streak: (await import('/js/streakTracker.js')).StreakTracker.currentStreak,
            errorScreen: !!document.querySelector('.error-screen.active, #error-screen.active')
        }));
        if (refused.calls !== 3) throw new Error('the refused write was not attempted exactly once: ' + JSON.stringify(refused));
        if (!refused.errs.some(t => /match not recorded/.test(t))) throw new Error('the refusal was swallowed without a trace: ' + JSON.stringify(refused.errs));
        if (refused.errorScreen) throw new Error('a refused quit-record raised an error screen over the menu');
        if (refused.streak !== 0) throw new Error('a refused write kept the streak alive: ' + refused.streak);
        console.log('         quit → 1 loss, streak 0 · guest → none · win → 1 win · refused → logged, silent');
    } finally {
        await page.evaluate(async () => {
            const r = window.__rec; if (!r) return;
            (await import('/js/scoreSystem.js')).ScoreSystem.recorder = r.orig;
            (await import('/js/auth.js')).AuthSystem.currentUser = r.user;
            console.error = r.origErr;
            delete window.__rec;
        });
    }

    // Put the table back for the step that follows.
    await page.click('#btn-play-bots');
    await page.waitForSelector('#game-container.active', { timeout: 10000 });
    await page.waitForTimeout(900);
});

console.log('\n— combustion shield (v3.7.1) —');

await step('a renewing slap puts the countdown back on the clock', async () => {
    // The reported bug, measured on the rendered deck: the shield icon sat there
    // with no number while the shield was still genuinely protecting the player,
    // and "expired" arrived long after the counter had run out. Cause: two
    // 30-second clocks, only one of which a renewal restarted.
    const seen = await page.evaluate(async () => {
        const [ui, game] = await Promise.all([import('/js/ui.js'), import('/js/game.js')]);
        const U = ui.UIManager, G = game.GameState;
        const read = () => {
            const el = document.querySelector('#bottom-player .deck-shield');
            if (!el) return { present: false };
            const txt = el.querySelector('.shield-timer-text');
            return {
                present: true,
                rendered: el.getClientRects().length > 0,
                secs: txt ? Number(txt.innerText) : null,
                raw: el.innerText.trim()
            };
        };

        // Snapshot whatever the live match is doing so it can be handed back.
        const savedStreaks = (G.streaks || [0, 0, 0, 0]).slice();
        G.streaks = [3, 0, 0, 0];   // shield live; updateCounts only draws it at 3+

        // Earn the shield.
        U.armShieldCountdown(0);
        U.updateCounts();
        const onEarn = read();

        // Age the clock the way 25 seconds of play would.
        U.shieldExpireTimestamps[0] = Date.now() + 4000;
        U.updateCounts();
        const aged = read();

        // The renewal signal. Driving it through the event rather than through
        // winPile() keeps the running match untouched — and the event is exactly
        // the contract under test here: winPile -> shieldRenewed is proven
        // behaviourally in the node suite (section 40); what only a browser can
        // show is whether the DRAWN clock answers it.
        const bus = (await import('/js/eventbus.js')).default;
        bus.emit('shieldRenewed', 0);
        await new Promise(r => setTimeout(r, 120));
        U.updateCounts();
        const afterRenew = read();

        // And the failure mode the player photographed: a live shield whose
        // drawn clock has already run out renders as a bare icon with no number.
        U.shieldExpireTimestamps[0] = Date.now() - 1000;
        U.updateCounts();
        const stale = read();

        // Put the board back the way the next step expects to find it: a live
        // match, no lingering shield. quitGame() here would end the match and
        // strand the step that follows.
        G.streaks = savedStreaks;
        U.shieldExpireTimestamps = [0, 0, 0, 0];
        U.updateCounts();
        return { onEarn, aged, afterRenew, stale, duration: game.SHIELD_DURATION_MS };
    });

    if (!seen.onEarn.present || !seen.onEarn.rendered)
        throw new Error('the shield icon did not render on the deck: ' + JSON.stringify(seen.onEarn));
    if (seen.onEarn.secs !== seen.duration / 1000)
        throw new Error(`a fresh shield should read ${seen.duration / 1000}s, read ${seen.onEarn.secs}`);
    if (!(seen.aged.secs <= 4))
        throw new Error('the countdown did not fall as time passed: ' + JSON.stringify(seen.aged));
    if (seen.afterRenew.secs !== seen.duration / 1000)
        throw new Error('THE REPORTED BUG: a renewing slap left the countdown at ' +
                        seen.afterRenew.secs + 's instead of resetting to ' + seen.duration / 1000 +
                        's — the drawn clock and the real shield have drifted apart again');
    if (!seen.stale.present)
        throw new Error('a live shield stopped drawing entirely once its countdown lapsed');
    if (seen.stale.secs !== null)
        throw new Error('a lapsed countdown should show no number rather than a wrong one');
    console.log(`         earned ${seen.onEarn.secs}s → aged to ${seen.aged.secs}s → renewed back to ${seen.afterRenew.secs}s`);
});

await step('coach names a rule the table switched off', async () => {
    await page.evaluate(() => window.GameState.quitGame());
    await page.click('#btn-quit');
    await page.waitForTimeout(300);
    await page.click('#btn-confirm-leave');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });

    await page.click('#btn-settings');
    await page.waitForSelector('#settings-panel.active', { timeout: 5000 });
    await page.click('#rule-tens');
    await page.click('#btn-back');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });

    await page.click('#btn-play-bots');
    await page.waitForSelector('#game-container.active', { timeout: 10000 });
    await page.waitForTimeout(900);

    const c = await coachSays([{ rank: 4, suit: 'clubs' }, { rank: 6, suit: 'hearts' }]);
    if (!c.text.includes('🚫')) throw new Error('expected a house-rule explanation, got: ' + c.text);
    console.log(`         ${JSON.stringify(c.text)}`);
});

console.log('\n— invite deep link (council ERS-07) —');

// F1 shipped under a green 664-test suite, and the fix shipped under a green
// 694-test one, because every assertion about it reads the SHAPE of main.js.
// A grep for "does not call joinTableDirect synchronously" cannot see what a
// player sees. These two steps boot a real browser at a real invite URL and
// look at the screen.
//
// The stub fires onAuthStateChanged asynchronously, exactly like the real SDK,
// so the race that produced F1 is reproduced here rather than described.

/**
 * Records every toast written into #notifications — AND whether it was actually
 * on screen when it was written.
 *
 * The visibility half was added in v3.7.0 after the ERS-08 review found that
 * this recorder had been certifying invisible text as present for the app's
 * entire history. #notifications lived inside #game-container, a .screen that
 * is display:none unless active, so every message raised from the lobby, the
 * menu or the reconnect popup was written into a hidden subtree. The recorder
 * read `innerText`, which a hidden ancestor does not affect, and the step below
 * asserted "a login prompt is shown" — and passed, while a real player saw an
 * empty screen. A test that reads the source shape of a message is not a
 * substitute for a test that sees it.
 *
 * The predicate is getClientRects().length, NOT offsetParent. The first draft of
 * this recorder used offsetParent !== null and reported the (now correctly
 * rendered) toast as invisible — because a position:fixed element has a null
 * offsetParent by specification, regardless of whether it is on screen. That
 * would have been the same defect one level up: a visibility check that cannot
 * see. getClientRects() returns an empty list when the element or any ancestor
 * is display:none, and a real box otherwise, for fixed and static alike.
 */
const TOAST_RECORDER = () => {
    window.__toasts = [];
    const attach = () => {
        const el = document.getElementById('notifications');
        if (!el) return false;
        new MutationObserver(() => {
            const t = (el.innerText || '').trim();
            if (!t) return;
            const last = window.__toasts[window.__toasts.length - 1];
            if (last && last.t === t) return;
            const cs = getComputedStyle(el);
            window.__toasts.push({
                t,
                vis: el.getClientRects().length > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
                screen: (document.querySelector('.screen.active') || {}).id || null
            });
        }).observe(el, { childList: true, characterData: true, subtree: true });
        return true;
    };
    if (!attach()) document.addEventListener('DOMContentLoaded', attach);
};

await step('a signed-in player following an invite link is never told to log in', async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx2.route('**://www.gstatic.com/firebasejs/**', r =>
        r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
    await ctx2.route('**://fonts.googleapis.com/**', r =>
        r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx2.route('**://fonts.gstatic.com/**', r => r.abort());
    await ctx2.route('**/audio/*.mp3', r =>
        r.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' }));

    const p2 = await ctx2.newPage();
    // A restored session, resolving after boot — the F1 condition exactly.
    await p2.addInitScript(() => {
        window.__ERS_SMOKE_USER__ = { uid: 'smoke-uid', email: 'smoke@example.test',
                                      displayName: 'SmokePlayer' };
    });
    await p2.addInitScript(TOAST_RECORDER);

    await p2.goto(`${base}/index.html#join=K9X2P1`, { waitUntil: 'domcontentloaded' });
    await p2.waitForTimeout(1500);

    const seen = await p2.evaluate(() => ({
        toasts: window.__toasts || [],
        pending: sessionStorage.getItem('ers_pending_invite'),
        hash: window.location.hash,
        authPanelOpen: !!document.querySelector('#account-panel.active')
    }));
    await ctx2.close();

    // The charge in F1: a correctly-authenticated player is shown a login error.
    const loginToast = seen.toasts.find(x => /log in|giriş|anmeld|войти/i.test(x.t));
    if (loginToast) throw new Error('login prompt shown to a signed-in player: ' + JSON.stringify(loginToast));
    if (seen.authPanelOpen) throw new Error('the auth panel was forced open for a signed-in player');
    // The join is attempted and fails against the stub — that is correct and
    // expected. What must not happen is the apology.
    if (seen.hash) throw new Error('the invite hash was not cleaned: ' + seen.hash);
    if (seen.pending) throw new Error('the pending invite was not consumed on join: ' + seen.pending);
    console.log(`         ${seen.toasts.length} toast(s), none of them a login prompt`);
});

await step('a signed-out player IS prompted, and the code survives for later', async () => {
    const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx3.route('**://www.gstatic.com/firebasejs/**', r =>
        r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
    await ctx3.route('**://fonts.googleapis.com/**', r =>
        r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx3.route('**://fonts.gstatic.com/**', r => r.abort());
    await ctx3.route('**/audio/*.mp3', r =>
        r.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' }));

    const p3 = await ctx3.newPage();
    await p3.addInitScript(TOAST_RECORDER);   // no __ERS_SMOKE_USER__: auth resolves to null
    await p3.goto(`${base}/index.html#join=K9X2P1`, { waitUntil: 'domcontentloaded' });
    await p3.waitForTimeout(1500);

    const seen = await p3.evaluate(() => {
        const raw = sessionStorage.getItem('ers_pending_invite');
        return { toasts: window.__toasts || [], raw, parsed: raw ? JSON.parse(raw) : null };
    });

    // Second read, ~1s later: the timestamp must not have moved. This is the
    // renewal hole — the stored `at` has to keep counting from the click.
    await p3.waitForTimeout(1000);
    const again = await p3.evaluate(() => {
        const raw = sessionStorage.getItem('ers_pending_invite');
        return raw ? JSON.parse(raw) : null;
    });
    await ctx3.close();

    const prompt = seen.toasts.find(x => /log in|giriş|anmeld|войти/i.test(x.t));
    if (!prompt)
        throw new Error('no login prompt for a signed-out player: ' + JSON.stringify(seen.toasts));
    // The half this suite was missing until v3.7.0: the message existing in the
    // DOM is not the same as the player seeing it.
    if (!prompt.vis)
        throw new Error('the login prompt was written into a hidden element ' +
                        `(active screen: ${prompt.screen}) — the player sees nothing`);
    console.log(`         login prompt shown and VISIBLE on ${prompt.screen}`);
    if (!seen.parsed) throw new Error('the invite code was dropped instead of held for sign-in');
    if (seen.parsed.code !== 'K9X2P1') throw new Error('wrong code held: ' + seen.parsed.code);
    if (!again || again.at !== seen.parsed.at)
        throw new Error('the pending timestamp moved — the 15-minute window restarted');
    console.log(`         prompted once, code held, timestamp steady at ${seen.parsed.at}`);
});

console.log('\n— advertising —');

await step('back to the menu', async () => {
    await page.evaluate(() => window.GameState.quitGame());
    await page.click('#btn-quit');
    await page.waitForTimeout(300);
    await page.click('#btn-confirm-leave');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
});

console.log('\n— modals actually appear —');

// The unit suite can see that a CSS rule exists. Only a browser can see that
// the card ends up visible. This step exists because the invite modal shipped
// fully transparent and every other kind of test said it was fine.
await step('the two table buttons sit side by side, not on top of each other', async () => {
    const seen = await page.evaluate(() => {
        const wr = document.getElementById('waiting-room-panel');
        wr.classList.add('active');
        document.getElementById('display-table-id').innerText = 'EWXH2Q';
        const copy = document.getElementById('btn-copy-id');
        const share = document.getElementById('btn-share-invite');
        const a = copy.getBoundingClientRect(), b = share.getBoundingClientRect();
        const overlap = !(a.right <= b.left || b.right <= a.left ||
                          a.bottom <= b.top || b.bottom <= a.top);
        const hit = (r) => { const el = document.elementFromPoint(
            Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
            return el ? el.id : null; };
        const out = {
            copy: [a.x, a.y, a.width, a.height].map(Math.round),
            share: [b.x, b.y, b.width, b.height].map(Math.round),
            overlap,
            copyPosition: getComputedStyle(copy).position,
            sharePosition: getComputedStyle(share).position,
            copyReachable: hit(a) === 'btn-copy-id',
            shareReachable: hit(b) === 'btn-share-invite',
            sameRow: Math.abs(a.y - b.y) < 8
        };
        wr.classList.remove('active');
        return out;
    });
    if (seen.overlap) throw new Error(
        `the buttons overlap: copy ${seen.copy.join(',')} vs share ${seen.share.join(',')}`);
    if (!seen.copyReachable) throw new Error('Copy ID is covered by something');
    if (!seen.shareReachable) throw new Error('Share Invite is covered by something');
    if (!seen.sameRow) throw new Error(
        `they are not on the same row (y ${seen.copy[1]} vs ${seen.share[1]})`);
    if (seen.copyPosition === 'absolute' || seen.sharePosition === 'absolute')
        throw new Error('a table action is still absolutely positioned');
    console.log(`         side by side at y=${seen.copy[1]}, both clickable`);
});

await step('the invite modal is visible, not just present', async () => {
    const seen = await page.evaluate(async () => {
        const lob = await import('/js/lobbyUI.js');
        document.getElementById('display-table-id').innerText = 'EWXH2Q';
        lob.LobbyUI.openInviteModal('EWXH2Q');
        await new Promise(s => setTimeout(s, 700));
        const m = document.getElementById('invite-modal');
        const c = m.querySelector('.modal-content');
        const cr = c.getBoundingClientRect();
        const at = document.elementFromPoint(Math.round(cr.x + cr.width / 2),
                                             Math.round(cr.y + cr.height / 2));
        const out = {
            overlayOpacity: getComputedStyle(m).opacity,
            cardOpacity: getComputedStyle(c).opacity,
            cardBox: [cr.width, cr.height].map(Math.round),
            insideCard: !!(at && c.contains(at)),
            code: document.getElementById('invite-code-display').innerText,
            qr: (() => { const q = document.getElementById('invite-qr-canvas');
                if (!q) return 'missing';
                const px = q.getContext('2d').getImageData(0, 0, q.width, q.height).data;
                let dark = 0;
                for (let i = 0; i < px.length; i += 4) if (px[i] < 128) dark++;
                return { size: `${q.width}x${q.height}`, darkPixels: dark }; })()
        };
        lob.LobbyUI.closeInviteModal();
        return out;
    });
    if (Number(seen.cardOpacity) < 1)
        throw new Error(`the invite card is transparent (opacity ${seen.cardOpacity})`);
    if (Number(seen.overlayOpacity) < 1)
        throw new Error(`the overlay is transparent (opacity ${seen.overlayOpacity})`);
    if (seen.cardBox[0] < 200 || seen.cardBox[1] < 200)
        throw new Error('the invite card collapsed: ' + seen.cardBox.join('x'));
    if (!seen.insideCard) throw new Error('something is covering the invite card');
    if (seen.code !== 'EWXH2Q') throw new Error('the table code did not reach the modal');
    if (seen.qr === 'missing' || seen.qr.darkPixels < 500)
        throw new Error('the QR canvas is blank: ' + JSON.stringify(seen.qr));
    console.log(`         card ${seen.cardBox.join('x')} at opacity ${seen.cardOpacity}, ` +
                `QR ${seen.qr.size} with ${seen.qr.darkPixels} dark pixels`);
});

console.log('\n— error surfacing (v3.7.0) —');

await step('the error screen renders opaque, on top, and names the reason', async () => {
    const seen = await page.evaluate(async () => {
        const [es, ec, loc] = await Promise.all([
            import('/js/errorScreen.js'), import('/js/errorCodes.js'), import('/js/localization.js?v=3')
        ]);
        loc.Localization.init('tr');
        // A stuck spinner is one of the things this screen exists to rescue
        // someone from, so raise it first and check the screen clears it.
        document.getElementById('loading-overlay').style.display = 'flex';
        es.ErrorScreen.show({
            code: ec.ERR.OFFLINE,
            titleKey: 'errTitleJoinTable',
            technical: 'smoke: simulated transport failure',
            onRetry: () => { window.__retried = true; }
        });
        await new Promise(r => setTimeout(r, 250));
        const m = document.getElementById('error-modal');
        const card = m.querySelector('.ers-error-card');
        const r = card.getBoundingClientRect();
        const mid = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
        return {
            overlayOpacity: getComputedStyle(m).opacity,
            overlayDisplay: getComputedStyle(m).display,
            cardOpacity: getComputedStyle(card).opacity,
            box: [r.width, r.height].map(Math.round),
            onTop: !!(mid && card.contains(mid)),
            classes: m.className,
            title: m.querySelector('.ers-error-title').innerText,
            reason: m.querySelector('.ers-error-reason').innerText,
            // textContent, not innerText: the detail starts collapsed, and
            // innerText returns '' for content inside a closed <details>.
            tech: m.querySelector('.ers-error-tech-body').textContent,
            techOpen: m.querySelector('.ers-error-tech').open,
            retryVisible: getComputedStyle(m.querySelector('.ers-error-retry')).display !== 'none',
            spinner: getComputedStyle(document.getElementById('loading-overlay')).display,
            zOverlay: getComputedStyle(m).zIndex
        };
    });
    if (seen.overlayDisplay === 'none') throw new Error('the error screen did not open at all');
    if (Number(seen.cardOpacity) < 1) throw new Error(`the error card is transparent (${seen.cardOpacity})`);
    if (seen.box[0] < 240 || seen.box[1] < 180) throw new Error('the error card collapsed: ' + seen.box.join('x'));
    if (!seen.onTop) throw new Error('something is covering the error card');
    if (/\bscreen\b/.test(seen.classes)) throw new Error('the error modal acquired .screen: ' + seen.classes);
    if (seen.spinner !== 'none') throw new Error('the error screen did not clear the stuck spinner');
    // The two sentences the player asked for, by name, in their own language.
    if (seen.title !== 'Odaya katılınamadı')
        throw new Error('the WHAT line is wrong: ' + JSON.stringify(seen.title));
    if (!/İnternet bağlantın koptu/.test(seen.reason))
        throw new Error('the WHY line is wrong: ' + JSON.stringify(seen.reason));
    // An unresolved key ships as visible camelCase, not as a blank.
    if (/^err[A-Z]/.test(seen.title) || /^err[A-Z]/.test(seen.reason))
        throw new Error('a raw localization key reached the screen: ' + seen.title + ' / ' + seen.reason);
    if (seen.techOpen) throw new Error('technical detail should start collapsed');
    if (!/OFFLINE/.test(seen.tech)) throw new Error('the stable code is missing from the detail line');
    if (!seen.retryVisible) throw new Error('a retry action was supplied but no Retry button rendered');
    if (Number(seen.zOverlay) <= 9999) throw new Error('the error screen sits below the spinner');
    console.log(`         "${seen.title}" / "${seen.reason}" — ${seen.box.join('x')} at z=${seen.zOverlay}`);
});

await step('Retry runs the action and closes the screen; Close just closes', async () => {
    const seen = await page.evaluate(async () => {
        const es = await import('/js/errorScreen.js');
        const m = document.getElementById('error-modal');
        m.querySelector('.ers-error-retry').click();
        await new Promise(r => setTimeout(r, 120));
        const afterRetry = { open: m.classList.contains('open'), retried: !!window.__retried };

        const ec = await import('/js/errorCodes.js');
        es.ErrorScreen.show({ code: ec.ERR.TABLE_FULL, titleKey: 'errTitleJoinTable' });
        await new Promise(r => setTimeout(r, 120));
        const noRetry = getComputedStyle(m.querySelector('.ers-error-retry')).display === 'none';
        const reason = m.querySelector('.ers-error-reason').innerText;
        m.querySelector('.ers-error-close').click();
        await new Promise(r => setTimeout(r, 120));
        return { ...afterRetry, noRetry, reason, closed: !m.classList.contains('open') };
    });
    if (!seen.retried) throw new Error('Retry did not run the supplied action');
    if (seen.open) throw new Error('Retry left the error screen open');
    if (!seen.noRetry) throw new Error('a Retry button rendered with no retry action supplied');
    if (!/dört oyuncu/.test(seen.reason)) throw new Error('TABLE_FULL got the wrong reason: ' + seen.reason);
    if (!seen.closed) throw new Error('Close did not close the error screen');
    console.log('         retry fired and closed; close closed; TABLE_FULL reason correct');
});

await step('six different join failures produce six different reasons', async () => {
    // This is the defect the release exists to fix: before v3.7.0 every one of
    // these produced the single sentence "Table not found or full", so five of
    // the six players were told something untrue.
    const seen = await page.evaluate(async () => {
        const [es, ec, loc] = await Promise.all([
            import('/js/errorScreen.js'), import('/js/errorCodes.js'), import('/js/localization.js?v=3')
        ]);
        loc.Localization.init('tr');
        const m = document.getElementById('error-modal');
        const out = {};
        const cases = {
            AUTH_REQUIRED: ec.appError(ec.ERR.AUTH_REQUIRED, 'x'),
            TABLE_NOT_FOUND: ec.appError(ec.ERR.TABLE_NOT_FOUND, 'x'),
            TABLE_FULL: ec.appError(ec.ERR.TABLE_FULL, 'x'),
            GAME_ALREADY_STARTED: ec.appError(ec.ERR.GAME_ALREADY_STARTED, 'x'),
            PERMISSION_DENIED: { code: 'permission-denied', message: 'x' },
            OFFLINE: { message: 'anything at all' }
        };
        for (const [name, err] of Object.entries(cases)) {
            const online = name !== 'OFFLINE';
            es.ErrorScreen.show({
                code: ec.classifyError(err, { online }),
                titleKey: 'errTitleJoinTable'
            });
            out[name] = m.querySelector('.ers-error-reason').innerText;
        }
        es.ErrorScreen.hide();
        return out;
    });
    const reasons = Object.values(seen);
    if (new Set(reasons).size !== reasons.length)
        throw new Error('two failures share a reason: ' + JSON.stringify(seen));
    for (const [k, v] of Object.entries(seen)) {
        if (!v || /^err[A-Z]/.test(v)) throw new Error(`${k} rendered a raw key: ${v}`);
    }
    if (!/İnternet bağlantın koptu/.test(seen.OFFLINE))
        throw new Error('an offline device was not told its connection dropped: ' + seen.OFFLINE);
    console.log(`         ${reasons.length} distinct reasons, all localized`);
});

await step('a newer toast survives the previous toast hide timer', async () => {
    const seen = await page.evaluate(async () => {
        const { UIManager } = await import('/js/ui.js');
        UIManager.showNotification('OLD TOAST', 'var(--error)');
        await new Promise(r => setTimeout(r, 1100));
        UIManager.showNotification('NEW TOAST', 'var(--accent)', true);
        await new Promise(r => setTimeout(r, 650));
        const el = document.getElementById('notifications');
        return { text: el.innerText, opacity: Number(getComputedStyle(el).opacity) };
    });
    if (seen.text !== 'NEW TOAST' || seen.opacity < 0.9)
        throw new Error('the old timer hid its replacement: ' + JSON.stringify(seen));
});

await step('a toast raised from the menu is visible, not written into a hidden div', async () => {
    // The regression that hid every lobby, menu and reconnect message for the
    // app's whole history. Only a rendered measurement can catch it.
    const seen = await page.evaluate(async () => {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('main-menu').classList.add('active');
        const ui = await import('/js/ui.js');
        ui.UIManager.showNotification('SMOKE VISIBILITY PROBE', 'var(--error)');
        await new Promise(r => setTimeout(r, 350));
        const el = document.getElementById('notifications');
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
            text: el.innerText.trim(),
            // NOT offsetParent: a position:fixed element always reports null
            // there. getClientRects() is empty only when it is genuinely unrendered.
            rendered: el.getClientRects().length > 0,
            display: cs.display,
            opacity: cs.opacity,
            position: cs.position,
            box: [r.width, r.height].map(Math.round),
            onScreen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight,
            insideGameContainer: !!document.getElementById('game-container').contains(el)
        };
    });
    if (seen.insideGameContainer)
        throw new Error('#notifications is inside #game-container again — invisible on every other screen');
    if (!seen.rendered || seen.display === 'none')
        throw new Error('the toast host is not rendered: ' + JSON.stringify(seen));
    if (seen.position !== 'fixed')
        throw new Error('the toast host is not viewport-anchored: ' + seen.position);
    if (Number(seen.opacity) < 0.9)
        throw new Error(`the toast is transparent (opacity ${seen.opacity})`);
    if (!seen.onScreen) throw new Error('the toast is off-screen: ' + seen.box.join('x'));
    if (seen.text !== 'SMOKE VISIBILITY PROBE') throw new Error('the toast text did not arrive: ' + seen.text);
    console.log(`         visible on the menu at ${seen.box.join('x')}, opacity ${seen.opacity}, ${seen.position}`);
});

await step('the winner banner does not follow you back to the menu', async () => {
    // The defect, exactly as the player hit it: finish a match, return to the
    // menu, and "KAOS KAZANDI!" is still there in 2.8rem gold across the
    // buttons. `gameOver` posts that banner with permanent = true, and until
    // v3.12.0 the project contained no code anywhere that ever set this
    // element's opacity back to zero outside the non-permanent fade.
    //
    // Driven through the real wiring — the same EventBus event a real match
    // emits, and the real GameManager.quitGame() the menu button calls — so
    // this passes only if production does.
    const seen = await page.evaluate(async () => {
        const { default: EventBus } = await import('/js/eventbus.js');
        const { GameManager } = await import('/js/gameManager.js');
        const el = document.getElementById('notifications');

        EventBus.emit('gameOver', 1);
        await new Promise(r => setTimeout(r, 400));
        const during = { text: el.innerText.trim(), opacity: Number(getComputedStyle(el).opacity) };

        GameManager.quitGame();
        await new Promise(r => setTimeout(r, 400));
        const after = { text: el.innerText.trim(), opacity: Number(getComputedStyle(el).opacity) };

        // ...and a permanent banner must not survive into the NEXT match either.
        EventBus.emit('gameOver', 1);
        await new Promise(r => setTimeout(r, 400));
        EventBus.emit('gameStarted');
        await new Promise(r => setTimeout(r, 400));
        const nextMatch = { text: el.innerText.trim(), opacity: Number(getComputedStyle(el).opacity) };

        return { during, after, nextMatch };
    });
    if (seen.during.opacity < 0.9)
        throw new Error('the winner banner never showed, so the test proves nothing: ' + JSON.stringify(seen.during));
    if (seen.after.opacity > 0.01)
        throw new Error('the winner banner survived the return to the menu: ' + JSON.stringify(seen.after));
    if (seen.nextMatch.opacity > 0.01)
        throw new Error('the winner banner survived into the next match: ' + JSON.stringify(seen.nextMatch));
    console.log(`         shown at opacity ${seen.during.opacity}, gone after quit and after restart`);
});

await step('nothing above the screen layer is left painted over the menu', async () => {
    // The general form of the bug above, and the reason it is worth a step of
    // its own: the specific assertion catches THIS element. This one catches
    // the next one, because the set it checks is derived rather than listed.
    //
    // The derivation: `.screen` tops out at z-index 1000, so anything
    // body-level ABOVE that is by construction an overlay — a toast, a
    // spinner, a modal, a banner. An overlay is exactly the kind of element
    // that is shown from JS and has to be taken down again, and it is exactly
    // the kind that survives a screen change, because screen changes only
    // touch `.screen`. So: while the menu is the active screen, no body-level
    // element with z-index >= 1000 may be rendered. A future overlay is in
    // scope the moment it is written, with no list to update.
    const offenders = await page.evaluate(async () => {
        const { GameManager } = await import('/js/gameManager.js');
        const { default: EventBus } = await import('/js/eventbus.js');
        // Raise a real overlay first, so this step reproduces the defect on
        // its own rather than inheriting a clean element from the step above.
        // A gate that passes because of what ran before it is not a gate.
        EventBus.emit('gameOver', 2);
        await new Promise(r => setTimeout(r, 300));
        GameManager.quitGame();
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('main-menu').classList.add('active');
        document.body.classList.add('menu-screen');
        document.body.classList.remove('game-screen');
        await new Promise(r => setTimeout(r, 500));

        // ONE predicate, used by the walk and by the proof below. Written
        // twice, the two drifted the first time they were mutated: a change
        // to the walk left the proof still passing, so the mutation reported
        // a gate that was in fact blind. Same defect class this project keeps
        // removing everywhere else — a value with no single home.
        const paintedOverlays = () => {
            const found = [];
            for (const el of document.body.children) {
                const cs = getComputedStyle(el);
                const z = cs.zIndex === 'auto' ? 0 : Number(cs.zIndex);
                if (!(z >= 1000)) continue;
                const r = el.getBoundingClientRect();
                const rendered = el.getClientRects().length > 0
                    && cs.display !== 'none'
                    && cs.visibility !== 'hidden'
                    && Number(cs.opacity) > 0.01
                    && r.width > 0 && r.height > 0;
                if (rendered) found.push({ id: el.id || el.className, z, opacity: cs.opacity, text: el.innerText.trim().slice(0, 40) });
            }
            return found;
        };
        const out = paintedOverlays();
        // Proof the scan is not blind: the same walk must be able to SEE an
        // overlay when there is one to see. Without this, an empty result is
        // equally consistent with "clean menu" and "the walk found nothing".
        //
        // The probe is a THROWAWAY element, not #notifications. The first
        // version raised the real toast and this step failed roughly one run
        // in five — because `GameManager.quitGame()` clears the toast through
        // a dynamic `import('./ui.js').then(...)`, which can resolve AFTER the
        // probe has been raised and wipe it. A flaky gate is a gate that gets
        // ignored, and the flake was in the proof rather than in the thing
        // being proved. A bare div owned by nobody cannot race the app.
        const probe = document.createElement('div');
        probe.id = 'smoke-overlay-probe';
        probe.textContent = 'SCAN PROBE';
        probe.style.cssText = 'position:fixed;top:40%;left:40%;width:120px;height:40px;z-index:10001;opacity:1;background:#111;color:#fff';
        document.body.appendChild(probe);
        await new Promise(r => setTimeout(r, 60));
        const sawProbe = paintedOverlays().some(o => o.id === 'smoke-overlay-probe');
        probe.remove();
        return { out, sawProbe };
    });
    if (!offenders.sawProbe)
        throw new Error('the overlay walk cannot see an overlay it was shown — the scan is blind');
    if (offenders.out.length)
        throw new Error('left painted over the menu: ' + JSON.stringify(offenders.out));
    console.log(`         menu is clean; the walk proved it can see an overlay when one is there`);
});

await step('the connection banner shows on disconnect and clears on reconnect', async () => {
    const seen = await page.evaluate(async () => {
        const cb = (await import('/js/connectionBanner.js')).ConnectionBanner;
        const el = document.getElementById('connection-banner');
        cb.armLost(60);                       // grace period, still hidden
        const during = getComputedStyle(el).display;
        await new Promise(r => setTimeout(r, 250));
        const r1 = el.getBoundingClientRect();
        const after = {
            display: getComputedStyle(el).display,
            text: el.innerText.trim(),
            box: [r1.width, r1.height].map(Math.round),
            z: getComputedStyle(el).zIndex,
            clickThrough: getComputedStyle(el).pointerEvents === 'none'
        };
        cb.clear();
        await new Promise(r => setTimeout(r, 60));
        return { during, after, cleared: getComputedStyle(el).display === 'none' };
    });
    if (seen.during !== 'none') throw new Error('the banner appeared before its grace period elapsed');
    if (seen.after.display === 'none') throw new Error('the banner never appeared after the grace period');
    if (seen.after.box[0] < 100) throw new Error('the banner collapsed: ' + seen.after.box.join('x'));
    if (!/bağlantı|connection|verbindung|соединение/i.test(seen.after.text))
        throw new Error('the banner says nothing about the connection: ' + seen.after.text);
    if (!seen.after.clickThrough) throw new Error('the banner can swallow clicks');
    if (!seen.cleared) throw new Error('the banner did not clear on reconnect');
    console.log(`         "${seen.after.text}" ${seen.after.box.join('x')} at z=${seen.after.z}, cleared on return`);
});

await step('the spinner cannot outlive the operation that raised it', async () => {
    const seen = await page.evaluate(async () => {
        const ui = await import('/js/ui.js');
        const ec = await import('/js/errorCodes.js');
        ui.UIManager.showLoading('smoke: hung request');
        const armed = ui.UIManager._loadingWatchdog !== null;
        const shown = getComputedStyle(document.getElementById('loading-overlay')).display;
        ui.UIManager.hideLoading();
        return {
            armed,
            shown,
            disarmed: ui.UIManager._loadingWatchdog === null,
            hidden: getComputedStyle(document.getElementById('loading-overlay')).display === 'none',
            watchdogMs: ec.LOADING_WATCHDOG_MS,
            deadlineMs: ec.DEFAULT_DEADLINE_MS
        };
    });
    if (seen.shown === 'none') throw new Error('showLoading did not show the spinner');
    if (!seen.armed) throw new Error('showLoading did not arm the watchdog — a hung request would strand the player');
    if (!seen.disarmed) throw new Error('hideLoading left the watchdog armed; it would fire over a healthy screen');
    if (!seen.hidden) throw new Error('hideLoading did not hide the spinner');
    if (!(seen.watchdogMs > seen.deadlineMs))
        throw new Error('the watchdog must outlive the call deadline, or it pre-empts the specific error');
    console.log(`         watchdog armed at ${seen.watchdogMs}ms, deadline ${seen.deadlineMs}ms, both disarmed on hide`);
});

await step('the boot safety net is inline and disarms once the app starts', async () => {
    const seen = await page.evaluate(() => ({
        booted: window.__ersBooted === true,
        bootErrorHidden: getComputedStyle(document.getElementById('boot-error')).display === 'none',
        hasStaticMarkup: !!document.querySelector('#boot-error .boot-error-tech')
    }));
    if (!seen.booted) throw new Error('main.js never handed over from the boot net');
    if (!seen.bootErrorHidden) throw new Error('the boot failure notice is showing on a healthy load');
    if (!seen.hasStaticMarkup) throw new Error('#boot-error has no static markup to fall back on');
    console.log('         boot net armed pre-module, disarmed after main.js, notice hidden');
});

/**
 * The step above cannot fail for the reason that actually mattered.
 *
 * `window.__ersBooted` is set to `false` by the inline net and to `true` by
 * main.js. On a healthy load main.js always runs, so the flag reads `true`
 * whether or not the inline script ever executed — which is exactly what
 * happened in production from v3.7.0 to v3.7.4, where CSP blocked the script
 * and this assertion stayed green.
 *
 * So the net is now tested the only way that proves anything: break the module
 * graph and require the notice to appear. Under the real policy headers.
 */
await step('the boot net actually fires when the app cannot start', async () => {
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const cspHits = [];
    try {
        await ctxB.route('**://www.gstatic.com/firebasejs/**', r =>
            r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
        await ctxB.route('**://fonts.googleapis.com/**', r =>
            r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
        await ctxB.route('**://fonts.gstatic.com/**', r => r.abort());
        // The failure being simulated: the module graph never arrives.
        await ctxB.route('**/js/main.js*', r => r.fulfill({ status: 503, body: 'gone' }));

        const pB = await ctxB.newPage();
        pB.on('console', m => { if (NEVER_IGNORABLE.test(m.text())) cspHits.push(m.text()); });
        pB.on('pageerror', e => { if (NEVER_IGNORABLE.test(e.message)) cspHits.push(e.message); });

        await pB.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
        // The net reveals on the script's error event; the 12s timer is the
        // backstop, not the path under test, so this must not wait for it.
        await pB.waitForSelector('#boot-error', { state: 'visible', timeout: 6000 })
            .catch(() => { throw new Error('the app failed to start and the notice never appeared'); });

        const seen = await pB.evaluate(() => {
            const el = document.getElementById('boot-error');
            const btn = el.querySelector('button');
            const r = el.getBoundingClientRect();
            return {
                visible: el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none',
                box: [Math.round(r.width), Math.round(r.height)],
                tech: (el.querySelector('.boot-error-tech') || {}).textContent || '',
                bothLanguages: /başlatılamadı/i.test(el.textContent) && /could not start/i.test(el.textContent),
                hasButton: !!btn,
                buttonLabel: btn ? btn.textContent.trim() : ''
            };
        });

        if (!seen.visible) throw new Error('#boot-error is in the DOM but not on the screen');
        if (seen.box[0] < 200 || seen.box[1] < 100)
            throw new Error('the notice collapsed: ' + seen.box.join('x'));
        if (!seen.bothLanguages)
            throw new Error('the notice does not carry both languages: ' + seen.tech);
        if (!seen.tech) throw new Error('the notice names no reason at all');
        if (!seen.hasButton) throw new Error('the notice offers no way to retry');
        if (cspHits.length)
            throw new Error('the recovery screen violates the production CSP: ' + cspHits[0].slice(0, 140));

        // The retry control must work under CSP too. An inline onclick= is
        // blocked by script-src just as an inline <script> is, and a hash does
        // NOT unblock it — so this asserts a real listener, not an attribute.
        const wired = await pB.evaluate(() => {
            const btn = document.querySelector('#boot-error button');
            return { inlineAttr: btn.hasAttribute('onclick'), reloadable: typeof location.reload === 'function' };
        });
        if (wired.inlineAttr)
            throw new Error('the retry button uses an inline onclick=, which CSP blocks');

        console.log(`         notice shown ${seen.box.join('x')}, both languages, reason "${seen.tech.slice(0, 40)}", retry wired without inline onclick`);
    } finally {
        await ctxB.close();
    }
});

console.log('\n— content pages —');

// These two pages exist because a review reads them. A structural test can see
// that the markup is there; only a browser can see that it renders translated
// prose rather than English fallbacks, and that the language switch reaches it.
await step('About and Rules render real prose, and follow the language', async () => {
    for (const [openBtn, panel, backBtn, minWords] of [
        ['#btn-about', '#about-panel', '#btn-about-back', 200],
        ['#btn-rules', '#rules-panel', '#btn-rules-back', 900]
    ]) {
        await page.click(openBtn);
        await page.waitForSelector(panel + '.active', { timeout: 5000 });
        const seen = await page.evaluate(({ panel }) => {
            const el = document.querySelector(panel);
            const empty = [...el.querySelectorAll('[data-i18n]')]
                .filter(n => !n.textContent.trim()).map(n => n.getAttribute('data-i18n'));
            return { words: el.innerText.trim().split(/\s+/).length, empty,
                     ads: el.querySelectorAll('.ad-slot').length,
                     filled: el.querySelectorAll('.ad-slot.filled').length };
        }, { panel });
        if (seen.empty.length) throw new Error(`${panel} has empty strings: ${seen.empty.join(', ')}`);
        if (seen.words < minWords) throw new Error(`${panel} is thin: ${seen.words} words`);
        if (seen.ads !== 1) throw new Error(`${panel} should carry exactly one ad container, has ${seen.ads}`);
        // v3.14.0: the container now fills. What this step still owns is the
        // PROSE — the ad's own behaviour is two steps below, on the wire.
        if (seen.filled !== 1) throw new Error(`${panel} has ${seen.filled} filled ad containers, want 1`);
        console.log(`         ${panel} — ${seen.words} words, 1 filled ad container`);
        await page.click(backBtn);
        await page.waitForSelector('#main-menu.active', { timeout: 5000 });
    }

    // Switch to Turkish and confirm the new prose actually follows. English text
    // left standing in a Russian policy is the failure this catches.
    await page.click('#btn-settings');
    await page.waitForSelector('#settings-panel.active', { timeout: 5000 });
    await page.selectOption('#select-lang', 'tr').catch(() => {});
    await page.waitForTimeout(300);
    await page.click('#btn-back');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });

    await page.click('#btn-about');
    await page.waitForSelector('#about-panel.active', { timeout: 5000 });
    const tr = await page.evaluate(() =>
        document.querySelector('[data-i18n="aWhatDesc"]').textContent.trim());
    await page.click('#btn-about-back');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
    if (!/refleks kart oyunu/i.test(tr))
        throw new Error('the About text did not follow the language: ' + JSON.stringify(tr.slice(0, 80)));
    console.log(`         en → tr: ${JSON.stringify(tr.slice(0, 60))}…`);

    // Put English back for the steps that follow.
    await page.click('#btn-settings');
    await page.waitForSelector('#settings-panel.active', { timeout: 5000 });
    await page.selectOption('#select-lang', 'en').catch(() => {});
    await page.waitForTimeout(300);
    await page.click('#btn-back');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
});

await step('ads land on reading panels only, labelled, and never beside a control', async () => {
    // Until v3.14.0 this step proved the opposite claim — an empty publisher id
    // meant no script, no request, no cookie — and it is kept in the same place
    // because the replacement claim is the one that now protects the game:
    // units on reading panels, never on a screen where something is timed.
    //
    // v3.24.1 (council ERS-37) adds AdSense's own placement rules: no unit on
    // the lobby, the shop or the account screen, and on a reading panel the
    // unit sits under the title with content — not a button — on both sides.
    // Measured while each panel is OPEN, because a closed panel has no boxes.
    const visits = [
        ['#btn-shop', '#shop-panel', '#btn-shop-back'],
        ['#btn-rules', '#rules-panel', '#btn-rules-back'],
        ['#btn-slapiq', '#slapiq-panel', '#btn-slapiq-back'],
        ['#btn-leaderboard', '#leaderboard-panel', '#btn-leaderboard-back']
    ];
    const placed = [];
    for (const [open, panel, close] of visits) {
        if (!(await page.$(open))) continue;
        await page.click(open);
        await page.waitForSelector(panel + '.active', { timeout: 5000 });
        await page.waitForTimeout(150);
        placed.push(await page.evaluate((panel) => {
            const host = document.querySelector(panel + ' .ad-slot.filled');
            if (!host) return { panel, filled: false };
            const b = host.getBoundingClientRect();
            // The nearest visible control, above or below the unit.
            let gap = Infinity;
            for (const c of document.querySelectorAll(panel + ' button, ' + panel + ' a[href]')) {
                const r = c.getBoundingClientRect();
                if (!r.width || !r.height) continue;
                gap = Math.min(gap, r.top >= b.bottom ? r.top - b.bottom : b.top >= r.bottom ? b.top - r.bottom : -1);
            }
            return {
                panel, filled: true,
                label: host.dataset.adLabel || '',
                drawn: getComputedStyle(host, '::before').content,
                before: host.previousElementSibling && host.previousElementSibling.tagName,
                after: host.nextElementSibling ? host.nextElementSibling.className : '',
                gap: Math.round(gap)
            };
        }, panel));
        await page.click(close);
        await page.waitForSelector('#main-menu.active', { timeout: 5000 });
    }
    for (const p of placed) {
        if (p.panel === '#shop-panel') {
            if (p.filled) throw new Error('the shop carries an ad unit — a wall of buy buttons may not');
            continue;
        }
        if (!p.filled) throw new Error(`${p.panel} opened and its unit was not filled`);
        if (!p.label) throw new Error(`${p.panel}: the unit carries no ad label`);
        if (p.drawn !== JSON.stringify(p.label)) throw new Error(`${p.panel}: the label is not drawn (::before is ${p.drawn})`);
        if (p.before !== 'H2') throw new Error(`${p.panel}: the unit follows a ${p.before}, not the panel title`);
        if (!/\brules-content\b/.test(p.after)) throw new Error(`${p.panel}: the unit is followed by "${p.after}", not the content`);
        if (p.gap < 24) throw new Error(`${p.panel}: a control is ${p.gap}px from the unit`);
    }

    const seen = await page.evaluate(() => {
        const units = [...document.querySelectorAll('ins.adsbygoogle')];
        const home = (el) => {
            const screen = el.closest('.screen');
            if (screen) return screen.id;
            const rail = el.closest('.ad-rail');
            return rail ? 'RAIL:' + (el.closest('[data-ad-screen]') || {}).dataset?.adScreen : 'ORPHAN';
        };
        return {
            scripts: [...document.querySelectorAll('script[src*="googlesyndication"]')].map(s => s.src),
            units: units.map(el => ({
                where: home(el),
                client: el.getAttribute('data-ad-client'),
                slot: el.getAttribute('data-ad-slot'),
                format: el.getAttribute('data-ad-format'),
                fullWidth: el.getAttribute('data-full-width-responsive'),
                w: el.style.width, h: el.style.height, display: el.style.display
            })),
            // Every screen id in the markup, so the deny list can be checked
            // against what is actually on the page rather than against itself.
            // The first three joined in v3.24.1: navigation and action screens.
            denyOccupied: ['main-menu', 'shop-panel', 'account-panel',
                           'game-container', 'daily-panel', 'tutorial-screen', 'lobby-panel',
                           'waiting-room-panel', 'victory-screen', 'settings-panel',
                           'privacy-panel', 'confirm-modal', 'invite-modal']
                .filter(id => (document.getElementById(id) || { querySelectorAll: () => [] })
                    .querySelectorAll('ins.adsbygoogle').length > 0)
        };
    });

    if (seen.scripts.length !== 1) throw new Error(seen.scripts.length + ' ad script tags, want exactly 1');
    if (!/client=ca-pub-\d{10,}/.test(seen.scripts[0])) throw new Error('the tag carries no publisher id: ' + seen.scripts[0]);
    if (!seen.units.length) throw new Error('ads are configured and not one unit was created');
    if (seen.denyOccupied.length) throw new Error('an ad unit sits on ' + seen.denyOccupied.join(', '));

    const badClient = seen.units.filter(u => !/^ca-pub-\d{10,}$/.test(u.client || ''));
    if (badClient.length) throw new Error(badClient.length + ' unit(s) with no publisher id');
    const badSlot = seen.units.filter(u => !/^\d{8,12}$/.test(u.slot || ''));
    if (badSlot.length) throw new Error(badSlot.length + ' unit(s) with no slot id');

    // NO lobby ad since v3.24.1: the lobby is a navigation screen. Neither the
    // in-column banner nor the two rails — the rails were its desktop ad.
    const inLobby = seen.units.filter(u => u.where === 'main-menu');
    if (inLobby.length) throw new Error(inLobby.length + ' unit(s) in the lobby, want 0 (a navigation screen)');
    const rails = seen.units.filter(u => String(u.where).startsWith('RAIL:'));
    if (rails.length) throw new Error(rails.length + ' rail unit(s) created, want 0 (both switches are off)');
    for (const b of seen.units.filter(u => !String(u.where).startsWith('RAIL:'))) {
        if (b.format !== 'horizontal') throw new Error(`the banner on ${b.where} asked for ${b.format}`);
        if (b.fullWidth !== 'false') throw new Error(`the banner on ${b.where} can escape its padded column`);
        if (b.w || b.h) throw new Error(`the banner on ${b.where} was given a fixed size`);
    }
    if (!adRequests.length) throw new Error('ads are on and nothing was ever requested');
    const gaps = placed.filter(p => p.filled).map(p => `${p.panel.slice(1, -6)} ${p.gap}px`).join(', ');
    console.log(`         ${seen.units.length} units, 1 script, 0 on a measured or navigation screen; labelled; nearest control: ${gaps}`);
});

await step('no panel puts a control outside its own box', async () => {
    // v3.14.4, found on the LIVE site at 1536px with the Slap IQ panel open:
    //
    //     #slapiq-panel        600 wide
    //     .slapiq-actions      558 wide, display:flex, direction ROW
    //       button reset       190
    //       .ad-slot           558   <- width:100% of the row, flex-shrink:0
    //       button back        111 , at x = 1252 — 294px OUTSIDE the panel
    //
    // The ad box had been wedged BETWEEN the two buttons since v3.0.0. In a row
    // its `width: 100%` is a WIDTH, so the row always wanted 859px of the 558 it
    // had; nothing showed because the box could still shrink. v3.14.3 set
    // `flex: 0 0 auto` — right for the column it was written for, fatal here —
    // and the Back button left the panel.
    //
    // The assertion is deliberately not about ads. A panel is a box; nothing
    // inside it may stick out of it. That catches this and every other break of
    // the same shape, including in panels that have no ad at all.
    const seen = await page.evaluate(() => {
        const ids = ['shop-panel', 'rules-panel', 'slapiq-panel', 'leaderboard-panel',
                     'about-panel', 'account-panel', 'settings-panel', 'privacy-panel'];
        const active = [...document.querySelectorAll('.screen.active')].map(s => s.id);
        const report = [];
        for (const id of ids) {
            const p = document.getElementById(id);
            if (!p) continue;
            document.querySelectorAll('.screen.active').forEach(s => s.classList.remove('active'));
            p.classList.add('active');
            void p.offsetHeight;
            const pb = p.getBoundingClientRect();
            let worst = null;
            for (const el of p.querySelectorAll('*')) {
                let b = el.getBoundingClientRect();
                if (b.width === 0 && b.height === 0) continue;
                // What the player can SEE, not what the box model says. A
                // decorative sheen deliberately wider than the tile it sweeps
                // is not a defect: the tile's `overflow: hidden` already cuts
                // it. So intersect with every clipping ancestor first — the
                // shop's .card-skin-shimmer is exactly this case, and without
                // this the step reports 68px of overflow that nobody can see.
                let clipped = false;
                // Up to but NOT including the panel: the panel's own clipping
                // is what this step is measuring against, so letting it into
                // the intersection would make the assertion unfailable.
                for (let a = el.parentElement; a && a !== p; a = a.parentElement) {
                    if (getComputedStyle(a).overflow === 'visible') continue;
                    const ab = a.getBoundingClientRect();
                    const left = Math.max(b.left, ab.left), right = Math.min(b.right, ab.right);
                    const top = Math.max(b.top, ab.top), bottom = Math.min(b.bottom, ab.bottom);
                    if (right <= left || bottom <= top) { clipped = true; break; }
                    b = { left, right, top, bottom, width: right - left, height: bottom - top };
                }
                if (clipped) continue;
                // Sideways only: a panel scrolls vertically on purpose.
                const over = Math.round(Math.max(b.right - pb.right, pb.left - b.left));
                if (over > 2 && (!worst || over > worst.over)) {
                    worst = { over, el: el.tagName.toLowerCase()
                        + (el.id ? '#' + el.id : '')
                        + (typeof el.className === 'string' && el.className
                            ? '.' + el.className.trim().split(/\s+/).join('.') : '') };
                }
            }
            const ad = p.querySelector('.ad-slot');
            const par = ad && ad.parentElement;
            const ps = par && getComputedStyle(par);
            report.push({ id, width: Math.round(pb.width), worst,
                adParentIsRow: !!(ps && ps.display.includes('flex') && !ps.flexDirection.startsWith('column')) });
        }
        document.querySelectorAll('.screen.active').forEach(s => s.classList.remove('active'));
        for (const id of active) { const el = document.getElementById(id); if (el) el.classList.add('active'); }
        return report;
    });

    const spilled = seen.filter(s => s.worst);
    if (spilled.length) {
        const w = spilled[0];
        throw new Error(`${w.id}: ${w.worst.el} hangs ${w.worst.over}px outside a ${w.width}px panel`);
    }
    // The cause, pinned apart from the symptom: a box whose width is 100% and
    // whose shrink factor is 0 cannot be a flex-ROW item.
    const inRow = seen.filter(s => s.adParentIsRow);
    if (inRow.length)
        throw new Error(`the ad box on ${inRow.map(s => s.id).join(', ')} is a flex-ROW item: `
            + 'its 100% width is a width there, and it will push its siblings out');
    console.log(`         ${seen.length} panels, nothing outside its box, no ad box in a row`);
});

await step('a phone: no ad in the lobby, and each panel banner fits the column, clear of the corner', async () => {
    // Until v3.24.1 the lobby had one ad at any width — rails on a desktop, an
    // in-column banner on a phone — and this step proved a phone got the
    // banner. The lobby is a navigation screen, so now it proves the opposite
    // at phone width too, and moves the "a banner fits a phone" half to the
    // first reading panel a player is likely to open.
    //
    // A FRESH page, not a resize of this one: a fill is decided once, when the
    // screen is first opened, because re-running fills to chase a resize is the
    // impression churn ads.js refuses to commit. A phone loads narrow.
    const phone = await ctx.newPage();
    const phoneAds = [];
    phone.on('request', r => { if (AD_HOST.test(r.url())) phoneAds.push(r.url()); });
    try {
        await phone.setViewportSize({ width: 390, height: 844 });
        await phone.goto(base + '/', { waitUntil: 'domcontentloaded' });
        await phone.waitForSelector('#main-menu.active', { timeout: 20000 });
        await phone.waitForTimeout(2500);

        const lobby = await phone.evaluate(() => {
            const on = el => el && el.getClientRects().length > 0;
            return {
                boxes: document.querySelectorAll('#main-menu .ad-slot').length,
                units: document.querySelectorAll('#main-menu ins.adsbygoogle, .ad-rail ins.adsbygoogle').length,
                railsVisible: [...document.querySelectorAll('.ad-rail')].filter(on).length,
                scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth
            };
        });
        if (lobby.boxes) throw new Error(lobby.boxes + ' ad box(es) in the phone lobby, want 0');
        if (lobby.units) throw new Error(lobby.units + ' ad unit(s) in the phone lobby, want 0');
        if (lobby.railsVisible) throw new Error(lobby.railsVisible + ' rail(s) visible on a 390px phone');
        if (lobby.scrollX > 0) throw new Error(lobby.scrollX + 'px of horizontal overflow in the phone lobby');
        if (phoneAds.some(u => /\/pagead\/ads/.test(u))) throw new Error('the phone lobby asked for an ad');

        // Every reading panel, measured open. On a phone each one is full width
        // and #top-left-corner (avatar, coins, spin) is fixed over its top, so
        // the corner is the nearest control a unit could crowd: before v3.24.1
        // moved the panels down, Slap IQ's unit began 36px under it.
        const gaps = [];
        for (const [open, panel, close] of [
            ['#btn-rules', '#rules-panel', '#btn-rules-back'],
            ['#btn-slapiq', '#slapiq-panel', '#btn-slapiq-back'],
            ['#btn-leaderboard', '#leaderboard-panel', '#btn-leaderboard-back'],
            ['#btn-about', '#about-panel', '#btn-about-back']
        ]) {
            await phone.click(open);
            await phone.waitForSelector(panel + '.active', { timeout: 5000 });
            await phone.waitForTimeout(300);
            const seen = await phone.evaluate((panel) => {
                const banner = document.querySelector(panel + ' .ad-slot');
                const b = banner ? banner.getBoundingClientRect() : null;
                const content = document.querySelector(panel + ' .rules-content').getBoundingClientRect();
                const title = document.querySelector(panel + ' h2').getBoundingClientRect();
                const corner = [...document.querySelectorAll('#top-left-corner > *')]
                    .map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
                const hits = (r) => corner.some(c => c.left < r.right && c.right > r.left && c.top < r.bottom && c.bottom > r.top);
                const cornerBottom = Math.max(0, ...corner.map(c => c.bottom));
                return {
                    filled: !!(banner && banner.classList.contains('filled')),
                    visible: !!(banner && banner.getClientRects().length > 0),
                    units: document.querySelectorAll(panel + ' ins.adsbygoogle').length,
                    width: b ? Math.round(b.width) : 0,
                    aboveContent: !!(b && b.bottom <= content.top + 1),
                    corners: corner.length,
                    titleCovered: hits(title),
                    gap: b ? Math.round(b.top - cornerBottom) : -1,
                    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    inTable: document.querySelectorAll('#game-container ins.adsbygoogle').length
                };
            }, panel);
            await phone.click(close);
            await phone.waitForSelector('#main-menu.active', { timeout: 5000 });
            if (!seen.filled) throw new Error(`${panel} got no banner on a phone`);
            if (!seen.visible) throw new Error(`${panel}: the phone banner was filled but is not on screen`);
            if (seen.units !== 1) throw new Error(`${seen.units} units on ${panel} on a phone, want exactly 1`);
            if (seen.width > 390) throw new Error(`${panel}: the banner is ${seen.width}px wide in a 390px window`);
            if (!seen.aboveContent) throw new Error(`${panel}: the banner does not sit above the text`);
            if (!seen.corners) throw new Error('the fixed corner was not found, so the gap below proves nothing');
            if (seen.titleCovered) throw new Error(`${panel}: the title is drawn under the fixed corner`);
            if (seen.gap < 40) throw new Error(`${panel}: the unit starts ${seen.gap}px under the corner's controls`);
            if (seen.scrollX > 0) throw new Error(`${panel}: ${seen.scrollX}px of horizontal overflow on a phone`);
            if (seen.inTable) throw new Error('an ad unit is inside #game-container');
            gaps.push(`${panel.slice(1, -6)} ${seen.gap}px`);
        }
        if (!phoneAds.length) throw new Error('a phone made no ad request at all');
        console.log(`         390x844: 0 units in the lobby; each panel's banner above its text, titles clear of the corner, corner gap: ${gaps.join(', ')}`);
    } finally {
        await phone.close();
    }
});

await step('a mobile creative keeps its full height after AdSense rewrites the host', async () => {
    const mobile = await ctx.newPage();
    try {
        await mobile.setViewportSize({ width: 375, height: 812 });
        await mobile.goto(base + '/', { waitUntil: 'domcontentloaded' });
        await mobile.waitForSelector('#main-menu.active', { timeout: 20000 });
        // v3.24.1: the lobby has no unit, so the About panel stands in — its
        // unit sits above its text, which is what "below" now measures.
        await mobile.click('#btn-about');
        await mobile.waitForSelector('#about-panel ins.adsbygoogle', { state: 'attached' });
        // The ad network is stubbed. Reproduce its observed DOM writes without
        // requesting real impressions, and exercise both banner and square fill.
        for (const height of [100, 375]) {
            const box = await mobile.evaluate((height) => {
                const host = document.querySelector('#about-panel .ad-slot');
                const ins = host.querySelector('ins');
                host.style.setProperty('height', 'auto', 'important');
                host.style.setProperty('min-height', '0', 'important');
                ins.style.height = height + 'px';
                ins.style.width = '100%';
                ins.setAttribute('data-ad-status', 'filled');
                const h = host.getBoundingClientRect();
                const i = ins.getBoundingClientRect();
                const text = document.querySelector('#about-panel .rules-content').getBoundingClientRect();
                return { hostHeight: h.height, adHeight: i.height,
                    inside: i.left >= h.left - 1 && i.right <= h.right + 1,
                    below: text.top >= i.bottom - 1,
                    overflow: document.documentElement.scrollWidth - innerWidth };
            }, height);
            if (box.hostHeight < height - 1 || box.adHeight < height - 1 || !box.inside || !box.below || box.overflow > 1)
                throw new Error('creative clipped or overlapped: ' + JSON.stringify(box));
        }
        // And the other answer AdSense can give: nothing. The host goes, label
        // and reserved height with it, so no labelled blank box is left behind.
        const unfilled = await mobile.evaluate(() => {
            const host = document.querySelector('#about-panel .ad-slot');
            host.querySelector('ins').setAttribute('data-ad-status', 'unfilled');
            return { display: getComputedStyle(host).display, height: host.getBoundingClientRect().height };
        });
        if (unfilled.display !== 'none' || unfilled.height !== 0)
            throw new Error('an unfilled unit left its box behind: ' + JSON.stringify(unfilled));
    } finally { await mobile.close(); }
});

await step('a zero-width panel does not burn its one fill', async () => {
    // Found on the live site, not here: a browser pane with no width laid the
    // lobby banner out at 0 x 60 — one client rect, because min-height gives it
    // height — and AdSense answered "No slot size for availableWidth=0". The
    // screen was already marked filled by then, so the fill was gone for good.
    // v3.24.1: the lobby carries no unit, so the Rules panel stands in; the
    // path is the same one — refused, remembered, filled once the box is real.
    //
    // Reproduced by squeezing the container rather than the window, because it
    // is the BOX's width that decides, and that is what the fix measures.
    const narrow = await ctx.newPage();
    const narrowAds = [];
    narrow.on('request', r => { if (AD_HOST.test(r.url())) narrowAds.push(r.url()); });
    try {
        await narrow.setViewportSize({ width: 390, height: 844 });
        // Collapse the box in the STYLESHEET rather than from a script, so the
        // rule is in force at the very first layout — the moment that matters,
        // and the one a script injected afterwards would already have missed.
        await narrow.route('**/style.css*', async (route) => {
            const res = await route.fetch();
            const body = await res.text();
            await route.fulfill({ response: res, body: body +
                '\n#rules-panel .ad-slot { width: 0 !important; max-width: 0 !important; min-height: 60px !important; }' });
        });
        await narrow.goto(base + '/', { waitUntil: 'domcontentloaded' });
        await narrow.waitForSelector('#main-menu.active', { timeout: 20000 });
        await narrow.click('#btn-rules');
        await narrow.waitForSelector('#rules-panel.active', { timeout: 5000 });
        await narrow.waitForTimeout(600);

        const collapsed = await narrow.evaluate(async () => {
            const { Ads } = await import('./js/ads.js');
            const slot = document.querySelector('#rules-panel .ad-slot');
            return {
                width: Math.round(slot.getBoundingClientRect().width),
                rects: slot.getClientRects().length,     // the old predicate's answer
                filled: slot.classList.contains('filled'),
                units: slot.querySelectorAll('ins.adsbygoogle').length,
                screenMarked: [...Ads._filled].includes('rules-panel'),
                waiting: Ads._pendingWidth.has('rules-panel')
            };
        });

        // The blindness proof: the OLD predicate would have said yes here.
        if (collapsed.rects === 0)
            throw new Error('the box is display:none, so this proves nothing about width');
        if (collapsed.width !== 0) throw new Error('the box was not collapsed: ' + collapsed.width + 'px');
        if (collapsed.units) throw new Error('a unit was created in a zero-width box');
        if (collapsed.filled) throw new Error('a zero-width box was marked filled');
        if (collapsed.screenMarked) throw new Error('the screen spent its fill on a zero-width box');
        if (narrowAds.some(u => /\/pagead\/ads/.test(u)))
            throw new Error('an ad was requested for a zero-width box');
        if (!collapsed.waiting) throw new Error('nothing is waiting to complete the fill');

        // ...and the fill it was owed arrives when the box becomes real.
        // Give the box its width back with a later rule of equal specificity —
        // source order decides, and a runtime <style> comes after style.css.
        await narrow.evaluate(() => {
            const css = document.createElement('style');
            css.textContent = '#rules-panel .ad-slot { width: 100% !important; max-width: 728px !important; }';
            document.head.appendChild(css);
        });
        await narrow.waitForTimeout(1200);
        const after = await narrow.evaluate(async () => {
            const { Ads } = await import('./js/ads.js');
            const slot = document.querySelector('#rules-panel .ad-slot');
            return {
                width: Math.round(slot.getBoundingClientRect().width),
                filled: slot.classList.contains('filled'),
                units: slot.querySelectorAll('ins.adsbygoogle').length,
                stillWaiting: Ads._pendingWidth.has('rules-panel')
            };
        });
        if (!after.width) throw new Error('the box never got a width back');
        if (!after.filled || after.units !== 1)
            throw new Error(`the owed fill never arrived (filled=${after.filled}, units=${after.units})`);
        if (after.stillWaiting) throw new Error('the completer did not stand down after filling');
        console.log(`         0px: refused and remembered; ${after.width}px: filled once, observer released`);
    } finally {
        await narrow.close();
    }
});

await step('the generated rules and about pages carry one labelled unit; privacy none; a blocked tag leaves nothing', async () => {
    // v3.24.1 (council ERS-38). These pages run no app code: js/page-ads.js
    // shows a box only once Google's tag has loaded. So the three cases are
    // measured on the real files under the real headers: the tag loads, the
    // page is the privacy page, and an ad blocker refuses the tag.
    const p = await ctx.newPage();
    const wire = [];
    const thrown = [];
    const csp = [];
    p.on('request', r => { if (AD_HOST.test(r.url())) wire.push(r.url()); });
    p.on('pageerror', e => thrown.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && NEVER_IGNORABLE.test(m.text())) csp.push(m.text()); });
    const units = () => wire.filter(u => /\/pagead\/ads/.test(u)).length;
    try {
        await p.setViewportSize({ width: 390, height: 844 });
        const rows = [];
        for (const path of ['/en/rules.html', '/tr/about.html']) {
            const before = units();
            await p.goto(base + path, { waitUntil: 'load' });
            await p.waitForSelector('.ad-box.on', { timeout: 5000 });
            await p.waitForTimeout(200);
            const seen = await p.evaluate(() => {
                const box = document.querySelector('.ad-box');
                const b = box.getBoundingClientRect();
                const h1 = document.querySelector('h1').getBoundingClientRect();
                const first = document.querySelector('.rules-section').getBoundingClientRect();
                const out = {
                    boxes: document.querySelectorAll('.ad-box').length,
                    label: box.querySelector('.ad-label').textContent,
                    between: b.top >= h1.bottom - 1 && b.bottom <= first.top + 1,
                    width: Math.round(b.width),
                    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth
                };
                // Google answers with nothing: the box goes, label and all.
                box.querySelector('ins').setAttribute('data-ad-status', 'unfilled');
                out.unfilledShown = box.getClientRects().length > 0;
                return out;
            });
            seen.requested = units() - before;
            rows.push(`${path} ${seen.label} ${seen.width}px`);
            if (seen.boxes !== 1) throw new Error(`${path}: ${seen.boxes} ad boxes, want 1`);
            if (seen.requested !== 1) throw new Error(`${path}: ${seen.requested} unit requests, want 1`);
            if (!seen.label.trim()) throw new Error(`${path}: the unit carries no label`);
            if (!seen.between) throw new Error(`${path}: the unit does not sit between the title and the text`);
            if (seen.width > 390) throw new Error(`${path}: the unit is ${seen.width}px wide in a 390px window`);
            if (seen.scrollX > 0) throw new Error(`${path}: ${seen.scrollX}px of horizontal overflow`);
            if (seen.unfilledShown) throw new Error(`${path}: an unfilled unit left its box on the page`);
        }

        const beforePrivacy = wire.length;
        await p.goto(base + '/en/privacy.html', { waitUntil: 'load' });
        await p.waitForTimeout(400);
        const privacy = await p.evaluate(() => document.querySelectorAll('.ad-box, ins.adsbygoogle').length);
        if (privacy) throw new Error('the privacy page carries an ad unit');
        if (wire.length !== beforePrivacy) throw new Error('the privacy page asked Google for something');

        await p.route('**://pagead2.googlesyndication.com/**', r => r.abort());
        const beforeBlocked = units();
        await p.goto(base + '/de/rules.html', { waitUntil: 'load' });
        await p.waitForTimeout(800);
        const blocked = await p.evaluate(() => {
            const box = document.querySelector('.ad-box');
            return { on: box.classList.contains('on'), shown: box.getClientRects().length > 0 };
        });
        if (blocked.on || blocked.shown) throw new Error('a blocked tag left a labelled box on the page: ' + JSON.stringify(blocked));
        if (units() !== beforeBlocked) throw new Error('a unit was requested with the tag blocked');
        if (thrown.length) throw new Error('a page threw: ' + thrown[0]);
        if (csp.length) throw new Error('a CSP violation on a content page: ' + csp[0]);
        console.log(`         ${rows.join('; ')}; privacy: none; blocked tag: no box`);
    } finally {
        await p.close();
    }
});

await step('in the app, a blocked ad tag leaves no labelled empty box', async () => {
    // Since v3.24.1 a filled box has a label and a surface. An ad blocker used
    // to leave a bare 100px gap; now it would leave a labelled empty frame on
    // every reading panel, unless the failure is noticed. It is.
    const q = await ctx.newPage();
    try {
        await q.route('**://pagead2.googlesyndication.com/**', r => r.abort());
        await q.setViewportSize({ width: 1280, height: 860 });
        await q.goto(base + '/', { waitUntil: 'domcontentloaded' });
        await q.waitForSelector('#main-menu.active', { timeout: 20000 });
        await q.waitForFunction(() => document.documentElement.classList.contains('ads-blocked'), null, { timeout: 5000 });
        await q.click('#btn-rules');
        await q.waitForSelector('#rules-panel.active', { timeout: 5000 });
        await q.waitForTimeout(300);
        const r = await q.evaluate(() => ({
            units: document.querySelectorAll('ins.adsbygoogle').length,
            shown: [...document.querySelectorAll('.ad-slot')].filter(el => el.getClientRects().length > 0).length
        }));
        if (r.units) throw new Error(r.units + ' unit(s) created after the tag failed');
        if (r.shown) throw new Error(r.shown + ' ad box(es) still on screen after the tag failed');
        console.log('         tag refused -> document marked, no unit created, no box on screen');
    } finally {
        await q.close();
    }
});

await step('a live match asks for nothing', async () => {
    // The whole reason adsConfig.js exists. Measured on the real scoring
    // function, 50ms of jank during a slap is worth 72 points, and in
    // multiplayer fairSlap.js gives the pile to whoever was not janked. So the
    // claim is not "ads are tasteful during a match" — it is that the wire is
    // silent. This counts requests across the match rather than reading the
    // guard in ads.js, because the guard is what is being tested.
    const before = adRequests.length;
    const unitsBefore = await page.evaluate(async () => {
        const { Ads } = await import('./js/ads.js');
        window.__filledBefore = [...Ads._filled];
        return document.querySelectorAll('ins.adsbygoogle').length;
    });

    await page.fill('#input-username', 'SmokeAds').catch(() => {});
    await page.click('#btn-play-bots');
    await page.waitForSelector('#game-container.active', { timeout: 15000 });
    await page.waitForTimeout(2500);

    const during = await page.evaluate(() => ({
        units: document.querySelectorAll('ins.adsbygoogle').length,
        inTable: document.querySelectorAll('#game-container ins.adsbygoogle').length,
        railsVisible: [...document.querySelectorAll('.ad-rail')].filter(r => r.getClientRects().length > 0).length
    }));
    const added = adRequests.length - before;
    if (added) {
        const who = await page.evaluate(async () => {
            const { Ads } = await import('./js/ads.js');
            return [...Ads._filled].filter(s => !window.__filledBefore.includes(s));
        });
        // Naming WHICH screen filled turns "something asked for an ad" into a
        // one-line diagnosis. "(none)" means the push came from outside
        // _maybeFill's own bookkeeping, which is how a stray edit in the
        // gameStateChanged handler showed itself.
        throw new Error(added + ' ad request(s) during a live match; newly filled: ' +
            (who.length ? who.join(', ') : '(none — pushed without claiming a screen)'));
    }
    if (during.units !== unitsBefore) throw new Error('a unit was created during a live match');
    if (during.inTable) throw new Error('an ad unit is inside #game-container');
    if (during.railsVisible) throw new Error(during.railsVisible + ' rail(s) still on screen over the table');

    // Back to the menu the way every other step in this file does it, so the
    // rest of the run starts clean. Not `.catch(() => {})`: a step that leaves
    // the app on the table makes every later step fail for the wrong reason.
    await page.evaluate(() => window.GameState.quitGame());
    await page.click('#btn-quit');
    await page.waitForTimeout(300);
    await page.click('#btn-confirm-leave').catch(() => {});
    await page.waitForSelector('#main-menu.active', { timeout: 10000 });
    console.log(`         0 requests, 0 new units, 0 rails visible over the table`);
});

await step('the wheel pays the prize it stops on', async () => {
    // A player found this, not a gate: the wheel stopped on one prize and paid
    // another, every spin, six segments apart. What makes it gate-able is
    // asking the BROWSER which segment is under the pointer — invert the
    // canvas's live transform matrix and read the polar angle in drawWheel's
    // own convention — instead of re-running spin()'s arithmetic and agreeing
    // with it.
    const results = await page.evaluate(async () => {
        const { DailySpin } = await import('./js/dailySpin.js');
        // v3.22.0: the day's spin is the server wallet's. Each spin here gets a
        // fresh in-memory wallet — the same plans the Firestore ledger commits.
        const { CardSkins } = await import('./js/cardSkins.js');
        const { createMemoryLedger } = await import('./js/walletRules.js');
        const canvas = document.getElementById('daily-spin-canvas');
        const pointer = document.querySelector('.wheel-pointer');
        if (!canvas || !pointer) throw new Error('the wheel is not in the markup');
        const sleep = ms => new Promise(r => setTimeout(r, ms));

        function indexUnderPointer(n) {
            const cr = canvas.getBoundingClientRect();
            const pr = pointer.getBoundingClientRect();
            const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
            const inv = new DOMMatrix(getComputedStyle(canvas).transform).inverse();
            const p = inv.transformPoint(new DOMPoint((pr.left + pr.right) / 2 - cx, cr.top + 26 - cy));
            let th = Math.atan2(p.y, p.x);
            if (th < 0) th += 2 * Math.PI;
            return Math.floor(th / ((2 * Math.PI) / n));
        }

        const out = [];
        // Three indices, not all eight: enough to catch a constant offset,
        // and each spin costs the animation's full length (SPIN_MS).
        for (const want of [0, 3, 6]) {
            createMemoryLedger(CardSkins, { coins: 0 });
            localStorage.removeItem('ers_spin_tier');
            DailySpin.isSpinning = false;
            DailySpin.open();
            const segs = DailySpin.segments;
            const real = Math.random;
            Math.random = () => (want + 0.5) / segs.length;
            // v3.17.0: spin() resolves when the wheel has STOPPED. This used to
            // be `await sleep(4400)` — a second copy of the animation's length,
            // which went stale the moment the spin got heavier. Waiting on the
            // spin itself cannot go stale.
            const turning = DailySpin.spin();
            Math.random = real;
            await turning;
            out.push({ want, saw: indexUnderPointer(segs.length),
                       prize: `${segs[want].coins} ${segs[want].type}` });
            DailySpin.close();
        }
        CardSkins.detachLedger();
        localStorage.removeItem('ers_spin_tier');
        return out;
    });
    const wrong = results.filter(r => r.saw !== r.want);
    if (wrong.length) {
        throw new Error(wrong.map(r =>
            `paid segment ${r.want} (${r.prize}) but stopped on ${r.saw}`).join('; '));
    }
    console.log(`         3 spins, the pointer stopped on the segment that paid, every time`);
});

await step('coins are the server\'s: a guest is asked to sign in, and nothing on this device can mint them', async () => {
    const r = await page.evaluate(async () => {
        const { CardSkins } = await import('./js/cardSkins.js');
        const { createMemoryLedger } = await import('./js/walletRules.js');
        const { ShopUI } = await import('./js/shopUI.js');
        const { DailySpin } = await import('./js/dailySpin.js');
        const { Settings } = await import('./js/settings.js');
        const out = {};
        const savedSkin = Settings.config.equippedCardSkin;
        try {
            // The old console line, as a player would type it.
            localStorage.setItem('ers_coins', '999999');
            localStorage.setItem('ers_owned_skins', JSON.stringify(['classic', 'gods', 'pharaoh']));
            CardSkins.detachLedger();
            out.guestCoins = CardSkins.getCoins();
            out.guestOwnsGods = CardSkins.isOwned('gods');
            Settings.config.equippedCardSkin = 'gods';
            out.guestDrawn = CardSkins.effectiveSkin(Settings.config.equippedCardSkin);

            ShopUI.open();
            const box = document.getElementById('shop-signin');
            out.guestPrompt = !!box && !box.hidden && getComputedStyle(box).display !== 'none';
            out.guestSignInBtn = getComputedStyle(document.getElementById('btn-shop-signin')).display !== 'none';
            out.guestBalance = document.getElementById('shop-coin-balance').textContent;
            const locked = document.querySelector('#shop-grid .shop-item[data-skin="golden"] .shop-item-btn');
            out.guestLockedLabel = locked && locked.textContent;
            ShopUI.close();

            DailySpin.open();
            out.guestSpinState = DailySpin.actionState;
            await DailySpin.spin();
            out.guestSpinPaid = CardSkins.getCoins();
            DailySpin.close();

            // Signed in: the prompt goes, and the balance is the wallet's — not the device's.
            createMemoryLedger(CardSkins, { coins: 150 });
            ShopUI.open();
            out.readyPrompt = getComputedStyle(document.getElementById('shop-signin')).display;
            out.readyBalance = document.getElementById('shop-coin-balance').textContent;
            document.querySelector('#shop-grid .shop-item[data-skin="golden"] .shop-item-btn').click();
            await new Promise(res => setTimeout(res, 50));
            out.bought = [CardSkins.isOwned('golden'), CardSkins.getCoins(), Settings.config.equippedCardSkin];
            ShopUI.close();
        } finally {
            CardSkins.detachLedger();
            Settings.config.equippedCardSkin = savedSkin;
            localStorage.removeItem('ers_coins');
            localStorage.removeItem('ers_owned_skins');
        }
        return out;
    });
    const want = {
        guestCoins: 0, guestOwnsGods: false, guestDrawn: 'classic', guestPrompt: true, guestSignInBtn: true,
        guestBalance: '🪙 0', guestSpinState: 'claimed', guestSpinPaid: 0,
        readyPrompt: 'none', readyBalance: '🪙 150', bought: [true, 0, 'golden']
    };
    const bad = Object.keys(want).filter(k => JSON.stringify(r[k]) !== JSON.stringify(want[k]));
    if (bad.length) throw new Error(bad.map(k => `${k}: got ${JSON.stringify(r[k])}, want ${JSON.stringify(want[k])}`).join('; '));
    if (!/🔒/.test(r.guestLockedLabel || '')) throw new Error('a guest\'s skin button does not read as locked: ' + r.guestLockedLabel);
    console.log('         a forged 999999 local balance reads as 0; guest shop and wheel ask for sign-in; a wallet buys');
});

await step('the lobby rails are geometry, not decoration', async () => {
    // Everything above counts `.ad-slot`, which is the in-column banner. The
    // rails are a different element with a different failure mode: they are
    // `position: fixed` and live OUTSIDE the 600px column, so the two ways they
    // go wrong are (a) covering the menu and (b) bringing back the horizontal
    // scrollbar v3.10.0 spent a release removing. Both are geometry, and
    // geometry can only be measured in a browser — no source scan sees either.
    const before = { w: page.viewportSize().width, h: page.viewportSize().height };
    const rows = [];
    for (const [w, h] of [[1535, 900], [1366, 768], [1200, 800], [1199, 800], [768, 900], [360, 740]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(120);
        rows.push(await page.evaluate((width) => {
            const rails = [...document.querySelectorAll('.ad-rail')];
            const shown = rails.filter(r => r.getClientRects().length > 0);
            const menu = document.getElementById('main-menu').getBoundingClientRect();
            const boxes = shown.map(r => r.getBoundingClientRect());
            return {
                width,
                rails: rails.length,
                shown: shown.length,
                // A rail may never reach past the column's edge, nor past the
                // window's. 484 = 300 (half column) + 24 (gap) + 160 (rail).
                overlapsColumn: boxes.some(b => b.right > menu.left + 0.5 && b.left < menu.right - 0.5),
                offscreen: boxes.some(b => b.left < 0 || b.right > width),
                // Height of the rails that are actually on screen. A hidden
                // rail measures 0 whether or not it holds a unit, so this is
                // "what the viewer's layout gives the ad", not "what exists".
                reserved: Math.max(0, ...boxes.map(b => b.height)),
                filled: shown.filter(r => r.querySelector('.ad-rail-slot.filled')).length,
                scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth
            };
        }, w));
    }
    for (const r of rows) {
        if (r.rails !== 2) throw new Error(`${r.width}px: expected 2 rails, found ${r.rails}`);
        const want = r.width >= 1200 ? 2 : 0;
        if (r.shown !== want) throw new Error(`${r.width}px: ${r.shown} rail(s) visible, want ${want}`);
        if (r.overlapsColumn) throw new Error(`${r.width}px: a rail overlaps the menu column`);
        if (r.offscreen) throw new Error(`${r.width}px: a rail hangs off the window`);
        // v3.24.1: the lobby is a navigation screen and carries no ad, so a
        // rail is shown (above the breakpoint) but never filled.
        if (r.filled) throw new Error(`${r.width}px: a rail was filled — the lobby carries no ad since v3.24.1`);
        // A rail is either absent (0px) or exactly the shape ads.js asked the
        // network for. 604 is the failure this caught once: an inline-block on
        // the text baseline, four pixels of descender under a 600px unit.
        const wantHeight = r.filled ? 600 : 0;
        if (Math.abs(r.reserved - wantHeight) > 1)
            throw new Error(`${r.width}px: a rail measures ${Math.round(r.reserved)}px, want ${wantHeight}px`);
        if (r.scrollX > 0) throw new Error(`${r.width}px: ${r.scrollX}px of horizontal overflow`);
    }

    // And the part no source scan can settle: leave the lobby, and the rails
    // must go with it. This is the v3.12.0 stranded-banner class, checked by
    // walking rather than by reading the rule that is supposed to prevent it.
    await page.setViewportSize({ width: 1535, height: 900 });
    await page.waitForTimeout(120);
    const strandedOn = [];
    for (const [open, panel, close] of [
        ['#btn-shop', '#shop-panel', '#btn-shop-back'],
        ['#btn-rules', '#rules-panel', '#btn-rules-back'],
        ['#btn-settings', '#settings-panel', '#btn-back'],
        ['#btn-privacy', '#privacy-panel', '#btn-privacy-back']
    ]) {
        if (!(await page.$(open))) continue;
        await page.click(open);
        await page.waitForSelector(panel + '.active', { timeout: 5000 });
        await page.waitForTimeout(120);
        const still = await page.evaluate(() =>
            [...document.querySelectorAll('.ad-rail')].filter(r => r.getClientRects().length > 0).length);
        if (still) strandedOn.push(`${panel} (${still})`);
        await page.click(close);
        await page.waitForSelector('#main-menu.active', { timeout: 5000 });
    }
    if (strandedOn.length) throw new Error('a rail stayed on screen over ' + strandedOn.join(', '));

    // The blindness probe: if the predicate above cannot see a rail that IS
    // shown, every assertion in this step passed for the wrong reason.
    const proof = await page.evaluate(() => {
        const el = document.querySelector('.ad-rail');
        const was = el.style.display;
        el.style.display = 'block';
        const seenWhenForced = el.getClientRects().length > 0;
        el.style.display = was;
        return { seenWhenForced, hiddenAgain: el.getClientRects().length > 0 };
    });
    if (!proof.seenWhenForced) throw new Error('the visibility predicate is blind — it cannot see a shown rail');
    await page.setViewportSize({ width: before.w, height: before.h });
    await page.waitForTimeout(120);
    const tall = rows.filter(r => r.shown).map(r => `${r.width}:${Math.round(r.reserved)}px`).join(' ');
    console.log(`         6 widths, rails only >=1200px (${tall}), 0px overflow, none stranded`);
});

await step('the privacy panel opens, reads, and closes', async () => {
    await page.click('#btn-privacy');
    await page.waitForSelector('#privacy-panel.active', { timeout: 5000 });
    const p = await page.evaluate(() => {
        const el = document.getElementById('privacy-panel');
        const untranslated = [...el.querySelectorAll('[data-i18n]')]
            .filter(n => !n.textContent.trim()).map(n => n.getAttribute('data-i18n'));
        return {
            words: el.innerText.trim().split(/\s+/).length,
            untranslated,
            ads: el.querySelectorAll('.ad-slot').length,
            mentionsAdSense: /AdSense/.test(el.innerText),
            mentionsContact: /[^\s@]+@[^\s@]+\.[a-z]{2,}/.test(el.innerText)
        };
    });
    if (p.untranslated.length) throw new Error('empty strings: ' + p.untranslated.join(', '));
    if (p.ads) throw new Error('the page explaining the ads carries an ad');
    if (!p.mentionsAdSense) throw new Error('the policy does not name the ad network');
    if (!p.mentionsContact) throw new Error('the policy gives no contact address');
    if (p.words < 150) throw new Error('the policy is suspiciously short: ' + p.words + ' words');
    // No consent script runs in this test, so the consent button must be absent.
    const cookieShown = await page.evaluate(() =>
        document.getElementById('btn-cookie-settings').getClientRects().length > 0);
    if (cookieShown) throw new Error('the consent button is on screen with no consent API to say it applies');
    await page.click('#btn-privacy-back');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
    console.log(`         ${p.words} words, names AdSense, gives an address, carries no ad`);
});

await step('the consent button appears only where the consent API says GDPR applies, and reopens the choice', async () => {
    // v3.24.1. Google's consent script never runs here (the ad tag is stubbed),
    // so this plays its part through the documented API: run the callbacks
    // ads.js queued, answer them with a stand-in __tcfapi, and watch the real
    // button on the real panel. The click has to reach Google's function.
    const setup = await page.evaluate(() => {
        const queue = (window.googlefc && window.googlefc.callbackQueue) || [];
        const ready = queue.filter(q => q && typeof q.CONSENT_API_READY === 'function');
        window.__smokeTcf = null;
        window.__tcfapi = (cmd, ver, cb) => { if (cmd === 'addEventListener') window.__smokeTcf = cb; };
        window.__smokeReopened = 0;
        window.googlefc.showRevocationMessage = () => { window.__smokeReopened++; };
        for (const q of ready) q.CONSENT_API_READY();
        return { queued: ready.length, listening: typeof window.__smokeTcf === 'function' };
    });
    if (setup.queued !== 1) throw new Error(`${setup.queued} consent callbacks queued, want exactly 1`);
    if (!setup.listening) throw new Error('the queued callback never asked the TCF API for consent data');

    await page.click('#btn-privacy');
    await page.waitForSelector('#privacy-panel.active', { timeout: 5000 });
    const shown = (tcData, success) => page.evaluate(([d, s]) => {
        window.__smokeTcf(d, s);
        return document.getElementById('btn-cookie-settings').getClientRects().length > 0;
    }, [tcData, success]);
    const outside = await shown({ gdprApplies: false }, true);
    const failed = await shown({ gdprApplies: true }, false);
    const inside = await shown({ gdprApplies: true }, true);
    if (outside) throw new Error('the consent button shows where GDPR does not apply');
    if (failed) throw new Error('the consent button shows when the consent API call failed');
    if (!inside) throw new Error('the consent button stays hidden where GDPR applies');

    await page.click('#btn-cookie-settings');
    const reopened = await page.evaluate(() => window.__smokeReopened);
    if (reopened !== 1) throw new Error(`the click reached showRevocationMessage ${reopened} time(s), want 1`);

    // Leave the page as it was for the steps after this one.
    await shown({ gdprApplies: false }, true);
    await page.evaluate(() => { delete window.__tcfapi; delete window.__smokeTcf; delete window.__smokeReopened; });
    await page.click('#btn-privacy-back');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
    console.log('         hidden outside GDPR and on a failed call, shown where it applies; one click, one reopen');
});

// v3.18.0: the Table of the Gods, through its real hall button and the real
// slap path. A slap wounds the god (you in full, a priest by half), the god's
// own pile heals Bastet, the fall ends the match in your favour through the
// ONE gameOver event, and leaving hands back the seat, its name and the rules.
await step('the Pantheon: slaps wound the god, it heals, it falls, and everything is handed back', async () => {
    await page.click('#btn-legends');
    await page.waitForSelector('#legends-panel.active', { timeout: 5000 });
    await page.click('[data-god="bastet"]');
    await page.waitForSelector('#game-container.active', { timeout: 8000 });
    const r = await page.evaluate(async () => {
        const { PantheonMode, DAMAGE, ALLY_SHARE } = await import('./js/pantheon.js');
        const { HouseRules } = await import('./js/houseRules.js');
        const { AIController } = await import('./js/ai.js');
        const { default: EventBus } = await import('./js/eventbus.js');
        const sleep = (ms) => new Promise(res => setTimeout(res, ms));
        const GS = window.GameState;
        const out = {};
        let overs = [];
        const onOver = (w) => overs.push(w);
        EventBus.on('gameOver', onOver);
        await sleep(300);
        out.hudShown = !document.getElementById('boss-hud').hidden;
        out.seatName = document.getElementById('p2-name').textContent.trim();
        out.locked = HouseRules.lockedBy;
        out.godSeat = !!AIController.seatConfig[2];
        const dbl = () => [{ rank: 7, suit: 'clubs' }, { rank: 7, suit: 'hearts' }];
        const slapAs = async (seat) => { await sleep(650); GS.pile = dbl(); GS.burnPile = []; GS.slap(seat); };
        const hp0 = PantheonMode.hp;
        await slapAs(0); out.heroHit = hp0 - PantheonMode.hp;
        const hp1 = PantheonMode.hp;
        await slapAs(1); out.priestHit = hp1 - PantheonMode.hp;
        const hp2 = PantheonMode.hp;
        await slapAs(2); out.bastetHeal = PantheonMode.hp - hp2;
        out.expectHero = DAMAGE.doubles; out.expectPriest = Math.round(DAMAGE.doubles * ALLY_SHARE);
        PantheonMode.hp = 4;
        await slapAs(0);
        await sleep(100);
        out.overs = overs.slice();
        out.defeatedStored = !!PantheonMode.store.defeated.bastet;
        EventBus.off && EventBus.off('gameOver', onOver);
        return out;
    });
    // Leave through the victory screen's menu button, the ordinary way out.
    await page.waitForSelector('#victory-screen.active', { timeout: 8000 });
    await page.click('#btn-victory-menu');
    await page.waitForSelector('#main-menu.active', { timeout: 8000 });
    const after = await page.evaluate(async () => {
        await new Promise(res => setTimeout(res, 300));
        const { HouseRules } = await import('./js/houseRules.js');
        const { AIController } = await import('./js/ai.js');
        const { MatchContext } = await import('./js/matchContext.js');
        return { locked: HouseRules.lockedBy, godSeat: !!AIController.seatConfig[2], names: MatchContext.seatNames,
            hudHidden: document.getElementById('boss-hud').hidden };
    });
    if (!r.hudShown || r.seatName !== 'Bastet') throw new Error('the god did not take the seat: ' + JSON.stringify(r));
    if (r.locked !== 'pantheon' || !r.godSeat) throw new Error('the god\'s rules or speed were not in force: ' + JSON.stringify(r));
    if (r.heroHit !== r.expectHero) throw new Error(`your Double took ${r.heroHit}, want ${r.expectHero}`);
    if (r.priestHit !== r.expectPriest) throw new Error(`a priest's Double took ${r.priestHit}, want ${r.expectPriest}`);
    if (r.bastetHeal !== r.expectHero) throw new Error(`Bastet's pile healed ${r.bastetHeal}, want ${r.expectHero}`);
    if (r.overs.length !== 1 || r.overs[0] !== 0) throw new Error('the fall did not end the match once, in your favour: ' + JSON.stringify(r.overs));
    if (!r.defeatedStored) throw new Error('the amulet was not recorded');
    if (after.locked !== null || after.godSeat || after.names !== null || !after.hudHidden) throw new Error('leaving did not hand everything back: ' + JSON.stringify(after));
    console.log(`         hero -${r.heroHit}, priest -${r.priestHit}, Bastet +${r.bastetHeal}, fell -> gameOver(0) once, amulet kept, all handed back`);
});

// v3.19.0: ghost cards (council ERS-20), through the real hall button, the
// real slap path and the real play path. Your wounding slap lays clones on
// TOP of the god's hand; its seat counts real cards and shows a ghost chip;
// a ghost the god plays is drawn as one; winning a pile with a ghost in it
// hands over only the real cards; then the god falls as before.
await step('ghost cards: clones on top of the god, drawn as ghosts, vanishing with the pile', async () => {
    await page.click('#btn-legends');
    await page.waitForSelector('#legends-panel.active', { timeout: 5000 });
    await page.click('[data-god="bastet"]');
    await page.waitForSelector('#game-container.active', { timeout: 8000 });
    const r = await page.evaluate(async () => {
        const { PantheonMode } = await import('./js/pantheon.js');
        const { default: EventBus } = await import('./js/eventbus.js');
        const sleep = (ms) => new Promise(res => setTimeout(res, ms));
        const GS = window.GameState;
        const out = {};
        await sleep(300);
        out.descShown = !!document.querySelector('[data-i18n="pantheonGhostDesc"]');
        await sleep(650);
        GS.pile = [{ rank: 7, suit: 'clubs' }, { rank: 7, suit: 'hearts' }]; GS.burnPile = [];
        GS.slap(0);
        const god = GS.players[2];
        out.top = god.slice(0, 2).map(c => !!c.ghost);
        await sleep(80);
        const chip = document.querySelector('#top-player .ghost-chip, .ghost-chip');
        out.chip = chip ? chip.textContent.trim() : null;
        out.countIsReal = Number(document.getElementById('p2-count')?.textContent ?? -1) === god.filter(c => !c.ghost).length;
        await sleep(650);
        GS.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
        GS.challengeResolverActive = false; GS.activePlayerId = 2; GS.lastPlayTime = 0;
        const topWasGhost = !!(GS.players[2][0] && GS.players[2][0].ghost);
        GS.playCard(2);
        await sleep(60);
        out.playedGhostDrawn = topWasGhost && !!document.querySelector('#pile-cards .card.ghost');
        let seen = null;
        const onWon = (e) => { seen = e; };
        EventBus.on('pileWon', onWon);
        await sleep(650);
        GS.pile = [{ rank: 9, suit: 'clubs', ghost: true }, { rank: 9, suit: 'hearts' }]; GS.burnPile = [];
        const heroBefore = GS.players[0].length;
        GS.slap(0);
        await sleep(40);
        // The won pile animates after the highlight (600 ms; 300 with fast animations).
        const ghostEl = document.querySelector('#pile-cards .card.ghost');
        await sleep(700);
        out.vaporizing = !out.playedGhostDrawn || !!(ghostEl && ghostEl.classList.contains('ghost-vaporize'));
        out.vanished = seen ? seen.vanished : null;
        out.heroGained = GS.players[0].length - heroBefore;
        out.heroHoldsGhost = GS.players[0].some(c => c.ghost);
        EventBus.off && EventBus.off('pileWon', onWon);
        PantheonMode.hp = 4;
        await sleep(650);
        GS.pile = [{ rank: 5, suit: 'clubs' }, { rank: 5, suit: 'hearts' }]; GS.burnPile = [];
        GS.slap(0);
        return out;
    });
    await page.waitForSelector('#victory-screen.active', { timeout: 8000 });
    await page.click('#btn-victory-menu');
    await page.waitForSelector('#main-menu.active', { timeout: 8000 });
    if (!r.descShown) throw new Error('the Legends panel does not explain ghost cards');
    if (r.top.join() !== 'true,true') throw new Error('the clones are not on top of the god\'s hand: ' + JSON.stringify(r));
    if (!r.chip || !/👻\s*\d+/.test(r.chip) || !r.countIsReal) throw new Error('the god\'s seat does not show its ghosts apart from its real cards: ' + JSON.stringify(r));
    if (!r.playedGhostDrawn) throw new Error('a ghost the god played was not drawn as a ghost: ' + JSON.stringify(r));
    if (r.vanished !== 1 || r.heroGained !== 1 || r.heroHoldsGhost) throw new Error('winning a pile with a ghost did not hand over only the real card: ' + JSON.stringify(r));
    if (!r.vaporizing) throw new Error('the ghost on the table did not vaporize: ' + JSON.stringify(r));
    console.log(`         clones on top, chip "${r.chip}", ghost drawn on the pile, 1 vanished, hero +${r.heroGained} real, vaporized`);
});

// v3.18.0: the Duat Journey, through its real button and the real slap path.
// You start with no cards and the eliminated screen must NOT cover the table;
// a wrong slap from the Duat costs an ankh (Ammit, v3.19.3); a good slap resurrects
// you through the engine's own path and passes the first gate; the twelfth
// gate ends the match in your favour; leaving hands everything back.
await step('the Duat: start dead, Ammit takes an ankh, slap back to life, reach dawn, hand back', async () => {
    await page.click('#btn-legends');
    await page.waitForSelector('#legends-panel.active', { timeout: 5000 });
    await page.click('#btn-duat-start');
    await page.waitForSelector('#game-container.active', { timeout: 8000 });
    const r = await page.evaluate(async () => {
        const { DuatMode } = await import('./js/duat.js');
        const sleep = (ms) => new Promise(res => setTimeout(res, ms));
        const GS = window.GameState;
        const out = {};
        await sleep(300);
        out.startCards = GS.players[0].length;
        out.eliminatedFlag = GS.humanEliminated;
        out.victoryUp = document.getElementById('victory-screen').classList.contains('active');
        out.hudDead = document.getElementById('duat-hud').classList.contains('dead') && !document.getElementById('duat-hud').hidden;
        out.names = [1, 2, 3].map(i => document.getElementById(`p${i}-name`).textContent.trim());
        const ankhs = () => [...document.querySelectorAll('#duat-tries .duat-ankh')].map(a => a.classList.contains('spent') ? 0 : 1).join('');
        out.ankhsBefore = ankhs();
        out.triesShown = !document.getElementById('duat-tries').hidden;
        const t0 = DuatMode.tries;
        GS.pile = [{ rank: 3, suit: 'clubs' }, { rank: 9, suit: 'hearts' }]; GS.slap(0);
        out.ammit = t0 - DuatMode.tries;
        out.ankhsAfter = ankhs();
        await sleep(650);
        GS.pile = [{ rank: 7, suit: 'clubs' }, { rank: 7, suit: 'hearts' }]; GS.burnPile = []; GS.slap(0);
        await sleep(50);
        out.risenCards = GS.players[0].length;
        out.dead = DuatMode.dead;
        out.hour = DuatMode.hour;
        out.resurrections = GS.stats.resurrections;
        DuatMode.hour = 11;
        await sleep(650);
        GS.pile = [{ rank: 5, suit: 'clubs' }, { rank: 5, suit: 'hearts' }]; GS.burnPile = []; GS.slap(0);
        await sleep(50);
        out.over = GS.gameOver;
        out.dawns = DuatMode.store.dawns;
        return out;
    });
    await page.waitForSelector('#victory-screen.active', { timeout: 8000 });
    await page.click('#btn-victory-menu');
    await page.waitForSelector('#main-menu.active', { timeout: 8000 });
    const after = await page.evaluate(async () => {
        await new Promise(res => setTimeout(res, 300));
        const { MatchContext } = await import('./js/matchContext.js');
        const { GameManager } = await import('./js/gameManager.js');
        return { owns: MatchContext.ownsElimination, names: MatchContext.seatNames, rematch: GameManager.rematchOptions,
            night: document.body.classList.contains('duat-journey'), hudHidden: document.getElementById('duat-hud').hidden };
    });
    if (r.startCards !== 0 || !r.eliminatedFlag) throw new Error('the journey did not start in the Duat: ' + JSON.stringify(r));
    if (r.victoryUp) throw new Error('the eliminated screen covered the table the player must slap into');
    if (!r.hudDead || r.names.join() !== 'Ba,Ka,Akh') throw new Error('the Duat is not shown: ' + JSON.stringify(r));
    if (r.ammit !== 1) throw new Error(`a wrong slap from the Duat cost ${r.ammit} ankhs, want 1`);
    if (!r.triesShown || r.ankhsBefore !== '111' || r.ankhsAfter !== '110') throw new Error('the three ankhs are not shown, or a spent one does not go dark: ' + JSON.stringify(r));
    if (r.risenCards < 2 || r.dead || r.hour !== 1 || r.resurrections !== 0) throw new Error('the slap did not resurrect through the engine (and the entry must not count as a comeback, ERS-18 fix 5): ' + JSON.stringify(r));
    if (!r.over || r.dawns < 1) throw new Error('the twelfth gate did not end the night: ' + JSON.stringify(r));
    if (after.owns || after.names !== null || after.rematch !== null || after.night || !after.hudHidden) throw new Error('leaving did not hand everything back: ' + JSON.stringify(after));
    console.log(`         0 cards and no eliminated screen, ankhs ${r.ankhsBefore} -> ${r.ankhsAfter}, risen with ${r.risenCards} cards (hour 1), dawn -> win, all handed back`);
});

// v3.19.3: three misses from the Duat and it keeps you — the table is stamped
// with the loss, the match ends for a shade, and the stamp steps aside for the
// end screen.
await step('the Duat: three wrong slaps lose the journey, stamped', async () => {
    await page.click('#btn-legends');
    await page.waitForSelector('#legends-panel.active', { timeout: 5000 });
    await page.click('#btn-duat-start');
    await page.waitForSelector('#game-container.active', { timeout: 8000 });
    const r = await page.evaluate(async () => {
        const { DuatMode } = await import('./js/duat.js');
        const sleep = (ms) => new Promise(res => setTimeout(res, ms));
        const GS = window.GameState;
        await sleep(300);
        const out = { start: DuatMode.tries };
        for (let i = 0; i < 3; i++) {
            GS.pile = [{ rank: 3, suit: 'clubs' }, { rank: 9, suit: 'hearts' }]; GS.slap(0);
            await sleep(200);
        }
        const v = document.getElementById('duat-verdict');
        out.tries = DuatMode.tries; out.lostBy = DuatMode.lostBy; out.over = GS.gameOver;
        out.stamp = v && !v.hidden ? v.textContent.trim() : null;
        out.spent = document.querySelectorAll('#duat-tries .duat-ankh.spent').length;
        return out;
    });
    await page.waitForSelector('#victory-screen.active', { timeout: 8000 });
    const stampGone = await page.evaluate(() => document.getElementById('duat-verdict').hidden);
    await page.click('#btn-victory-menu');
    await page.waitForSelector('#main-menu.active', { timeout: 8000 });
    if (r.start !== 3 || r.tries !== 0 || r.lostBy !== 'tries' || !r.over) throw new Error('three misses did not end the journey: ' + JSON.stringify(r));
    if (!r.stamp || r.spent !== 3) throw new Error('the loss is not stamped on the table: ' + JSON.stringify(r));
    if (!stampGone) throw new Error('the stamp stayed over the end screen');
    console.log(`         3 ankhs -> 0, stamped "${r.stamp}", then the end screen`);
});

// v3.18.0: the Pharaoh's Tomb, through its real buttons. Three cards face up;
// clicking one lays it; the guardian answers on its tier's clock; and not one
// shared match event fires, so the tomb cannot reach Slap IQ or the boards.
await step('the Tomb: a hand face up, a card laid, the guardian answers, nothing shared fires', async () => {
    await page.click('#btn-legends');
    await page.waitForSelector('#legends-panel.active', { timeout: 5000 });
    const r = await page.evaluate(async () => {
        const { TombMode } = await import('./js/tomb.js');
        const { default: EventBus } = await import('./js/eventbus.js');
        const sleep = (ms) => new Promise(res => setTimeout(res, ms));
        const fired = [];
        const realEmit = EventBus.emit.bind(EventBus);
        EventBus.emit = (name, ...a) => { fired.push(name); return realEmit(name, ...a); };
        const out = {};
        try {
            document.getElementById('btn-tomb-start').click();
            await sleep(100);
            const intro = document.getElementById('tomb-intro');
            out.intro = !!intro && !intro.hidden && intro.offsetHeight > 0
                && document.getElementById('tomb-table').hidden
                && document.querySelectorAll('#tomb-intro .tomb-rules li').length === 4
                && !!document.querySelector('#tomb-intro-emblem svg');
            document.getElementById('btn-tomb-go').click();
            await sleep(200);
            out.introGone = intro.hidden && intro.offsetHeight === 0;
            out.screen = document.getElementById('tomb-screen').classList.contains('active');
            out.hand = document.querySelectorAll('#tomb-hand .tomb-card').length;
            out.portrait = !!document.querySelector('#tomb-portrait svg');
            const s = TombMode.state;
            // Lay the first card that neither opens a challenge nor completes a pattern.
            const i = Math.max(0, s.you.hand.findIndex(c => c.rank < 11));
            document.querySelectorAll('#tomb-hand .tomb-card')[i].click();
            out.afterLay = TombMode.state.pile.length;
            const t0 = performance.now();
            while (performance.now() - t0 < 4000 && TombMode.state && TombMode.state.pile.length < 2 && !TombMode.state.over) await sleep(20);
            out.guardAnswered = TombMode.state.pile.length >= 2 || TombMode.state.over !== null || TombMode.state.pile.length === 0;
            document.getElementById('btn-tomb-exit').click();
            await sleep(100);
            out.menu = document.getElementById('main-menu').classList.contains('active');
        } finally {
            EventBus.emit = realEmit;
        }
        const shared = ['cardPlayed', 'pileWon', 'gameOver', 'gameStarted', 'invalidSlap', 'slapAttempt', 'challengeStarted', 'slapExplained', 'masteryMarkEarned'];
        out.leaked = fired.filter(n => shared.includes(n));
        return out;
    });
    if (!r.intro) throw new Error('the tomb did not open on its rules: ' + JSON.stringify(r));
    if (!r.introGone) throw new Error('the rules stayed up after the torch was lit: ' + JSON.stringify(r));
    if (!r.screen || r.hand !== 3 || !r.portrait) throw new Error('the tomb did not open on a guardian and three cards: ' + JSON.stringify(r));
    if (r.afterLay !== 1) throw new Error('clicking a card did not lay it: ' + JSON.stringify(r));
    if (!r.guardAnswered) throw new Error('the guardian never played: ' + JSON.stringify(r));
    if (!r.menu) throw new Error('leaving the tomb did not return to the menu');
    if (r.leaked.length) throw new Error('shared match events fired: ' + r.leaked.join(', '));
    console.log('         rules first, then a hand of 3 face up, a card laid, the guardian answered, back to menu, 0 shared events');
});

// Back to the menu from wherever a failed step left the page, so one broken
// promise is reported once instead of cascading into every step after it.
const senetToMenu = async () => {
    const where = await page.evaluate(() => document.querySelector('.screen.active')?.id || '');
    if (where === 'victory-screen') await page.click('#btn-victory-menu');
    else if (where === 'game-container') {
        await page.click('#btn-quit');
        await page.waitForTimeout(300);
        await page.click('#btn-confirm-leave');
    } else if (where === 'legends-panel') await page.click('#btn-legends-back');
    await page.waitForSelector('#main-menu.active', { timeout: 8000 });
};

// v3.26.0 (council ERS-40): Senet — the Game of Passing, through its real
// button and the engine's real slap path. The card lists throws generated from
// the damage table; the race opens with every piece on square 1 and the classic
// rules locked; the board moves when a pile is won and at no other moment.
await step('Senet: the card lists derived throws, the race opens on square 1, rules locked, the board still while a card is played', async () => {
    await senetToMenu();
    await page.click('#btn-legends');
    await page.waitForSelector('#legends-panel.active', { timeout: 5000 });
    const card = await page.evaluate(async () => {
        const T = await import('./js/senet.js');
        const { Localization } = await import('./js/localization.js?v=3');
        const items = [...document.querySelectorAll('#senet-throws li')].map(li => li.textContent.trim());
        const want = [...T.throwTable().map(t => `${Localization.get('ruleName_' + t.id)} ${t.steps}`),
            `${Localization.get('senetFacePile')} ${T.CHALLENGE_THROW}`];
        return { items, want, emblem: !!document.querySelector('#senet-emblem svg') };
    });
    if (card.items.join('|') !== card.want.join('|')) throw new Error('the card does not list the derived throws: ' + JSON.stringify(card));
    if (!card.emblem) throw new Error('the Senet card has no emblem');
    await page.click('#btn-senet-start');
    await page.waitForSelector('#game-container.active', { timeout: 8000 });
    const r = await page.evaluate(async () => {
        const { SenetMode } = await import('./js/senet.js');
        const sleep = (ms) => new Promise(res => setTimeout(res, ms));
        const GS = window.GameState;
        await sleep(300);
        const hud = document.getElementById('senet-hud');
        const tf = () => [...hud.querySelectorAll('.senet-piece')].map(p => p.style.transform).join('|');
        const out = { positions: SenetMode.positions.slice(), hudShown: !hud.hidden, pieces: hud.querySelectorAll('.senet-piece').length,
            locked: window.HouseRules.lockedBy, rules: window.HouseRules.key(), classic: window.HouseRules.isClassic(), line: document.getElementById('senet-line').textContent };
        // A card played onto an empty pile wins nothing: not one piece may move.
        const before = tf();
        GS.pile = []; GS.burnPile = [];
        GS.activePlayerId = 0;
        GS.playCard(0);
        await sleep(120);
        out.played = GS.pile.length;
        out.still = tf() === before;
        return out;
    });
    if (r.positions.join() !== '1,1,1,1') throw new Error('the race did not open on square 1: ' + JSON.stringify(r));
    if (!r.hudShown || r.pieces !== 4) throw new Error('the board is not shown with four pieces: ' + JSON.stringify(r));
    if (r.locked !== 'senet' || !r.classic) throw new Error('the classic rules are not locked for the race: ' + JSON.stringify(r));
    if (!r.line) throw new Error('the race opened without saying how it is played');
    if (r.played !== 1 || !r.still) throw new Error('a piece moved while a card was played: ' + JSON.stringify(r));
    console.log(`         ${card.items.join(' · ')}; 4 pieces on 1; locked ${r.rules}; still while a card lands`);
});

await step('Senet: a Tens throws 3, a face-card pile 1, the water returns to 15, a swap is said, passing wins; leaving hands back', async () => {
    const r = await page.evaluate(async () => {
        const T = await import('./js/senet.js');
        const { SenetMode } = T;
        const sleep = (ms) => new Promise(res => setTimeout(res, ms));
        const GS = window.GameState;
        const line = () => document.getElementById('senet-line').textContent;
        const tf = (seat) => document.querySelector(`#senet-hud .senet-piece[data-seat="${seat}"]`).style.transform;
        const slapYou = async (a, b) => {
            await sleep(650);   // past the engine's 500 ms grace after a won pile
            GS.pile = [a, b]; GS.burnPile = [];
            GS.slap(0);
            await sleep(60);
        };
        const out = {};
        // The bots stand still for the staged slaps: no pending play or slap,
        // and every pile below is won by you, so the turn stays yours.
        const { AIController } = await import('./js/ai.js');
        AIController.clearAllTimeouts();
        GS.activePlayerId = 0;
        const t0 = tf(0), t1 = tf(1);
        await slapYou({ rank: 4, suit: 'clubs' }, { rank: 6, suit: 'hearts' });
        out.tens = SenetMode.positions[0];
        out.tensWant = 1 + T.throwFor('tens');
        out.tensLine = line();
        out.youMoved = tf(0) !== t0;
        out.othersStill = tf(1) === t1;
        await sleep(650);
        GS.pile = [{ rank: 12, suit: 'spades' }, { rank: 3, suit: 'hearts' }]; GS.burnPile = [];
        GS.winPile(0, 'challenge');
        await sleep(60);
        out.face = SenetMode.positions[0] - out.tens;
        SenetMode.positions = [24, 1, 1, 1];
        await slapYou({ rank: 4, suit: 'clubs' }, { rank: 6, suit: 'hearts' });
        out.water = SenetMode.positions[0];
        out.waterLine = line();
        SenetMode.positions = [5, 7, 1, 1];
        await slapYou({ rank: 9, suit: 'clubs' }, { rank: 9, suit: 'hearts' });
        out.swap = SenetMode.positions.slice(0, 2);
        out.swapLine = line();
        const passingsBefore = SenetMode.store.passings;
        SenetMode.positions = [28, 1, 1, 1];
        await slapYou({ rank: 8, suit: 'clubs' }, { rank: 8, suit: 'diamonds' });
        out.over = GS.gameOver;
        out.passed = SenetMode.passed;
        out.passings = SenetMode.store.passings - passingsBefore;
        out.passLine = line();
        return out;
    });
    const broken = [];
    if (r.tens !== r.tensWant || !/4/.test(r.tensLine)) broken.push('a slapped Tens did not throw its derived squares: ' + JSON.stringify({ tens: r.tens, want: r.tensWant, line: r.tensLine }));
    if (!r.youMoved || !r.othersStill) broken.push('the wrong piece moved');
    if (r.face !== 1) broken.push(`a face-card pile threw ${r.face}, want 1`);
    if (r.water !== 15 || !/15/.test(r.waterLine)) broken.push('the House of Water did not return the piece to the House of Life, or did not say so: ' + r.waterLine);
    if (r.swap.join() !== '7,5' || !/Blitz/.test(r.swapLine)) broken.push('a landing on Blitz did not swap, or the swap was not said: ' + r.swapLine);
    if (!r.over || r.passed !== 0 || r.passings !== 1 || !r.passLine) broken.push('passing square 30 did not win the match: ' + JSON.stringify({ over: r.over, passed: r.passed }));
    if (broken.length) {
        await senetToMenu();
        throw new Error(broken.join(' | '));
    }
    await page.waitForSelector('#victory-screen.active', { timeout: 8000 });
    await page.click('#btn-victory-menu');
    await page.waitForSelector('#main-menu.active', { timeout: 8000 });
    const after = await page.evaluate(async () => {
        await new Promise(res => setTimeout(res, 300));
        const { SenetMode } = await import('./js/senet.js');
        const { GameManager } = await import('./js/gameManager.js');
        return { armed: SenetMode.armed, locked: window.HouseRules.lockedBy, rematch: GameManager.rematchOptions,
            race: document.body.classList.contains('senet-race'), hudHidden: document.getElementById('senet-hud').hidden,
            best: document.getElementById('senet-best').textContent };
    });
    if (after.armed || after.locked !== null || after.rematch !== null || after.race || !after.hudHidden) throw new Error('leaving did not hand everything back: ' + JSON.stringify(after));
    if (!after.best) throw new Error('the card does not show the passing just made');
    console.log(`         Tens 1 -> ${r.tens}, face pile +${r.face}, water -> ${r.water}, swap ${r.swap.join('/')}, passed and won; card: "${after.best}"`);
});

// §17.11's lesson: a teardown hooked only to the normal ending misses the
// player who walks out. Quit mid-race and measure the board gone.
await step('Senet: quitting mid-race takes the board, the lock and the rematch with it', async () => {
    await senetToMenu();
    await page.click('#btn-legends');
    await page.waitForSelector('#legends-panel.active', { timeout: 5000 });
    await page.click('#btn-senet-start');
    await page.waitForSelector('#game-container.active', { timeout: 8000 });
    await page.waitForTimeout(300);
    const during = await page.evaluate(() => ({ hud: !document.getElementById('senet-hud').hidden, locked: window.HouseRules.lockedBy }));
    await page.click('#btn-quit');
    await page.waitForTimeout(300);
    await page.click('#btn-confirm-leave');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
    await page.waitForTimeout(400);
    const after = await page.evaluate(async () => {
        const { SenetMode } = await import('./js/senet.js');
        const { GameManager } = await import('./js/gameManager.js');
        return { armed: SenetMode.armed, locked: window.HouseRules.lockedBy, rematch: GameManager.rematchOptions,
            race: document.body.classList.contains('senet-race'), hudHidden: document.getElementById('senet-hud').hidden };
    });
    if (!during.hud || during.locked !== 'senet') throw new Error('the race did not start: ' + JSON.stringify(during));
    if (after.armed || after.locked !== null || after.rematch !== null || after.race || !after.hudHidden) throw new Error('quitting left the race behind: ' + JSON.stringify(after));
    console.log('         board, lock and rematch gone after Quit');
});

// The board may never sit on the pile (the slap target), on a deck, or on the
// emoji and chat buttons. Measured at desktop and phone sizes with your deck
// pulsing as it does on your turn — the first phone fit was taken from the
// resting deck and the lifted one slid under the board. A short phone gets
// the strip (the same road unfolded), a tall one the board.
await step('Senet: the board fits the table — desktop and phone, never on the pile, a deck or the buttons', async () => {
    const shots = process.env.SMOKE_SHOTS;
    const sizes = [[1280, 860], [1024, 768], [1366, 768], [375, 667], [390, 844], [412, 915]];
    await senetToMenu();
    await page.click('#btn-legends');
    await page.waitForSelector('#legends-panel.active', { timeout: 5000 });
    await page.click('#btn-senet-start');
    await page.waitForSelector('#game-container.active', { timeout: 8000 });
    await page.waitForTimeout(300);
    await page.evaluate(async () => {
        // Hold the table still while it is measured; your deck pulses as on your turn.
        const { AIController } = await import('./js/ai.js');
        AIController.clearAllTimeouts();
        window.GameState.activePlayerId = 0;
        document.getElementById('human-deck').classList.add('active');
        const { SenetMode } = await import('./js/senet.js');
        SenetMode.positions = [12, 9, 15, 4];
        SenetMode._draw();
        SenetMode.renderHud();
    });
    const seen = [];
    const bad = [];
    for (const [w, h] of sizes) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(450);
        const m = await page.evaluate(async () => {
            const { SenetMode } = await import('./js/senet.js');
            const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width && b.height ? [b.left, b.top, b.right, b.bottom] : null; };
            const hud = document.getElementById('senet-hud');
            const ids = { pile: 'center-pile', deck: 'human-deck', emoji: 'emoji-btn', chat: 'chat-btn', left: 'left-deck', right: 'right-deck', top: 'top-deck' };
            return { layout: SenetMode.layout, shown: getComputedStyle(hud).display !== 'none', hud: r(hud), vw: innerWidth, vh: innerHeight,
                others: Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, r(document.getElementById(id))])) };
        });
        const tag = `${w}x${h}`;
        seen.push(`${tag} ${m.shown ? m.layout : 'hidden'}`);
        if (!m.shown || !m.hud) { bad.push(`${tag}: no board shown`); continue; }
        const [l, t, rt, b] = m.hud;
        if (l < 0 || t < 0 || rt > m.vw || b > m.vh) bad.push(`${tag}: off the screen ${JSON.stringify(m.hud)}`);
        for (const [k, o] of Object.entries(m.others)) {
            if (o && !(rt <= o[0] || o[2] <= l || b <= o[1] || o[3] <= t)) bad.push(`${tag}: on the ${k} ${JSON.stringify({ hud: m.hud, [k]: o })}`);
        }
        if (shots) await page.screenshot({ path: `${shots}/senet-${tag}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(300);
    await senetToMenu();
    if (bad.length) throw new Error(bad.join(' | '));
    console.log(`         ${seen.join(', ')}`);
});

// ── v3.21.2 (council ERS-27): what the player actually sees ───────────────────
//
// A PNG from the browser, decoded here with zlib — no dependency. Colour types
// 2 (RGB) and 6 (RGBA), 8-bit, not interlaced: what Chromium writes.
function decodePng(buf) {
    let off = 8, w = 0, h = 0, type = 0;
    const idat = [];
    while (off < buf.length) {
        const len = buf.readUInt32BE(off), tag = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (tag === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('png: only 8-bit, non-interlaced'); }
        if (tag === 'IDAT') idat.push(data);
        off += 12 + len;
    }
    const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
    if (!bpp) throw new Error('png: colour type ' + type);
    const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(h * stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1;
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
            let v = raw[src + x];
            if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : pb <= pc ? b : c; }
            px[y * stride + x] = v & 255;
        }
    }
    return { w, h, at: (x, y) => { const i = y * stride + x * bpp; return [px[i], px[i + 1], px[i + 2]]; } };
}
const relLum = ([r, g, b]) => [r, g, b].map(c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const wcag = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

await step('dark skins: every index reads against the pixels actually painted around it', async () => {
    const skins = ['golden', 'neon', 'shadow', 'inferno', 'frost', 'emerald', 'royal', 'sakura', 'phantom', 'holographic', 'obsidian'];
    const c2 = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
    const p2 = await c2.newPage();
    try {
        await p2.setContent(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${base}/style.css">
            <style>body{margin:0;background:#1b2027;display:flex;flex-wrap:wrap;gap:14px;padding:10px;width:980px}
            .slot{position:relative;width:130px;height:195px}*{animation:none!important;transition:none!important}</style></head>
            <body>${skins.flatMap(k => [['black', '♠', 'A'], ['red', '♥', 'K']].map(([c, s, r]) =>
                `<div class="slot"><div class="card ${c} card-skin-${k}" data-id="${k} ${s}"><div class="card-top">${r} ${s}</div><div class="card-center">${s}</div><div class="card-bottom">${r} ${s}</div></div></div>`)).join('')}</body></html>`,
            { waitUntil: 'load' });
        await p2.waitForTimeout(300);
        const boxes = await p2.evaluate(() => [...document.querySelectorAll('.card')].map(c => ({
            id: c.dataset.id, color: getComputedStyle(c).color.match(/\d+/g).slice(0, 3).map(Number),
            parts: ['.card-top', '.card-center'].map(s => { const r = c.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })
        })));
        const shot = decodePng(await p2.screenshot());
        await p2.addStyleTag({ content: '.card-top,.card-bottom,.card-center{color:#ff00ff!important;-webkit-text-stroke:0!important}' });
        await p2.waitForTimeout(200);
        const keyed = decodePng(await p2.screenshot());
        const worst = [];
        for (const b of boxes) {
            for (const [pi, [bx, by, bw, bh]] of b.parts.entries()) {
                const x0 = Math.max(0, Math.floor(bx * 2) - 12), y0 = Math.max(0, Math.floor(by * 2) - 12);
                const x1 = Math.min(shot.w - 1, Math.ceil((bx + bw) * 2) + 12), y1 = Math.min(shot.h - 1, Math.ceil((by + bh) * 2) + 12);
                const W = x1 - x0 + 1, H = y1 - y0 + 1, mask = new Uint8Array(W * H);
                for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
                    const [r, g, bl] = keyed.at(x0 + x, y0 + y);
                    mask[y * W + x] = r > 200 && g < 80 && bl > 200 ? 1 : 0;
                }
                const dist = new Uint8Array(W * H).fill(255);   // Chebyshev distance to the glyph, capped
                for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) {
                    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
                        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
                        const d = Math.max(Math.abs(dx), Math.abs(dy)), i = Y * W + X; if (d < dist[i]) dist[i] = d;
                    }
                }
                let n = 0; const sum = [0, 0, 0];
                for (let i = 0; i < W * H; i++) if (!mask[i] && dist[i] >= 3 && dist[i] <= 6) { const c = shot.at(x0 + i % W, y0 + Math.floor(i / W)); sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; n++; }
                if (!n) { worst.push(`${b.id} ${pi ? 'pip' : 'index'}: no glyph found`); continue; }
                const ratio = wcag(b.color, sum.map(v => v / n));
                if (ratio < 4.5) worst.push(`${b.id} ${pi ? 'pip' : 'index'} ${ratio.toFixed(2)} : 1`);
            }
        }
        if (worst.length) throw new Error('below 4.5 : 1 as painted: ' + worst.join(', '));
        console.log(`         ${boxes.length * 2} glyphs on ${skins.length} dark skins, each >= 4.5 : 1 against what surrounds it on screen`);
    } finally { await c2.close(); }
});

await step('online, your skin survives the room\'s redraw — and nothing replays', async () => {
    const r = await page.evaluate(async () => {
        const { UIManager } = await import('./js/ui.js');
        const { Settings } = await import('./js/settings.js');
        const { CardSkins } = await import('./js/cardSkins.js');
        const { createMemoryLedger } = await import('./js/walletRules.js');
        const GS = window.GameState;
        const saved = { skin: Settings.config.equippedCardSkin, pile: GS.pile };
        const el = document.getElementById('pile-cards');
        const out = {};
        try {
            // v3.22.0: a skin is drawn only if the wallet owns it.
            createMemoryLedger(CardSkins, { coins: 0, owned: ['classic', 'gods'] });
            Settings.config.equippedCardSkin = 'gods';
            UIManager.syncPileElements([]);
            const mine = { rank: 13, suit: 'spades' }, theirs = { rank: 9, suit: 'hearts' }, late = { rank: 4, suit: 'clubs' };
            GS.pile = [mine];
            UIManager.renderPileCard(mine, 0);                     // cardPlayed …
            const first = el.lastElementChild;
            UIManager.handleGameSynced({ players: [] });           // … then gameSynced, same tick, as in firebaseSync
            out.sameNode = el.lastElementChild === first;
            out.dressed = first.classList.contains('card-skin-gods') && first.classList.contains('pd-deck');
            GS.pile = [mine, theirs];
            UIManager.renderPileCard(theirs, 1);
            UIManager.handleGameSynced({ players: [] });
            out.afterTheirs = [el.children.length, el.children[0] === first, el.children[1].classList.contains('card-skin-gods')];
            GS.pile = [mine, theirs, late];                         // a card that arrived with no cardPlayed
            UIManager.handleGameSynced({ players: [] });
            out.appended = [el.children.length, el.children[0] === first, el.children[2].dataset.key];
            GS.pile = [];
            UIManager.handleGameSynced({ players: [] });
            out.cleared = el.children.length;
        } finally {
            Settings.config.equippedCardSkin = saved.skin;
            CardSkins.detachLedger();
            GS.pile = saved.pile || [];
            UIManager.syncPileElements([]);
        }
        return out;
    });
    if (!r.sameNode) throw new Error('the redraw replaced the card you just laid: ' + JSON.stringify(r));
    if (!r.dressed) throw new Error('your card lost its skin in the redraw: ' + JSON.stringify(r));
    if (r.afterTheirs[0] !== 2 || !r.afterTheirs[1] || r.afterTheirs[2]) throw new Error('another player\'s card changed yours, or wore your skin: ' + JSON.stringify(r));
    if (r.appended[0] !== 3 || !r.appended[1] || r.appended[2] !== '4clubs') throw new Error('a card from the room was not appended in place: ' + JSON.stringify(r));
    if (r.cleared !== 0) throw new Error('a won pile did not clear the table: ' + JSON.stringify(r));
    console.log('         laid, synced, synced again, appended from the room, cleared: your card is the same element, still dressed');
});

// ── v3.23.0 / v3.23.1 (council ERS-33/34): the two features, in a real browser ──
// The suite pins the table and the wiring; only a browser shows that the hall
// draws the pills, that a level changes the seat the god sits in, that a fall
// records the LEVEL, and that another seat's card wears the seat's skin.
await step('Ascension: the hall offers a level after the last, the duel is sized by it, a fall records the level', async () => {
    await page.evaluate(async () => {
        const { PantheonMode } = await import('./js/pantheon.js');
        PantheonMode.store = { defeated: { bastet: 1 }, ascended: {} };
    });
    await page.click('#btn-legends');
    await page.waitForSelector('#legends-panel.active', { timeout: 5000 });
    await page.evaluate(async () => { (await import('./js/pantheon.js')).PantheonMode.renderHall(); });
    const hall = await page.evaluate(() => {
        const pills = [...document.querySelectorAll('[data-god="bastet"][data-level]')];
        const card = document.querySelector('[data-god="bastet"]').closest('.god-card');
        return { levels: pills.map(p => p.getAttribute('data-level') + (p.disabled ? 'x' : '')),
                 note: (card.querySelector('.god-ascend-note') || {}).textContent || '',
                 pillHeight: Math.round(pills[0].getBoundingClientRect().height),
                 locked: [...document.querySelectorAll('.god-card')].slice(2).every(c => !c.querySelector('[data-level]')) };
    });
    if (hall.levels.join() !== '1,2x,3x') throw new Error('the hall should open I only: ' + JSON.stringify(hall));
    if (!/Ascension I: \+25% life/.test(hall.note)) throw new Error('the hall does not say in words what level I does: ' + JSON.stringify(hall));
    if (hall.pillHeight < 40) throw new Error('a pill is under a finger wide: ' + hall.pillHeight + 'px');
    if (!hall.locked) throw new Error('an unbeaten god offers Ascension');
    await page.click('[data-god="bastet"][data-level="1"]');
    await page.waitForSelector('#game-container.active', { timeout: 8000 });
    const r = await page.evaluate(async () => {
        const { PantheonMode } = await import('./js/pantheon.js');
        const { AIController } = await import('./js/ai.js');
        const { BotConfig } = await import('./js/botConfig.js');
        const sleep = (ms) => new Promise(res => setTimeout(res, ms));
        const GS = window.GameState;
        await sleep(400);
        const out = {
            level: PantheonMode.level, maxHp: PantheonMode.maxHp,
            hpText: document.getElementById('boss-hp').textContent.trim(),
            tag: document.getElementById('boss-extra').textContent,
            delay: AIController.seatConfig[2].playDelay, easyDelay: BotConfig.easy.playDelay
        };
        PantheonMode.hp = 4;
        await sleep(650);
        GS.pile = [{ rank: 7, suit: 'clubs' }, { rank: 7, suit: 'hearts' }]; GS.burnPile = [];
        GS.slap(0);
        await sleep(150);
        out.ascended = PantheonMode.store.ascended.bastet;
        return out;
    });
    await page.waitForSelector('#victory-screen.active', { timeout: 8000 });
    await page.click('#btn-victory-menu');
    await page.waitForSelector('#main-menu.active', { timeout: 8000 });
    const after = await page.evaluate(async () => {
        await new Promise(res => setTimeout(res, 300));
        const { PantheonMode } = await import('./js/pantheon.js');
        return { level: PantheonMode.level, defeated: !!PantheonMode.store.defeated.bastet };
    });
    // …and the hall now shows the level cleared, the rim, and II open.
    await page.click('#btn-legends');
    await page.waitForSelector('#legends-panel.active', { timeout: 5000 });
    const hall2 = await page.evaluate(() => {
        const card = document.querySelector('[data-god="bastet"]').closest('.god-card');
        return { pills: [...card.querySelectorAll('[data-level]')].map(p => p.textContent.trim() + (p.disabled ? 'x' : '')), rim: card.classList.contains('gilded-1'),
                 rimPainted: getComputedStyle(card).boxShadow !== 'none', note: (card.querySelector('.god-ascend-note') || {}).textContent || '' };
    });
    await page.click('#btn-legends-back');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
    if (r.level !== 1 || r.maxHp !== 100 || (r.hpText !== '4 / 100' && r.hpText !== '100 / 100')) throw new Error('Ascension I should give Bastet 100 life: ' + JSON.stringify(r));
    if (!/Ascension I/.test(r.tag)) throw new Error('the HUD does not name the level: ' + JSON.stringify(r));
    if (!(r.delay < r.easyDelay)) throw new Error('the god is no quicker than its tier: ' + JSON.stringify(r));
    if (r.ascended !== 1) throw new Error('the fall did not record Ascension I: ' + JSON.stringify(r));
    if (after.level !== 0) throw new Error('leaving did not reset the level: ' + JSON.stringify(after));
    if (hall2.pills.join() !== 'I ✓,II,IIIx' || !hall2.rim || !hall2.rimPainted) throw new Error('the hall after the fall: ' + JSON.stringify(hall2));
    if (!/Ascension II: \+50% life/.test(hall2.note)) throw new Error('the note does not move on to level II: ' + JSON.stringify(hall2));
    console.log(`         hall opens I only and says what it does; Bastet ${r.maxHp} life, quicker (${Math.round(r.delay)} < ${r.easyDelay} ms), fell -> level 1 kept, gilded rim, II now open`);
});

await step('visible skins: another seat\'s card wears that seat\'s skin, and only a catalogue skin', async () => {
    const r = await page.evaluate(async () => {
        const { UIManager } = await import('./js/ui.js');
        const { SeatSkins } = await import('./js/seatSkins.js');
        const { CARD_SKINS } = await import('./js/cardSkins.js');
        const { Settings } = await import('./js/settings.js');
        const GS = window.GameState;
        const ids = CARD_SKINS.map(k => k.id);
        const saved = { skin: Settings.config.equippedCardSkin, pile: GS.pile };
        const el = document.getElementById('pile-cards');
        const out = {};
        try {
            Settings.config.equippedCardSkin = 'classic';
            UIManager.syncPileElements([]);
            SeatSkins.set([{}, { cardSkin: 'gods' }, { cardSkin: '<img src=x onerror=1>' }, { cardSkin: 'neon' }], 0, ids);
            const a = { rank: 5, suit: 'hearts' }, b = { rank: 6, suit: 'clubs' }, c = { rank: 8, suit: 'spades' }, d = { rank: 9, suit: 'diamonds' };
            GS.pile = [a];       UIManager.renderPileCard(a, 1);
            GS.pile = [a, b];    UIManager.renderPileCard(b, 2);
            GS.pile = [a, b, c]; UIManager.renderPileCard(c, 3);
            GS.pile = [a, b, c, d]; UIManager.renderPileCard(d, 0);
            const cls = () => [...el.children].map(n => [...n.classList].filter(x => x.startsWith('card-skin-')).join('+'));
            out.laid = cls();
            const first = el.children[0];
            UIManager.handleGameSynced({ players: [] });
            out.sameNode = el.children[0] === first;
            out.afterSync = cls();
            out.artFigures = el.children[0].classList.contains('pd-deck');
            out.hostileClass = [...el.children].some(n => n.className.includes('onerror') || n.className.includes('<'));
            // a card that arrived with no cardPlayed: nobody is remembered as its owner
            const e = { rank: 2, suit: 'clubs' };
            GS.pile = [a, b, c, d, e];
            UIManager.handleGameSynced({ players: [] });
            out.unknownOwner = cls()[4];
            // leaving the room empties the table
            SeatSkins.clear();
            const f = { rank: 3, suit: 'clubs' };
            GS.pile = [a, b, c, d, e, f]; UIManager.renderPileCard(f, 1);
            out.afterLeave = cls()[5];
        } finally {
            Settings.config.equippedCardSkin = saved.skin;
            SeatSkins.clear();
            GS.pile = saved.pile || [];
            UIManager.syncPileElements([]);
        }
        return out;
    });
    if (r.laid.join('|') !== 'card-skin-gods||card-skin-neon|') throw new Error('another seat\'s card should wear its seat\'s skin (gods, none for a hostile value, neon, and yours classic): ' + JSON.stringify(r));
    if (!r.sameNode || r.afterSync.join('|') !== r.laid.join('|')) throw new Error('the redraw undressed a card: ' + JSON.stringify(r));
    if (!r.artFigures) throw new Error('an art deck lost its figures on another seat\'s card: ' + JSON.stringify(r));
    if (r.hostileClass) throw new Error('a hostile room value reached the markup: ' + JSON.stringify(r));
    if (r.unknownOwner !== '') throw new Error('a card with no known owner was dressed: ' + JSON.stringify(r));
    if (r.afterLeave !== '') throw new Error('skins outlived the room: ' + JSON.stringify(r));
    console.log('         seat 1 gods (with its figures), seat 2 hostile value drawn as nothing, seat 3 neon, yours classic; survives the redraw; gone with the room');
});

await step('visible skins: your own seat shares only the skin the wallet owns, and never throws', async () => {
    const r = await page.evaluate(async () => {
        const { FirebaseSync } = await import('./js/firebaseSync.js');
        const { AuthSystem } = await import('./js/auth.js');
        const { Settings } = await import('./js/settings.js');
        const { CardSkins } = await import('./js/cardSkins.js');
        const { createMemoryLedger } = await import('./js/walletRules.js');
        const saved = { skin: Settings.config.equippedCardSkin, roomId: FirebaseSync.roomId, idx: FirebaseSync.localPlayerIndex, at: FirebaseSync._skinAt };
        const userDesc = Object.getOwnPropertyDescriptor(AuthSystem, 'currentUser');
        const out = {};
        try {
            createMemoryLedger(CardSkins, { coins: 0, owned: ['classic', 'neon'] });
            FirebaseSync.roomId = 'ROOM'; FirebaseSync.localPlayerIndex = 0;
            Object.defineProperty(AuthSystem, 'currentUser', { value: { uid: 'u1' }, configurable: true, writable: true });
            const room = (skin) => ({ players: [{ uid: 'u1', cardSkin: skin }, { uid: 'u2' }, { uid: 'u3' }, { uid: 'bot_3' }] });
            Settings.config.equippedCardSkin = 'gods';                 // equipped but NOT owned
            FirebaseSync._skinAt = 0; FirebaseSync.syncOwnSkin(room(undefined)); out.notOwned = FirebaseSync._skinAt;
            Settings.config.equippedCardSkin = 'neon';                 // owned
            FirebaseSync._skinAt = 0; FirebaseSync.syncOwnSkin(room(undefined)); out.owned = FirebaseSync._skinAt > 0;
            FirebaseSync._skinAt = 0; FirebaseSync.syncOwnSkin(room('neon')); out.agrees = FirebaseSync._skinAt;
            FirebaseSync._skinAt = 0; FirebaseSync.syncOwnSkin({ players: [{ uid: 'someone-else' }, {}, {}, {}] }); out.notMySeat = FirebaseSync._skinAt;
            FirebaseSync._skinAt = 0; FirebaseSync.syncOwnSkin({}); out.noPlayers = FirebaseSync._skinAt;
        } finally {
            Settings.config.equippedCardSkin = saved.skin; CardSkins.detachLedger();
            FirebaseSync.roomId = saved.roomId; FirebaseSync.localPlayerIndex = saved.idx; FirebaseSync._skinAt = saved.at;
            if (userDesc) Object.defineProperty(AuthSystem, 'currentUser', userDesc);
        }
        return out;
    });
    if (r.notOwned !== 0) throw new Error('an equipped skin the wallet does not own was shared: ' + JSON.stringify(r));
    if (!r.owned) throw new Error('an owned, equipped skin was not shared: ' + JSON.stringify(r));
    if (r.agrees !== 0 || r.notMySeat !== 0 || r.noPlayers !== 0) throw new Error('a write was attempted when it should not be: ' + JSON.stringify(r));
    console.log('         owned -> shared; equipped-but-not-owned, already-agreeing, someone else\'s seat, no players -> nothing written');
});

// ── v3.22.1: the admin page ────────────────────────────────────────────────
// A context of its own, with a Firebase double that is an in-memory store —
// scoped to this step, so firebase-stub.mjs stays inert for everything else.
// The rules themselves are proven in the emulator (firestore-rules-test.mjs);
// this proves the PAGE: it opens only for an admin, it renders hostile table
// data as text, it never builds a database path out of a hostile id, it
// diagnoses the tables, and a grant goes through the audit record.
await step('the admin page: admin-only, hostile names stay text, hostile ids never reach a path, a grant is audited', async () => {
    const ADMIN_STUB = `
const store = globalThis.__ADM_STORE__;
const paths = (globalThis.__paths = globalThis.__paths || []);
const noop = () => {};
export const initializeApp = () => ({});
export const getDatabase = () => ({});
export const getFunctions = () => ({});
export const getAuth = () => ({});
export const signInWithEmailAndPassword = async () => { throw Object.assign(new Error('stub'), { code: 'auth/invalid-credential' }); };
export const signOut = async () => {};
export const onAuthStateChanged = (a, cb) => { setTimeout(() => cb(store.user), 0); return noop; };
export const getFirestore = () => ({});
const join = (parts) => parts.filter(p => typeof p === 'string').join('/');
export const collection = (db, ...segs) => ({ kind: 'col', path: join(segs) });
let auto = 0;
export const doc = (base, ...segs) => {
    const path = base && base.kind === 'col' ? (segs.length ? base.path + '/' + join(segs) : base.path + '/G' + (++auto)) : join(segs);
    paths.push('fs:' + path);
    return { kind: 'doc', path, id: path.split('/').pop() };
};
const snapDoc = (path) => { const v = store.fs[path]; return { id: path.split('/').pop(), exists: () => v !== undefined, data: () => v }; };
export const getDoc = async (r) => snapDoc(r.path);
export const where = (f, op, v) => ({ where: [f, op, v] });
export const orderBy = () => ({});
export const limit = () => ({});
export const query = (c, ...mods) => ({ kind: 'col', path: c.path, where: mods.filter(m => m.where).map(m => m.where) });
const colDocs = (q) => Object.keys(store.fs)
    .filter(p => p.startsWith(q.path + '/') && p.split('/').length === q.path.split('/').length + 1)
    .map(snapDoc).filter(d => (q.where || []).every(([f, op, v]) => (op === 'array-contains'
        ? Array.isArray(d.data()[f]) && d.data()[f].includes(v) : d.data()[f] === v)));
export const getDocs = async (q) => { const docs = colDocs(q); return { docs, empty: !docs.length, forEach: (f) => docs.forEach(f) }; };
const removals = (globalThis.__removes = globalThis.__removes || []);
export const deleteDoc = async (r) => { removals.push('fs:' + r.path); delete store.fs[r.path]; (store.listeners || []).forEach(f => f()); };
// v3.24.0: every admin power is one batch (admin_actions record + admin_state + the change).
export const writeBatch = () => {
    const ops = [];
    return {
        set: (r, v) => { ops.push(['set', r.path, v]); },
        update: (r, v) => { ops.push(['update', r.path, v]); },
        delete: (r) => { ops.push(['delete', r.path]); },
        commit: async () => {
            for (const [op, path, v] of ops) {
                if (op === 'delete') { removals.push('fs:' + path); delete store.fs[path]; }
                else store.fs[path] = op === 'update' ? { ...store.fs[path], ...v } : v;
            }
            (store.listeners || []).forEach(f => f());
        }
    };
};
export const onSnapshot = (q, next) => {
    const fire = () => { if (q.kind === 'doc') next(snapDoc(q.path)); else { const docs = colDocs(q); next({ docs, forEach: (f) => docs.forEach(f) }); } };
    setTimeout(fire, 0); (store.listeners = store.listeners || []).push(fire); return noop;
};
export const serverTimestamp = () => Date.now();
export const runTransaction = async (db, fn) => {
    const writes = [];
    const tx = { get: async (r) => snapDoc(r.path), set: (r, v) => writes.push([r.path, v, false]), update: (r, v) => writes.push([r.path, v, true]) };
    const out = await fn(tx);
    for (const [p, v, merge] of writes) store.fs[p] = merge ? { ...store.fs[p], ...v } : v;
    (store.listeners || []).forEach(f => f());
    return out;
};
export const ref = (db, path) => { paths.push('db:' + path); return { path }; };
export const get = async (r) => { const v = store.db[r.path]; return { val: () => (v === undefined ? null : v), exists: () => v !== undefined }; };
export const onValue = (r, next, err) => {
    setTimeout(() => {
        if (r.path === 'gameRooms') {
            if (store.roomsDenied) { if (err) err({ code: 'PERMISSION_DENIED' }); return; }
            // The test pushes the next snapshot of /gameRooms through this.
            globalThis.__admPushRooms = (rooms) => { store.db.gameRooms = rooms; next({ val: () => rooms }); };
            next({ val: () => store.db.gameRooms || null });
        }
        else if (r.path === '.info/connected') next({ val: () => true });
        else if (r.path === 'online') next({ val: () => store.db.online || null });
        else next({ val: () => (r.path === '.info/serverTimeOffset' ? 0 : (store.db[r.path] ?? null)) });
    }, 0);
    return noop;
};
export const set = async () => {};
export const remove = async (r) => {
    removals.push('db:' + r.path);
    const [top, id] = r.path.split('/');
    delete store.db[r.path];
    if (id && store.db[top] && typeof store.db[top] === 'object') delete store.db[top][id];
    if (top === 'gameRooms' && globalThis.__admPushRooms) globalThis.__admPushRooms({ ...(store.db.gameRooms || {}) });
};
`;
    const now = Date.now();
    const today = Math.floor(now / 86400000);
    const XSS = '<img src=x onerror="window.__xss=1">';
    const seedStore = {
        user: { uid: 'boss', email: 'berk@admin.ers-card-game.web.app' },
        fs: {
            'admins/boss': { note: 'owner' },
            // v3.24.0: one finished match (Ayşe dropped, Blitz won) and one page error of hers.
            'match_log/room_AAA111_1790000000000': {
                roomId: 'room_AAA111_1790000000000', tableId: 'AAA111', playerIds: ['h1', 'p2'], winner: 2,
                players: [{ uid: 'h1', name: 'Host', bot: false, cards: 0 }, { uid: 'p2', name: 'Ayşe', bot: false, cards: 4 }, { uid: '', name: 'Blitz', bot: true, cards: 48 }],
                startedAt: now - 20 * 60000, endedAt: now - 60000, expireAt: now + 29 * 86400000, disconnects: 1, god: null, houseRules: 'doubles'
            },
            'client_errors/p2': { e0: { m: 'TypeError: boom', src: 'ui.js', line: 12, at: now - 5000, mode: 'bots' }, count: 1, v: '3.24.0', updatedAt: now - 5000 },
            'leaderboard/boss': { username: 'Berk', totalScore: 3 },
            'leaderboard/p2': { username: 'Ayşe', totalScore: 7 },
            'wallets/p2': { coins: 100, owned: ['classic', 'golden'], earnDay: today, earnedToday: 40, spinDay: -1 },
            'coin_grants/OLD1': { to: 'p2', by: 'boss', amount: 100, before: 0, after: 100, note: '=HYPERLINK("x")', at: now - 60000 },
            'multiplayer_tables/AAA111': {
                tableId: 'AAA111', hostId: 'h1', hostUsername: 'Host', createdAt: now - 3 * 3600e3,
                players: [{ uid: 'h1', name: XSS, index: 0 }, { uid: 'p2', name: 'Ayşe', index: 1 }, { uid: 'bot_1', name: 'Blitz', index: 2 }],
                playerIds: { h1: true, p2: true }, gameState: { status: 'playing', playerCount: 2, roomId: 'ROOM01' }
            },
            'multiplayer_tables/BBB222': {
                tableId: 'BBB222', hostId: 'p3', hostUsername: 'Ok', createdAt: now - 60000,
                players: [{ uid: 'p3', name: 'Ok', index: 0 }], playerIds: { p3: true }, gameState: { status: 'waiting', playerCount: 1 }
            },
            'multiplayer_tables/CCC333': {
                tableId: 'CCC333', hostId: 'p4', hostUsername: 'P4', createdAt: now - 60000,
                players: [{ uid: 'p4', name: 'P4', index: 0 }, { uid: 'x/../admins', name: 'Sneaky', index: 1 }],
                playerIds: { p4: true }, gameState: { status: 'waiting', playerCount: 2 }
            },
            // v3.22.3: old enough to close, but its host is connected (online/p5).
            'multiplayer_tables/DDD444': {
                tableId: 'DDD444', hostId: 'p5', hostUsername: 'P5', createdAt: now - 2 * 3600e3,
                players: [{ uid: 'p5', name: 'P5', index: 0 }], playerIds: { p5: true }, gameState: { status: 'waiting', playerCount: 1 }
            }
        },
        db: { 'presence/h1': 'offline', 'presence/p2': 'online', 'presence/p3': 'online', 'presence/p4': 'online',
              // v3.22.3: two tabs for Ayşe, one for p5; a lobby mirror with no table behind it.
              online: { p2: { '-Aaaaaaaaaaaaaaaaaaa': now - 120000, '-Bbbbbbbbbbbbbbbbbbb': now - 60000 }, p5: { '-Ccccccccccccccccccc': { at: now - 30000, t: now - 10000, s: 'menu' } },
                        // p6 is in a bot match that has lost a card (13+12+14+12 = 51).
                        p6: { '-Ddddddddddddddddddd': { at: now - 50000, t: now - 20000, s: 'bots',
                              g: { h: { 0: 13, 1: 12, 2: 14, 3: 12 }, p: 0, b: 0, a: 1, n: 33, o: false, e: 2, u: now - 3000 } } } },
              lobbyRooms: { AAA111: { tableId: 'AAA111', hostId: 'h1', gameState: { status: 'playing', roomId: 'ROOM01' } },
                            ORPH01: { tableId: 'ORPH01', hostId: 'gone', hostUsername: 'Gone', gameState: { status: 'waiting' } } },
              'lobbyRooms/AAA111': { tableId: 'AAA111', hostId: 'h1', gameState: { status: 'playing', roomId: 'ROOM01' } },
              gameRooms: { ROOM01: {
                  hostId: 'h1', playerIds: { h1: true, p2: true }, activePlayerId: 0, lastPlayTime: now, gameOver: false,
                  players: [
                      { uid: 'h1', name: XSS, cards: [{ rank: 5, suit: 'spades' }, { rank: 9, suit: 'hearts' }], status: 'online' },
                      { uid: 'p2', name: 'Ayşe', cards: [{ rank: 7, suit: 'clubs' }], status: 'online' },
                      { uid: 'bot_1', name: 'Blitz', cards: [{ rank: 3, suit: 'clubs' }] },
                      { uid: 'bot_2', name: 'Kobra', cards: [{ rank: 2, suit: 'diamonds' }] }],
                  pile: [{ rank: 5, suit: 'hearts' }] } } }
    };

    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx2.route('**://www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: ADMIN_STUB }));
    await ctx2.route('**://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx2.route('**://fonts.gstatic.com/**', r => r.abort());
    await ctx2.addInitScript((s) => { globalThis.__ADM_STORE__ = s; }, seedStore);
    const p = await ctx2.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    const shots = process.env.SMOKE_SHOTS;
    try {
        await p.goto(`${base}/admin.html`);
        await p.waitForSelector('#adm-app:not([hidden])', { timeout: 8000 });
        const who = await p.textContent('#adm-who');
        if (!/berk/.test(who)) throw new Error('the panel did not greet the admin: ' + who);
        await p.waitForFunction(() => /AAA111/.test(document.getElementById('adm-problems').textContent), null, { timeout: 5000 });
        // v3.22.5: a broken bot match is a problem too, though it has no table or room.
        await p.waitForFunction(() => /bot maçında/.test(document.getElementById('adm-problems').textContent), null, { timeout: 5000 });

        await p.click('.adm-tab[data-view="tables"]');
        await p.waitForFunction(() => document.querySelectorAll('#adm-tables .adm-table').length === 4, null, { timeout: 5000 });
        const t = await p.evaluate(() => ({
            text: document.getElementById('adm-tables').textContent,
            imgs: document.querySelectorAll('#adm-tables img').length,
            xss: window.__xss,
            paths: window.__paths.slice()
        }));
        if (shots) await p.screenshot({ path: `${shots}/admin-tables.png`, fullPage: true });
        if (t.imgs || t.xss) throw new Error('a player name was rendered as HTML');
        if (!t.text.includes('<img src=x')) throw new Error('the hostile name is not shown as text');
        if (!/host-offline/.test(t.text) || !/stale-playing/.test(t.text) || !/ids-missing/.test(t.text) || !/bad-id/.test(t.text)) throw new Error('the table checks did not fire: ' + t.text.slice(0, 300));
        const bad = t.paths.filter(x => /\.\.|x\//.test(x));
        if (bad.length) throw new Error('a hostile id reached a database path: ' + bad.join(', '));

        // Live rooms: the list, the seats, and the feed a room change produces.
        await p.click('.adm-tab[data-view="rooms"]');
        await p.waitForFunction(() => /ROOM01/.test(document.getElementById('adm-room-list').textContent)
            && document.querySelectorAll('#adm-room-detail .adm-seatcard').length === 4, null, { timeout: 5000 });
        await p.evaluate(() => {
            const r0 = JSON.parse(JSON.stringify(globalThis.__ADM_STORE__.db.gameRooms.ROOM01));
            // Ayşe slaps and takes the pile (a 5 on a 5); the host drops out.
            const r1 = JSON.parse(JSON.stringify(r0));
            r1.players[1].cards.push({ rank: 5, suit: 'hearts' }, { rank: 5, suit: 'spades' });
            r1.players[0].cards = [{ rank: 9, suit: 'hearts' }];
            r1.pile = []; r1.lastWinReason = 'slap'; r1.players[0].status = 'disconnected';
            // ...the host's seat goes to a bot, and the game ends with Ayşe the winner.
            const r2 = JSON.parse(JSON.stringify(r1));
            r2.players[0].uid = 'bot_9'; r2.gameOver = true; r2.winnerIndex = 1;
            const one = (room) => ({ ROOM01: room });
            globalThis.__admPushRooms(one(r0));
            // (the first push after load only re-primes; now the real changes)
            const s1 = { ROOM01: { ...r0, pile: [...r0.pile, { rank: 5, suit: 'spades' }], players: r0.players.map((pl, i) => i === 0 ? { ...pl, cards: [{ rank: 9, suit: 'hearts' }] } : pl) } };
            globalThis.__admPushRooms(s1);
            globalThis.__admPushRooms(one(r1));
            globalThis.__admPushRooms(one(r2));
        });
        await p.click('#adm-rooms-finished');
        await p.waitForFunction(() => /Oyun bitti — kazanan Ayşe/.test(document.getElementById('adm-room-detail').textContent), null, { timeout: 5000 });
        const feed = await p.evaluate(() => ({
            text: document.getElementById('adm-room-detail').textContent,
            imgs: document.querySelectorAll('#adm-room-detail img').length,
            xss: window.__xss
        }));
        for (const want of ['yığını aldı (şaplak', 'bağlantısı koptu', 'koltuğunu bota devretti', 'Oyun bitti — kazanan Ayşe']) {
            if (!feed.text.includes(want)) throw new Error(`the room feed does not say "${want}": ` + feed.text.slice(0, 400));
        }
        if (feed.imgs || feed.xss) throw new Error('a player name in a live room was rendered as HTML');
        if (shots) await p.screenshot({ path: `${shots}/admin-live-room.png`, fullPage: true });
        await p.click('.adm-tab[data-view="overview"]');
        const globalFeed = await p.textContent('#adm-global-feed');
        if (!/ROOM01/.test(globalFeed) || !/kazanan Ayşe/.test(globalFeed)) throw new Error('the overview feed does not carry the room\'s events: ' + globalFeed.slice(0, 300));
        if (shots) await p.screenshot({ path: `${shots}/admin-overview.png`, fullPage: true });
        await p.click('.adm-tab[data-view="rooms"]');
        await p.evaluate(() => { document.querySelector('#view-rooms details.adm-card').open = true; });
        const deck = [];
        for (const s of ['spades', 'hearts', 'clubs', 'diamonds']) for (let r = 2; r <= 14; r++) deck.push({ rank: r, suit: s });
        const room = { hostId: 'h1', playerIds: { h1: true }, activePlayerId: 1, lastPlayTime: now, gameOver: false,
            players: [{ uid: 'h1', name: 'H', cards: deck.slice(0, 13) }, { uid: 'bot_1', name: 'B', cards: [] },
                      { uid: 'bot_2', name: 'C', cards: deck.slice(13, 30) }, { uid: 'bot_3', name: 'D', cards: deck.slice(30, 51) }] };
        await p.fill('#adm-room-json', JSON.stringify(room));
        await p.click('#adm-room-analyze');
        const verdict = await p.textContent('#adm-room-result');
        if (!/card-count/.test(verdict) || !/turn-empty/.test(verdict)) throw new Error('the room analysis missed a lost card or a stuck turn: ' + verdict.slice(0, 300));
        if (shots) await p.screenshot({ path: `${shots}/admin-room.png`, fullPage: true });

        // v3.22.3 (council ERS-30): who is online, and closing what is dead.
        await p.click('.adm-tab[data-view="online"]');
        await p.waitForFunction(() => document.querySelectorAll('#adm-online tbody tr').length === 3, null, { timeout: 5000 });
        const online = await p.evaluate(() => {
            const group = (t) => [...document.querySelectorAll('#adm-online .adm-online-group')].find(s => s.getAttribute('aria-label').includes(t));
            return { text: document.getElementById('adm-online').textContent, count: document.getElementById('adm-online-count').textContent,
                     mp: (group('Multiplayer') || {}).textContent || '', solo: (group('Tek oyunculu') || {}).textContent || '',
                     clock: document.getElementById('adm-clock').textContent, ping: document.getElementById('adm-ping').textContent };
        });
        // Ayşe (seated at AAA111) and P5 (hosting DDD444) are multiplayer; p6 in a bot match has no table and is solo.
        if (online.count !== '3' || !/Ayşe/.test(online.mp) || !/AAA111/.test(online.mp) || !/p5/.test(online.mp)
            || !/p6/.test(online.solo) || !/bot maçında/.test(online.solo) || !/tarayıcıda \(masa yok\)/.test(online.solo) || /p6/.test(online.mp)
            || !/kartlar 13·12·14·12/.test(online.solo) || !/card-count/.test(online.solo) || !/page-errors/.test(online.solo))
            throw new Error('the online list does not group players by kind of play: ' + online.text.slice(0, 400));
        if (!/saat uyumlu|cihaz saati/.test(online.clock) || /saat farkı/.test(online.clock) || !/gecikme/.test(online.ping))
            throw new Error('the clock chip still reads like a delay: ' + online.clock + ' / ' + online.ping);
        if (shots) await p.screenshot({ path: `${shots}/admin-online.png`, fullPage: true });

        await p.click('.adm-tab[data-view="tables"]');
        await p.waitForFunction(() => /ORPH01/.test(document.getElementById('adm-orphans').textContent), null, { timeout: 5000 });
        const cl = await p.evaluate(() => {
            const card = (id) => [...document.querySelectorAll('#adm-tables .adm-table')].find(a => a.textContent.includes(id));
            return {
                aaa: !!card('AAA111').querySelector('.adm-btn--danger'),
                bbb: !!card('BBB222').querySelector('.adm-btn--danger'),
                ddd: card('DDD444').textContent,
                sweep: document.getElementById('adm-tables-sweep').hidden ? '' : document.getElementById('adm-tables-sweep').textContent
            };
        });
        if (!cl.aaa || cl.bbb || !/Ev sahibi şu an bağlı/.test(cl.ddd) || !/\(1\)/.test(cl.sweep))
            throw new Error('the page offers the wrong tables for closing: ' + JSON.stringify(cl));
        await p.evaluate(() => [...document.querySelectorAll('#adm-tables .adm-table')].find(a => a.textContent.includes('AAA111')).querySelector('.adm-btn--danger').click());
        await p.click('#adm-confirm button[value="ok"]');
        await p.waitForFunction(() => !globalThis.__ADM_STORE__.fs['multiplayer_tables/AAA111'], null, { timeout: 5000 });
        const removed = await p.evaluate(() => globalThis.__removes.slice());
        if (removed.join(',') !== 'db:gameRooms/ROOM01,db:lobbyRooms/AAA111,fs:multiplayer_tables/AAA111')
            throw new Error('the close did not go room → lobby → table: ' + removed.join(','));
        if (shots) await p.screenshot({ path: `${shots}/admin-tables-closed.png`, fullPage: true });

        // v3.24.0 (council ERS-36): every step of that close left a record, and the
        // table's own delete rode in the same batch as its record.
        const log = await p.evaluate(() => {
            const fs = globalThis.__ADM_STORE__.fs;
            const acts = Object.entries(fs).filter(([k]) => k.startsWith('admin_actions/')).map(([k, v]) => ({ id: k.split('/')[1], ...v }));
            return { acts: acts.map(a => `${a.kind}:${a.target}:${a.by}:${a.reason}`), last: (fs['admin_state/boss'] || {}).lastActionId,
                     closeId: (acts.find(a => a.kind === 'close-table') || {}).id };
        });
        const wantActs = ['delete-room:rtdb:gameRooms/ROOM01:boss:ölü masa temizliği', 'delete-lobby:rtdb:lobbyRooms/AAA111:boss:ölü masa temizliği',
                          'close-table:multiplayer_tables/AAA111:boss:ölü masa temizliği'];
        if (JSON.stringify(log.acts) !== JSON.stringify(wantActs) || log.last !== log.closeId)
            throw new Error('the close was not logged step by step: ' + JSON.stringify(log));

        // "Multiplayer" is a real tab now: live, waiting, who, and finished matches.
        await p.click('.adm-tab[data-view="multiplayer"]');
        await p.waitForFunction(() => !document.getElementById('view-multiplayer').hidden
            && /AAA111/.test(document.getElementById('adm-mp-history').textContent), null, { timeout: 5000 });
        const mp = await p.evaluate(() => ({ stats: document.getElementById('adm-mp-stats').textContent, hist: document.getElementById('adm-mp-history').textContent,
                                             waiting: document.getElementById('adm-mp-waiting').textContent }));
        if (!/Canlı maç/.test(mp.stats) || !/🏆 Blitz/.test(mp.hist) || !/Ayşe/.test(mp.hist) || !/DDD444/.test(mp.waiting))
            throw new Error('the multiplayer tab does not show matches and tables: ' + JSON.stringify(mp).slice(0, 400));
        if (shots) await p.screenshot({ path: `${shots}/admin-multiplayer.png`, fullPage: true });

        // Moderation: a suspension, and an announcement that must not carry a link.
        await p.click('.adm-tab[data-view="moderation"]');
        await p.fill('#adm-ban-uid', 'p2');
        await p.fill('#adm-ban-reason', 'smoke ban');
        await p.click('#adm-ban-form button[type="submit"]');
        await p.click('#adm-confirm button[value="ok"]');
        await p.waitForFunction(() => !!globalThis.__ADM_STORE__.fs['bans/p2'], null, { timeout: 5000 });
        await p.fill('#adm-ann-en', 'Free coins at ers-card-game.web.app');
        await p.click('#adm-ann-form button[type="submit"]');
        const linkRefused = await p.evaluate(() => ({ problem: document.getElementById('adm-ann-problem').textContent,
                                                      written: !!globalThis.__ADM_STORE__.fs['config/announcement'] }));
        if (!/bağlantı/.test(linkRefused.problem) || linkRefused.written) throw new Error('a link reached the announcement: ' + JSON.stringify(linkRefused));
        await p.fill('#adm-ann-en', 'Maintenance tonight at 23.00');
        await p.click('#adm-ann-form button[type="submit"]');
        await p.click('#adm-confirm button[value="ok"]');
        await p.waitForFunction(() => !!globalThis.__ADM_STORE__.fs['config/announcement'], null, { timeout: 5000 });
        const mod = await p.evaluate(() => {
            const fs = globalThis.__ADM_STORE__.fs;
            const acts = Object.values(fs).filter(v => v && v.kind && v.target);
            return { ban: fs['bans/p2'], ann: fs['config/announcement'], kinds: acts.map(a => a.kind), bans: document.getElementById('adm-bans').textContent };
        });
        if (!mod.ban || mod.ban.reason !== 'smoke ban' || !(new Date(mod.ban.until).getTime() > now) || !mod.kinds.includes('ban')
            || !mod.ann || mod.ann.en !== 'Maintenance tonight at 23.00' || !mod.kinds.includes('announce') || !/ASKIDA/.test(mod.bans))
            throw new Error('the suspension or the announcement did not land with its record: ' + JSON.stringify(mod).slice(0, 400));
        if (shots) await p.screenshot({ path: `${shots}/admin-moderation.png`, fullPage: true });

        // Error reports.
        await p.click('.adm-tab[data-view="errors"]');
        await p.waitForFunction(() => /TypeError: boom/.test(document.getElementById('adm-errors').textContent), null, { timeout: 5000 });
        const errText = await p.textContent('#adm-errors');
        if (!/ui\.js:12/.test(errText) || !/bot maçında/.test(errText)) throw new Error('the error report is not shown in full: ' + errText.slice(0, 300));

        await p.click('.adm-tab[data-view="players"]');
        await p.fill('#adm-search', 'Ayşe');
        await p.press('#adm-search', 'Enter');
        await p.waitForFunction(() => /🪙 100/.test(document.getElementById('adm-player').textContent), null, { timeout: 5000 });
        const card = await p.textContent('#adm-player');
        if (!/ASKIDA/.test(card) || !/Son multiplayer maçları \(1\)/.test(card) || !/TypeError: boom/.test(card))
            throw new Error('the player card misses the suspension, the match or the error: ' + card.slice(0, 400));
        await p.fill('#adm-grant-amount', '50');
        await p.fill('#adm-grant-note', 'smoke test');
        await p.click('#adm-player .adm-grant .adm-btn--primary');
        await p.click('#adm-confirm button[value="ok"]');
        await p.waitForFunction(() => /🪙 150/.test(document.getElementById('adm-player').textContent), null, { timeout: 5000 });
        if (shots) await p.screenshot({ path: `${shots}/admin-player.png`, fullPage: true });
        const after = await p.evaluate(() => {
            const fs = globalThis.__ADM_STORE__.fs;
            const g = Object.entries(fs).filter(([k, v]) => k.startsWith('coin_grants/') && v.note === 'smoke test').map(([, v]) => v);
            return { coins: fs['wallets/p2'].coins, grants: g, lastGrantId: fs['wallets/p2'].lastGrantId };
        });
        const g = after.grants[0];
        if (after.coins !== 150 || !g || g.by !== 'boss' || g.amount !== 50 || g.before !== 100 || g.after !== 150 || !after.lastGrantId)
            throw new Error('the grant and its audit record disagree: ' + JSON.stringify(after));

        await p.click('.adm-tab[data-view="audit"]');
        const audit = await p.textContent('#adm-audit');
        if (!/smoke test/.test(audit) || !/=HYPERLINK/.test(audit)) throw new Error('the audit log does not list both grants');
        for (const w of ['masa kapatıldı', 'askıya alındı', 'duyuru yayınlandı', 'smoke ban'])
            if (!audit.includes(w)) throw new Error(`the audit log does not show "${w}": ` + audit.slice(0, 300));
        if (errs.length) throw new Error('page errors: ' + errs.join(' | '));
        console.log('         admin only; hostile name drawn as text; "x/../admins" never reached a path; 3 table checks; room analysis; online list; dead table closed room→lobby→table with 3 records; multiplayer tab; ban + announcement (link refused); error report; +50 audited');
    } finally { await ctx2.close(); }
});

// ── v3.24.0: what a player sees of the admin's powers ───────────────────────
// A variant of the inert stub: doc() keeps its path, the player's own ban
// document exists, and config/announcement carries text with markup in it.
// This is the only place the menu notice, the suspension line and the lobby's
// refusal are exercised in a real browser — the rules are proven in the
// emulator, the wiring only here.
await step('the menu shows the announcement and a suspension as text, and the lobby refuses a suspended player', async () => {
    const until = Date.now() + 3 * 86400000;
    const MENU_STUB = STUB
        .replace('export const doc = () => ({});', 'export const doc = (db, ...segs) => ({ path: segs.join("/") });')
        // A FUNCTION replacement: the text below contains '$&', which a string
        // replacement would expand into the matched text (the same trap banStatus.js guards).
        .replace('export const getDoc = async () => ({ exists: () => false, data: () => ({}) });',
            () => `export const getDoc = async (r) => (r && r.path === 'bans/banned1'
                ? { exists: () => true, data: () => ({ until: { toMillis: () => ${until} }, reason: 'smoke reason $& <b>x</b>', by: 'boss', at: 1 }) }
                : { exists: () => false, data: () => ({}) });`)
        .replace('export const onSnapshot = unsub;',
            `export const onSnapshot = (r, next) => {
                if (r && r.path === 'config/announcement') setTimeout(() => next({ exists: () => true, data: () => ({
                    en: '<img src=x onerror="window.__annxss=1"> Maintenance tonight at 23.00', level: 'warn',
                    until: { toMillis: () => ${until} }, by: 'boss', at: { toMillis: () => 12345 } }) }), 0);
                return () => {};
            };`);
    if (MENU_STUB === STUB || !MENU_STUB.includes("bans/banned1") || !MENU_STUB.includes('config/announcement'))
        throw new Error('the stub variant did not apply — firebase-stub.mjs changed shape');
    const ctx4 = await browser.newContext();
    await ctx4.route('**://www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: MENU_STUB }));
    await ctx4.route('**://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx4.route('**://fonts.gstatic.com/**', r => r.abort());
    await ctx4.addInitScript(() => { globalThis.__ERS_SMOKE_USER__ = { uid: 'banned1', email: 'b@x.io' }; try { localStorage.clear(); } catch (e) { /* */ } });
    const p = await ctx4.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    try {
        await p.goto(`${base}/index.html`);
        await p.waitForFunction(() => {
            const n = document.getElementById('site-notice'), b = document.getElementById('ban-notice');
            return n && !n.hidden && b && !b.hidden;
        }, null, { timeout: 10000 });
        const seen = await p.evaluate(() => {
            const n = document.getElementById('site-notice');
            const r = n.getBoundingClientRect();
            return { ann: document.getElementById('site-notice-text').textContent, level: n.dataset.level,
                     ban: document.getElementById('ban-notice').textContent, imgs: document.querySelectorAll('.menu-notices img').length,
                     xss: window.__annxss, inMenu: !!n.closest('#main-menu'), visible: r.width > 0 && r.height > 0 };
        });
        if (!/Maintenance tonight at 23\.00/.test(seen.ann) || seen.level !== 'warn' || !seen.inMenu || !seen.visible)
            throw new Error('the announcement is not shown in the menu: ' + JSON.stringify(seen));
        if (seen.imgs || seen.xss || !seen.ann.includes('<img')) throw new Error('announcement markup was rendered as HTML');
        if (!/smoke reason \$& <b>x<\/b>/.test(seen.ban)) throw new Error('the suspension reason is not shown verbatim, as text: ' + seen.ban);
        // The lobby refuses before the rules would, and says why.
        const code = await p.evaluate(() => import('./js/tableManager.js').then(m => m.TableManager.createTable()).then(() => 'created', e => e && e.ersCode));
        if (code !== 'BANNED') throw new Error('a suspended player was not refused a table: ' + code);
        // A dismissal sticks to this announcement.
        await p.click('#site-notice-close');
        const after = await p.evaluate(() => ({ hidden: document.getElementById('site-notice').hidden, key: localStorage.getItem('ers_ann_dismissed') }));
        if (!after.hidden || after.key !== '12345') throw new Error('the dismissal did not stick: ' + JSON.stringify(after));
        if (errs.length) throw new Error('page errors: ' + errs.join(' | '));
        console.log('         notice in the menu as text (markup inert), suspension line verbatim, lobby says BANNED, dismissal remembered');
    } finally { await ctx4.close(); }
});

await step('the admin page refuses a signed-in player who is not an admin', async () => {
    const ctx3 = await browser.newContext();
    await ctx3.route('**://www.gstatic.com/firebasejs/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
    await ctx3.route('**://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx3.route('**://fonts.gstatic.com/**', r => r.abort());
    await ctx3.addInitScript(() => { globalThis.__ERS_SMOKE_USER__ = { uid: 'player1', email: 'p@x.io' }; });
    const p = await ctx3.newPage();
    try {
        await p.goto(`${base}/admin.html`);
        await p.waitForFunction(() => /yönetici değil/.test(document.getElementById('adm-login-error').textContent), null, { timeout: 8000 });
        const appHidden = await p.evaluate(() => document.getElementById('adm-app').hidden);
        if (!appHidden) throw new Error('the panel opened for a non-admin');
        console.log('         a non-admin sees the sign-in card and a refusal, never the panel');
    } finally { await ctx3.close(); }
});

// Firebase is stubbed, so its own failures are expected noise. Anything else
// is a real defect.
//
// NEVER_IGNORABLE is declared beside the console listeners, because the boot
// net step needs it too.
const ignorable = (t) => !NEVER_IGNORABLE.test(t)
    && /offline stub|net::ERR|Failed to load resource|firebase/i.test(t);
const real = consoleErrors.filter(t => !ignorable(t));

console.log(`\n— console —\n  ${real.length} unexpected error(s)`);
real.slice(0, 20).forEach(e => console.error('    ! ' + e));

await browser.close();
server.close();

if (failures || real.length) {
    console.error(`\nsmoke: FAILED (${failures} step failure(s), ${real.length} console error(s))`);
    process.exit(1);
}
console.log('\nsmoke: OK');
