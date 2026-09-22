# Adversarial Council ERS-16 — "Which new feature, faithful to the design?"

Mode: in-conversation, full panel (5 judges, quorum 4). Date: 2026-09-22.
Raised by: the operator — *"oyun tasarım şemasına sadık kalarak oyuna yeni bir
özellik ekle"*. No feature was named; the choice was delegated to a Game
Designer lens (agentfires `game-designer`) and to this panel.
The design schema the proposal is measured against is `DESIGN.md` (v1), written
in the same session from evidence already in the repo.

---

## Step 0 — Analyst (baseline)

**The gap, in the project's own words.** `COUNCIL.md`, Product: *"Kazanma
dışında başarı metriği yok"* — marked partially solved by Slap IQ. Slap IQ is a
**report**: a score, three metrics, a per-pattern bar. It gives the player
nothing to aim at. A report nobody acts on is not a loop (DESIGN.md §2).

**Three candidates, each written as a mechanic spec.**

**A — Desen Ustalığı / Pattern Cartouches.** Each slap pattern active at the
table earns a cartouche with up to three marks (Bronze / Silver / Gold) when
the player's **coverage** of that pattern — patterns slapped ÷ patterns that
appeared — crosses thresholds. Shown in the Slap IQ panel. Each mark pays a
one-time coin grant. No new screen, no change to any match.

**B — Refleks Talimi / Slap Drill.** A new 60-second solo mode: cards flash,
slap on patterns, hold on the rest. Scored on hits, false slaps and median
reflex. A new screen.

**C — Ra'nın Lütfu / Skill-linked wheel.** A top-half Daily Challenge result
lets the next day's wheel start on Silver.

**Facts established by reading the source — not inferred.**

1. `slapForensics.ruleBreakdown()` already computes, per rule, `hit`, `missed`,
   `seen` and `rate`. Candidate A's measure exists today.
2. Those counters are **lifetime and cumulative** (`stats.hits`,
   `stats.missedChances`); there is no time window.
3. **Reflex is recorded globally, not per rule** (`stats.reflex`, last 40).
4. A missed chance is recorded when a pattern leaves the pile unclaimed, or a
   BOT wins it by slap. So coverage depends on how fast the bots are — i.e. on
   **difficulty** (`difficultyInForce()` in `matchContext.js`).
5. The Slap IQ panel has a **Reset stats** button that empties every counter.
6. `tutorialMode.js` (285 lines) already teaches every rule in isolation, and a
   test pins that practice never touches the shared `GameState`.
7. Every screen in the markup must be classified ad-allowed or ad-denied; a
   gate fails the build otherwise. A adds no screen; B adds one.
8. The Daily Challenge record is **client-authoritative** (CLAUDE §14.1) — the
   stored result can be edited in `localStorage`.

**Self-named risks.** No analytics: no outcome of any candidate can be measured
after shipping. The author of DESIGN.md is also the author of this proposal.

---

## Step 1 — Opposition (against A)

**O1 — A lifetime ratio is not a goal.** Fact 2. A player with 400 sandwiches
behind them moves their coverage by a quarter of a point per match. For anyone
who has played a while, the marks are already decided by history and nothing
they do this week changes them. A goal that cannot move is decoration — and a
mark earned in March says nothing about how they play today.

**O2 — The same mark would mean different things (G4).** Fact 4. On Easy the
bots give the player more time, so coverage is higher. A Gold cartouche earned
on Easy and one earned on Hard would look identical. DESIGN.md P4 exists
precisely because a comparison between unequal conditions is a lie.

**O3 — Coins plus a reset button is a farm (G3).** Fact 5. Earn marks → press
Reset → earn them again → collect the grant again. P3 says rewards are earned.

**O4 — "Renders but does nothing" (G5).** A cartouche that can never be earned
in some mode would be this repo's most expensive defect again (DECISIONS
#13/#48). Nobody has shown that a mark is *reachable* from a real stream of
game events.

**O5 — It is a badge, not a feature.** B trains the one skill directly (P1).

**Worst case.** A permanent, un-movable, farmable badge row that means
different things on different difficulties — presented as "mastery".

---

## Step 2 — Defense (for A)

**→ O1. Concede, and change the measure.** Lifetime is wrong for a *goal*.
Marks are judged on a **rolling window of the last 30 chances per pattern** —
new counters, alongside the lifetime ones, which the Slap IQ bars keep showing.
A mark is earned when the window crosses the line and, once earned, is **kept**:
it records that you did it. The window also gives the panel something that
moves after one match — "last 30: 21 caught".

**→ O2. Concede.** Chances count toward marks only where the standard is the
same for everyone: **Medium, Hard, Challenger, multiplayer and the Daily
Challenge**. Easy still coaches and still fills the Slap IQ bars; it simply does
not earn marks — and the panel **says so in one line** (G2), so nobody wonders.

**→ O3. Concede fully.** Grants are recorded in a **separate ledger** that
Reset does not clear. A mark pays once per device, ever. Reset clears your
statistics, not your history of having earned something.

