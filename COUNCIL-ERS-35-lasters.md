# Adversarial Council ERS-35 — comparing the lasters (1).zip snapshot with the live project

Raised by the operator: compare the files in "D:\neww\lasters (1).zip" one by one
with the real project; see whether it has a feature worth taking as a model;
defend the current version in general; look with a game debugger's and a game
developer's eyes; hunt bugs. Recommendation put to the panel (R):

**R.** (a) Adopt no feature from the zip and do not revive its `matchmaking.js`.
(b) Fix the two regressions the comparison found, in a small release (v3.23.3): a
signed-in player who quits an active match gets a loss written to the permanent
record through the existing atomic `recordMatch`, and quitting resets the session
win streak; both get tests, including a real-browser step. (c) Keep the current
architecture. Verdict scale for the panel: "Defensible" = R as written is sound;
"Partially Defensible" = sound only with conditions named by the judge; "Not
Defensible" = R is wrong.

## Step 0 — Analyst (measured this session)

**What the zip is.** Its `index.html` says "v2.9.0". 66 files, 12 MB: the first
Firebase-multiplayer release, with `CLAUDE.md` and `COUNCIL.md` (the earlier
"Challenger Council" rules) in it. The live tree has 209 tracked files, currently
v3.23.2. So the zip is an old snapshot of the same project, not another product.

**File-level comparison.** 62 files exist in both. Of those, 20 are byte-identical
(all 11 images, all 6 audio files, `.firebaserc`, `functions/index.js`,
`functions/package.json`, `eventbus.js`, `matchTimer.js`, `resultCard.js`,
`firebaseConfig.example.js`). 42 differ. 147 files exist only in the live tree.
Only four things exist only in the zip: the two docs, `public/js/firebaseConfig.js`
(a real config file; deliberately not read or copied into this review), and
`public/js/matchmaking.js`.

**Feature-level comparison.** Every i18n key in the zip (220) exists in the live
file (543 keys). Every CSS class and every settings key in the zip exists live. The
only HTML ids missing live are `btn-signin`, `btn-signup`, `register-actions`, the
old sign-in buttons, replaced by a single `auth-form`. The functions the zip has and
the live tree lacks by name were each traced: `getNextPlayer`/`migrateHostIfNeeded`
moved into a shared module and are still imported by `functions/gameLogic.js`;
`getFriendlyErrorMessage` became a localized error-code map in `auth.js`;
`addPoints`/`incrementGames`/`saveBestReflexToFirestore` were replaced by one atomic
commit of the private record and its public leaderboard mirror (`playerRecord.js`,
rules-bounded); `ai.js` shrank because its numbers moved to `botConfig.js` and its
rolls became deterministic. Every v2.9.0 feature named in the zip's own
`CLAUDE.md` (practice mode, bot personalities, win streak, share card, comfort
settings, perfect-slap bonus, danger zone, bot nemesis, MVP moment, blitz timer, bot
table talk, emoji, spectator, parallax menu, skins and coins) was found live.

**`matchmaking.js`.** A Firestore `queues` collection; every client waits for
exactly four queued humans, and the oldest entry creates the room. There is no bot
backfill, no queue expiry, and `firestore.rules` today contains no `queues` rule.
It was deleted in the v3.8-v3.13 release; the live lobby replaced it with tables
and bot backfill.

**Two regressions found by reading, then reproduced.** In v2.9.0, quitting a match
(`btn-quit`) emits `coinsAwarded` with `winnerId: -2`. The zip's `ScoreSystem` and
`StreakTracker` both listened for it: the quit counted as a game lost in the
permanent record (and the best reflex so far was saved), and the win streak reset.
The comments say why: "a quit was ALSO a free way to keep a loss out of a player's
permanent Firestore win/loss record". The live `ScoreSystem` records only on
`gameOver`, and the live `StreakTracker` has lost the `-2` handler; the coin
penalty for quitting survives in `cardSkins.js`. Reproduction on real code: a
tracker fed three wins, then a quit — the zip's module goes 3 -> 0, the live module
stays 3. The `ScoreSystem` half is established by reading the live file and by the
absence of any other listener for `-2` (a search found only `victoryScreen`, which
only displays the coin line). No test in the 3273-test suite names either
behaviour.

**Exit paths.** The only in-game exit control is `btn-quit` (`main.js`), guarded by
a confirmation modal; `victoryScreen` exits happen after `gameOver`. Closing the
tab, reloading or a crash emits nothing at all, in v2.9.0 and today.

