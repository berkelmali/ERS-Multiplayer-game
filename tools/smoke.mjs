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

await step('ads land on menus, and on no measured screen', async () => {
    // Until v3.14.0 this step proved the opposite claim — an empty publisher id
    // meant no script, no request, no cookie — and it is kept in the same place
    // because the replacement claim is the one that now protects the game:
    // units on reading panels, never on a screen where something is timed.
    const visits = [
        ['#btn-shop', '#shop-panel', '#btn-shop-back'],
        ['#btn-rules', '#rules-panel', '#btn-rules-back'],
        ['#btn-slapiq', '#slapiq-panel', '#btn-slapiq-back']
    ];
    for (const [open, panel, close] of visits) {
        if (!(await page.$(open))) continue;
        await page.click(open);
        await page.waitForSelector(panel + '.active', { timeout: 5000 });
        await page.waitForTimeout(150);
        await page.click(close);
        await page.waitForSelector('#main-menu.active', { timeout: 5000 });
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
            denyOccupied: ['game-container', 'daily-panel', 'tutorial-screen', 'lobby-panel',
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

    // ONE lobby ad. This run is at 1280px, above the rail breakpoint, so the
    // lobby's ad is its two rails and its in-column banner must have stepped
    // aside. The phone case — banner, no rails — is the step below.
    const inLobby = seen.units.filter(u => u.where === 'main-menu');
    if (inLobby.length) throw new Error(inLobby.length + ' in-column banner(s) in the lobby at 1280px, want 0 (the rails are its ad)');

    // A rail asks for one fixed shape; a panel banner is responsive. Getting
    // these the wrong way round renders, and looks wrong to a human only.
    const rails = seen.units.filter(u => String(u.where).startsWith('RAIL:'));
    for (const r of rails) {
        if (r.format) throw new Error('a rail asked for data-ad-format=' + r.format);
        if (r.fullWidth) throw new Error('a rail asked to go full width');
        if (r.w !== '160px' || r.h !== '600px') throw new Error(`a rail is ${r.w} x ${r.h}, want 160px x 600px`);
    }
    for (const b of seen.units.filter(u => !String(u.where).startsWith('RAIL:'))) {
        if (b.format !== 'auto') throw new Error(`the banner on ${b.where} asked for ${b.format}`);
        if (b.w || b.h) throw new Error(`the banner on ${b.where} was given a fixed size`);
    }
    if (!adRequests.length) throw new Error('ads are on and nothing was ever requested');
    console.log(`         ${seen.units.length} units (${rails.length} rails), 1 script, 0 on a measured screen`);
});

await step('a phone gets the lobby banner, and no rails', async () => {
    // The lobby has one ad at any width and a different one at each: rails in
    // the gutter on a desktop, an in-column banner on a phone. Both are chosen
    // by CSS alone, so the only way to know which one a player actually gets is
    // to load the page at that width and look.
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

        const seen = await phone.evaluate(() => {
            const menu = document.getElementById('main-menu');
            const banner = menu.querySelector('.ad-slot');
            const on = el => el && el.getClientRects().length > 0;
            const b = banner ? banner.getBoundingClientRect() : null;
            const footer = document.getElementById('game-version');
            const f = footer ? footer.getBoundingClientRect() : null;
            return {
                bannerFilled: !!(banner && banner.classList.contains('filled')),
                bannerVisible: on(banner),
                bannerUnits: menu.querySelectorAll('ins.adsbygoogle').length,
                railsVisible: [...document.querySelectorAll('.ad-rail')].filter(on).length,
                railUnits: document.querySelectorAll('.ad-rail-slot ins.adsbygoogle').length,
                width: b ? Math.round(b.width) : 0,
                overlapsFooter: !!(b && f && b.bottom > f.top && b.top < f.bottom),
                scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                inTable: document.querySelectorAll('#game-container ins.adsbygoogle').length
            };
        });

        if (!seen.bannerFilled) throw new Error('the phone lobby got no banner at all');
        if (!seen.bannerVisible) throw new Error('the phone banner was filled but is not on screen');
        if (seen.bannerUnits !== 1) throw new Error(seen.bannerUnits + ' units in the phone lobby, want exactly 1');
        if (seen.railsVisible) throw new Error(seen.railsVisible + ' rail(s) visible on a 390px phone');
        if (seen.railUnits) throw new Error('a rail was filled on a phone — an invisible impression');
        if (seen.width > 390) throw new Error('the banner is ' + seen.width + 'px wide in a 390px window');
        if (seen.overlapsFooter) throw new Error('the banner sits on top of the version line');
        if (seen.scrollX > 0) throw new Error(seen.scrollX + 'px of horizontal overflow on a phone');
        if (seen.inTable) throw new Error('an ad unit is inside #game-container');
        if (!phoneAds.length) throw new Error('a phone made no ad request at all');
        console.log(`         390x844: 1 banner (${seen.width}px), 0 rails, 0px overflow`);
    } finally {
        await phone.close();
    }
});

await step('a zero-width lobby does not burn its one fill', async () => {
    // Found on the live site, not here: a browser pane with no width laid the
    // lobby banner out at 0 x 60 — one client rect, because min-height gives it
    // height — and AdSense answered "No slot size for availableWidth=0". The
    // screen was already marked filled by then, so the fill was gone for good.
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
                '\n#main-menu .ad-slot { width: 0 !important; max-width: 0 !important; }' });
        });
        await narrow.goto(base + '/', { waitUntil: 'domcontentloaded' });
        await narrow.waitForSelector('#main-menu.active', { timeout: 20000 });
        await narrow.waitForTimeout(2500);

        const collapsed = await narrow.evaluate(async () => {
            const { Ads } = await import('./js/ads.js');
            const slot = document.querySelector('#main-menu .ad-slot');
            return {
                width: Math.round(slot.getBoundingClientRect().width),
                rects: slot.getClientRects().length,     // the old predicate's answer
                filled: slot.classList.contains('filled'),
                units: slot.querySelectorAll('ins.adsbygoogle').length,
                screenMarked: [...Ads._filled].includes('main-menu'),
                waiting: Ads._pendingWidth.has('main-menu')
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
            css.textContent = '#main-menu .ad-slot { width: 100% !important; max-width: 728px !important; }';
            document.head.appendChild(css);
        });
        await narrow.waitForTimeout(1200);
        const after = await narrow.evaluate(async () => {
            const { Ads } = await import('./js/ads.js');
            const slot = document.querySelector('#main-menu .ad-slot');
            return {
                width: Math.round(slot.getBoundingClientRect().width),
                filled: slot.classList.contains('filled'),
                units: slot.querySelectorAll('ins.adsbygoogle').length,
                stillWaiting: Ads._pendingWidth.has('main-menu')
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
        // and each spin costs the animation's four seconds.
        for (const want of [0, 3, 6]) {
            localStorage.removeItem('ers_last_spin_date');
            localStorage.removeItem('ers_spin_tier');
            DailySpin.isSpinning = false;
            DailySpin.open();
            const segs = DailySpin.segments;
            const real = Math.random;
            Math.random = () => (want + 0.5) / segs.length;
            DailySpin.spin();
            Math.random = real;
            await sleep(4400);
            out.push({ want, saw: indexUnderPointer(segs.length),
                       prize: `${segs[want].coins} ${segs[want].type}` });
            DailySpin.close();
        }
        localStorage.removeItem('ers_last_spin_date');
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
    await page.click('#btn-privacy-back');
    await page.waitForSelector('#main-menu.active', { timeout: 5000 });
    console.log(`         ${p.words} words, names AdSense, gives an address, carries no ad`);
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
