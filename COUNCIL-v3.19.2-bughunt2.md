# Adversarial Councils ERS-22 and ERS-23 — second bug hunt (v3.19.2)

Mode: in-conversation, full panel (5 judges, quorum 4) for each. Date: 2026-09-23.
Raised by: the operator — *"Please act as professional game bug tester, try to
improve this system. Debug and try that system. I'm open to any solution and
ideas."*
Under review: the Table of the Gods after v3.19.0 (ghost cards) and v3.19.1
(round-1 fuzz fixes). Neither is deployed; v3.19.2 ships with them.

---

## ERS-22 — round 2, part 1

### What the tester found

- **H0, in the tester's own harness.** The fake RTDB handed the per-commit
  check the *mutated* state as "before", so every round-1 before/after
  invariant compared a write with itself and passed vacuously. Fixed. Round 1's
  freeze (F1) was found by an after-only check, so it stands.
- **G1: online Slap Back In was impossible.** `pushSlapAttempt` began with
  `if (data.players[playerIndex].eliminated) return;`. That is a fifth lock,
  missed by v3.11.0's four-lock sweep.
- **G2:** after a comeback, a second knock-out never showed the defeat screen.
- **G3:** the host's bot driver read `cards.length` on a seat that had no
  `cards` field. RTDB stores no empty arrays, so a TypeError dropped the
  remaining bots' slaps for that snapshot.
- **G4 (offline, pre-existing):** a challenge award timer outlived the match
  and fired `winPile(null)`. This happened in 13 of 2 000 Anubis duels.
- **P1, created by G1:** a wrong slap from an empty hand costs nothing, so an
  eliminated player could spam-slap and win contests at the reaction floor.

### Verdict

**5–0 Partially Defensible, Weak** (all five judges at Medium confidence).

**Q1 — Ship H0 and G2–G4.** Yes. **G1** ships only together with a fix for P1.

**Q2 — P1: option (c), unanimous.** A seat gets one wrong slap from an empty
hand per pile.
- The rule is keyed to pile state (`lastPile.seq`), not to a clock.
- A lost contest is not a wrong slap.
- It applies online (inside the transaction) and offline.
- The Duat is exempt, because Ammit already charges a round for a wrong slap.
- "Empty hand" means no real card. A hand of ghosts is emptied the moment it
  forms.

**Q3 — I1, a burn stamp.** 3–2 against. Deferred to the next release.

**Q4 — I2, fuzz the host's bot driver.** Now, 5–0: G3 had escaped the fuzzer.

**Q5 — Conditions:**
- implement (c) and add a spam-slap agent that attacks it;
- run a Duat fuzz with G1 and (c), which a majority asked for;
- add mutants for the ghost-card invariants and for the lock;
- do I2.

### Done

- (c) is implemented:
  - online: `slapOutcome.emptySlapLocked`, `pileKey`, and `slapLock` set by a
    dead slap;
  - offline: `game.js` `emptySlapLock` and `pileSeq`;
  - the Duat is exempt through `MatchContext.pricesWrongSlaps`.
- I2 is the host mode (see ERS-23).
- Spam-slapping humans and a Duat fuzz mode run in every verify.
- Mutants, below.

---

## ERS-23 — round 2, part 2: the host's own client

### What the tester built (condition I2)

**`--mode host`** starts the real `MultiplayerMode.start()` against the
in-memory RTDB.
- Its own listener delivers every snapshot to `syncToLocal` and
  `gameSynced`, then to the bot driver, turn timer, contest close and defeat
  checks, exactly as in the browser.
- The humans are scripted:
  - some play normally;
  - some go AFK, and the host must time them out;
  - some spam slaps from an empty hand, which attacks the (c) lock;
  - 20 % drop their connection mid-match. RTDB's `onDisconnect` marks the
    seat, and there is no tab-close cleanup.

**`--mode duat`** runs the Duat journey. The hero starts dead, and the lock
must stand aside.

**Harness fixes:**
- Module hooks now run in-thread (`module.registerHooks`), so a seed replays
  exactly. Before, off-thread hooks made every `import()` take variable real
  time, and runs could not be reproduced.
- `update()` writes now reach the per-commit checks.
- The checks count with the fuzzer's own oracle, not with the ghost module
  under test.

### What it found (each reproduced, fixed, pinned by a unit test, a fixed scenario and a mutant)

| | Finding |
|---|---|
| **K1** | Four modules were imported under two query strings each, so they loaded twice. The host's human-turn timer asked a second, never-listening copy of `FirebaseSync`. **An AFK human was never timed out online.** The same split broke the return to the waiting room, the defeat notice and the history opponents, and language changes did not reach the multiplayer copy of Localization. A test now scans every import and fails on any module imported under two specifiers. |
| **K2** | `start()` registered its `gameSynced` listener after a deferred `import()`, and after attaching the room listener. An early snapshot reached nobody: no bot move was scheduled and no turn timer was armed. |
| **K3** | `quit()` removed its listeners in that same deferred import, after nulling them. `EventBus.off(event, null)` wipes **every** listener of the event. **Leaving the first online match removed ui.js's session-wide `gameSynced` handler** (pile redraw, challenge banner, burn count, disconnect notices) for the rest of the session. |
| **K4** | "Every human is out" counted an **empty hand** as out, so the match ended as "no human won" in the half second after a human's last card. In that moment the human could still slap their own pair, or was the attacker in a live challenge. |
| **K5** | A play or timeout that arrived between a slap window's deadline and its close (~10 ms) landed on the disputed pile. When that card ended a challenge, the window then awarded the **empty** table to the slapper, together with the turn and one Double of god damage. Timeouts also ignored open windows. |
| **K6** | *(pre-existing, severe)* A host whose connection **dropped** (phone locked, network lost) kept `hostId`. Only the host drives bots, timeouts and conversion, so **the room froze at the next bot turn.** |