**Limits of the write.** The Firestore emulator scenarios name a won match and
several refusals (a score jump, a score without a win, a second match inside ten
seconds); none names an accepted lost match. `recordMatch` runs under a rule that accepts one +1 step
per `RECORD_COOLDOWN_S` (10 s); a rejected write is caught and logged. The
suite loads `ScoreSystem`'s dependencies only in a browser (Firebase CDN imports);
the browser smoke replaces Firebase with a stub whose transactions do not run the
callback.

## Step 1 — Opposition (arguing that the zip, or the old ideas, beat the present)

**O1 — The present silently dropped a decision.** The zip proves the project once
decided that a quit is a loss. Thirty releases later nothing says that decision
was reversed. A rewrite of the record path (v3.18.0, the security review) lost it,
and nobody noticed for five weeks because no test named it. If one rewrite lost
this, others lost things the comparison cannot see.

**O2 — The fix changes permanent records and is itself a risk.** Writing a loss on
quit adds a Firestore write on a path players hit in anger. The 10-second cooldown
can reject it silently. A player who mis-clicks quit (or whose match was a
mistaken start) is punished permanently. And the multiplayer case is different: a
host quitting ends the table for others.

**O3 — A feature IS missing: one-click matchmaking.** The zip could put you into a
game without picking a table. The live lobby asks a new player to understand
tables, hosts and invite links. For a small site that is where players drop off,
and the zip's queue is the only trace of an answer.

**O4 — The snapshot is 30 releases old; the comparison proves little about now.**
A diff against v2.9.0 can only find behaviours that used to exist. Every bug
introduced since then that is not a lost behaviour is invisible to it. Reading two
regressions and declaring the review done would be false comfort.

**O5 — The fix cannot be proven where it matters.** `ScoreSystem` cannot be loaded
by the unit suite and the smoke stub does not run transactions, so a test of "a
quit writes a loss" would be a source scan; the exact class of test that let this
regression through.

**O6 — The fix is partial by construction.** Tab close, reload and crash still hide
a loss from every ledger. Closing the button path only teaches the exploit to use
the tab.

## Step 2 — Defense (of the present version, and of R)

**D1 (O1) — Conceded.** It is a real regression, reproduced, with a documented
reason for the original behaviour. It is also the only lost behaviour the
comparison found among 62 shared files, 220 keys, every class and every setting, and
each other difference was traced to a deliberate replacement. That is evidence the
rewrites were careful, not that the project is fragile. The lesson is to pin the
behaviour, which R does.

**D2 (O2) — Partly conceded.** The quit already costs coins and already asks for
confirmation, in words that quote the price. The design choice "a quit is a loss"
is the project's own, made in v2.9.0, so R restores a decision rather than making a
new one. The write goes through the same rules-bounded `recordMatch`; a rejected
write is caught, never surfaced; nothing else changes. What is new is only that the
warning text mentions coins and not the record; the message can name the record
too. Multiplayer: the quitter loses; the rest of the table's outcome is untouched.

**D3 (O3) — Refuted for now.** The old queue needs four humans and has no backfill,
so on a site with few concurrent players it would leave people staring at
"Looking for players" until they gave up; it has no rule to run against today; it
lets any client create a room from the oldest entry, the trust model the project
spent v3.18-v3.22 removing. A quick-join built today would be new code on the live
lobby (join the fullest waiting table, else make one), a different feature from the
zip's. The project has no telemetry that says new players drop at the lobby, so it
belongs in a later council on its own evidence, not in this one.

**D4 (O4) — Conceded as a limit.** The comparison is one lens. It found what it
can find. The fix release is bounded to what it found, and the report says so.

**D5 (O5) — Partly conceded, and answered.** Make `ScoreSystem` take its recorder
as a property (`ScoreSystem.recorder`, defaulting to `recordMatch`). Then a real
browser step can put a spy in it, sign a fake user in, start a bot match, click
`btn-quit`, confirm, and assert that exactly one `{ won: false }` outcome was
recorded and the streak went to 0, and that a normal `gameOver` still records
once. That is behaviour, not a source scan. A mutant that removes the handler
must fail that step.

**D6 (O6) — Conceded, and it does not undo R.** Tab close cannot be observed from a
page reliably, and a Firestore write on `pagehide` needs an authenticated request
the browser may cancel. A server that referees the match is the real answer, and
that is the standing decision (no server validation). Closing the button path is
still worth it because it is the path a player takes by intent, in the UI that
warns about it. The deploy notes should say what remains open.

## Step 3 — Cross-examination, round 1 (opposition)

1. To D2 — "*a rejected write is caught, never surfaced*": a quit within ten seconds
   of the previous record is silently a free quit. Is that acceptable, and does
   the same window let a win be recorded twice?
