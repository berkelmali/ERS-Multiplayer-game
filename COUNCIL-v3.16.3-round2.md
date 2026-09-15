# Adversarial Council — v3.16.3, round 2 (the implemented change)

What is under review this time is the **code as written**, not the proposal.
Mode: in-conversation, full panel (5 judges, quorum 4). Date: 2026-09-15.

---

## Step 0 — Analyst

**Type.** A shipped diff: `public/index.html` (the inline boot net), the CSP
hash in `firebase.json`, test section 66, `deploy.bat` notes, version bumps.

**What it does.** The fatal set becomes exactly *a same-origin `<script>`* and
*a same-origin `rel="stylesheet"`*, decided by `new URL(u, location.href).origin`.
Anything else is recorded and passed through. The 12-second backstop is untouched.

**Claimed support.** 2369 tests green; section 66 runs the real bytes in a vm
against link cases read out of the document; three mutations tried, three caught;
all six conditions from round 1 applied.

**Self-named risk.** The end-to-end browser before/after was never reproduced.

---

## Step 1 — Opposition

**O1 — There is a false "measured" written into the source file.** The comment
shipped in `index.html` said the app "BOOTED and the 'could not start' screen
covered it anyway." That run used a **same-origin** URL — which the new rule
fatals too, correctly — and a **stubbed stylesheet**, which removed
`#boot-error { display: none }`, so the element was visible no matter what the
net did. Both halves of the citation are invalid. A wrong claim in a comment
outlives the conversation that produced it and will be read as established.

**O2 — Section 66 is green about a thing it cannot see.** Every "does NOT hide
the game" assertion is a synthetic event dispatched at a predicate in a sandbox.
The user-visible behaviour — a real browser, a real blocked font, a game that
stays up — is precisely what six attempts failed to demonstrate.

**O3 — Two of the four rows are still unverified, and are now the subject of
production comments.** Narrowing something that may never have fired is noise
inside a security-adjacent mechanism.

**O4 — The "not fatal must not mean invisible" condition is only half-met.** The
recorded list reaches a screen only if the 12-second backstop fires — that is,
only when the app ALSO failed. In the normal case (font blocked, game boots
fine) `__ersBooted` goes true and nothing is ever reported. The condition that
round 1 called "not optional" is satisfied exactly where it is least useful.

**O5 — The edit lands in the most dangerous thirty lines in the project.** Every
byte here is pinned by a CSP hash, with a five-release precedent of getting that
wrong. The defect being fixed costs users a typeface.

**Worst case.** The comment's false citation is believed by a future reader, who
"restores" the old condition as an improvement.

---

## Step 2 — Defense

**→ O1. Concede, and treat it as stop-ship.** Correct on both counts. The
comment has been rewritten to separate what is established (the source reading,
the vm gate, the 92ms/739ms timing) from what is not (the end-to-end
reproduction), and to name each failed attempt so the next reader does not repeat
them. A false "measured" in a source file is worse than no claim.

**→ O2. Partially concede.** Section 66 does not restate the predicate — it
executes the same bytes the CSP hash covers, extracted by the same function, on
cases read from the document. But it cannot prove browser delivery, correct. One
half of that IS separately measured: in a real Chromium a cross-origin
stylesheet failure was confirmed delivered to the window at 92ms while boot
finished at 739ms, and under v3.16.3 the game stayed visible. The missing half is
the *old* condition failing in a live browser.

**→ O3. Concede.** They are narrowed because it costs nothing, and the comment
now claims no behaviour change for them.

**→ O4. Concede — the best engineering point in the round.** Fixed with one
line: the skipped URL is now `console.warn`-ed at the moment it is skipped,
inside a try/catch, so it is visible in the normal case instead of only in the
failure case. No coupling to `main.js`, no new file.

**→ O5. Refute.** The precedent exists *because* there was no gate. There are now
three: `csp-hash.mjs` regenerates rather than retypes, `deploy.bat` gate 6
refuses a stale hash, and section 66 asserts that the CSP admits the current
bytes. The hash was regenerated twice in this session and verified in step both
times.

