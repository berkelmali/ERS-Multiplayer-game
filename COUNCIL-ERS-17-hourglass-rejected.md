> **REJECTED BY THE OPERATOR, 2026-09-22 — never shipped.** The mode was built
> as ruled below and then cancelled: *"beğenmedim bu modu, daha yaratıcı olsun,
> oyunun konseptine uygun … Kum Saati iptal"*. Kept as a record so it is not
> proposed again: a reflex drill with no theme is not what this game wants.

# Adversarial Council ERS-17 — "A new mode that is more fun, and unlike the ones we have"

Mode: in-conversation, full panel (5 judges, quorum 4). Date: 2026-09-22.
Raised by: the operator — *"eğlenceyi arttırmak için yeni bi mod … challenge /
multiplayer / botlarla oyun dışında unique, alışılmamış bişe"*. The operator
delegated the choice to this panel ("konsey karar versin, tek başına da olabilir")
and asked for it to be built.
Measured against: `DESIGN.md` v1.1 (pillars P1–P6, gates G1–G6).

---

## Step 0 — Analyst (baseline)

**What already exists (read from `index.html` and `public/js/`).** Bot match
(four difficulties, Blitz option), multiplayer tables, the Daily Challenge,
Practice (a scripted tutorial), Ra's Wheel, Slap IQ with Pattern Mastery. Every
*playable* mode is the same shape: a full ERS match of 5–15 minutes. There is
no short-session mode at all.

**Three candidates, each written as a mechanic spec.**

**A — Firavun'un Merdiveni / Pharaoh's Ascent (roguelike run).** Five chambers,
each a timed 1-v-1 duel against a bot. Every chamber carries a *curse* (a rule
set change); after each win the player picks one of three *blessings* (fewer
burned cards, a longer shield, a forgiven false slap…). Lose a chamber, the run
ends. Modelled on the Balatro structure — a traditional card game with a run of
modifiers on top.

**B — Kum Saati / Hourglass (solo arcade survival).** No hands, no opponents.
Cards fall onto the pile on their own, faster and faster; the player only slaps.
Three lives. A false slap costs one; so does a pattern that is allowed to pass.
The run ends at zero lives; score is the number of catches.

**C — Mezar Bulmacaları / Tomb Puzzles.** Hand-built positions: "slap or not?",
"which card wins the challenge?". Stars per puzzle, a ladder of 30.

**Facts established by reading the source — not inferred.**

1. `tutorialMode.js` already runs **its own local pile on its own screen**, uses
   the real `evaluateSlap` from `slapRules.js` and the real card look, and
   *"deliberately does NOT touch the real GameState singleton or fire the shared
   'gameOver' / 'pileWon' / 'cardPlayed' events"*. B can be built on that exact
   pattern; A cannot — A is a variant of the match itself.
2. `game.js` (680 lines) owns penalties, shields and turn timers in one
   singleton that multiplayer also drives. Every blessing in A is a new branch in
   that file.
