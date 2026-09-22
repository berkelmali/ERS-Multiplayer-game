# Adversarial Council ERS-18 — "Do the Legends fit the other modes, and is the mentality right?"

Mode: in-conversation, full panel (5 judges, quorum 4). Date: 2026-09-22.
Raised by: the operator — *"bi gözden geçirme yap. designleri diğer oyun
modlarıyla uyumlu mudur? oyun mentalitesi okay midir"*.
Under review: v3.18.0 Legends — Table of the Gods (bots + multiplayer), the
Duat Journey, the Pharaoh's Tomb. Measured against DESIGN.md P1–P6.

---

## Step 0 — Analyst (baseline — every fact measured or read, none argued)

**Visual (screenshots of menu, Practice, Tomb, Daily, Slap IQ, Legends, same
session, same language):**
- F1. The Legends button is the same dark pill as its neighbours; the Legends
  panel uses the same shell as Daily and Slap IQ (emoji h2, scrollable panel,
  dark cards). The Tomb reuses the Practice container, exit pill, dots and
  coach. Divergence: Legends **section headings are gold** (#f0d98a) where Slap
  IQ's section headings are the shared blue; god cards carry gold borders.
  The portraits are world objects, which DESIGN.md §4 allows to carry theme.
- F8. Practice opens on an intro screen that explains itself; **the Tomb opens
  straight into chamber 1** — its rules (three cards face up, "a pattern you
  complete belongs to the guardian") exist only as a paragraph in the hub.

**Economy (8 automated matches, Easy, an auto-player slapping valid patterns
450–700 ms after the card, real browser):**
- F2. Bastet duels ended at **115, 190, 210 s**; ordinary matches at **191,
  216 s** (a third was still running past 265 s); Duat runs at **190, 265 s**.
  Rewards are an ordinary win/loss (+40 / −15, +1 leaderboard point).
  The coin rate per minute is not inflated.
- F4. The player landed **6–10 slaps per match**; Bastet's life is 8 of the
  player's Doubles. Her life is roughly one match of your slaps.

**Mechanics read from the source:**
- F3. In one Bastet run of three the player **took all 52 cards before her
  life ran out**: the classic win fired, the match was won — and **no amulet
  was recorded**, because only `_fall()` stores one. The next god stays locked
  after a won duel.
- F5. The Duat always records at least one resurrection (the way in), so every
  Duat win shows the victory screen's Slap-Back line, and two deaths earn the
  "comeback" MVP badge that elsewhere marks a rare feat.
- F7. The two "priests" are described as "your side of the table", but the
  engine is free-for-all: they still take your piles and can eliminate you.
- F9. Pattern Mastery counts by the player's difficulty setting; an Easy-tier
  god at a Hard setting counts (the priests run at Hard).
- F10. Multiplayer gods are verified by unit tests only; no live two-account
  test has been run.
- F11. All three modes keep the reflex at the centre (P1); the Tomb adds a
  decision (which card) without removing the race.
- F12. Names come from the myth itself: the Amduat's twelve hours, Ammit,
  Apep, Ba/Ka/Akh, Bastet's nine lives, Anubis's weighing of the heart.

---

## Step 1 — Opposition

1. **A broken promise (P5), measured (F3).** The hall says "bring it to zero
   and you win" and the ladder unlocks on a fall. A player who plays *well
   enough to take every card* wins the match, is paid, and the god is still
   standing and the next one still locked. One run in three.
2. **The co-op story contradicts the engine (F7).** "Your side of the table…
   your two priests" — and those priests take your piles and can knock you
   out. The narrative says team; the mechanics say rivals.
3. **The Tomb does not teach itself (F8, P2).** Its central twist — your own
   pattern is a trap — is counter-intuitive to anyone who knows ERS, and the
   first time the player meets it is losing a card to it.
4. **A second heading colour (F1, P6).** Gold section headings and borders are
   the Legends' own chrome; P6 says a feature may not bring its own visual
   language to a screen.
5. **The comeback badge is cheapened (F5).** A rare-feat badge now arrives in
   every Duat.

## Step 2 — Defense

1. **Concede.** The fix is small and true to the fiction: taking every card
   the god holds *is* defeating it. A card win in a duel records the fall.
2. **Partially concede.** ERS is free-for-all and rewriting it into teams is
   not a review fix. The honest fix is the words: call them "the other two
   players" whose slaps also wound the god, not "your side".
3. **Concede.** Give the Tomb the same one-screen intro Practice has, with the
   trap rule in one line. The in-game message already explains the trap when
   it happens (P2 at the moment); the intro stops it being an ambush.
4. **Partially refute.** Gold is the world's colour — Ra's wheel, the amulets,
   the portraits' rims — and §4 lets world objects carry it. But section
   *headings* are panel chrome: concede those back to the shared style.
5. **Partially refute.** In the Duat the resurrection is the mode, and the
   Slap-Back line tells the truth. The badge, though, is for a comeback; the
   entry resurrection is not one. Exclude it.

**Strengths the opposition left out:** F2 — measured, the economy is not
inflated; F11 — no mode trades the reflex away; F12 — every name and power is
from the myth, which is exactly what the operator asked for after rejecting a
theme-less drill; the Tomb is fully isolated from shared stats.

## Step 3 — Cross-examination, round 1 (Opposition → Defense)

- **Q1.** *"Taking every card the god holds is defeating it."* Then why did
  the hall promise life to zero? — **A.** Because life is the new path, not
  the only one. The hall line becomes "bring its life to zero, or take every
  card it holds".
- **Q2.** *"Call them the other two players."* Does that not make the half
  damage arbitrary? — **A.** No: they are bots at your difficulty; half damage
  is what keeps the kill yours (F4 shows your slaps are the budget).
- **Q3.** On F9: is an Easy god at a Hard setting a mastery loophole? —
  **A.** The race is against Hard priests; the chances are Hard chances. It
  is the same rule every bot table already follows.

## Step 4 — Cross-examination, round 2 (Defense answers, then challenges)

Answers above. **Defense's challenge to opening point 4:** "*Gold section
headings and borders are the Legends' own chrome.*" The borders frame
portraits — world objects — and the same gold rims the wheel. — **Opposition:**
concedes the borders; keeps the headings.

---

## Step 5 — Judges (each written before reading the others)

**J1 — logic / evidence · Partially Defensible · High.** The review stands on
measurement: F2 clears the economy, F3 convicts one promise with a real run.
The design is sound where it was measured and wrong in one place it did not
anticipate. Decisive: *"One run in three."*

**J2 — risk · Partially Defensible · Medium.** The worst live outcome is a
player stuck on Bastet after winning — frustrating, reversible, cheap to fix.
Multiplayer is untested live (F10); it is gated behind a host's choice, so the
blast radius is small. Decisive: *"the next god still locked."*

**J3 — feasibility · Partially Defensible · High.** Every conceded fix is a
few lines: record the fall on a card win, reword two strings, add one intro
screen, restore the heading style, skip one resurrection in a badge. None
touches the engine. Decisive: *"The fix is small and true to the fiction."*

**J4 — skeptic · Partially Defensible · High.** Default against. The strongest
objection — a broken promise — was answered with a fix, not a denial, and the
co-op contradiction was answered honestly by changing the words instead of
pretending. What is not fixed by this review is F10; it must be tested with
two accounts before anyone calls multiplayer done. Decisive: *"no live
two-account test has been run."*

**J5 — balancer · Defensible · Medium.** The mentality is right: myth-true
names, reflex kept, economy measured flat. The five points are polish on a
design that already fits. I would ship with the fixes but not call the design
wrong. Decisive: *"the economy is not inflated."*

## Step 6 — Tally

| Verdict | Judges |
|---|---|
| Partially Defensible | J1, J2, J3, J4 |
| Defensible | J5 |

Quorum 5/5. Majority **Partially Defensible**, 4–1. High-confidence judges in
the majority: J1, J3, J4 → strength **Strong**.

### Verdict: PARTIALLY DEFENSIBLE (Strong) — the Legends fit; five fixes

Fits the other modes: same panel shell, same menu pill, the Tomb on the
Practice surfaces; reflex central; coin rate measured equal to a normal match;
names and powers from the myth. Binding fixes:

1. **A card win against a god is its fall** — record the amulet, unlock the
   next god; the hall says "life to zero, or every card it holds".
2. **Say who the priests are**: the other two players at the table, whose
   slaps wound the god by half — not "your side".
3. **The Tomb gets Practice's one-screen intro**, with the trap rule in a line.
4. **Legends section headings return to the shared heading style**; gold stays
   on world objects (portraits, amulets, the wheel).
5. **The comeback badge ignores the Duat's entry resurrection.**

Not closed by this review: **multiplayer must be tested with two accounts**
before it is called done (F10).

## Implemented (v3.18.0)
1. Card win is a fall — `PantheonMode.onGameOver` records the amulet when you win the cards while the god still has life; a fall by life is not counted twice. pantheonDesc names both roads, 4 languages.
2. "Priests" removed — "the other two players at the table", 4 languages.
3. Tomb intro — `#tomb-intro` (emblem, four rules, the trap rule marked), "Light the torch" starts; "Enter again" skips it.
4. `.legend-title` → `var(--primary)`; gold stays on god/journey cards.
5. Duat entry rise is taken back out of `stats.resurrections` once per journey.
Gates: test section 79 (21 checks), 7/7 mutations caught, 12 source gates green, smoke green.
