# Adversarial Council — v3.16.3 (boot safety net)

Document under review: `PROPOSAL-v3.16.3.md`
Mode: in-conversation, full panel (5 judges, quorum 4)
Date: 2026-09-15

---

## Step 0 — Analyst (neutral baseline)

**Type.** A scoped change proposal for a live production web game: one
condition in one file, plus one new test section.

**Purpose.** Stop the failure of a non-essential resource from replacing the
whole game with a fatal "could not start" screen.

**Main claims.**
1. The boot net's condition does not implement the intent its own comment states.
2. A Google Fonts failure reaches the fatal screen — reproduced in a headless browser.
3. The affected population is non-trivial (blockers, corporate networks, China).
4. It is a live AdSense-review risk.
5. The 12-second timeout makes the net safe to narrow.
6. The test runs the real predicate rather than a copy of it.

**Supporting data.** `index.html` lines 17, 30, 31, 32 and 1129; one reproduction
producing `failed to load https://fonts.googleapis.com/...`.

**Audience.** The project owner, deciding whether to ship now.

**Implicit assumptions.** That a `location.origin` string prefix is a sound proxy
for "the app's own files"; that a headless reproduction generalises to real
browsers; that Google's renderer would hit the same path.

**Self-named risks.** Three, in §Honest limits: two unmeasured table rows, a
narrowed safety mechanism, and a sandbox test that cannot prove browser behaviour.

---

## Step 1 — Opposition (opening)

**O1 — The only measurement in the document is contaminated.** In the
environment that produced the font error line, gstatic was *also* unreachable,
and `main.js` statically imports Firebase from gstatic. The app would have
failed regardless; the font was merely the first error to fire. The document
warns that the proposal "must not be sold on rows that were not measured" — and
then sells row 32 on a run that cannot distinguish font-fatal from firebase-fatal.

**O2 — The affected population is asserted, not measured.** "Blanket-blocked by
several ad and tracker blockers … unreachable in China" carries no source, no
number, no analytics. The project's own standard is measure-don't-argue; this
paragraph is argument wearing measurement's clothes.

**O3 — The AdSense claim is the weakest link and carries the most urgency.** The
proposal fears Google's renderer will fail to fetch Google Fonts — from Google.
That is the single most reliable fetch in the document. Attaching a pending
review to an unrelated fix is motivated reasoning.

**O4 — The change makes a class of real failure quieter.** Today the net fires
in under a second and prints the failing URL. After the change, a same-origin
non-stylesheet failure falls into a 12-second blank wait ending in
"application did not start", with no URL. The document calls this "later and
with a vaguer message" and moves on. Trading a precise instant signal for a
vague delayed one is a regression in the instrument — the second time this
session that a degraded instrument has produced a degraded conclusion.

**O5 — `url.indexOf(location.origin + '/') === 0` is a string test standing in
for an origin comparison.** It is right today only because same-origin URLs
happen to serialise that way. This is the project's signature defect: a string
pattern used where a semantic match was meant — the same shape as `**/*.html`
failing to match `/tr/rules`.

**Worst case.** The guard is narrowed, a genuine startup failure lands in the
12-second path, a user reports "the page is just black", and the team no longer
has the URL that would have named it.

---

## Step 2 — Defense (point by point)

**→ O1. Concede, and it is the strongest point made.** The run cannot separate
the two failures. But the defect does not rest on the run — it rests on the
source: `isResource` is true for any `LINK`, which is a static reading needing
no network. The run shows the screen *can* be reached through a font URL; the
code shows it *must* be. What I should not have claimed is that the run proved
the app was otherwise healthy. The evidentiary weight moves from the run to the
source; the table row stands.

**→ O2. Partially concede.** The site has no analytics, so no number is
obtainable — a real gap, not a rhetorical one. But the claim does not need a
number: the change is justified if *any* user can lose the game to an optional
stylesheet, and the code says they can. The paragraph should be restated as a
mechanism, not a population estimate.

**→ O3. Concede entirely.** The paragraph comes out. Google fetching Google
Fonts is the least likely fetch to fail, and attaching a pending review to an
unrelated fix repeats precisely what the previous council convicted this project
of — "they said content, and what I built is navigation." Repeating that one
round later would be worse than the original.

