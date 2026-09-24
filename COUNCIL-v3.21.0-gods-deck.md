# Adversarial Council ERS-25 — the Deck of the Gods (v3.21.0)

Mode: in-conversation, full panel (5 judges, quorum 4). Date: 2026-09-24.
Raised by: the operator — *"benzer stylede bi tasarım geliştir, bu 2k coin
olsun, kusursuzca mağazada satılanlar gibi. güzel hoş bi efekt versin bu
design skini."* The price is the operator's: **2 000 coins**.

## The proposal under review

A sister to the Pharaoh's Deck (ERS-24, 1 000): the same hand — gold frame,
hieroglyph columns, a figure panel, serif indices, the suit beside the figure —
turned from day to **night**.

- **P1 Theme.** Ground of **lapis lazuli**: deep ultramarine with pyrite-gold
  flecks, as the stone is. The court cards carry **gods**, not royals:
  K **Osiris** (green-faced, atef crown, crook and flail; double-ended like the
  Pharaoh's K), Q **Isis** (throne crown, wings spread), J **Horus** (falcon,
  double crown, was-sceptre), A **Khepri** (the scarab lifting the sun).
  Name: **Deck of the Gods** / *Tanrıların Destesi*.
- **P2 Effect, "Night of Nut".** As the card lands the **winged sun** unfolds
  behind the figure — wings open from the disc outward — then settles to a
  faint watermark; a wave of **stars** lights from the centre out; the card
  blooms lapis-and-gold against the table. At rest the stars twinkle and the
  Ace's sun glows. Top card only; reduced motion: static.
- **P3 Tier.** Keep **☥ MYTHIC** (two items), or a new tier above it.
- **P4 Code.** Generalise, don't copy: the Pharaoh's structure moves to one
  `.pd-deck` class, each skin supplies only tokens (colours, ground) and its
  own figures; `decorateArtCard(el, card, art)` dispatches by the skin's `art`.
- **P5 Legibility.** On a dark ground the black suits' index turns ivory-gold
  and the red suits' turns coral; both computed against the lapis.

## Chamber

### Analyst