2. To D5 — "*a real browser step*": the step replaces the recorder with a spy, so
   it proves the listener calls the recorder, not that the recorded outcome is what
   the rules accept. What proves the shape is right?
3. To D3 — "*the project has no telemetry*": you refuse the queue for lack of
   evidence, but you accepted three other features in this project without
   telemetry (Ascension, visible skins). Is that consistent?

## Step 4 — Cross-examination, round 2 (defense)

1. The window is a property of the rule and of v2.9.0's design alike: the cooldown
   exists to stop a forged record from jumping, not to police quits. A quit inside
   it is lost, a real limit; the cost is one free quit right after a match, which
   is the smallest version of the exploit. A gameOver and a quit cannot both record
   one match: `ScoreSystem.gameProcessed` is set by whichever comes first and reset
   only when a new match starts, the same guard the zip and the live `gameOver`
   handler already use.
2. The recorder receives `{ won: false, reflex }`, the exact argument the live
   `gameOver` handler builds for every lost bot match today; `recordMatch` and
   `matchUpdate` are unchanged, and the unit suite pins `matchUpdate` for a lost
   match (only `gamesPlayed` +1). The step proves the listener. The honest gap: the
   Firestore emulator scenarios cover a won match and the refusals, and none is
   named for an accepted lost match (the emulator could not be downloaded here in any
   case); production already makes that write on every lost match. What is not
   proven is the two joined against a real Firestore, and the notes say so.
3. Consistent in one respect and not in another. The earlier features were
   accepted as low-risk, opt-in, reversible additions, with a kill switch for the
   only unobserved write. A queue is a new multiplayer subsystem with no rule to
   run against; its cost of being wrong is much larger. It is not refused, only not
   taken from a 30-release-old file.

Defense's challenge to the opposition's opening: O4 says the diff cannot see bugs
introduced since. That is true of any diff, and the answer is a second lens, not
dropping the first. The same session ran the browser smoke, the fuzzers and the
suite on the current tree, and found the two-commit package sound; this review adds
one confirmed defect to that.

## Step 5 — Proposed release v3.23.3 (builder's plan)

- `ScoreSystem`: one `record(won)` path used by `gameOver` and by the quit signal
  (`coinsAwarded` with `winnerId === -2`), guarded by `gameProcessed`;
  `ScoreSystem.recorder` defaults to `recordMatch`.
- `StreakTracker`: restore the `-2` reset.
- Tests: unit (real `EventBus` behaviour for the streak, the reproduction above);
  source pins for the `ScoreSystem` wiring; a browser step with a spy recorder
  covering quit -> one loss, normal win -> one win, quit after game over -> nothing.
- Quit warning names the record as well as the coins (four languages).
- Deploy notes: the tab-close limit, the ten-second window, and "quit is a loss"
  stated as the rule.

## Step 6 — Panel (five independent judges, each saw only Steps 0–5)

Quorum 5 of 5 valid. Every quote below was checked against this transcript
(whitespace-normalised, exact match found for all five).

| Judge | Lens | Verdict | Confidence | Decisive quote |
|---|---|---|---|---|
| J1 | logic / evidence | Partially Defensible | Medium | "The `ScoreSystem` half is established by reading the live file and by the absence of any other listener for `-2`" |
| J2 | risk | Partially Defensible | Medium | "What is new is only that the warning text mentions coins and not the record; the message can name the record too." |
| J3 | feasibility | Partially Defensible | Medium | "The step proves the listener. The honest gap: the Firestore emulator scenarios cover a won match and the refusals, and none is named for an accepted lost match" |
| J4 | skeptic | Partially Defensible | Medium | "What is not proven is the two joined against a real Firestore, and the notes say so." |
| J5 | balancer | Partially Defensible | Medium | "It is not refused, only not taken from a 30-release-old file." |

**Tally.** Partially Defensible 5, Defensible 0, Not Defensible 0. Majority 5 of
5; no judge in it reported High confidence, so the strength label is **Weak**.
Read plainly: everyone agrees the two fixes are right and the zip is not a source
of features; nobody was confident enough to call R sound as written. Their
conditions are what made it sound, and they are answered below.

**One judge caught an error in this transcript.** J1: the Step 0 heading says both
regressions were "reproduced", but only the streak was run; the `ScoreSystem` half
was read. That was true when the panel saw it. It is now also reproduced by
execution (see the release below).

## Step 7 — What the release did with each condition (v3.23.3)