**→ O4. Partially concede, and the remedy is cheap.** The regression is real,
but it follows from *removing* the reveal, not from narrowing it. A non-fatal
resource error can still be recorded into the tech line and surfaced if the
12-second path ever fires. Four lines, and the URL survives.

**→ O5. Refute on substance, concede on form.** It is not a semantic origin
comparison. But the standard-library equivalent is free:
`new URL(url, location.href).origin === location.origin`. There is no reason to
ship the string test.

**Strengths the opposition passed over.** One condition in one file, reversible
by reverting three lines; the 12-second backstop untouched, so no failure
becomes silent; and a test that extracts and runs the real predicate instead of
restating it — the v3.16.2 gate lesson applied rather than quoted.

---

## Step 3 — Cross-examination, round 1 (Opposition → Defense)

**Q1.** You concede the run cannot separate font-fatal from firebase-fatal, then
say "the *code* shows it must be." If the code alone settles it, why was the run
in the document — and what else here reads stronger than it is?

**Q2.** You now propose three amendments. A proposal needing three amendments to
survive its first opposition is not the document the panel was handed. Are the
judges ruling on the document or on your rebuttal?

**Q3.** You call it "fully reversible by reverting three lines." There is no
staging environment and deploys go straight to production. What is the actual
detection path for a regression that only appears on a user's network?

---

## Step 4 — Cross-examination, round 2 (Defense answers, then attacks)

**A1.** It was in the document because it is how I found the bug, and I let the
order of discovery stand in for the order of proof. That is the failure mode
this project logged twice already this session — a schema list read truncated,
and a stale fetch read as a stale site. The honest form: the source is the
evidence, the run is the anecdote that pointed at it. Nothing else rests on the
run; the four-row table is read from lines 17, 30, 31, 32.

**A2.** On the document. The amendments are concessions, not a new proposal —
two of them *delete* claims and one swaps a string test for the standard-library
equivalent. If the document as written overclaims, Partially Defensible is the
correct verdict regardless of what I would ship next.

**A3.** There is none, and it is the weakest part of the whole picture. No
analytics, no error reporting, no staging: the detection path is a user
complaining. That is itself an argument for the non-fatal-report amendment,
since it puts the URL on the user's screen where they can photograph it — which
is empirically how the last two bugs in this project were reported.

**Defense → the opposition's weakest opening claim.** O3 called the AdSense
framing "motivated reasoning". I concede the paragraph, but the
characterisation overreaches: the sentence was conditional, and the document
labels its own confidence per row. Motivated reasoning hides uncertainty; this
document printed it. The paragraph is wrong and should go — but it was wrong
openly.

---

## Step 5 — Judges (independent)

**J1 — logic / evidence · Partially Defensible · High.**
The central claim is a static reading of source and it holds. But the document
as submitted supports it with a contaminated reproduction and two unmeasured
table rows, both conceded under questioning.
Decisive: *"the reproduction cannot separate the two failures."*

**J2 — risk · Partially Defensible · High.**
Shipping risks a same-origin non-stylesheet failure falling into a 12-second
silence with no URL, on a site with no analytics, no staging and no error
reporting. Not shipping leaves a live dead-game path. The second is real today;
the first needs a resource the document does not yet contain. The
non-fatal-report amendment is therefore not optional.
Decisive: *"the detection path is a user complaining."*

**J3 — feasibility · Defensible · Medium.**
One condition, one file, no new dependency, and a test that runs the real
predicate in a sandbox rather than a restatement of it. The three amendments are
smaller than the original change.
Decisive: *"no new file and no import."*

**J4 — skeptic · Partially Defensible · High.**
Default against. The strongest objection, O1, was conceded rather than answered,
and a concession is not an answer. The AdSense paragraph — submitted as a reason
to act — was withdrawn entirely. A document whose urgency argument does not
survive questioning has not earned Defensible. The underlying defect is real;
the case for it was overbuilt.
Decisive: *"the AdSense paragraph should come out."*

**J5 — balancer · Partially Defensible · Medium.**
Both sides are right about different objects: the opposition about the document,
the defense about the defect. The distinction the panel must not blur is whether
the *code change* or the *document* is under review. The amended change is
sound; the submitted document overclaims in two places it has since withdrawn.
Decisive: *"the change is justified by row 32 alone."*

---

## Step 6 — Tally

| Verdict | Judges |
|---|---|
| Partially Defensible | J1, J2, J4, J5 |
| Defensible | J3 |
| Not Defensible | — |