**→ O4. Partially refute, accept the test.** The counters are fed by the same
events (`cardPlayed`, `pileWon`, `slapAttempt`) in every mode. But the panel is
right that "the events exist" is not proof. A test must drive a synthetic event
stream through the real module and **watch a mark unlock** — and watch it NOT
unlock on Easy.

**→ O5. Refute.** Fact 6: the rules are already taught in isolation. B would
add a screen (fact 7), four languages of copy and a second isolated game loop,
to train a skill the player already exercises in every real match. A points the
player's attention at the pattern they miss *during real play* — where the
skill is actually measured.

**Strength the opposition passed over.** A creates a **decision** where there
was none (Game Designer: *"never add complexity that doesn't add meaningful
choice"*): "my Sandwich is at 19/30, I'm going to watch for it". B and C do not
change what the player looks at on the table.

**On C.** Fact 8. C attaches an economic reward to a client-authoritative score
in the one system whose whole point is fairness (P1, P4). It gives players a
reason to tamper with the board. The defense does not support C.

---

## Steps 3–4 — Cross-examination

**Q1 (Opp).** "Once earned, kept." Then a mark is a trophy, not a rank. Why not
let it fall when the window falls?
**A1.** Because a mark that can be taken away punishes an off night, and the
window already shows current form right next to it. Trophy for the achievement,
bar for the form — two different questions, each answered once.

**Q2 (Opp).** Your window adds new counters to a store at `STORE_VERSION = 1`.
What happens to a player who already has data?
**A2.** The new fields default to empty through the same spread `load()`
already does. The window starts at zero; no mark is granted from lifetime
history. That is the honest reading: "we did not measure this before".

**Q3 (Opp).** Thresholds. Where do the numbers come from?
**A3.** They are the Slap IQ grade bands the game already uses (C 40 / B 55 /
A 70 / S 85): Bronze = 55%, Silver = 70%, Gold = 85% of the last 30. Reused,
not invented — and marked as tuning levers in the spec.

**Q4 (Def → the weakest opposition claim).** O5 calls A "a badge". A badge that
changes where you look on the next hand is a mechanic. What does B change about
a real match?
**A4 (Opp).** Nothing directly. Conceded as a scope argument; B remains the
better *training* tool and should stay on the list.

---

## Step 5 — Judges

**J1 — logic / evidence · Partially Defensible · High.**
Every objection that landed was answered by a change to the design rather than
by argument, and every change is grounded in a fact from Step 0. What remains
unproven is reachability — the defense itself asked for it.
Decisive: *"A test must drive a synthetic event stream through the real module and watch a mark unlock."*

**J2 — risk · Defensible · Medium.**
A touches no match, no timing, no server and no shared record. Its worst
remaining failure is a mark that is hard to reach — reversible in a tuning
change. C carries the only serious risk on the table and was rejected by both
sides.
Decisive: *"C attaches an economic reward to a client-authoritative score in the one system whose whole point is fairness."*

**J3 — feasibility · Partially Defensible · High.**
Small and buildable in one release: new counters beside existing ones, one
panel section, four languages of a handful of strings, a ledger key. But the
rolling window, the difficulty filter and the separate ledger are three things
that must ALL ship, or O1–O3 return.
Decisive: *"Grants are recorded in a separate ledger that Reset does not clear."*

**J4 — skeptic · Partially Defensible · High.**
Default against. The proposal as first written failed three of the six gates
in its own design document (G3, G4, G5). It is defensible only as amended, and
only if the amendments are pinned by tests — a promise in a council transcript
is not a property of the code.
Decisive: *"A lifetime ratio is not a goal."*

**J5 — balancer · Partially Defensible · Medium.**
The opposition was right about every weakness of A-as-written and wrong only
about its category. B is a good idea at the wrong size for now; C is the wrong
idea. A-as-amended is the smallest thing that turns an existing report into a
goal.
Decisive: *"A points the player's attention at the pattern they miss during real play."*

---

## Step 6 — Tally

| Verdict | Judges |
|---|---|
| Partially Defensible | J1, J3, J4, J5 |
| Defensible | J2 |

Quorum 5/5. Majority **Partially Defensible**, 4–1. High-confidence judges in
the majority: 3 → strength **Strong**.

### Verdict: PARTIALLY DEFENSIBLE (Strong) — build A, as amended

**B deferred** (right idea, wrong size now). **C rejected.**

Six conditions, each of which must be a test, not a sentence:

1. **Rolling window.** Marks are judged on the last **30** chances per pattern,
   not on lifetime counters.
2. **One standard.** Only Medium / Hard / Challenger / multiplayer / Daily
   chances count toward marks; Easy does not — and the panel says so in one line.
3. **No farm.** A separate grant ledger that Reset does not clear; each mark
   pays once.
4. **Reused thresholds.** Bronze 55% / Silver 70% / Gold 85% — the Slap IQ grade
   bands already in the code, read from one place.
5. **Reachable, measured.** A test drives synthetic events through the real
   module: a mark unlocks on Medium, does NOT unlock on Easy, and pays once.
6. **No new visual language.** It lives in the existing Slap IQ panel, on the
   shared panel surface (P6).
