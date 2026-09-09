# v3.11.0 — Slap Back In

The council's first item, and the gate that would have caught it.

## The promise

The rules panel has carried this section in four languages since long before any
code could honour it:

> **👁️ Spectator Mode & Slap Back**
> Eliminated? Don't leave yet! You enter Spectator Mode where you can watch the
> match, send quick chat emojis, and still attempt to **Slap Back In** at any
> time. **A successful slap resurrects you with the pile!**

Around that promise the codebase had built a notification and a log line
(`ui.js`), a defeat-screen teardown (`victoryScreen.js`), a counter
(`multiplayerMode.js`), a "Slap Backs" statistic on the victory screen, an MVP
badge for two or more (`mvpComeback`), and `GameState.stats.resurrections`.

Nothing anywhere emitted the event. `resurrected` had **2 listeners and 0
emitters**, and the statistic was pinned at zero by construction.

## Four locks, not one bug

| | Where | What it did |
|---|---|---|
| 1 | `game.js` `checkGameOver` | Ended the offline match the instant the human ran dry, crowning whichever bot held most cards |
| 2 | `game.js` `slap()` | Refused a slap from a seat with no cards — the one action the rules grant it |
| 3 | `firebaseSync.js` `_settleContest` | Threw away an eliminated seat's **winning** slap: it could win the race on reaction time and be ignored |
| 4 | `victoryScreen.js` spectator lock | `pile.style.pointerEvents = 'none'` — the slap is a `pointerdown` on `#center-pile`, so no engine fix could be reached by a finger |

Three of these were recorded in `DECISIONS #17` when the feature was first
referred to a product decision. The fourth — the pile lock — was found this
round, and on its own it would have made everything else pointless.

The **deck** stays locked, correctly: an empty hand has no card to play, and
`getNextPlayer` already skips empty seats. An eliminated player gets no turn.
They get the pile.

## The fix

One line carries the whole rule, in `slapOutcome.js`:

```js
players[winnerId].eliminated = false;
```

It sits six lines above its own mirror image — *"Anyone left holding nothing is
out"* — so both halves of the rule are now in the same place. Because
`slapOutcome.js` is the shared module, this fixes multiplayer and single-player
at once. The room is also stamped with `lastResurrectedId`, so every client
learns about a comeback from the transaction that caused it rather than
inferring it from a diff of the eliminated flags.

## The user's v3.7.4 rule is preserved, not traded

`DECISIONS #17/#18` record a product decision: *when the number of live real
players at the table reaches zero, the match ends and elimination becomes
permanent.* `countLiveHumans` and `resolveEndOfMatch` are **untouched**.

Slap-back only reaches the case that rule never covered — somebody else is still
in. Measured:

| Situation | `countLiveHumans` | Result |
|---|---|---|
| Only human eliminated, 3 bots play on | 0 | match ends, `winnerId = -1`, nobody crowned — **v3.7.4, unchanged** |
| Human A eliminated, human B still in | 1 | match continues, A can slap back |

A mutation that deliberately made slap-back universal — dropping `!p.eliminated`
from `countLiveHumans` — **fails 13 tests**. The rule is now pinned from both
directions.

## The gate — `tools/check-promises.mjs`, deploy gate 9 of 10

Nine gates guarded this project and every one read either source text or layout.
None asked the question a player cares about: *does the thing you promised
actually happen?* `check-locales` went further and **certified** the four
strings describing this feature as correctly translated, in four languages, for
something that did not exist.

**Rule:** every event name passed to `.on(...)` must appear in at least one
`.emit(...)`.

**Not symmetric, on purpose.** The mirror case — emitted with nobody listening —
is reported and does not fail the build. An event nobody listens to is a hook
waiting for a feature. A listener nobody fires is a promise the player has been
shown. Only one of the two can put "Slap Backs" on a screen and hold it at zero.

**Seven mutations:**

| | Mutation | Want | Got |
|---|---|---|---|
| M1+M2 | both emitters removed — the original bug | fail | fail |
| M3 | one of two emitters removed | pass | pass |
| M4 | a new listener nobody emits | fail | fail |
| M5 | a new emitter nobody hears | pass | pass |
| M6 | a computed event name | fail | fail |
| M7 | an extra `.off()` | pass | pass |

M6 fails because a runtime-built name makes the rule *unprovable* rather than
false — the gate stops instead of reporting a clean bill it cannot support. M7
matters because `ui.js` calls `EventBus.off('resurrected')` immediately before
re-registering; counting that as a subscription would let a file satisfy the
rule by unsubscribing.

## Validation

1491 unit tests, 0 failed. Ten deploy gates green. `npm run smoke` — 49 checks,
0 unexpected console errors. Six behavioural mutations run against the feature
itself; every one caught, including the v3.7.4 trade-away.

**Not verified in this environment:** the feel of the comeback in a real match.
The logic and the four locks are proven; whether the moment *lands* — the
notification timing, the screen teardown, whether the pile is easy to hit as a
spectator — needs a real match on the live site.

## Still outstanding

The council's items 3 and 4. Multiplayer is client-authoritative: RTDB grants
any player in a room write access to the whole room, `USE_SERVER_VALIDATION` is
false, and `functions/` — 836 lines including `attemptSlap` — is not in
`firebase.json` and has never been deployed. And the game screen, the shop and
the victory screen still hold 4, 0 and 10 CSS rules between them.
