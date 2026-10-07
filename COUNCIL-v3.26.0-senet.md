# Adversarial Council ERS-40 — "Add an idea that bumps the version and makes the game more fun"

Mode: in-conversation, full panel (5 judges, quorum 4). Date: 2026-10-07.
Raised by: the operator — *"Devam et versiyon arttıracak bi fikir ekle. eğlence
katsın oyuna"*. The operator leaves design to the council (memoryfires #110)
and has set two standing conditions for a new mode: it must be unusual (#122),
and it must belong to this game — *"daha yaratıcı olsun, oyunun konseptine
uygun"* — which is why the Hourglass was built and then cancelled (#128,
`COUNCIL-ERS-17-hourglass-rejected.md`).
Measured against: `DESIGN.md` (pillars P1–P6, gates G1–G6) and the standing
policies #113 (numbers derived), #114 (look, don't reason), #116 (an existing
surface, not a new screen), #155 (one path awards a pile), #158 (room
semantics need a protocol gate).

Roadmap note: ERS-39 put growth and measurement before features and deferred a
new mode — *deferred, not forbidden*. The operator has now asked for a feature
in so many words, so this docket overrides that ordering for one release. The
Spanish/FAQ release ERS-39 planned as v3.26.0 moves to v3.27.0, unchanged.

---

## Step 0 — Analyst (baseline)

**What a mode can already do without touching the engine (read from source).**

1. `pantheon.js` and `duat.js` impose a seat's bot numbers
   (`AIController.seatConfig[seat]`), the seat names (`MatchContext.seatNames`),
   the rule set (`HouseRules.setLocal(..., { force: true })` + `lock`), a
   starting deal (`scenario`), and their own ending (`GameState.endMatch`) —
   and read the match only through `slapAttempt`, `pileWon`, `invalidSlap` and
   `gameOver`. Neither changes `game.js` or `ai.js`. A Journey is torn down by
   `GameManager.quitGame()` (dynamic `stop()`), and its HUD lives in a player
   zone (`#boss-hud` top, `#duat-hud` bottom).
2. The Pantheon's damage table is a measured rarity table:
   `10 × √(frequency of Doubles / frequency of the pattern)` over 600 000 cards
   — Doubles 10, Sandwich 11, Top-Bottom 12, Tens 13, Marriage 23, Triple and
   Four-in-a-Row 30 (cap). A number that already says "how rare is this slap".
3. Economy: a win pays +40 and a loss −15 through one path
   (`CardSkins.computeReward` on `gameOver`); the server caps earning at 80 a
   write and **1200 a UTC day** (`walletRules.js`, mirrored in
   `firestore.rules`). The Gods and the Duat pay an ordinary win; the Tomb pays
   its first full heist once.
4. `slapForensics.js` keeps reaction times **only for slaps that landed on a
   live pile** (§17.7: the history is cut at the slow end), counts a pattern a
   bot took first as a missed chance, and counts nothing about a second human.
5. `ai.js` drives every seat 1–3 whenever `activeMode === 'bots'`; there is no
   human-seat exception in either its `turnChanged` or its `cardPlayed`
   handler. `game.js` tracks `humanEliminated`, the stats and the turn timer
   for seat 0 alone; `CardSkins` pays on `winnerId === 0`.
6. **Senet** is Egypt's own game: 30 squares in three rows of ten, moves of one
   to five from four casting sticks. Surviving boards paint signs on the
   squares — an ankh on 15 (the House of Life), *nefer* on 26 (the House of
   Happiness), waves on 27 (the House of Water), three Ba-birds on 28. The
   rules are modern reconstructions (R. C. Bell, Timothy Kendall); no ancient
   rulebook survives.

**Four candidates, each written as a mechanic spec.**

**A — Senet: the Game of Passing (Senet — Geçiş Oyunu).** A third Journey card.
An ordinary bot table — you, Blitz, Chaos and Viper at your difficulty — with a
Senet track beside it. Every pile a seat takes moves its piece: a slapped pile
by that pattern's *throw*, a challenge pile by 1. Land exactly on the House of
Water and you wash back to the House of Life; land on another piece and you
swap places with it. First piece past the thirtieth square bears off and wins
the match; holding all 52 cards still wins too.

