# Hard control: is v3.13.0 fit to deploy?

Adversarial council review. Subject: the working tree at `release/v3.13.0`,
two commits ahead of `main`, not yet deployed. Live is v3.12.0.

Every finding below was **measured in a real browser before the debate opened**,
because this process has a stated limit: *the panel evaluates the transcript,
not the world.* A council that only re-argues what the author already believed
is theatre.

---

## Step 0 — Analyst: the shared factual baseline

**What is being reviewed.** A release adding four things to a deployed game:
Ra's Wheel (a daily coin wheel), a photo-finish banner, a three-slap deck aura,
and a PWA manifest. Plus two gate repairs and a share button.

**What the author claims.** 1821 unit tests green, eight deploy gates green,
smoke green over six consecutive runs, 15 mutations caught across the two new
test sections, 28 behavioural checks in a real browser. The release notes state
the game is now installable to a phone home screen.

**Measured facts, gathered for this review:**

| | Measurement | Result |
|---|---|---|
| M1 | `public/assets/logo.png` dimensions | **298 × 113** — not square, below Chrome's 144px install minimum |
| M2 | Manifest served and icon loaded in-browser | 200, `application/manifest+json`, icon loads at 298×113 |
| M3 | One `slapPhotoFinish` event, elements visible after 400ms | **toast z9998 at y377–523 AND banner z9997 at y196–236, both visible, same sentence** |
| M4 | `position` of the nine body-level overlays | seven `fixed`; **`confirm-modal` and `invite-modal` are `absolute`** |
| M5 | Day key at 2026-09-09T22:30Z, TZ Europe/Istanbul | wheel `Thu Sep 10 2026`, daily challenge `2026-09-09` — **different days** |
| M6 | Three spins after `localStorage.removeItem('ers_last_spin_date')` | coins **0 → 30**; those coins buy shop skins |
| M7 | CSP violations and console errors on load | none |

**Implicit assumption the release makes:** that a green gate set is evidence of
readiness. Seven of the eight gates read source text or layout; none of them can
see an icon's pixel dimensions, a duplicated announcement, or a timezone.

---

## Step 1 — Opposition

**O1. The release ships a capability that does not exist, and claims it.**
The manifest is served correctly and the icon loads — and Chrome will still
never offer to install the game, because 298×113 is neither square nor ≥144px.
This is the exact defect class the project has spent five releases building
gates against: *code that renders and does nothing.* It is worse here than in
any previous instance, because previous instances were silent. This one is
**asserted**: `deploy.bat` line 802 instructs the operator to verify *"Telefonda
'Ana ekrana ekle': uygulama adı ve ikonu gelmeli"* — a check written to pass
that cannot pass. The author manufactured a false confirmation step.

**O2. The photo-finish banner is a third announcement of a fact already stated
twice.** Measured: for one slap, the 2.8rem centre toast and the new banner are
on screen simultaneously, in the same language, saying the same thing, forty
pixels of vertical gap apart — plus a log line. The port's justification was
that the banner "had no CSS and therefore did nothing"; the fix was to give it
CSS. Nobody asked whether the game needed it at all. A feature ported because it
was *there* is not a feature the game was missing.

**O3. A comment in the shipped stylesheet overclaims, and the overclaim is
load-bearing.** `html { overflow-x: clip }` carries the justification *"this file
has eleven fixed overlays that depend on it not changing."* Measured: two of the
nine body-level overlays — `confirm-modal` and `invite-modal` — are
`position: absolute`. The count is wrong and the category is wrong. The comment
exists to stop a future maintainer switching `clip` to `hidden`; a maintainer who
checks it will find it false and trust the rest of the file less.

**O4. Two "daily" features reset at different moments.** Measured at 01:30
Istanbul: the wheel has flipped to the 10th, the Daily Challenge is still on the
9th. `dailyScore.todayKey()` is UTC *on purpose* — there is a test named
"todayKey does not drift with local time" — and the wheel was written with
`toDateString()` without anyone asking which convention the game already had.

