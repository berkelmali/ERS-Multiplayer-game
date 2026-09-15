# Adversarial Council — v3.16.5 ("Challenge a friend" becomes a challenge)

Mode: in-conversation, full panel (5 judges, quorum 4). Date: 2026-09-15.

---

## Step 0 — Analyst (baseline)

**Type.** A feature proposal for a live game, in two parts.

**A. The share link becomes a Daily Challenge link.**
Today `buildShareText()` ends with `.replace('{url}', window.location.origin)` —
the site root. Proposal: `https://ers-card-game.web.app/?daily=YYYY-MM-DD`, read
at boot in `main.js`, opening the Daily Challenge panel.

**B. The two share buttons merge.** `btn-share-result` (a 1080×1080 PNG drawn in
`resultCard.js`) and `btn-challenge-share` (plain text) become one control that
sends the image and the text together through `navigator.share`.

**Why.** The Daily Challenge deals every player the same position from the same
seed, so "I took 123 cards" is only a comparable claim there. The button is
named "Challenge a friend" and currently sends a brag plus a homepage link.

**Facts established by reading the source.**
- `buildScenario(seed)` is a pure function of the date string — any day's board
  is reproducible.
- `dailyChallenge.startRun()` already has an unscored path:
  `this.scored = !this.hasPlayedToday();`
- `refreshDate()` runs at the top of `startRun()` and resets to `todayKey()`.
- `?join=` already occupies the boot region, with a peek/consume distinction
  fixed twice in earlier releases.

**Self-named risks.** The shared date may be in the past; the desktop share path
is a fallback, not the main path; there is no analytics, so nothing here can be
measured after shipping.

---

## Step 1 — Opposition

**O1 — The link still does not deliver the board it brags about.** The whole
case is "same deck, fair comparison". But the proposal opens *today's* challenge
regardless of the date in the link. A friend who clicks after UTC midnight gets
a different deal from the one the message describes. That is the same defect as
today — a link that does not lead to your game — with machinery on top, and it
is now *dressed* as a challenge, so it misleads more than a bare homepage link
did.

**O2 — The minority case is the one being designed for.** People open messages
hours later, often the next day. So "clicked while the board is still live" is
the uncommon path, and the design spends its complexity there while the common
path gets an apology notice.

**O3 — Merging the buttons trades a working control for an unproven one.**
`navigator.canShare({files})` is false in most desktop browsers, so the image
path is the *exception* and the fallback is the rule. And the proposed fallback
does two different things from one press — writes the clipboard and starts a
file download. This project has refused that kind of surprise elsewhere.

**O4 — Nothing here can be measured.** No analytics, no event logging. After
shipping, there is no way to know whether the new link is shared or followed
more than the old one. "Better mentality" is an aesthetic claim.

**O5 — The boot region is load-bearing and has been wrong twice.** `?join=`
carries a peek/consume distinction, a hashchange listener and an auth-ordering
rule, each added after a live bug. Adding a second parameter there risks the
invite flow — a feature people actually use — for a share button nobody but the
author has asked about.

**Worst case.** The invite path regresses and multiplayer invites silently stop
working, in exchange for a share link that still sends the wrong board.

---

## Step 2 — Defense

**→ O1. Concede, and fix the design rather than the copy.** The objection is
correct and it is fatal to the proposal *as written*. The fix is available and
small, because the pieces already exist: `buildScenario` is pure, and `scored`
is already a variable rather than a constant. The link should carry the date,
and when that date is past the panel should offer the shared board as an
**unscored replay** — "Berk played 15 Sep. Play that exact board (not scored),
or play today's." The only thing that must never happen is recording a past
board under today's key. That is a guard on `refreshDate()` plus
`this.scored = false`, not a new mode.

**→ O2. Concede, and note it strengthens O1's fix.** If most clicks arrive late,
then the late path is the product, and the replay is not a nicety.

**→ O3. Partially concede.** The merge should not ship in the same round as the
link. Two reasons: the desktop fallback's double action is a real surprise, and
merging removes a control that works today in exchange for a path that is the
exception on desktop. Keep both buttons; revisit the merge on its own evidence.

**→ O4. Concede fully.** The document should say plainly that this is a
coherence fix — the button's name matching what it does — and claim no
conversion gain. There is no instrument, so there is no claim.

**→ O5. Refute in part, concede a test.** The `?daily=` read is a pure read of
`location.search` at boot: no storage write, no auth dependency, no hashchange
requirement, and it never touches `savePendingInvite` or `consumePendingInvite`.
But the concern is legitimate at the seam, so a gate must pin that a URL
carrying *both* parameters still resolves as an invite, and that the invite path
is unchanged.

