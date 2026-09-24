# Adversarial Council ERS-27 — hard review of the release package (v3.21.0 + v3.21.1)

Mode: in-conversation, full panel (5 judges, quorum 4). Date: 2026-09-24.
Raised by: the operator — *"bu haliyle okay gibi. Konseyimiz iyice sorgulasın.
Muhalefet."* Under review, unreleased: v3.21.0 (Deck of the Gods, 2 000 coins,
ERS-25) and v3.21.1 (readable indices and red/black separation on eleven dark
skins, ERS-26 and its review).

The opposition was told to be hard and truthful: every charge below was
measured or read in the code before it was made.

## Step 0 — Analyst

- **What ships.** A second mythic art deck (lapis, gods, winged sun, stars);
  per-skin index colours for eleven dark skins; a gate (section 88) that reads
  each skin's gradient and index colours from style.css and requires ≥ 4.5 : 1
  against every stop, CIEDE2000 ≥ 30 between the suits, ≥ 15 under simulated
  protanopia and deuteranopia.
- **Claims.** "Each pair ≥ 4.5 : 1"; "red and black stay two suits, also for
  colour-blind players"; the deck is worth 2 000.
- **Where skins appear.** `renderPileCard` (your own cards, playerId 0) and the
  shop preview. Skins are local: other players never see them.
- **Implicit assumptions.** That the gradient stops are what surrounds the text;
  that nothing is painted between the text and the eye; that the pile keeps the
  elements `renderPileCard` made.

## Step 1 — Opposition (opening)

**O1 — In multiplayer, no skin survives a single snapshot.** `firebaseSync.js`
`syncToLocal` emits `cardPlayed` (line 230) — `renderPileCard` draws your card,
skinned — and then, in the same call, emits `gameSynced` (line 456).
`ui.js` `handleGameSynced` then runs `this.pileEl.innerHTML = ''` and rebuilds
the whole pile with `createCardElement` (lines 607–615), which applies **no
skin**. Same tick: the skinned card is never painted. The 1 000- and 2 000-coin
decks are offline-only, silently, and the skin comment in `renderPileCard`
("exactly as safe in multiplayer as it is offline") promises the opposite. The
bloom, the sunrise, the stars: never online. Pre-existing for every skin — but
this release sells the most expensive one.

**O2 — "≥ 4.5 : 1" is true of the CSS, not of the screen.** Every dark skin paints
a coloured `drop-shadow` glow behind its own index (`.card-top` / `.card-bottom`,
5–6 px) and centre pip. That glow is lighter than the face. Rendered and
measured (text colour against the pixels actually painted 2–6 px around the
glyphs, pile size, no animation):

| skin | ♥ index vs its surroundings | ♥ centre pip |
|---|---|---|
| Neon | **4.12** | 4.35 |
| Sakura | 4.37 | 4.52 |
| Phantom | 4.40 | 4.45 |
| Frost | 4.64 | **4.41** |
| Obsidian | 4.49 | 4.50 |
| Holographic | 5.23 | **4.01** |

The reds were tuned to sit at 4.60–4.77 against the lightest stop — no margin
at all — so the glow the skin already had pushes them under the promise.

**O3 — The shimmer paints over the text.** `.card-skin-overlay` (z-index 2) with
its shimmer band (z-index 3) sits *above* `.card-top`, which has no z-index.
When the band crosses an index it tints glyph and ground alike: at its peak,
red index contrast falls to **2.70–3.73** on every dark skin (Frost 2.70, Neon
2.75, Inferno 2.81 …). Transient, but every 1.5–3 s, on the card you are
reading.

**O4 — The colour-blind floor was fitted to pass.** "≥ 15 under simulation" sits
just under the two worst revised values (16.8 and 16.9). A floor chosen after
seeing the results is a description, not a requirement; and CIEDE2000 is a
large-patch metric — the shop's index is 0.55 rem (≈ 8.8 px).

**O5 — Saturated red on black.** Obsidian's red is now `#ff2929`, Phantom's
`#ff2945`: near-spectral red on near-black vibrates at glyph edges
(chromostereopsis), and Obsidian was sold as "minimal". The optimiser maximised
ΔE, not comfort.

**Worst case:** a player pays 2 000 coins, plays online, and never sees the
deck; offline, the ♥ they bought the fix for still dips under the line the
release notes promise.

