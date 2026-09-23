# Adversarial Council ERS-20 — Ghost cards at the Table of the Gods

Mode: full panel (5 judges, quorum 4), chamber and judges run as separate
agents; no judge saw another's ruling. Date: 2026-09-23.

The request: the Table of the Gods should be harder — every card your side
slaps should come back as a ghost clone in the god's deck, with an effect.
Already decided by the developer: the clone count is a middle ground between
"the pattern's cards" and "the whole pile" (D1); ghosts vaporize when a pile
holding them is won (D2); bots and multiplayer alike (D3).

## What was put to the council
Proposal: clone the pattern's cards plus half of the pile's other real cards
(top down), max 6 per slap, max 13 held, placed at the BOTTOM of the god's
hand; one award path; real-card 52 checks; a winner stamp in the room;
visuals; tests; a committed balance simulation (`tools/sim-pantheon.mjs`,
1 500 seeded duels per cell, the real `matchSlap`, god numbers and ghost
functions; hero modelled as fast / avg / slow).

Questions: Q1 placement (bottom or top) · Q2 an "echo" rule (a slap on a ghost
pattern deals half) · Q3 keep 6/13 · Q4 is the architecture sound · Q5 retune
the first gods now.

Code facts found before any code was written:
- F2 — `checkGameOver` / MP ended a match on `length === 52`: ghosts could
  hand the god a false victory.
- F3 — five MP award paths, three of them inline copies in firebaseSync.js.
- F5 — clients INFERRED the pile winner from card-count growth. With a
  vaporized ghost and the god's clones in the same write, a Double holding one
  ghost made every screen name the god. (Now measured in section 82.)

## Chamber (summary)
- Opposition: "harder" is not delivered on gods 1–4 (≥99.7% avg hero in
  every variant); readings misstated (Set: 53% of ghosts never played at the
  bottom, not ~45%); echo contradicts "on top of losing life"; an OLD client
  in a new room still runs its inline award — ghosts in a person's hand, the
  false 52 — and no version gate exists; the spec says nothing about a hand
  of ghosts only.
- Defense: the ladder is meant to be steep and the teeth belong on Set/Ra;
  bottom hides the effect (Bastet 72% unplayed), top plays 69–96%; echo off;
  write the rule "realCount 0 = out, ghosts vaporize"; the single award
  helper makes a gate cheap. Conceded under cross-examination: a flag an old
  client cannot read does not gate it — the gate must be enforced where the
  room is written, or D3 is not safe to ship.

## Judges (each written alone)
| Judge | Verdict | Confidence | Q1 | Q2 | Q3 | Q5 |
|---|---|---|---|---|---|---|
| J1 logic/evidence | Partially Defensible | High | top | no | keep | no |
| J2 risk | Partially Defensible | Medium | top | no | keep | no |
| J3 feasibility | Partially Defensible | Medium | top | no | keep | no |
| J4 skeptic | Not Defensible | Medium | top | no | keep | no |
| J5 balancer | Partially Defensible | Medium | top | no | keep | no |

Quorum 5/5; quotes verified against the transcript. **Verdict: PARTIALLY
DEFENSIBLE, 4–1, Moderate** (one High-confidence judge in the majority).
Unanimous on every question.

Decisive argument (J1, J2, J3, J4 all cite it): *"Without it, D3's
multiplayer scope is not safe to ship."*

## Conditions, and how v3.19.0 meets each
1. Server-enforced minimum-version gate on god rooms (all five judges) —
   `database.rules.json`: a room with a god accepts writes only from a user
   whose `clientVersions/{uid}` ≥ `ROOM_PROTOCOL` (2). `roomProtocol.js`
   registers it before the first room write (`listenToRoom`) and before a
   host deals a god room. Tested in the emulator (`tools/rules-test.mjs`:
   14 scenarios, 5 mutants) and statically (section 82).
2. "A seat with realCount 0 is out and its ghosts vaporize" (all five) —
   `awardPile` / `dropHollowHand` (MP) and `_dropHollowHand` (offline), after
   every play, burn and award; invariant checked over 23 000 simulated moves.
3. One award path (J3, J4, J5) — the three inline copies in firebaseSync.js
   now call `slapOutcome.awardPile`; every "all 52" check counts real cards.
4. Cap-hit counts before 6/13 is final (J1–J5) — measured: the 6-per-slap cap
   binds < 0.1 times per duel, the 13-held cap ≈ 0. They are bounds, not the
   balance. 6/13 kept.
5. Readings corrected — Set 53% (not ~45%); "66→64" and "~8 slaps" dropped.
- Q1 top, Q2 no echo, Q5 no retune: shipped as ruled.
- Not adopted (J2 only, no majority): a room-level switch to turn ghosts off
  without a release.

## Honest limits
- The simulation ranks variants; its absolute win rates are a model, not
  players. Gods 1–4 stay about as easy as before — ghosts bite on Set and
  Ra (avg model: Ra 84.5% → 66.9%, Set 95.7% → 88.3%). A retune of the early
  gods is a separate, measured change.
- The gate trusts the number a client writes about itself. It keeps an OLD
  tab out; it is not an anti-cheat.