**Strengths the opposition passed over.** The current state is a button whose
name promises something the code does not do — this project's oldest defect
class, pointed at the player instead of at a crawler. And the fix reuses
existing, tested machinery rather than adding a subsystem.

---

## Steps 3–4 — Cross-examination

**Q1 (Opp).** You concede O1 is "fatal to the proposal as written", then propose
a larger change. Why should the panel rule on a design that appeared during its
own defense?
**A1.** It should rule on the document, and the document overclaims — Partially
Defensible is the correct verdict for it. The amendment is recorded so the
implementation is not mistaken for what was submitted.

**Q2 (Opp).** "A guard on refreshDate() plus scored = false, not a new mode."
That is the sentence carrying the whole feasibility claim. What breaks if it is
wrong?
**A2.** If the guard is wrong in the permissive direction, a replayed board gets
recorded under today's key and the player loses their real attempt at today's
challenge — a user-visible, unrecoverable-for-that-day bug. That is why the
replay must be asserted by a test that plays a past date and checks the record
key is untouched, rather than by reading the code.

**Q3 (Opp).** You dropped the merge. Was that the evidence, or the path of least
resistance?
**A3.** The evidence: `canShare({files})` is false on most desktop browsers, so
the merged button's normal desktop behaviour is the fallback, and that fallback
does two things at once. The user asked for the merge and should be told the
panel's reasoning rather than have it quietly dropped.

**Defense → weakest opposition claim.** O5's worst case — "invite silently stops
working" — is stated without a mechanism. The invite path reads the hash and the
query through `parseInviteCode`; a new, separately-named parameter does not
enter that function. The risk is real enough to gate, not real enough to block.

---

## Step 5 — Judges

**J1 — logic / evidence · Partially Defensible · High.**
The central claim ("same deck, fair comparison") is not supported by the
submitted design, which opens today's board whatever the link says. Conceded,
not answered, and the repair is a different proposal.
Decisive: *"the proposal opens today's challenge regardless of the date in the link."*

**J2 — risk · Partially Defensible · High.**
The dangerous edge is precise and named: a replayed board recorded under today's
key costs the player their real attempt, and cannot be undone that day. That is
worse than the defect being fixed. Acceptable only with the test the defense
itself demanded.
Decisive: *"the player loses their real attempt at today's challenge."*

**J3 — feasibility · Defensible · Medium.**
Both halves are small and reuse tested machinery: `buildScenario` is pure,
`scored` is already a variable, and the boot read is a pure read. Dropping the
merge from this round reduces scope further.
Decisive: *"`this.scored = !this.hasPlayedToday();`"*

**J4 — skeptic · Partially Defensible · High.**
Default against. The document's own headline justification collapsed under the
first objection, and O4 was conceded outright — there is no instrument, so no
claim about outcome survives. What is left is a coherence argument, which is
real but much smaller than what was submitted.
Decisive: *"'Better mentality' is an aesthetic claim."*

**J5 — balancer · Partially Defensible · Medium.**
Both sides are right about different halves: the opposition about the submitted
link, the defense about the underlying defect. A button named "Challenge a
friend" that challenges nobody is worth fixing; the version that fixes it is not
the version submitted.
Decisive: *"a button whose name promises something the code does not do."*

---

## Step 6 — Tally

| Verdict | Judges |
|---|---|
| Partially Defensible | J1, J2, J4, J5 |
| Defensible | J3 |

Quorum 5/5. Majority **Partially Defensible**, 4–1. High-confidence judges in
the majority: 3 → strength **Strong**.

### Verdict: PARTIALLY DEFENSIBLE (Strong)

Ship the link. Five conditions:

1. **The shared date must be playable.** A past date opens the panel offering
   that exact board as an **unscored replay**, beside today's. Without this the
   link still lies and the change is not worth making.
2. **A test must play a past date and assert the record key is untouched.**
   Read-the-code is not enough; the failure costs the player a real attempt.
3. **A gate must pin the seam:** a URL with both `?join=` and `?daily=` resolves
   as an invite, and the invite path is unchanged.
4. **Do not merge the share buttons this round.** `canShare({files})` is false
   on most desktops, so the merged control's normal desktop behaviour would be a
   fallback doing two things at once.
5. **Claim coherence, not conversion.** There is no analytics; the release note
   must say so.