## Step 2 — Defense

**D1 (O1) — Conceded, in full.** The trace is right and nothing in the suite
could see it: the fuzzer's host mode runs against a recorder screen, the smoke
run plays offline. It predates these releases. The fix is local to `ui.js`:
remember which pile cards were *yours* when `renderPileCard` drew them (a real
card is unique by rank and suit; ghosts are never yours), and make the redraw
incremental — keep the elements already on the table when the room's pile
still starts with them, append only what is new, reapply your skin to your
cards. In the normal path the DOM already matches the room and the redraw
becomes a no-op, so the entrance effects are not replayed on every snapshot.

**D2 (O2) — Conceded; the measurement is the better one.** Fix at the cause, not
by nudging colours: put a tight **dark** halo under each dark skin's index and
pip (`drop-shadow(0 0 1.5px …)`, near-black) *before* its coloured glow, so the
pixels next to the glyph are dark whatever the glow does further out. Then
re-measure the rendered pixels, and keep that measurement in the release gate.

**D3 (O3) — Conceded.** Lift the indices and the pip above the overlay
(`z-index` 4 over the overlay's 2–3). The band then passes *under* the text; the
dark halo keeps the glyph edge.

**D4 (O4) — Partly conceded.** The floor was set with the classic deck as
reference (protan 34, deutan 49) and ΔE00 > 10 as "clearly different colours";
15 is a regression floor, and it is honest to call it that. What guarantees
legibility is O2's rendered measurement, which becomes part of the gate.

**D5 (O5) — Refuted in part.** Red on black is the classic deck's red on white,
inverted; chromostereopsis needs adjacent saturated red and blue at larger
areas, and the dark halo from D2 separates the red from the face. Obsidian's
minimal face, border and glow are untouched. If the panel wants it softer, it
can be one notch less saturated while holding every floor.

## Step 3 — Cross-examination, round 1 (opposition)

1. "*a real card is unique by rank and suit*" — and a god's ghost of that card on
   the same pile? Two identical keys.
2. "*keep that measurement in the release gate*" — which gate? The unit suite has
   no browser; the smoke run has no image decoder.
3. "*the redraw becomes a no-op*" — and burned cards, which `renderBurnedCard`
   *prepends* to the same element?

## Step 4 — Cross-examination, round 2 (defense)

1. Ghosts carry `ghost: true`; the key includes it, the "yours" set holds real
   cards only, and the comparison is over the whole ordered sequence, so
   duplicates cannot collide.
2. The smoke run: it already drives a real Chromium; a PNG is zlib-deflated
   scanlines, and Node has zlib — a forty-line decoder, no dependency. The step
   renders each dark skin's ♠ and ♥, masks the glyphs with a second render in a
   key colour, and requires ≥ 4.5 : 1 against the painted ring around them.
3. Burned cards are marked as such and left in place while the pile stands; the
   pile being won clears everything, as today.

Defense's challenge to O3: "every 1.5–3 s, on the card you are reading" — the
band covers an index for a fraction of each cycle; it is a real dip, not a
steady state. Opposition's reply: a legibility promise holds all the time or
it is not one.

## Step 5 — Panel (each written before reading the others)

**J1 — logic / evidence.** O1 is a code trace with line numbers, O2/O3 are
measurements; the defense concedes all three and offers fixes that address the
causes. O4 is correctly narrowed to "regression floor". The release as
submitted overstates its guarantees. **Partially Defensible — High.** Decisive:
*"'≥ 4.5 : 1' is true of the CSS, not of the screen."*

**J2 — risk.** O1 is the largest risk: a paid item that does nothing in one of
two modes, discovered by a buyer, not by us. Reversible and fixable before
release; shipping without it is not acceptable. **Partially Defensible —
High.** Decisive: *"The 1 000- and 2 000-coin decks are offline-only,
silently."* Condition: O1 fixed and proven in a browser.

**J3 — feasibility.** Every fix is local (ui.js redraw, three CSS rules, one
smoke step with a small decoder). The ghost and burn-card questions were
answered concretely. **Partially Defensible — Medium.** Decisive: *"a PNG is
zlib-deflated scanlines, and Node has zlib."*

**J4 — skeptic.** The package was presented as done twice and was not. Accept
only with the rendered check inside the gate, and O5 addressed rather than
argued: soften the two reddest reds one notch. **Partially Defensible —
Medium.** Decisive: *"The optimiser maximised ΔE, not comfort."*

**J5 — balancer.** Both sides agree on the facts; the dispute is only whether
to ship now or after three fixes. After, since nothing is released yet. O5:
soften, keep floors. **Partially Defensible — High.** Decisive: *"a legibility
promise holds all the time or it is not one."*

**Tally:** 5 valid, 5–0 **Partially Defensible**, 3 High → **Strong**.

## Rulings (v3.21.2, folded into the same unreleased package)

| # | Ruling |
|---|---|
| R1 | **Multiplayer keeps your skin**: remember your pile cards; incremental redraw (reuse matching elements, append new, reapply skin), no replay of entrance effects on unchanged cards; pile won clears all. Proven in a browser with the room stub. |
| R2 | **Dark halo** under every dark skin's index and pip, before its coloured glow. |
| R3 | **Text above the shimmer**: indices and pip over the overlay. |
| R4 | **Rendered check in the gate**: a smoke step measures ♠ and ♥ of every dark skin against the pixels painted around them, ≥ 4.5 : 1. The CSS gate's 15 is renamed a regression floor. |
| R5 | **Soften** Obsidian's and Phantom's red one notch, every floor held. |

## Done

| # | Status |
|---|---|
| R1 | **done** — `ui.js`: `_yours` (your pile cards by identity; ghosts never; cleared on a new match and a won pile), `syncPileElements` (keeps the common prefix, drops the rest, appends only what is new, dresses yours), `dressYourCard` (one place for class, FX and art), `dataset.key` on every card element, `dataset.burned` on burned ones. Smoke: *"online, your skin survives the room's redraw — and nothing replays"* — laid, synced, synced again, appended from the room, cleared; your card stays the same element, still dressed. **Proven to catch the defect:** with the old wipe-and-rebuild restored, the step fails ("the redraw replaced the card you just laid"). |
| R2 | **done** — every dark skin's index and pip: `drop-shadow(0 0 0.8px …0.95) drop-shadow(0 0 1.6px …0.85) drop-shadow(0 0 3px …0.6)` before its coloured glow. |
| R3 | **done** — indices and pip at `z-index: 4`, above the overlay (2) and its shimmer (3). |
| R4 | **done** — smoke: *"dark skins: every index reads against the pixels actually painted around it"*; a 40-line PNG decoder on `node:zlib`; 44 glyphs (♠ and ♥, index and pip, eleven skins) against the pixels 1.5–3 CSS px around them. It failed first (Neon ♥ 3.85, Sakura 4.25, Holographic pip 4.32, Frost 4.46) — the halo alone was not enough — and passes after the reds of seven skins were re-tuned to ≥ 5.25 : 1 against their lightest stop. Lowest as painted now: **4.73** (Phantom ♥). The CSS gate's 15 is labelled a regression floor. |
| R5 | **done** — Obsidian and Phantom `#ff4e47` (were `#ff2929` / `#ff2945`). |

Suit separation after the re-tune (seen / protan / deutan), all above the floors:
Golden 37.2 / 25.2 / 16.9 · Neon 42.4 / 32.4 / 31.3 · Shadow 38.5 / 37.9 / 31.7 ·
Inferno 35.5 / 30.1 / 24.1 · Frost 38.7 / 30.1 / 30.1 · Emerald 35.6 / 22.6 / 21.4 ·
Royal 38.1 / 38.7 / 33.9 · Sakura 31.7 / 26.8 / 24.0 · Phantom 49.4 / 39.7 / 34.2 ·
Holographic 35.7 / 34.2 / 30.6 · Obsidian 39.4 / 39.9 / 32.8 · Gods 35.3 / 24.3 / 16.8 ·
Pharaoh 31.6 / 21.2 / 30.5.

Not done, by ruling: the shimmer still lightens the ground under a glyph while
it passes (the glyph itself is no longer tinted, and the halo holds its edge);
other players still do not see your skin (a synced skin field is a schema
change, out of scope).

Evidence: 2 994 unit tests, 0 failed (section 89 adds 15); smoke green with
both new steps; fuzzer and every gate green.