Catalogue after ERS-24: 13 skins, top 1 000 (Pharaoh's Deck, mythic). Coin
faucet unchanged: +40 a win, −15 a loss or quit, daily spin 5–200, Slap IQ
marks, first tomb raid. 2 000 ≈ 50 net wins; ≈ 160 matches at a 50 % win rate.
The Pharaoh's Deck's pieces: `pharaohDeck.js` (figures + `decorate()`), a
172-line CSS block keyed on `.card-skin-pharaoh`, test section 86. Ranks 11–14
= J Q K A. Card on the pile 130 × 195; shop preview 68 × 96.

### Opposition

1. **A re-skin at twice the price.** If the frame, the columns and the panel are
   the same, the buyer pays 2 000 for a colour swap. "Similar style" is the
   request; "the same card in blue" is not worth double.
2. **Dark ground, dark suit.** A black ♠ on lapis vanishes. Recolouring the black
   suits to gold breaks the red/black reading players rely on at speed.
3. **The effect budget.** Stars are many elements; a wave of them per landing on
   a phone, plus the bloom, plus the wings, is exactly the overdraw that stalls
   mid-range devices.
4. **Refactoring a shipped skin to add a new one** risks regressing the Pharaoh's
   Deck, which the operator has just approved in the browser.
5. **"Deck of the Gods" collides with "Table of the Gods"** — a mode name.

### Defense

1. *Partly conceded.* The shared hand is deliberate — it makes the two a set —
   but what the buyer sees is new: new ground (stone, not paper), four new
   figures, a new signature effect (the winged sun, the star wave) that the
   Pharaoh's Deck does not have. The frame is the family resemblance, not the
   product.
2. *Refuted with numbers.* Black suits go ivory-gold, red suits coral; the pair
   still differ in hue (yellow vs red) and both must clear 4.5 : 1 on the
   darkest lapis — pinned by a test, as ERS-24 did.
3. *Conceded, bounded.* A hard budget: ≤ 12 stars, opacity/transform only; the
   wings are one SVG scaled once; the bloom is the one box-shadow animation, as
   in ERS-24; everything below the top card is still.
4. *Refuted.* The refactor is mechanical and the Pharaoh's tests stay; the smoke
   run and a before/after screenshot of the Pharaoh's cards gate it.
5. *Conceded.* The gods on this deck are not the Table's gods; a shared word is
   thematic, not confusing — but the council may rename.

### Cross-examination, round 1 (opposition)

- "*the pair still differ in hue*" — at 300 ms, is yellow vs coral enough, or
  does the suit symbol carry it?
- "*≤ 12 stars*" — twelve per card, and how many cards animate at once?
- "*the Pharaoh's tests stay*" — the tests match CSS strings keyed on
  `.card-skin-pharaoh`; they will change. Which ones, and what replaces them?

### Cross-examination, round 2 (defense)

- The suit symbol always carries it (♠ ♣ vs ♥ ♦); colour is a second cue. The
  engine's own classic skin relies on the symbol the same way on the dark Obsidian.
- One card animates: the top one. Twelve stars × one card.
- The structural selectors move from `.card.card-skin-pharaoh` to
  `.card.pd-deck`; section 86's assertions are re-pointed, none removed, and a
  new section pins both decks through the same checks.
- Challenge to opposition 1: the Pharaoh's Deck at 1 000 was ruled "not a
  grind wall" on the operator's word *pahalı*; here the operator named 2 000.

## Panel

**J1 logic/evidence — Partially Defensible (High).** The legibility claim is
testable and will be tested; the re-skin charge is answered by four new figures
and a new effect, not by the frame. Decisive: *"The frame is the family
resemblance, not the product."* Q3: keep MYTHIC — a tier with two items at two
prices is a ladder, a tier per item is noise.

**J2 risk — Partially Defensible (High).** Worst case: a regression in the
approved Pharaoh's Deck. Bounded by *"the Pharaoh's tests stay … re-pointed,
none removed"* plus smoke plus a before/after render. Effect budget acceptable
at *"Twelve stars × one card."* Q4: generalise.

**J3 feasibility — Partially Defensible (Medium).** Four figures on a dark
ground need light outlines and brighter fills; the panel must lift the figure
off the stone. Decisive: *"Recolouring the black suits to gold breaks the
red/black reading"* answered by *"The suit symbol always carries it."* Name:
keep "Deck of the Gods" — the Legends menu already teaches players these names.

**J4 skeptic — Partially Defensible (Medium).** Opposition 1 stands in part:
the deck must look different at a glance in the shop tile, not only up close.
Condition: the shop preview (A) must be the Khepri scarab and sun, visibly unlike
the Eye of Horus. Decisive: *"the buyer pays 2 000 for a colour swap."*

**J5 balancer — Partially Defensible (High).** Both are right: a family needs a
resemblance and a new product needs a signature. The winged sun is that
signature. Decisive: *"a new signature effect (the winged sun, the star wave)
that the Pharaoh's Deck does not have."* Q3 MYTHIC; Q5 as defended.

**Tally:** 5 valid, 5–0 **Partially Defensible**, 3 High → **Strong**.

## Rulings and conditions

| | Ruling |
|---|---|
| Theme / name | **Lapis night, gods**: Osiris K (double-ended), Isis Q (wings), Horus J, Khepri A. **Deck of the Gods** / Tanrıların Destesi. |
| Effect | **Night of Nut**: winged sun unfolds, star wave, lapis-gold bloom; stars twinkle at rest; Ace's sun glows. ≤ 12 stars, opacity/transform only; top card only; reduced motion static. |
| Tier | **☥ MYTHIC** (the ladder: 1 000, 2 000). |
| Code | **Generalise**: `.pd-deck` structure, per-skin tokens; `decorateArtCard()`; Pharaoh's checks re-pointed, none removed. |
| Legibility | Ivory-gold for ♠♣, coral for ♥♦, each ≥ 4.5 : 1 on the darkest lapis, pinned. |

Conditions: the shop tile must read as a different deck at 68 × 96 (Khepri);
the Pharaoh's Deck renders unchanged after the refactor (before/after render +
smoke); the operator's eye in a browser before release.

## Done

| Condition | Status |
|---|---|
| Deck of the Gods, 2 000, MYTHIC | **done**: `cardSkins.js` (`art: 'gods'`), named in four languages; the tile in the shop framed in night blue |
| Figures | **done**: `godsDeck.js` — Osiris (atef crown, green face, crook and flail, double-ended), Isis (throne crown, wings spread — one drawn, one mirrored), Horus (falcon, double crown, was-sceptre), Khepri (scarab lifting the sun, shen ring); gold outlines on the stone, no ids, no typed colours |
| Night of Nut | **done**: the winged sun unfolds (scaleX) and settles to a watermark; twelve stars light in a wave from the centre (their own delays) and then twinkle; the bloom is lapis; opacity/transform only for the stars; top card only; reduced motion static |
| Generalised, not copied | **done**: every structural rule keys on `.pd-deck`; each skin gives only tokens; `decorateArtCard(el, card, art)`; `decoratePharaohCard` kept as a name. Section 86's Pharaoh checks re-pointed, none removed |
| Pharaoh's Deck unchanged | **done**: before/after render under reduced motion — 775 of 784 000 pixels differ, all at the frame's anti-aliased edge; smoke green |
| Legibility on lapis | **done**: section 87 — worst index pair 4.85 : 1 (coral on the brightest lapis), AA 4.5 : 1 |
| Shop tile reads as another deck | **done**: its Ace is Khepri and the red sun, pinned |
| Operator's eye in a browser | **operator** — in the deploy.bat checklist |

Evidence: 2 973 unit tests, 0 failed (section 87 adds 28); every gate, the fuzzer and the browser smoke run green.
