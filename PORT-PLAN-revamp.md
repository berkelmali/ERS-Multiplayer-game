# ers-revamp → ers-web: what to port, and what not to

Adversarial council review. Subject: the plan for merging `D:\neww\ers-revamp`
into the live project.

---

## Step 0 — Analyst: the shared factual baseline

`ers-revamp` is **not** a fork with divergent history. It is a snapshot of
`ers-web` taken before v3.11.0, plus four additions. Measured, not assumed:

| | Finding |
|---|---|
| Files only in revamp | `public/js/dailySpin.js`, `public/manifest.webmanifest`, `public/sw.js` |
| Files only in ers-web | `tools/check-promises.mjs`, `RELEASE-3.11.0.md`, `RELEASE-3.12.0.md`, `.claude-memory/*` |
| New CSS selectors | **46**, all under `.spin-*`, `.tier-*`, `.wheel-*`, `.coin-badge`, `.modal-close-btn`, `.player-banner-group`, `.arcade-*` |
| `style.css` raw diff | 5949 added / 5766 removed lines — but only 46 new *selectors*, so the churn is reordering, not a rewrite |
| `ui.js` diff | **+20 / −2 lines.** Two features: a photo-finish banner, and an `.on-fire` class at streak ≥ 3 |
| `main.js` diff | +9 lines: `DailySpin.init()` and a service-worker registration |

**The four additions:**

1. **Ra's Daily Spin** — 496 lines, a 3-tier canvas wheel, daily-gated, awarding
   5–200 coins.
2. **PWA** — a web manifest plus a service worker with a precache list and a
   mixed cache-first / network-first fetch strategy.
3. **Photo-finish banner** — a centre-screen "⚡ PHOTO FINISH" callout when two
   slaps land within milliseconds, self-retiring after 2400 ms.
4. **Arcade restyle** — chunky 3D-shadow menu buttons (`.arcade-gold`,
   `.arcade-emerald`) and rounded pills for the secondary row.

**What the revamp does NOT contain:** every change from v3.11.0 (Slap Back In,
`check-promises`) and v3.12.0 (the whole account card). Its `index.html` still
carries `btn-signin`, `btn-signup` and `register-actions`.

---

## Step 1 — Opposition

**O1. The port direction is backwards, and the diff hides it.**
Because revamp predates two releases, `index.html`, `ui.js`, `main.js` and
`style.css` all differ for *two* reasons at once — features added, and features
not yet present. Any file copied wholesale silently reverts finished work. The
account card alone was 1625 tests and 12 mutations of effort; it would be gone
without a single test failing, because the tests that pin it would be
overwritten in the same copy.

**O2. The spin writes to the coin ledger without going through it.**
`cardSkins.js` owns `COINS_KEY = 'ers_coins'`, is the only writer, and emits
`coinsUpdated` on every save. `dailySpin.js` does:

```js
const currentCoins = parseInt(localStorage.getItem('ers_coins') || '0', 10);
localStorage.setItem('ers_coins', (currentCoins + winningSegment.coins).toString());
```

Three consequences. No `coinsUpdated` event, so every listener is blind to the
award. `CardSkins` may hold coins in memory and write them back, clobbering the
spin. And the spin repaints the balance itself with
`el.textContent = ${newCoins}` — a bare number, where `shopUI.js` renders
`🪙 0`; the two disagree until the next shop render.

**O3. It ships this project's signature defect, twice.**
`document.querySelectorAll('.user-coin-balance, #shop-coin-balance, #banner-coins')`
— `.user-coin-balance` appears nowhere in ers-web except inside that selector.
And `.photo-finish-banner` is written into the markup, given `display:block` and
`.active` by `ui.js`, and **has no CSS rule anywhere in the revamp**. Code that
renders and does nothing is the single most expensive recurring defect in this
codebase's history.

**O4. The service worker fights the deploy model, and is already broken offline.**
`firebase.json` sends `Cache-Control: no-store` on `/` deliberately, so a deploy
reaches players immediately. A service worker is the opposite bet. Worse, the
precache list holds `./style.css` while `index.html` requests
`style.css?v=3.12.0` — a **different cache key**. Offline, the page loads and
the stylesheet does not. `main.js` also hardcodes `sw.js?v=3.12.0`, a fourth
place a version string must be kept in step with three others that a gate
already checks. And the CSP declares no `worker-src`.

**O5. The whole spin is monolingual.**
Every string is Turkish, in `dailySpin.js` and in the markup: *"Ra'nın Şans
Çarkı"*, *"Her gün bir kez çevir!"*, *"Bugünlük şansın bitti..."*. The file
imports `Localization` and never calls it. English, German and Russian players
get Turkish. `check-locales` cannot catch this — the strings are not keys.

**Worst realistic case:** a wholesale merge reverts v3.11.0 and v3.12.0, ships a
dead banner and a dead selector, hands three of four languages a Turkish modal,
and installs a service worker that pins a stale build on players' devices with
no stylesheet offline.

---

## Step 2 — Defense

**On O1 — conceded, and it decides the method.** The port must be
feature-by-feature, never file-by-file. `ui.js` is +20/−2; those twenty lines can
be applied by hand. `index.html` and `style.css` are additive-only: take the new
blocks, touch nothing else.

**On O2 — conceded, and it is four lines.** `CardSkins` already exposes the
right seam. The spin calls it and deletes its own persistence and repaint.

**On O3 — conceded, and one of the two is already gated.**
`.photo-finish-banner` is a class in markup with no stylesheet rule, which is
exactly what `check-orphan-classes` (gate 8/10) fails on — the gate written in
v3.10.0 for this precise defect would have refused the build. `.user-coin-balance`
is a JS-side selector no gate covers; it goes, because O2's fix removes the line
containing it.

