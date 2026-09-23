# Adversarial Council ERS-24 — the Pharaoh's Deck (v3.20.0)

Mode: in-conversation, full panel (5 judges, quorum 4). Date: 2026-09-23.
Raised by: the operator — *"ana menüde her alan kart designini shop sayfasında
pahalı bir fiyata satalım. bu designi kusursuzca magazada satılanlar gibi.
güzel hoş bi efekt versin bu design skini."*

## The proposal under review

A thirteenth card skin, **the Pharaoh's Deck**, drawn after the four cards in the
lobby painting (`assets/menu.jpg`): K♠ a pharaoh in the nemes, double-ended;
Q♦ a queen in the vulture crown; J♣ Anubis; A♥ the Eye of Horus. Ivory
parchment, a gold double frame, a column of hieroglyphs inside each long edge,
serif corner indices in ink black and carnelian red.

- **P1 Art.** Original inline SVG, one figure per court rank and one for the Ace,
  the same figure in every suit, tinted by the suit's colour; pips 2–10 keep the
  engine's big suit sign with a gold keyline. Not a crop of `menu.jpg`.
- **P2 Effect, "Sunrise".** When the card lands: a gold sun disc swells behind
  the figure and one sweep of light crosses the frame (~0.9 s). At rest: the
  hieroglyph columns glow in a slow travelling pulse, and the Ace's eye breathes.
  On the pile only the TOP card animates. `prefers-reduced-motion`: static.
- **P3 Price and tier.** A new tier above legendary, **☥ MYTHIC**, at **1 000**
  coins — twice the dearest skin (Obsidian, 500).
- **P4 Scope.** Unchanged from every skin: your own played cards on your own
  screen, the shop preview. Nothing synced, no rules change.
- **P5 Code.** `pharaohDeck.js` (the art and one `decorate()`), a `data-rank`
  on every card element, one skin entry with `art: 'pharaoh'`, a CSS block, the
  name in four languages, tests.

Open questions: Q1 the price; Q2 how the art is made; Q3 how much effect and on
which cards; Q4 a new tier or legendary; Q5 double-ended courts or single figures.

## Chamber

### Analyst (baseline)

Document type: feature proposal for a cosmetic, client-local shop item.
Claims: the painting defines a coherent deck (four cards visible); the item is a
coin sink; effect is tasteful and cheap. Data: coins come from wins (+40),
losses (−15), quits (−15), the daily spin (5–200 by tier), Slap IQ and the first
full tomb raid; the catalogue today totals 2 950 coins, top item 500. Pile card
is 130 × 195 px; shop preview 68 × 96 px. CSP allows `data:` images and inline
SVG. Implicit assumptions: SVG can read as "the painting's deck"; players who
own every skin have nothing to spend on.

### Opposition

1. **"Kusursuz" is the operator's word, and SVG will not be.** The painting is
   rendered art; a hand-drawn vector pharaoh next to it risks looking like clip
   art. A 1 000-coin item that looks cheaper than the lobby wallpaper is worse
   than no item.
2. **The price is a grind wall.** At a 45 % win rate a match nets about
   +9.75 coins: 1 000 is ~100 matches. Nothing tells the player how far away it is.
3. **Performance.** Skins already inject particles and animated layers into every
   pile card; a pile can hold 30+ of your cards. Another animated frame per card
   is jank on phones.
4. **Double-ended courts at 130 px are two tiny heads.** The painting's K is
   double-ended; at pile size the figure would halve.
5. **Legibility.** Gold on ivory and a serif swap in the corner indices can cost
   the one thing a slap game needs: reading rank and suit in 300 ms.

### Defense

1. *Partly conceded.* A crop is not available: the painting holds four cards at
   ~150 px, tilted and blurred, and no 7♣ at all. What makes the painting read as
   "that deck" is the frame, the parchment and the hieroglyph columns — those are
   pure geometry and SVG draws them exactly. The figures follow the house style
   `godArt.js` already ships (the Legends portraits the operator accepted).
2. *Refuted in part.* It is meant to be the long-term sink; the catalogue's 2 950
   is exhausted by committed players. The shop already shows the price and
   locks the button below it. Daily spin tiers add 10–200 a day.
3. *Conceded.* Top card only; lower cards drop to the static look.
4. *Partly conceded.* Keep the double-ended K as painted — it is the signature
   card — but draw it as one figure mirrored at the waist, each half at full
   width; Q and J single half-length figures as in the painting.
5. *Refuted with a guard.* Corner indices stay the engine's weight and size; only
   the colour moves to ink/carnelian, checked for contrast on the parchment.

### Cross-examination, round 1 (opposition)

- "*Follow the house style godArt.js already ships*" — those are 120 px portraits
  on dark medallions; will they survive on ivory at pile speed?
