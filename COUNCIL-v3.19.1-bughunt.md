# Adversarial Council ERS-21 — Bug hunt on the Table of the Gods

Mode: full panel (5 judges, quorum 4), chamber and judges as separate agents.
Date: 2026-09-23. Asked: "act as a professional game bug tester, improve this
system, debug and try it; open to any solution and ideas."

## What was done
- `tools/fuzz-pantheon.mjs`: random-but-legal duels through the REAL code —
  offline `game.js` + `pantheon.js` on a fake clock; multiplayer through
  `firebaseSync.js`'s own transactions against an in-memory RTDB that stores
  what RTDB stores (`tools/fuzz/`). Invariants after every committed write.
  360 offline + 360 multiplayer duels, all six gods.
- Exploratory browser runs (real bots, scripted hero), desktop and 390px.

## Found and fixed
| | Where | What |
|---|---|---|
| F1 | MP, every table, pre-existing | Attacker plays its last card (a face card), slaps wrong with an empty hand (dead slap: out), then wins the challenge by timeout: 7 cards, still eliminated, holding the turn. Every write refused an eliminated seat — permanent freeze. Fuzz seed 5. |
| F2 | MP | Three hand-written challenge awards had drifted (timeout never ended a match; none handled the comeback flag). Now one `awardChallenge`. |
| F3 | MP | A turn held by a seat that cannot act is passed on — and stamped as `forcedTurnPass` and logged. |
| F4 | both | Winning a pile of ghosts only counted as a comeback with 0 cards. |
| F5 | offline, pre-existing | First turn of the first match after page load had no turn timer. |
| F6 | text | "1 ghost cards vaporized". |

## Ideas weighed
- I1 "echo return" (a vaporized ghost heals its god 1): **rejected 5–0** —
  changes life against the developer's wish, leaves Bastet at 100%, pushes
  Set slow from 30.7% to 18.4% (9.2% at 2).
- I2 local "duel record" on the god card: **rejected 3–2** — local-only data
  never reaches the developer, so it cannot be the measurement it claimed to
  be; may return later as a player-facing feature on its own terms.
- I3 the fuzzer as a permanent gate: **adopted 5–0** (`npm run verify`).

## Verdict
PARTIALLY DEFENSIBLE, 5–0, Weak (no High-confidence judge). Ship F1–F6 with
conditions; the conditions and how they are met:
- (a) one scenario per award path, driving the real transactions, with what
  CHANGED stated — 9 scenarios run first by the fuzz gate (timeout can end a
  match; an empty defender loses on timeout; …).
- (b) a forced pass is never silent: stamped in the room, logged, and the
  fuzzer fails on any.
- (c) protocol gate: NOT bumped. v3.19.0 never shipped, so protocol 2 goes out
  once, already with F1–F6. A v3.18.x client in an ordinary room still runs
  the old award code; the difference is only that the new code resolves
  states the old one froze on — no corruption path (the old code creates no
  ghosts, and god rooms already refuse it).
- (d) independent revert path: v3.19.0 and v3.19.1 are separate commits.
- F5 cannot double-arm: scenario S9 shows the first timer is replaced, not
  duplicated.
- Not met here: a real multiplayer browser run — no Firebase from this
  environment. It is in the deploy checklist (two accounts).

## Honest limits
- A mutant that removes F3's pass was not caught by random duels (the state
  no longer arises after F1); it is caught by scenario S8.
- The fuzzer's driver is random, not adversarial; it never races two clients
  on the same transaction.