---

## Steps 3–4 — Cross-examination

**Q1 (Opp).** You call O1 stop-ship, yet the same document already carried an
"Honest limits" section in round 1. Why did a false citation get written anyway?
**A1.** Because the limits I wrote were the ones I had thought of. The
contaminated run was not on that list — I believed it. The failure is not an
absent habit of hedging, it is that I cited discovery as proof, again. The
correction is structural, not attitudinal: the comment now names the four ways
the harness was wrong, so the claim cannot be re-inflated by someone reading it
later.

**Q2 (Opp).** If the end-to-end case cannot be reproduced, on what basis do you
assert the bug was ever user-visible?
**A2.** On the source, which is not in dispute: the old condition called
`reveal()` for any `<link>`, and `reveal()` sets `display: flex` on a full-screen
element. Plus the timing: the event arrives at 92ms, boot at 739ms, so the guard
is awake when it lands. What I cannot show in one run is the two composed.

**Q3 (Opp).** `console.warn` in production, in the net that must never depend on
anything?
**A3.** It is inside try/catch, and the sandbox proves the net survives a context
with no `console` at all — section 66 runs it in exactly such a context and stays
green.

**Defense → weakest opposition claim.** O5 calls a typeface the whole cost. The
cost is not the typeface: it is a full-screen notice, in two languages, telling
the user their connection dropped when it did not, with the game behind it.

---

## Step 5 — Judges

**J1 — logic / evidence · Partially Defensible · High.** The source reading is
exact and the vm gate is well-built. The false citation was caught by the panel
rather than by the author, and the composed claim is still unproven.
Decisive: *"Both halves of the citation are invalid."*

**J2 — risk · Defensible · Medium.** Worst case is now bounded: the backstop is
untouched, the hash is gated three ways, the narrowing is mutation-tested, and
the misleading comment — the one durable hazard — is removed. The remaining
exposure is a same-origin non-stylesheet resource added later, which does not
exist today.
Decisive: *"the 12-second backstop is untouched."*

**J3 — feasibility · Defensible · High.** Implemented, green, delivered: 2369
tests, 3/3 mutations, four source gates in step.
Decisive: *"three mutations were tried and all three were caught."*

**J4 — skeptic · Partially Defensible · High.** Default against. O4 was a real
hole in a condition round 1 declared "not optional", and it survived
implementation until an adversary found it. That the fix is one line is not
reassuring; it means nothing in the process caught it. And the headline claim
remains unreproduced after six attempts.
Decisive: *"satisfied exactly where it is least useful."*

**J5 — balancer · Defensible · Medium.** Every objection raised was either
conceded and fixed in the same round or answered on the record. What is left
unproven is a demonstration, not a mechanism, and the comment now says so in the
file itself. That is the correct resting state for a change of this size.
Decisive: *"the comment now claims no behaviour change for them."*

---

## Step 6 — Tally

| Verdict | Judges |
|---|---|
| Defensible | J2, J3, J5 |
| Partially Defensible | J1, J4 |
| Not Defensible | — |

Quorum 5/5. Majority: **Defensible**, 3–2. High-confidence judges in the
majority: 1 (J3) → strength **Moderate**.

### Verdict: DEFENSIBLE (Moderate)

Ship it. Two dissents are recorded and neither is about the code:

- **J1 and J4 both convict the process, not the diff.** The false citation and
  the half-met reporting condition were found by an adversary, in a round that
  only happened because it was asked for. A *Moderate* strength label is the
  honest reading of a 3–2 with one high-confidence judge in the majority — this
  is not a confident consensus.
- **The unreproduced end-to-end case stays open.** It is now written into the
  source comment as unproven rather than quietly dropped.

### Applied in this round

1. The comment's false "measured" replaced with an explicit
   established / not-established split that names all four harness failures.
2. `console.warn` at the moment a resource is skipped, in try/catch, so the
   normal case reports too.
3. CSP hash regenerated (`sha256-66XrvYbp…`) and verified in step.
4. Re-run: 2369 passed, 0 failed; pages fresh; links OK; hash in step.