3. `HouseRules.lock()/setLocal({force})` already lets a mode own the rule set —
   the Daily Challenge does exactly this. Rule rotation (A's curses) is cheap.
4. `BotConfig.playDelay` is **1200 / 900 / 700 / 600 ms** for easy / medium /
   hard / challenger — an existing tempo ladder.
5. **Measured, not guessed** (200 000 random cards through the real
   `matchSlap`): with doubles + sandwich live, a pattern appears every **9.7
   cards on average, 1 in 10 gaps is 20+ cards**. With the four classic rules,
   every 7.2 cards, p90 14.
6. The Wikipedia list of ERS variants includes a **"three-strike system"** for
   invalid slaps — three lives is a rule people already play by, not ours.

---

## Step 1 — Opposition (opening)

1. **B, as specced, is boring — fact 5 proves it.** At 1200 ms a card and a
   pattern every 9.7 cards, the player watches ~12 seconds of nothing between
   catches, and one gap in ten is 24 seconds. A "rush" that is mostly waiting is
   the opposite of what the operator asked for.
2. **A is the most unusual and the most expensive.** Five blessings means five
   new branches in the match singleton multiplayer shares (fact 2). This
   project's most expensive defect class is "renders but does nothing" (P5,
   DECISIONS #13/#48, 12+ times); a blessing menu is five chances to repeat it.
   A 5 × timed-duel run is also 10+ minutes — not a new *kind* of session.
3. **C drops the one skill the game is about.** P1: *reflex is the only skill*.
   A puzzle is deliberate; it is a quiz about ERS, not ERS.
4. **B has an economy hole.** A 90-second arcade loop paying coins per catch
   out-earns a 10-minute match paying 40. G3 fails unless the grant is bounded.
5. **Whichever wins, it must not leak** into Slap IQ, mastery marks or the
   leaderboard, or it breaks P4 — a fast solo drill is not "the same board".

## Step 2 — Defense (rebuttal, point by point)

1. **Concede the spec, refute the verdict.** Fact 5 kills a *random* stream, not
   the mode. The fix is a **composed stream**: after each catch the next pattern
   is placed 2–5 cards ahead, and the filler between is drawn so it forms **no**
   pattern — verified by the same `matchSlap`, rerolled if it does. A catch every
   ~3.5 cards instead of ~9.7. Better still, the filler can be **near misses** —
   a 4 then a 5, a King then a Jack, 9·x·y·9 — so the quiet cards are a test of
   discipline, not a wait.
2. **Partially concede A.** Agreed on cost. But A's cheapest idea — *curses as
   rule rotation* — rides on fact 3 and costs nothing in `game.js`. It belongs in
   B.
3. **Concede C.** No defense offered.
4. **Concede and bound.** No coin per catch. Pay only for reaching a stage for
   the first time ever — derived from the win reward like Pattern Mastery
   (win ÷ 4, ÷ 2, × 1) — so the total is fixed and cannot be farmed.
5. **Agree — and it is free.** Built on the tutorial's isolation (fact 1), it
   fires none of the shared events. Local best only; no leaderboard.

**Strengths the opposition passed over.** B is the only candidate that creates a
**new session length** (1–3 minutes), which is what "one more go" needs. It is
the purest expression of P1: nothing but reading and reflex. And fact 4 gives it
a tempo ladder the player already knows by name: "you have reached Hard tempo".

## Step 3 — Cross-examination, round 1 (Opposition → Defense)

- **Q1.** *"The filler can be near misses."* Who decides what a near miss is? If
  the stream invents its own definitions it teaches something the game does not
  judge. — **A.** The same `matchSlap`: a decoy is a card sequence that *looks*
  like a live pattern (rank neighbour, K–J, sum 9 or 11, a gap of two) and that
  `matchSlap` returns **null** for. The judge never changes.
- **Q2.** *"Curses as rule rotation."* A rule switched off mid-run — how does
  the player know? A life lost to an unannounced rule is the "game lies" defect.
  — **A.** A stage banner before the first card of the stage, and the live rules
  shown for the whole stage (the rules badge already does this at tables). The
  coach line on a lost life names the rule: "Onluk bu hanedanda ölü".
- **Q3.** *"Reaching a stage for the first time."* If the stages are easy, the
  70 coins arrive in the first run. — **A.** Yes, once; that is a first-clear
  bonus, the same size as Pattern Mastery, and it never repeats.

## Step 4 — Cross-examination, round 2 (Defense answers, then challenges)

Answers given above. **Defense's challenge to the opposition's opening, point 2:**
"*A 5 × timed-duel run is 10+ minutes — not a new kind of session.*" Then the
opposition agrees the operator's request is best served by a *short* session —
which only B provides. — **Opposition:** conceded; its remaining objection is
execution risk in the composed stream, and it asks that the stream be tested as
a property (no accidental pattern in filler, ever), not by example.

---

## Step 5 — Judges (each written before reading the others)

**J1 — logic / evidence · Partially Defensible · High.** The case against B's
first spec is measured (fact 5), and the defense's answer is measured with the
same tool. A is argued from cost that is visible in the source (fact 2). B stands
*as amended*: composed stream, announced curses, bounded grant. Decisive:
*"Fact 5 kills a random stream, not the mode."*

**J2 — risk · Defensible · Medium.** Isolation (fact 1) means the worst case of
B is a dull mode, not a broken match or a polluted leaderboard. A's worst case is
a multiplayer regression. Reversible, cheap, contained. Decisive: *"it fires
none of the shared events."*

**J3 — feasibility · Partially Defensible · High.** B is one module and one
screen on an existing template; A is surgery on the singleton. B must ship with
the three amendments or it is the boring mode the opposition described.
Decisive: *"B can be built on that exact pattern; A cannot."*

**J4 — skeptic · Partially Defensible · High.** Default against. The strongest
objection — "mostly waiting" — was answered with a mechanism, not a promise, and
the opposition's demand that the filler be property-tested was accepted. I hold
the verdict to that test. Decisive: *"the stream be tested as a property (no
accidental pattern in filler, ever), not by example."*

**J5 — balancer · Partially Defensible · Medium.** Both sides had a point: A is
the more original idea and B the better product. The amendment that takes A's
curses into B is the right synthesis. Decisive: *"A's cheapest idea — curses as
rule rotation — … belongs in B."*

## Step 6 — Tally

| Verdict | Judges |
|---|---|
| Partially Defensible | J1, J3, J4, J5 |
| Defensible | J2 |

Quorum 5/5. Majority **Partially Defensible**, 4–1. High-confidence judges in the
majority: 3 → strength **Strong**.

### Verdict: PARTIALLY DEFENSIBLE (Strong) — build B, "Kum Saati", as amended

Binding conditions (each must be a test, not a sentence):

1. **Composed stream.** Each catch is placed 2–5 cards ahead; filler never forms
   a live pattern under the stage's rules (property-tested over thousands of
   streams); some filler is a named near miss.
2. **Tempo from `BotConfig.playDelay`**, stage by stage: easy → medium → hard →
   challenger. No typed tempo numbers.
3. **Stages (dynasties).** I: doubles + sandwich. II: + tens. III: + marriage
   (the classic four). IV: the classic four at challenger tempo. V and on: a
   **curse** — one classic rule is dead, in rotation, announced before the first
   card and shown for the whole stage.
4. **Three lives** (the folk three-strike rule). A false slap costs one; a pattern
   allowed to pass costs one. Every lost life says *why* in the coach line (P2).
5. **Economy.** First time ever reaching stage II / III / IV pays win ÷ 4 / ÷ 2 /
   × 1 through `CardSkins.addCoins`. Nothing else pays. Stored ledger survives.
6. **Isolation.** No shared match events, no Slap IQ, no mastery, no leaderboard.
   Local personal best only.
7. **P6.** The tutorial screen's surfaces, pile and coach; one new menu button.