- "*The shop already shows the price*" — it shows the price, not the distance.
  Where does the player see 640/1 000?
- "*Checked for contrast*" — by what, and against which colour?

### Cross-examination, round 2 (defense)

- Figures are redrawn for the light ground, not re-used: strong ink outline,
  flat lapis/gold/carnelian fills, no gradients below 4 px.
- Accepted: the locked button reads "🪙 640 / 1 000" style progress for this item.
- Computed WCAG ratio for each index colour on the parchment, pinned by a test.
- Challenge to opposition point 2: the operator asked for *pahalı*. A price a
  new player reaches in a week is not expensive; the grind is the request.

## Panel

**J1 logic/evidence — Partially Defensible (High).** The crop is correctly ruled
out by the analyst's numbers; the SVG route is the only one with evidence it can
be finished. Decisive: *"the painting holds four cards at ~150 px, tilted and
blurred, and no 7♣ at all."* Q1: 1 000 stands — it is the only figure tied to the
existing ladder (2 × top). Condition: contrast computed, not asserted.

**J2 risk — Partially Defensible (High).** Worst case is a jank-prone pile on
phones and an item that disappoints after 100 matches. Both are addressed only
if the conditions are binding. Decisive: *"Top card only; lower cards drop to
the static look."* Reversible (cosmetic, local). Q3: top card only, no particle
cloud. Q4: a new tier is fine if it costs one config line.

**J3 feasibility — Partially Defensible (Medium).** Four figures and a frame in
SVG is a day's work; the hover cycle in `shopUI.js` rebuilds the class list and
the centre text, so `decorate()` must be re-run there too. Decisive: the
opposition's *"Double-ended courts at 130 px are two tiny heads"* answered by
*"one figure mirrored at the waist, each half at full width"*. Q5 as defended.

**J4 skeptic — Partially Defensible (Medium).** Opposition 1 was not fully
answered: taste cannot be proved by a test. Accept only with an operator eye on
the result before release. Decisive: *"A 1 000-coin item that looks cheaper than
the lobby wallpaper is worse than no item."* Q1: 1 000, with the progress readout.

**J5 balancer — Partially Defensible (High).** Both sides are right: the grind is
the request, and distance must be visible. Decisive: *"it shows the price, not
the distance."* Q2 SVG; Q3 top card only; Q4 MYTHIC; Q5 K double-ended, Q/J single.

**Tally:** 5 valid (quorum met), 5–0 **Partially Defensible**, 3 High in the
majority → **Strong**.

## Rulings and conditions

| | Ruling |
|---|---|
| Q1 price | **1 000 coins**, and the locked button shows the distance (have / need). |
| Q2 art | **Original SVG**, redrawn for a light ground; no crop, no raster. |
| Q3 effect | **Sunrise** on landing, slow glyph pulse at rest; **top card only**; no particle cloud; reduced-motion static. |
| Q4 tier | **☥ MYTHIC**, one new rarity entry. |
| Q5 courts | **K double-ended** (mirrored at the waist), **Q and J single** half-length, **A the Eye of Horus**. |

Conditions before release: contrast of each index colour on the parchment
computed and pinned by a test; `decorate()` idempotent and re-run on the shop's
hover cycle; the operator looks at the pile and the shop card in a browser.

## Done

| Condition | Status |
|---|---|
| 1 000 coins, MYTHIC tier | **done**: `cardSkins.js` (`rarity: 'mythic'`, `art: 'pharaoh'`), `shopUI.js` badge `☥ MYTHIC`, a gold-framed shop tile, a five-note unlock chime |
| Distance on the locked button | **done**: "🪙 640 / 1000" in place of "Unlock — 🪙 1000" while out of reach, for every skin (one line on a phone) |
| Original SVG figures | **done**: `pharaohDeck.js` — K pharaoh (nemes, crook and flail, mirrored at the waist), Q queen (blue crown, lotus), J Anubis (was-sceptre), A Eye of Horus; each court card in a gold panel with its suit beside the figure; no ids, no typed colours |
| Sunrise, top card only, reduced motion | **done**: `style.css` "THE PHARAOH'S DECK" — sun disc, a gold bloom against the table as the card lands (its own fly-in, which leaves the box-shadow frame alone), one light sweep per 6 s, light travelling down the glyph columns (masked by them), the Ace's eye breathing; `#pile-cards … :not(:last-child)` stops all of it below the top card; `prefers-reduced-motion` stills it |
| Contrast computed | **done**: test section 86 — worst index pair 4.67:1 (carnelian on the parchment's darkest edge), AA 4.5:1 |
| `decorate()` idempotent, re-run on hover | **done**, pinned on a page-less stand-in for the DOM |
| Operator's eye in a browser | **operator** — in the deploy.bat checklist |

Evidence: 2 945 unit tests, 0 failed (section 86 adds 34); every gate green.