| Condition (judge) | Status |
|---|---|
| Confirm the `ScoreSystem` regression by execution, step must fail before the fix (J1) | **Done.** The new browser step, run on the tree without the `-2` handlers, fails: "a quit did not write exactly one loss: []". |
| Executed mutation gate: delete each `-2` handler, browser step and unit test must fail (J3, J4, J5) | **Done.** Without the `ScoreSystem` handler: browser step fails ("a quit did not write exactly one loss: []"); the unit suite catches it only through its wiring pin (ScoreSystem cannot load in Node), which is why the browser step carries it. Without the `StreakTracker` handler: browser step fails ("the win streak survived the quit: 3") and the unit suite fails on real `EventBus` behaviour (two tests). Both handlers present: full smoke green, 3282 unit tests. |
| Quit warning names the permanent record, four languages, same release (J2, J3, J4, J5) | **Done.** `confirmQuitRecord`, shown to signed-in players only (a guest has no record), in tr/en/de/ru. `check-locales` passes; the smoke asserts the text for a signed-in player and its absence for a guest. |
| One guard, quit after `gameOver` and double record impossible (J2, J5) | **Done.** `ScoreSystem.record()` is the one path; a quit followed by a late `gameOver`, and a finished match followed by leaving, each leave exactly one write (smoke). |
| A rejected write (10 s cooldown, offline) fails safe, silently (J3, J4) | **Done in the step**: the spy recorder throws `permission-denied`; the menu is reached, no error screen, the refusal is logged once, the streak is still reset. |
| Unit pin for the `{won:false, reflex}` argument and `matchUpdate` for a loss (J3) | **Done** (section 95). |
| Source pins are not counted as behaviour (J3) | Followed: the section says so, and the behaviour lives in the smoke step. |
| Verify `-2` on the multiplayer exit, or limit the wording (J3) | **Read, not run.** `btn-quit` is the only in-game exit and `isActiveMatch` includes multiplayer; the `-2` signal comes from `CardSkins.applyQuitPenalty`, which is mode-independent. The smoke stub cannot host a room. An eliminated player who quits is recorded once, earlier than the `gameOver` that would have recorded the same loss. Stated in the deploy notes as a check for the operator with two accounts. |
| Emulator scenario for an accepted lost match (J1, J2, J3, J4, J5) | **Not done; stated.** The Firestore rules emulator could not be downloaded here. Production already writes exactly this shape on every lost bot match, so the risk is of a gap in the test suite, not in a new write. Add the scenario when the emulator is available. |
| Deploy notes: tab close, reload, crash unrecorded; the 10 s window is a free quit (J2, J3, J4, J5) | **Done** (`deploy.bat`, item 237, and DESIGN.md §2). |
| Soften or exempt very early quits (J4) | **Not done, on purpose.** The gate is the same `isActiveMatch` that has charged the coin penalty since v2.x; an exemption would need a rule for "early" that a client can game (start, quit, repeat), and the write is already bounded to one per 10 s. The warning now says what it costs, so a mis-click is an informed choice. Revisit if players complain. |
| Reword R(a): reject the zip's queue and `matchmaking.js` only; leave quick-join open (J5) | **Done.** Recorded here and in `deploy.bat`: quick-join is not refused, only not taken from a 30-release-old file; it needs its own evidence-based council. |
| Say the v2.9.0 diff is one lens, and describe (c) as "no architecture change found by this lens" (J1, J4) | **Done.** R(c) is amended to that wording; the deploy notes say the diff is not an audit. |

**R as amended by the panel.** (a) Adopt no feature from the zip and do not revive
its queue or `matchmaking.js`; a quick-join for the live lobby is not refused and
needs its own council on evidence. (b) Fix the two regressions in v3.23.3, with
the record named in the quit warning and the open limits stated. (c) No
architecture change was found by this one lens; the review does not clear the
architecture.

## Honest limits (of this review)

- **One lens.** A diff against v2.9.0 finds behaviour that used to exist. It cannot
  find a bug introduced since that was never a behaviour of the old version.
  The same session ran the browser smoke, the fuzzers and the suite on the current
  tree; this review adds one confirmed defect (two listeners) to that.
- **Still open, by construction:** closing the tab, reloading and a crash record
  nothing — a server that referees the match is the only real answer, and that is
  the standing decision. A quit within 10 s of the previous record cannot be
  recorded by the rule and is therefore a free quit.
- **Unproven joint:** the loss write against the real Firestore rules (see above).
- **Multiplayer exit:** verified by reading, not by running.
- **Panel independence:** the judges are separate contexts of one model family;
  the panel evaluates this transcript, not the world. Quote verification proves a
  quote exists, not that its reasoning is sound.
- **Weak strength label.** Five agreeing judges at Medium confidence is a weaker
  signal than the tally alone suggests. Treat the verdict as one input.