**B — The Duel of the Ka (Ka'nın Düellosu).** The Ka is the double every
Egyptian was born with. A 1-v-1 against a bot built from your own Slap IQ
record — your reaction band, your catch rate, your wrong-slap rate — in the
top seat, with your name in a cartouche. Optionally, a link that sends your Ka
to a friend.

**C — The Book of Thoth (Thoth'un Kitabı).** A codex on the Slap IQ panel:
about twenty named slaps and feats to collect in any mode — a Marriage of one
suit, Doubles of Aces, a Sandwich of Kings, a slap under 300 ms, a slap back in
from nothing, a challenge won with an Ace. The first time you land one, the
coach chip says so and the glyph is inked into the book.

**D — The Two Crowns (İki Taç).** Two people on one device — Upper Egypt
against Lower Egypt, each with a play key and a slap key (two halves of the
screen on touch); the winner wears the double crown.

*Considered and not tabled:* Osiris as a seventh god. Content rather than a new
way to play, and a god must work at a multiplayer table, whose room protocol is
gated (#158).

**Facts established by measurement — not inferred.**

7. **B, measured** (`tools`-style simulation, 600 duels a row: a hero model
   plays 30 ordinary tables, its Ka is built from exactly what
   `slapForensics.js` would have kept, then the two duel). The same hero beats
   its own Ka anywhere from **44.8 % to 98.5 %** of the time depending on
   *which tables the record came from* — the average hero: 55.7 % when its
   record came from Medium tables, 85.8 % from Hard, 96.5 % from Challenger.
   Reading the Ka's attention off the tier ladder instead of the catch rate
   moves the spread to **15.2 %–72.7 %**, still table-dependent. Cause: fact 4.
   Both the reflex history and the catch rate describe the player *and the
   bots they raced*, and cannot be separated after the fact.
8. **A, measured** (simulation, 800 races a row, the real `matchSlap`, classic
   rules; throw = `round(2 × damage / 10)` capped at 5, so Doubles 2, Sandwich
   2, Tens 3, Marriage 5; a challenge pile 1; water 27 → 15; swap on landing;
   30 bears off). A race ends at **about half the cards** of the same table
   without a track (average hero: Hard 188 vs 378, Medium 132 vs 177; slow
   hero at Hard 245 vs 804). **55–87 %** of matches end by bearing off, the
   rest by cards. The strong hero still wins every race it won before (100 %);
   the weakest gains a real chance (slow at Hard: **3.5 % → 11.6 %**). Per race:
   0.6–1.2 trips into the water, 2–8 swaps; without swaps the win rates move by
   two points at most.
9. **D, read from source.** fact 5: a second human needs changes in `ai.js`,
   `game.js`, `slapForensics.js` and `CardSkins`, or a second ERS engine of its
   own (the Tomb's `tomb.js`, 22 KB, is the precedent).

---

## Step 1 — Opposition (opening)

1. **B promises something the data cannot keep.** "Your Ka is you" is the whole
   pitch, and fact 7 shows the Ka is a portrait of *your tables*. The same
   player gets a pushover or a wall depending on where they have been playing.
   P5 — *the game does not lie* — fails on the first screen.
2. **A is the Pantheon wearing a board.** An overlay on the bot table with a
   HUD and a second way to end the match: that is exactly what the Table of
   the Gods is. And it changes what a slap is worth: Marriage moves you five
   squares — so it changes incentives at the table.
3. **A on the game screen.** P1: the screen where reflex is measured is sacred.
   A board with four pieces jumping, swapping and falling into water is motion
   in the player's eye line on the measured screen.
4. **A halves the match, so it doubles the coins an hour** (fact 8, fact 3). A
   race of 188 cards paying the same +40 as a match of 378 is a faster faucet.
5. **A's swaps are random cruelty.** Two to eight a race (fact 8): your piece
   jumps *backwards* because a bot landed on you. Unannounced, that is the
   "renders but does nothing" class's cousin — "moves and nobody says why".
6. **C is achievements, which ERS-39 deferred**, and a list is not fun: the
   operator asked for *eğlence*, and a codex adds goals, not play.
7. **D is the most fun and the most expensive** (fact 9): every match-path file
   at once, on the measured screen, for players who have a second person in
   the room — and nobody knows how many do; there is no traffic data.
8. **Whatever wins may be cancelled the way the Hourglass was.** The operator
   judges by playing it; a council cannot measure fun.

## Step 2 — Defense (rebuttal, point by point)

1. **Concede.** B as specified makes a claim fact 7 refutes. Its honest form —
   a Ka that rises when you beat it and falls when it beats you — is an
   endless ladder of one opponent, and the Pantheon already is a ladder (six
   gods × Ascension I–III). B is withdrawn.
2. **Partially concede the frame, refute the conclusion.** A and the Pantheon
   share the *mode framework* (fact 1) — that is why A costs no engine change,
   and it is the reason to choose it, not against. What is played is
   different: the Pantheon is three against one and ends at zero life; Senet is
   four pieces racing, every pile by every seat moves *someone*, and position
   is drama (water, swaps) the Pantheon has no form of. On incentives: the
   throw is the Pantheon's own measured rarity (fact 2) — the same table that
   already makes a Marriage hit a god 2.3 times harder — so A adds no new
   valuation, it reuses the one the game already argued for (#113). A wrong
   slap still burns a card; nothing pays for reaching.
3. **Refute with the precedent, and accept a bound.** The Pantheon's boss HUD
   and the Duat's hour clock already live on that screen. The board moves only
   when a pile is *won* — inside the engine's 1 s hand-over, after the slap is
   judged — never while a card is live. Bound it: no motion except on a won
   pile, and reduced motion honoured (DESIGN §4).
4. **Partially concede.** Coins an hour rise; coins a day do not — 1200 is the
   server's ceiling for every player and every mode (fact 3), and the Bastet
   duel (an average hero wins it 100 %) already pays +40 a win. A Senet win
   being "an ordinary win" is the same rule the other Journeys follow.
5. **Concede the danger, keep the rule.** Swaps are Senet's own capture rule
   in every reconstruction; dropping them removes the one way to fight back on
   the board. Every swap and every fall into the water is said on the HUD line
   and floated on the board, naming the seat.
6. **Concede C as the fun pick; keep it as a candidate for later.** It is the
   cheapest and safest, and it improves every mode — but it adds goals, not a
   new way to play, and the operator's last two requests were for play.
7. **Concede D.** No defense of its cost with no data on who would use it.
8. **Partially concede.** No council can measure fun. What it can do is weigh
   the two reasons the operator gave for cancelling the Hourglass — no theme,
   not this game's rules — and A is Egypt's own game played with ERS's own
   piles. And it is one module and one card: cheap to remove if the operator
   says no.

**Strengths the opposition passed over.** A gives the game a **new session
length** — about half a match (fact 8) — which ERS-17 called "what 'one more
go' needs" and which the operator then received only as the cancelled
Hourglass. It gives the **weaker player hope** without taking anything from the
strong one (3.5 % → 11.6 %, 100 % → 100 %). And it makes **every pile matter
twice**: who holds the cards, and where the pieces stand.

## Step 3 — Cross-examination, round 1 (Opposition → Defense)

- **Q1.** *"A adds no new valuation."* Which rule set? If house rules apply,
  Top-Bottom, Triple and Four-in-a-Row throw too, and a personal best set under
  seven rules is compared with one set under four. — **A.** The classic four,
  locked for the race (the Daily's lock, `HouseRules.lock`). The throw table a
  player learns is then exactly five numbers — Doubles 2, Sandwich 2, Tens 3,
  Marriage 5, a challenge 1 — and every race is measured by the same yardstick
  (G4).
- **Q2.** *"Said on the HUD line."* Said to whom — the player who is looking
  at the pile? — **A.** Both: a one-line notice on the HUD **and** the log
  (the Duat's `_say` path), plus a float on the board at the square it
  happened. The notice names the seat and the rule: "Blitz lands on you — you
  swap places", "Into the House of Water — back to the House of Life".
- **Q3.** *"Cheap to remove."* Cheap to remove is not the same as safe to
  ship. What happens to the HUD when the player quits mid-race — the bug class
  of §17.11? — **A.** `GameManager.quitGame()` stops it like the Duat and the
  Pantheon, and the smoke test leaves a race through Quit and measures the
  board gone.

## Step 4 — Cross-examination, round 2 (Defense answers, then challenges)

Answers given above. **Defense's challenge to the opposition's opening,
point 2:** "*A is the Pantheon wearing a board.*" Then the opposition must say
which of the Pantheon's numbers a Senet race reproduces. Life, damage-to-a-god,
ghosts, ascension: none appear. What is shared is the mode framework of fact 1,
which the opposition's own point 7 prefers to the alternative (a second
engine). — **Opposition:** conceded as to mechanics; its remaining objections
are the measured screen (point 3), which it asks be held to "moves only on a
won pile" as a *test*, and the coins an hour (point 4), which it asks be
written down where the economy is (`DESIGN.md` §3.1), not left to a comment.

---

## Step 5 — Judges (each written before reading the others)

**J1 — logic / evidence · Partially Defensible · High.** The decisive move in
this docket was measurement, twice. Fact 7 removes B on evidence rather than
taste — a mirror that reflects the room instead of the person. Fact 8 gives A
three properties the opposition did not dispute: half-length sessions, hope for
the weaker player, no loss for the stronger. A stands only as amended in Step 3
(classic rules locked; every swap and fall announced). Decisive: *"Both the
reflex history and the catch rate describe the player and the bots they raced,
and cannot be separated after the fact."*

**J2 — risk · Defensible · Medium.** A's worst case is a mode the operator does
not like, removed in one commit — the Hourglass outcome, at lower cost. It
changes no file the multiplayer path or the Daily runs through (fact 1), so a
defect stays inside the Journey. The coins-an-hour point is real but capped by
the server for everyone (fact 3). D's worst case is a regression on the
measured screen for every player. Decisive: *"Coins an hour rise; coins a day
do not — 1200 is the server's ceiling for every player and every mode."*

**J3 — feasibility · Partially Defensible · High.** A is the Duat's shape: one
module, one HUD in a player zone, one Journey card, `endMatch` at the end, a
`stop()` called from `quitGame()`. The throws come from a table that exists.
What it must ship with is the board drawn and *looked at* on a phone (#114) —
a 30-square board beside a pile is a layout risk no unit test sees.
Decisive: *"it is one module and one card: cheap to remove if the operator
says no."*

**J4 — skeptic · Partially Defensible · High.** Default against. The strongest
objection — "the Pantheon wearing a board" — was answered with a question the
opposition could not answer (which number is reproduced?), and conceded. The
screen objection survives as a condition, and I hold the verdict to it being a
test: the board moves on a won pile and at no other time. Decisive: *"which it
asks be held to 'moves only on a won pile' as a test."*

**J5 — balancer · Partially Defensible · Medium.** Both sides were right
somewhere: the opposition about B (withdrawn) and about the swaps needing a
voice; the defense about A being this game's own concept twice over. C is the
right *next* idea — cheap, safe, good for every mode — and should be kept on
the record rather than lost. Decisive: *"A is Egypt's own game played with
ERS's own piles."*

## Step 6 — Tally

| Verdict | Judges |
|---|---|
| Partially Defensible | J1, J3, J4, J5 |
| Defensible | J2 |

Quorum 5/5. Majority **Partially Defensible**, 4–1. High-confidence judges in
the majority: 3 (J1, J3, J4) → strength **Strong**.

### Verdict: PARTIALLY DEFENSIBLE (Strong) — build A, "Senet", as amended

Binding conditions (each must be a test, not a sentence):

1. **Throws derived, not typed.** A slapped pile throws
   `round(2 × DAMAGE[rule] / DAMAGE.doubles)`, capped at 5 (the casting
   sticks' highest throw), from the Pantheon's measured table; a challenge pile
   throws 1. Changing the damage table must change the throws.
2. **Classic rules, locked** for the race (`HouseRules.lock`), restored on
   every way out.
3. **The board.** 30 squares; everyone starts on 1; exact landing on the House
   of Water (27) returns a piece to the House of Life (15); landing on another
   piece swaps the two; reaching 30 bears off and ends the match
   (`GameState.endMatch`) for that seat. 52 cards still wins.
4. **Every swap and every fall into the water is said** — on the HUD line and
   in the log, naming the seat — and floated on the board.
5. **The board moves only on a won pile.** Nothing on it animates while a card
   is live; reduced motion is honoured.
6. **Solo only.** No room, no protocol, no Daily: nothing multiplayer or scored
   reads the race.
7. **Economy.** A race ends as an ordinary match ends (+40 / −15, one path),
   and `DESIGN.md` §3.1 states the coins-an-hour consequence and the server cap
   that bounds it. A local best — the fewest piles to bear off — and a count of
   passings; no coins of its own.
8. **Tear-down.** `GameManager.quitGame()` stops the race; the smoke test quits
   mid-race and measures the board, the lock and the seat names gone.
9. **P6.** The Journey card and the HUD frame use the common surface; the board
   is a world object (DESIGN §4) and may carry the theme. Looked at on a phone
   and a desktop before it ships (#114).
10. **The simulator ships** (`tools/sim-senet.mjs`) so the numbers in this
    record can be re-run.

On the record for later: **C, the Book of Thoth** (J5). **B** is withdrawn on
fact 7 and should not be re-proposed without a measurement that separates the
player from the table. **D** waits for data on who plays in pairs.

---

## Implementation note (v3.26.0, same day)

Condition 9 ("looked at on a phone and a desktop before it ships") found two
layout defects that no unit test saw, both measured in a browser:

1. **Desktop, 1024×768:** the HUD ran under the emoji button, which hangs just
   outside the right edge of your zone. The HUD now ends at that edge.
2. **Phones:** the HUD covered the bottom of the pile — the slap target — and
   the top of your deck. Measured at 375×667: the pile ends at y 409 and your
   deck, lifted and swollen on your turn (`@keyframes activePulse`), starts at
   about 466 — 57 px for everything. The board is now fitted to that gap with
   the deck at the height of its pulse (`liftedDeckTop`, `phoneLayout` in
   `senet.js`); where three rows do not fit, the same road is drawn unfolded
   as one row, and where not even that fits, nothing is drawn and the log
   carries the race. A smoke step measures six screen sizes (three desktop,
   three phone) for any overlap with the pile, the decks or the buttons.

Mutation proof: 16 unit-level mutants, all caught; at the smoke level a
mutant that throws 1 for every pile and one that drops the measured phone
position each fail their own step.