**On O4 — partially conceded, and it splits cleanly.** The manifest and the
service worker are separable. `manifest.webmanifest` is 18 lines of static JSON:
it makes the game installable, adds a home-screen icon and a splash colour, and
carries **no** caching behaviour and no risk. The service worker is a different
proposition with a real cost, a genuine bug, and no urgency.

**On O5 — conceded.** Roughly 20 strings across four languages. The pattern is
established; `localization.js` already carries 17 keys added this week.

**Ignored context worth stating:** the underlying work is good. A 3-tier wheel
with a canvas renderer, a daily gate and a tier-up mechanic is a real feature,
and the arcade buttons address something the lobby genuinely lacked. The
objections are all about *seams*, not about the ideas.

---

## Steps 3–4 — Cross-examination

**Opposition → Defense.** *"You call the manifest zero-risk. It sets
`"start_url": "./index.html"`. `firebase.json` runs `cleanUrls: true`, and this
project has a recorded finding that `/index.html` redirects to `/` — an
installed app would launch through a redirect on every cold start, and the
`no-store` header is on `/`, not on `/index.html`."*

**Defense.** Correct, and it is a one-word fix: `"start_url": "./"`. That the
objection is answerable by editing a single JSON value is the argument for
taking the manifest and leaving the worker.

**Defense → Opposition.** *"You framed the spin as an economy risk. Coins are
`localStorage` only — `cardSkins.js` never writes them to Firestore. A player
who edits their own coin balance in DevTools affects nobody. Is O2 a security
objection or a correctness one?"*

**Opposition.** A correctness one, and it is stronger for it: the failure is not
cheating, it is two writers to one key with no coordination, which produces
balances that disagree between screens for honest players. But one point stands
on design rather than correctness — `cardSkins.js` records a deliberate decision
to make coin-farming unattractive, and `window.DailySpin.reset()` clears the
daily gate from the console. That is a product decision, not a bug, and it
belongs to the user, not to the merge.

---

## Step 5 — The panel

**J1 — logic and evidence.** Every opposition claim is grounded in a measured
fact, and the defense concedes four of five outright. The decisive line is the
defense's own: *"The port must be feature-by-feature, never file-by-file."* The
plan is defensible only in that form. **Partially Defensible. High confidence.**

**J2 — risk.** The asymmetry is stark. Spin, banner, buttons and manifest are
all additive and reversible: delete the file, drop the block. The service worker
is the only item that persists on devices *after* it is removed and can pin a
broken build — it needs an explicit unregister path to undo. The decisive
argument: *"Offline, the page loads and the stylesheet does not."* A feature
whose whole purpose is offline use, that is broken offline, is not ready.
**Not Defensible as written; Defensible with the worker excluded. High confidence.**

**J3 — feasibility.** Measured, the work is small: +20/−2 in `ui.js`, 46 CSS
selectors, one new file, ~20 locale keys, four lines to reroute the coins. The
one thing that would make it infeasible is the wholesale copy, and the plan
already rules that out. **Defensible. High confidence.**

**J4 — skeptic.** My default is against, and the strongest objection is O3,
because it is not a matter of taste: the revamp ships a banner with no
stylesheet. That is the same defect class as `check-lobby`'s three dead
selectors and v3.10.0's seven unstyled classes. But the defense's answer is the
one I cannot argue with — *the gate written in v3.10.0 for this precise defect
would have refused the build.* The project's own machinery catches it. That is
what a gate is for, and it moves me off "no". **Partially Defensible. Medium confidence.**

**J5 — balancer.** Both sides are right about different objects. The opposition
is right about the *merge*; the defense is right about the *features*. The
correct resolution is not a verdict on "the revamp" at all — it is four separate
verdicts, because the four additions have nothing in common but a folder.
**Partially Defensible. High confidence.**

**Tally: 4 of 5 Partially Defensible (J2 conditional on excluding the worker).
Quorum 5/5. Strength: Strong** — four majority judges at High confidence.

---

## Verdict

Port three of four. Defer the fourth.

### Tier 1 — port, with the fixes the review named

| Feature | Conditions |
|---|---|
| **Photo-finish banner** | Add the missing `.photo-finish-banner` CSS. Replace hardcoded `⚡ PHOTO FINISH:` with the `photoFinish` key that already exists in four languages. |
| **`.on-fire` aura** (streak ≥ 3) | Has CSS. Port as-is. |
| **Arcade buttons** | Port the 46 selectors. Keep the per-button inline hues — verify Shop gold / Daily blue / Slap IQ mint / Practice purple still read as four colours, and that `check-lobby` stays green. |
| **Web manifest** | Change `start_url` to `"./"` before shipping. |
| **Ra's Daily Spin** | Route every award through `CardSkins`, not `localStorage`. Delete the `.user-coin-balance` selector and the self-repaint. Translate ~20 strings into four languages. Keep the daily gate. |

### Tier 2 — defer

**The service worker.** Not because a PWA is wrong, but because this one is
broken at the job it exists for: it precaches `./style.css` while the page
requests `style.css?v=…`, so the offline page has no stylesheet. Shipping it
also trades away instant deploys — the property `no-store` on `/` was chosen
for — and a service worker is the one thing here that outlives its own removal.
Worth doing properly, later, with the version query strings respected and an
unregister path.

### Not in scope, and deliberately

`window.DailySpin.reset()` clears the daily gate from the console, and
`cardSkins.js` carries a recorded decision about not making coins farmable.
Whether a daily wheel fits that economy is a product call, not a merge call.
Flagged, not decided.