**Fixes:**
- **K1** One specifier per module.
- **K2, K3** Listeners are registered and removed synchronously.
- **K4** The `eliminated` flag decides who is out.
- **K5** A play or timeout waits out an open window and settles a closed one
  first. A window whose pile is gone awards nothing.
- **K6** Host failover. `orphanedHostHeir` returns the first connected human,
  preferring one still in the match. Only that client claims the room, inside
  a transaction that re-checks the rule. No rules change is needed.

### Verdict

**5–0 Partially Defensible, Strong** (all five judges at High confidence).

Every judge's decisive quote was verified against the chamber transcript.

The judges ruled K1–K5 sound. For K6, the fuzzer proved liveness but not
safety. It runs one client instance, so it cannot model an **old host** whose
queued writes (a timeout, a blind "every human is out" update, bot slaps, the
room clean-up) replay into a match the new host is running. The package also
overstated its evidence: 16 mutants were claimed, 15 existed.

**Rulings:**

- **Q-A — failover timing:** claim immediately, with no grace period.
  RTDB's own disconnect detection already absorbs short connection blips. This
  holds only together with a **fence** on the old host.
- **Q-B — the last human online:** keep the rule that the match ends once
  every connected human is out. Change the rules text so it stops promising
  online play what it does not do. Aligning with offline play is deferred to
  v3.20+ and needs a hard cap on the bots-only phase.
- **Q-C — packaging:** ship everything together, fence included. Do not split
  K6 out, since that would ship a certain freeze to avoid a rare race.
- **Q-D — required before release:**
  - fence every host write inside its transaction;
  - re-check the elapsed time inside the timeout;
  - turn "every human is out" into a transaction;
  - re-check the room clean-up when it fires;
  - stop driving the room when the database connection is lost;
  - add a two-client replay scenario with its mutants;
  - re-soak with at least 1 200 host matches;
  - correct the evidence ledger;
  - update the rules text;
  - do one manual two-browser check.

### Conditions and their status

| Condition | Status |
|---|---|
| Fence the host writes (bot play, bot slap, timeout, conversion) | **done**. `_mayDrive` guards the bot seats; `pushTimeout` requires `hostId === me`; `convertToBot` is allowed only for the host or the seat's own player. |
| Timeout re-checks elapsed time (15 s or more) in the transaction | **done**. `TURN_TIMEOUT_MS` is shared by the host timer and the transaction. |
| "Every human is out" as a transaction that re-checks the host and the eliminated flags | **done**: `FirebaseSync.endIfNoHumanLeft()` |
| Bot-slap timers re-check the host when they fire | **done** |
| Room clean-up re-reads the host and the connection when it fires | **done** |
| A client without the database stops driving the room | **done**. `roomConnection` triggers `standDown()`, and `drivesRoom` requires being both host and connected. |
| Two-client replay scenario, with a control | **done**. There are 11 fence scenarios. A replaced host's queued bot card, bot slap, timeout, "every human is out" and conversion change nothing. The same writes from the current host go through. A timeout before 15 s changes nothing, even from the host. |
| One mutant per fence line | **done**, 6 in total, all caught. |
| Re-soak after the fence | **done**, all clean: 1 200 host matches, 1 800 transaction matches, 3 000 offline, 2 000 Duat. |
| Evidence ledger | **corrected**. `tools/fuzz-mutants.mjs` now holds **26 mutants, all caught**, and runs as `npm run fuzz:mutants`. K6 is labelled "liveness verified by the host fuzz; old-host safety verified by the fence scenarios". The fuzzer itself runs one client instance. |
| Rules text | **done**, in 4 languages: "A wrong slap with no cards benches you until the next pile. Online, the match ends once every human player is out." |
| Manual two-browser check | **operator**. It is in the deploy.bat checklist: with the host tab offline in DevTools for about 60 s, the other player's match must continue, and the host must rejoin as a normal player. |

**Deferred, not blocking:**
- `EventBus.off(event, undefined)` as a no-op, plus an explicit `clear()`, in
  v3.19.3;
- a rules-level `hostId` fence, which the rules language cannot express yet;
- I1, the burn stamp (ERS-22, 3–2);
- aligning Q-B with offline play, with a cap.

### Evidence (final code)

- The unit suite passes 2 891 tests. The one failure is environment-only: a
  CSP frame-src check against the mirror's local config.
- Gates:
  - syntax, links, locales, score bounds, error modal, CSP hash, lobby,
    orphan classes, promises;
  - the fuzz gate, which runs all four modes and 34 fixed scenarios in about
    4 s;
  - the browser smoke test.
- Mutants: 26 out of 26 caught.
- Soak: 1 200 host matches, 1 800 transaction matches, 3 000 offline matches
  and 2 000 Duat journeys. None broke an invariant.

### Honest limits

- The fuzzer's host mode runs one client instance that takes on whichever
  identity the room names. The safety of two diverging clients is covered by
  fixed replay scenarios, not by random play.
- The fence protects against an honest client replaying stale writes. It does
  not protect against a malicious room member. That still needs server
  validation, which is kept off by policy.
- Q-B is a product rule kept as it is. The rules text now says so.