**O5. The wheel's daily limit is one line in DevTools, and it prints money the
shop accepts.** Measured: three spins, 30 coins, no reset needed beyond removing
one key. `cardSkins.js` carries an explicit design decision about making coins
non-farmable; this release added a coin faucet without consulting it.

**Realistic worst case.** The release deploys. A player installs nothing, because
the install prompt never appears. The operator ticks the install check anyway
because the release notes told them to expect it, and the false confirmation
enters the project's record. Meanwhile the shop economy is open, and the game now
shouts the same slap result at the player three ways.

---

## Step 2 — Defense

**On O1 — conceded entirely, and it is the most serious thing here.** The claim
is worse than the defect. The honest options are three: ship a 512×512 icon,
remove the manifest, or keep the manifest and delete the claim. The first is
correct but requires an asset that does not exist in the repo; the third is
dishonest by omission if the release notes still imply installability.

**On O2 — partially conceded.** The measurement is right and the double
announcement is real. But the conclusion does not follow: the toast is
`text-transform: uppercase` at 2.8rem across the middle of the screen, which is
the game's *loudest* channel, used for winner announcements and disconnections.
A photo finish is a smaller event. The defensible fix is not to delete the
banner — it is to stop using the loudest channel for it, which is a one-line
change and arguably an improvement over what shipped in v3.12.0.

**On O3 — conceded, and it is trivial to fix.** The number should be measured
rather than remembered. That the author wrote "eleven" from memory in a file that
this project audits mechanically is itself the finding.

**On O4 — conceded.** The wheel should use `todayKey()`. There is no argument
for two conventions; the only question is which, and the project already answered
it in `dailyScore.js` with a comment explaining why.

**On O5 — partially conceded, and this one is a product decision, not a bug.**
Coins are `localStorage` only and never reach Firestore — a player who edits
their own balance affects nobody else, and the leaderboard is unaffected. The
`cardSkins.js` note concerns *per-match* reward farming, which is a different
mechanism. But the objection stands in one respect: a daily wheel gated by a
client-side date string is decoration, not a limit, and the release notes should
not imply otherwise.

**Context the opposition ignored.** Five of the seven measurements above exist
*because* this release built the instruments that found them — the overlay walk,
the animation-keyframe check, the port's own comment discipline. And three
defects the port inherited (the coin ledger bypass, the dead `.user-coin-balance`
selector, the monolingual canvas) were caught and fixed before shipping. The
process is working; this review is that process continuing, not a failure of it.

---

## Step 3 — Cross-examination, round 1 (Opposition → Defense)

> *"You write: 'The process is working; this review is that process
> continuing.' The manifest shipped, was committed, and a verification step was
> written for it — the process had three chances and took none of them. On what
> evidence is it working?"*

**Defense.** The evidence is that the eight gates are all source-and-layout
gates and this defect is neither. No gate in this project reads a PNG header. The
honest answer is not "the process worked" but "the process has a shape, and this
fell outside it" — which is the argument for a ninth gate, not for the claim I
made. I withdraw the sentence.

> *"You propose 'stop using the loudest channel' for the photo finish. That
> leaves two announcements instead of three. Why is two right?"*

**Defense.** It is not obviously right, and I will not defend a number I have not
measured. The banner and the log line serve different readers — one is glanceable
mid-match, one is scrollback. The toast is the one with no distinct job here.

---

## Step 4 — Cross-examination, round 2 (Defense → Opposition)

> *"Your O5 worst case says 'the shop economy is open'. It was open before this
> release: `CardSkins.getCoins()` has always read a localStorage integer any
> player could set. What did the wheel change?"*

**Opposition.** Conceded — the wheel did not open it; it was already open. What
changed is only that the game now presents a rate limit it does not enforce. I
downgrade O5 from a defect to a documentation problem: do not describe it as a
daily limit in the release notes.

---

## Step 5 — The panel

