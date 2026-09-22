# Adversarial Council — "Elimination should stop the match (Start with Bots)"

Mode: in-conversation, full panel (5 judges, quorum 4). Date: 2026-09-16.
Raised by: the operator, from the live site, with two screenshots.

---

## Step 0 — Analyst (baseline)

**The report.** In Start with Bots, after the human is eliminated, the
`(ELIMINATED)` screen appears — and a 2.8rem gold notice, *"CHAOS WON THE PILE
VIA CHALLENGE!"*, is drawn across it, covering the stats row and the
`Share Result` button. The operator's conclusion: *"oyun bitince, yani elimine
olunca oyun durmalı bence"* — elimination should end the match.

**Claim under review:** in bots mode, elimination should stop the match.

**Facts established by reading the source — not inferred.**

1. `game.js` does NOT end the match on human elimination. It emits
   `humanEliminated` and lets `activePlayers <= 1` remain the only terminal
   condition. This is deliberate and documented in a 20-line comment.
2. `victoryScreen.js` raises `show(99)` — the "eliminated, match still ongoing"
   screen. Its primary button is relabelled **Spectate**.
3. The match keeps running. `pileWon` keeps firing, and `ui.js` answers every
   one of them with `showNotification(...)`.
4. `#notifications` is `position: fixed`, **`z-index: 9998`**, `top/left: 50%`,
   `font-size: 2.8rem`, `pointer-events: none`. `.screen` tops out at 1000.
   So a notice is painted over EVERY screen, dead centre — including this one,
   where the stats and the share control also sit.
5. The rules panel carries a section headed "Spectator Mode & Slap Back" in
   **four languages**: *"Eliminated? Don't leave yet! ... a successful slap
   resurrects you with the pile!"*
6. That promise was unreachable until v3.11.0, which removed **four separate
   locks** to make it real (an early match end, a refused slap, a discarded
   winning slap, and `pointer-events: none` on the pile).

**Self-named risks.** The operator is the only reporter. There is no analytics.
The person who wrote v3.11.0 and the person defending it here are the same.

---

## Step 1 — Opposition (against stopping the match)

**O1 — It would re-break a promise the game makes in four languages.** The
rules text is not a comment; it is shipped copy, and 16 tests pin it. Stopping
the match makes "you can still slap back in" false again. That is the project's
oldest defect class — text that describes behaviour the code does not have —
and v3.11.0 exists specifically to close it.

**O2 — The complaint and the proposed remedy are not the same size.** What the
operator SAW was a notice covering the screen; their own words end with
*"popup falan geliyor"*. That is a layering defect: one element at z-index 9998
painted over a screen at 1000. The proposed remedy deletes a feature, rewrites
four translations and changes a documented council decision. Fixing a z-index
by removing a game mode is not proportionate.

**O3 — It would split one situation into two rules.** Multiplayer already has a
council-decided ending rule (v3.7.4: the match ends when no live human remains,
and nobody is crowned). Bots mode ending on the human's elimination would make
"eliminated" mean two different things in one product.

**O4 — It makes working code unreachable.** `slapOutcome.js` clears
`eliminated` when an eliminated seat takes the pile; `ui.js` and
`victoryScreen.js` both have resurrection handlers; `GameState.stats.resurrections`
feeds the `mvpComeback` badge. Stop the match and all of it becomes dead
wiring — which is the exact thing this repo has spent releases deleting.

**Worst case.** A documented, tested, four-language feature is removed to fix a
stacking-context bug, and the rules panel starts lying again.

---

## Step 2 — Defense (for stopping the match)

**→ O1. Partially concede.** The promise is real, but a promise nobody can act
on is not being kept either. On the screen the operator photographed, the match
IS running and the player can see none of it — the eliminated screen is opaque
and covers the table. The only way to reach the promised spectator mode is to
notice a button labelled *Spectate* underneath a notice that is covering it.

**→ O2. Refute in part.** The layering is the visible symptom, but not the
whole complaint. Behind that screen, bots keep taking piles and the match can
REACH ITS END while the player is still reading a blocking screen. Pressing
Spectate can therefore land on a finished match. That is a state bug, not a
z-index bug, and no amount of restyling the notice fixes it.

**→ O3. Concede.** Two meanings for "eliminated" would be worse than the bug.

**→ O4. Concede fully.** The resurrection path is live, tested code and
removing its only entry point would be deliberate dead wiring.

**Strength the opposition passed over.** The operator is not a bug reporter
here, they are the player. "I was eliminated and the game kept shouting at me
about a match I am no longer in" is a legitimate experience report even when
the mechanism behind it is working as designed.

---

## Steps 3–4 — Cross-examination

**Q1 (Opp).** You say "pressing Spectate can land on a finished match". Is that
measured, or reasoned?
**A1.** Reasoned from the source: nothing pauses the loop while screen 99 is up,
and `activePlayers <= 1` can be reached by the bots alone. NOT measured in a
browser. It should be recorded as a prediction, not a finding.

**Q2 (Opp).** If the notice were suppressed while screen 99 is up, what part of
the operator's report would remain?
**A2.** The part in A1, if it turns out to be real. Everything they actually
photographed would be gone.