Quorum: 5 / 5 valid. Majority: **Partially Defensible**, 4–1.
High-confidence judges in the majority: 3 (J1, J2, J4) → strength **Strong**.

### Verdict: PARTIALLY DEFENSIBLE (Strong)

The defect is real and the fix should ship. The document that argued for it
should not ship as written. Five conditions, all earned in the transcript:

1. **Delete the AdSense paragraph.** It attached a pending review to an
   unrelated fix — the same diagnosis-shift the previous council convicted.
2. **Restate the population claim as a mechanism**, not an estimate: a network
   that blocks `googleapis.com` yields a dead game. No numbers without analytics.
3. **Use a real origin comparison**, `new URL(url, location.href).origin ===
   location.origin`, not a string prefix.
4. **Keep reporting what is no longer fatal.** A non-fatal resource error still
   writes its URL into the tech line, so the 12-second path is not blind.
5. **Mark rows 17 and 30 as unverified** in the shipped comment. Only row 32 was
   measured.

### What the panel did not rule on

Whether the app is otherwise healthy when only the font fails. No measurement in
this transcript establishes it, and the defense conceded as much. If that
matters to the decision, it is a separate reproduction: block only
`fonts.googleapis.com` and leave gstatic reachable.

---

## Post-verdict measurement (run AFTER the panel ruled)

The judges ruled on the transcript above and their verdict is not retroactively
amended. This is new evidence, recorded separately, and it closes the gap the
panel named.

The reproduction the panel asked for, built from the real `index.html` with
exactly two edits — the font stylesheet repointed at a host that refuses, and
`js/main.js` replaced by a one-line stand-in that boots successfully. The inline
boot net itself was not touched.

```json
{ "booted": true,
  "fatalScreenShown": true,
  "techLine": "failed to load http://localhost:8098/definitely-not-here.css" }
```

**The app booted. The fatal screen covered it anyway.** `__ersBooted` was `true`
and the "could not start" notice was displayed, caused by nothing but a
stylesheet link.

Consequences for the verdict's conditions:

- **O1 is now answered rather than conceded.** The run that was contaminated has
  been replaced by one that isolates the variable. Row 32 no longer rests on an
  anecdote.
- **Condition 2 strengthens.** The mechanism is not "a blocked font may
  contribute to a failure" — it is "a blocked font hides a working game."
- **Conditions 1, 3, 4 and 5 are unchanged.** The AdSense paragraph still comes
  out, the origin comparison still needs to be real, non-fatal errors still need
  to report, and rows 17 and 30 are still unverified.

The verdict stands at **Partially Defensible (Strong)** — the defect is real and
now demonstrated, and the document that argued for it still overclaimed in the
two places the panel named.

---

## Post-verdict finding from the decision archive

Neither advocate raised this, so no judge could weigh it. It came out of the
searchable archive afterwards, which is what the archive is for.

Archive entry **#24 (2026-09-06)**: *"Boot safety net v3.7.0–v3.7.4 arası CSP
tarafından bloke edildi: hata ekranı hiç açılamadı."* The inline boot net was
rejected by the CSP on every production load for five releases, because
`script-src` carries no `'unsafe-inline'`. The remedy then was a hash, generated
rather than copied: `tools/csp-hash.mjs`, enforced by `deploy.bat` gate 6.

**Consequence for v3.16.3.** `firebase.json` pins the net by the exact bytes of
its source:

```
'sha256-0A/wLFqPfml++YGI8D5Fj91M5gwBY4svhP1C+HjWz1g='
```

Editing the condition changes those bytes. So the proposal's framing — "one
condition, in the same inline net, with no new file" — is wrong in a way that
matters: **v3.16.3 touches two files**, `public/index.html` and the CSP hash in
`firebase.json`, and the second is regenerated with `node tools\csp-hash.mjs
--write`, never typed.

This does not overturn J3's feasibility verdict; the regeneration is one
command, and the gate that catches a stale hash is already wired and green
(`check-csp-hash: OK`, verified). It does mean the exact failure this change
exists to prevent — a boot net that is present but cannot run — is also the
failure a careless version of this change would cause.

**Condition 6, added:** regenerate the CSP hash in the same commit, and confirm
`deploy.bat` gate 6 reports OK before deploying.