**J1 — logic and evidence.** Every opposition point is grounded in a
measurement, and the defense concedes four of five outright and the fifth in
cross-examination. The decisive exchange is the defense's own withdrawal:
*"The honest answer is not 'the process worked' but 'the process has a shape,
and this fell outside it'."* A release whose central defence is withdrawn under
one question is not ready as it stands. **Not Defensible as it stands. High
confidence.**

**J2 — risk.** Ranking by reversibility: O1 is the only finding that ships a
*false statement* — the others ship suboptimal behaviour that a player absorbs
silently. A wrong instruction in `deploy.bat` is worse than a missing feature,
because it manufactures a confirmation that enters the project's own record and
is trusted later. Decisive: *"a check written to pass that cannot pass."*
Everything else here is a same-day fix with no external consequence.
**Not Defensible until O1 is resolved; Defensible after. High confidence.**

**J3 — feasibility.** Measured against effort, four of the five are minutes:
`todayKey()` for the wheel, a corrected comment, dropping one `showNotification`
call, and a release-note wording change. O1 alone needs a decision, not just
code — and one of its three options (delete the claim, keep the manifest) is also
minutes. Nothing here justifies holding the wheel, the share button or the gate
repairs, which are independently sound. **Partially Defensible. High
confidence.**

**J4 — skeptic.** My default is against, and I looked for the reason this panel
is being generous. I did not find one: the strongest objection, O1, was conceded
in the first sentence of the defense rather than argued down, which is what an
author does when the finding is undeniable. What moves me off a flat "no" is
narrow and specific — the four non-O1 findings are all *quality* rather than
*correctness*, and the release's engine, rules, scoring and Firebase paths are
untouched, which the measurements confirm (no CSP violations, no console errors,
1821 tests). **Partially Defensible. Medium confidence.**

**J5 — balancer.** Both sides are right about different objects, and the split
is clean: the opposition is right about the *claims*, the defense is right about
the *code*. Nothing measured here says the wheel is broken, the share button is
broken, or the gates are broken — they were each tested and mutated. What is
broken is the accounting: a manifest presented as installability, a limit
presented as a limit, a comment presenting a count it did not check. Decisive:
*"The claim is worse than the defect."* Fix the accounting and the release is
sound. **Partially Defensible. High confidence.**

**Tally.** Valid verdicts 5/5, quorum satisfied.
Not Defensible **2** · Partially Defensible **3** · Defensible 0.
Majority: **Partially Defensible**, with three High-confidence judges in it —
**Strength: Strong.**

Both dissenting judges (J1, J2) condition their objection on the same single
finding, and both state that resolving it changes their verdict.

---

## Verdict

**Do not deploy as it stands. Five fixes, four of them minutes.**

| | Fix | Why it blocks or does not |
|---|---|---|
| **1** | **Resolve the install claim.** Either ship a ≥192×192 square icon, or keep the manifest and delete every claim of installability — the release note and the `deploy.bat` verification step. | **Blocking.** It is the only finding that puts a false statement into the project's record. |
| 2 | Wheel uses `dailyScore.todayKey()` (UTC), like the other daily feature. | Not blocking, but it is a one-line change and the alternative is two conventions in one game. |
| 3 | Drop the photo-finish `showNotification` call; keep the banner and the log line. | Not blocking. The loudest channel should stay for winner and disconnection. |
| 4 | Correct the `overflow-x: clip` comment: nine body-level overlays, seven fixed, two absolute. | Not blocking. A false comment in an audited file is a small debt that compounds. |
| 5 | Release notes must not call the wheel a daily *limit*. | Not blocking. It is a client-side date string and the notes should say so. |

**What the panel explicitly did not fault.** The wheel, the share button, the
aura, the two gate repairs and the de-flaked overlay walk were each tested,
mutated and measured; no judge raised one. The engine, rules, scoring and
Firebase paths are untouched.

**Honest limit of this review.** Every finding came from measurements taken
before the debate. A defect nobody thought to measure is still invisible to all
five judges — the icon was found by reading a PNG header on a hunch, and there
is no gate that would have found it. Item 1's real fix is arguably a ninth gate,
not a bigger icon.