**Q3 (Def → the weakest opposition claim).** O3 says splitting the rule is
unacceptable — but multiplayer keeps the match alive precisely because OTHER
HUMANS are still playing. In bots mode nobody is waiting. The situations are
not symmetric, so treating them identically is a choice, not a consistency
requirement.
**A3 (Opp).** Accepted as a fair hit. The asymmetry is real. It still does not
license removing the slap-back entry point, which is what the proposal does.

---

## Step 5 — Judges

**J1 — logic / evidence · Partially Defensible · High.**
The report is sound; the diagnosis is not. Four of the five facts the operator
saw are explained by one stacking rule, and the fifth (the match running on) is
reasoned, not observed.
Decisive: *"`#notifications` is `position: fixed`, `z-index: 9998` ... `.screen` tops out at 1000."*

**J2 — risk · Not Defensible · High.**
The proposal's worst case is a shipped four-language promise becoming false and
a tested feature losing its only entry point. The bug's worst case is an
obscured button. Those are not comparable, and the remedy is irreversible in a
way the bug is not.
Decisive: *"Fixing a z-index by removing a game mode is not proportionate."*

**J3 — feasibility · Partially Defensible · Medium.**
Both paths are small in code. But stopping the match also means rewriting the
rules copy in four languages and unpinning the tests that hold it — the edit is
cheap, the blast radius is not.
Decisive: *"the rules text is not a comment; it is shipped copy, and 16 tests pin it."*

**J4 — skeptic · Partially Defensible · High.**
Default against, and the defense's own best argument is unproven. A1 concedes
the "finished match behind a blocking screen" claim was never measured. A claim
that decides a design question must be measured before it decides it.
Decisive: *"NOT measured in a browser. It should be recorded as a prediction, not a finding."*

**J5 — balancer · Partially Defensible · Medium.**
Both sides own half. The operator is right that the screen is wrong; the
opposition is right about which part of it. The defense's one surviving
contribution is Q3's asymmetry — bots mode has nobody waiting — but that argues
for offering an ending, not for forcing one.
Decisive: *"'I was eliminated and the game kept shouting at me about a match I am no longer in' is a legitimate experience report."*

---

## Step 6 — Tally

| Verdict | Judges |
|---|---|
| Partially Defensible | J1, J3, J4, J5 |
| Not Defensible | J2 |

Quorum 5/5. Majority **Partially Defensible**, 4–1. High-confidence judges in
the majority: 2 → strength **Strong**.

### Verdict: PARTIALLY DEFENSIBLE (Strong)

**Do NOT stop the match.** Fix what the operator actually saw. Five conditions:

1. **Suppress the centre notice while the eliminated screen is up.** It is the
   whole of the photographed complaint: a 2.8rem notice at z-index 9998,
   centred over a screen whose stats and share button sit in that exact spot.
2. **Do not touch the resurrection path, the rules copy, or the multiplayer
   ending rule.** Nothing in this report justifies reopening any of them.
3. **MEASURE the unproven claim before acting on it:** can the match reach its
   end while screen 99 is up, so that pressing Spectate lands on a finished
   match? If yes, that is a separate defect and gets its own round. If no, the
   defense's strongest argument was wrong and should be recorded as such.
4. **Offer the ending, do not force it.** J5's point: bots mode has nobody
   waiting. The eliminated screen may carry a "Main Menu" exit — it already
   does — and that is the whole of the concession.
5. **Gate the property, not the instance.** The rule is not "hide this one
   notice". It is: a notice must not be painted over a screen that is itself
   asking the player to read something.

---

## Step 7 — Condition 3 discharged (measured after the verdict)

The panel refused to let the defense's strongest argument decide anything until
it was measured. It has now been measured, on the **live site**, by driving the
real modules in a real browser.

**Method.** Start a bots match; empty seat 0 and call `checkGameOver()` to
raise the eliminated screen; then, *while that screen is up*, empty seats 2 and
3 and call `checkGameOver()` again — forcing the match to end behind it. Poll
the screen once a second for six seconds.

**Result.**

| Step | Observed |
|---|---|
| seat 0 emptied | `victory-screen` active, title **"(ELENDİ)"**, `gameOver: false` |
| seats 2+3 emptied, screen 99 still up | **`gameOver: true`** — the match DID end behind the screen |
| +1s … +6s | title became **"YENİLGİ!"**, message **"Blitz oyunu kazandı!"**, stats panel rendered |

**Verdict on the claim.** The first half is true: the match can reach its end
while the eliminated screen is showing. The second half — *"pressing Spectate
can therefore land on a finished match"* — is **FALSE**. The ending replaces the
eliminated screen with the proper defeat screen within ~1.5s, unprompted. There
is no stranded state and no separate defect.

**So J4 was right to hold the line.** The defense's strongest argument was a
prediction, it was recorded as one rather than acted on, and when measured it
did not survive. Had it been accepted at face value it would have justified a
second round of work on a bug that does not exist.

**What survives, and it is the whole of it:** `#notifications` is `z-index:
9998`, `position: fixed`, centred at 50%/50%, `font-size: 2.8rem`; `.screen`
computes to `z-index: 1000`. Both numbers read from the live page. That single
stacking rule is the entire defect the operator photographed.

**Honest limit on this measurement.** The overlap geometry — exactly which
pixels the notice covers — was NOT reproduced here: the browser pane reported a
0x0 viewport, so every rectangle it returned was meaningless and is discarded.
The evidence that the notice covers the stats row and the share button is the
operator's screenshot, which shows it plainly. The z-index pair explains it; the
pixel measurement is not re-derived.
