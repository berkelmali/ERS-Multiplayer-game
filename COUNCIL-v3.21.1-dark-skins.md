# Adversarial Council ERS-26 — the dark skins you cannot read (v3.21.1)

Mode: in-conversation, full panel (5 judges, quorum 4). Date: 2026-09-24.
Raised by: the operator, with a screenshot of the shop — *"mağazada aktif olup
fazla siyah olduğu için okunmayan skinler var… bunlar için bir çözüm üret"*.
Circled: Neon, Shadow, Inferno, Frost, Emerald, Royal, Phantom, Holographic,
Obsidian.

## The finding (measured, not eyeballed)

Section 24 of style.css says the skins "only override background/border/
box-shadow — .card.red/.card.black are left untouched, so suit-colour
readability is preserved regardless of equipped skin." The premise is false:
eleven of the twelve paid skins paint a near-black face, and `.card.black`
paints its index `#0d1117`. WCAG ratio of that index against each skin's
lightest background stop:

| skin | black index | red index (`#e53e3e`) |
|---|---|---|
| Golden | 1.02 | 2.25 |
| Neon | 1.03 | 3.99 |
| Shadow | 1.03 | 4.00 |
| Inferno | 1.03 | 3.22 |
| Frost | 1.03 | 3.22 |
| Emerald | 1.05 | 2.37 |
| Royal | 1.03 | 3.45 |
| Sakura | 1.00 | 3.19 |
| Phantom | 1.00 | 4.19 |
| Holographic | 1.02 | 3.58 |
| Obsidian | 1.00 | 4.22 |

1.0 : 1 is black on black. And it is not only the shop: the same classes paint
**your own cards on the pile**, where a rank has to be read in 300 ms. Golden
and Sakura were not circled but fail the same way (Sakura's preview happened to
be a red K♥).

## The proposal

- **P1** Every dark skin gets its own two index colours — a light, accent-tinted
  one for ♠♣ and a light red/pink for ♥♦ — each ≥ 4.5 : 1 against every stop of
  that skin's background gradient.
- **P2** Keep the skins' faces as they are (the look people bought).
- **P3** A gate: a test reads every skin's gradient from style.css and its two
  index colours, and fails if any pair is under 4.5 : 1 or if a skin has none —
  so the next skin cannot ship unreadable.
- **P4** Ship as v3.21.1 on top of the unreleased v3.21.0: one deploy.

## Chamber

**Analyst.** Twelve paid skins; eleven dark; the art decks (ERS-24/25) already
carry computed index tokens. The fix is CSS only: `.card.card-skin-X.black` and
`.red` (0,3,0) outrank `.card.black` (0,2,0).

**Opposition.** (1) Eleven hand-picked tints are eleven opinions; one universal
light pair is simpler and cannot drift. (2) Light text on a glowing skin loses
the "dark luxury" look buyers paid for. (3) Red vs black at speed: if both
indices are pale, the suit colour stops carrying information. (4) A test that
parses CSS gradients is brittle — a skin written as `background-image` or with
rgba stops escapes it. (5) The shimmer overlay sits above the text (z-index 2)
and may still wash it out.

**Defense.** (1) *Partly conceded*: the numbers are not opinions — each pair is
computed against that skin's own stops; tinting to the accent keeps each skin's
identity, which a universal white does not. (2) *Refuted*: the face, border,
glow and particles are untouched; only the characters change, and unreadable
luxury is not a feature. (3) *Answered*: ♥♦ stay in a red family (red channel
dominant by ≥ 60), ♠♣ stay near-neutral — the test enforces both. (4)
*Conceded, guarded*: the test fails loudly when it finds no hex stop or no
index rule for a skin, rather than passing it. (5) *Measured*: the shimmer is a
moving 8–15 % band; the drop-shadow glow each skin already puts behind its text
now sits behind light text, which it helps.

**Cross-exam 1 (opposition).** "*computed against that skin's own stops*" — the
worst stop, or an average? "*fails loudly*" — including a new skin added
without index colours?

**Cross-exam 2 (defense).** The worst (lightest) stop — the minimum over every
stop. Yes: every `cssClass` in `CARD_SKINS` except classic and the art decks
must have both rules, or the test names it. Challenge to (1): a universal
white on Golden's `#5a4400` stop gives the same ratio but turns a gold skin's
ranks grey — the exact identity loss (2) warned against.

## Panel

**J1 logic/evidence — Defensible (High).** The table is the argument: 1.0 : 1.
Decisive: *"1.0 : 1 is black on black."* P1–P3 follow.

**J2 risk — Defensible (High).** Low risk, fully reversible, CSS only; the gate
removes the recurrence. Decisive: *"so the next skin cannot ship unreadable."*

**J3 feasibility — Defensible (High).** Twenty-two declarations and one test.
Decisive: *"`.card.card-skin-X.black` … (0,3,0) outrank `.card.black` (0,2,0)."*

**J4 skeptic — Partially Defensible (Medium).** Opposition (3) needs the
enforcement the defense promised, and (5) was measured only by argument.
Condition: a before/after render of the shop and the pile.

**J5 balancer — Defensible (Medium).** Per-skin tints keep identity; the gate
keeps the floor. Decisive: *"a universal white … turns a gold skin's ranks grey."*

**Tally:** 5 valid; 4–1 **Defensible**, 3 High in the majority → **Strong**.

## Rulings

| | Ruling |
|---|---|
| Scope | **All eleven dark skins**, circled or not. |
| Colours | **Per skin**, accent-tinted light for ♠♣, light red family for ♥♦, each ≥ 4.5 : 1 against every background stop. |
| Faces | **Unchanged.** |
| Gate | **Yes**: every non-art paid skin must have both index rules and clear the floor; red stays red, black stays neutral. |
| Release | **v3.21.1** on top of v3.21.0, one deploy. |

Condition (J4): before/after render of the shop and the pile.

## Done

| Ruling | Status |
|---|---|
| All eleven dark skins, per-skin colours | **done**: 22 declarations in style.css, "Readable indices on the dark skins"; worst pairs now 4.5 : 1 or better on every stop (lowest: Golden ♥♦ 5.14, Emerald ♥♦ 5.25, Sakura ♥♦ 5.34; ♠♣ 8.19–15.99) |
| Faces unchanged | **done**: no background, border, glow or particle touched |
| Gate | **done**: section 88 reads each skin's gradient and its two rules from style.css; proven by removing the block — the test fails and names all eleven skins |
| Before/after render (J4) | **done**: the shop at the operator's view, before and after, side by side |
| Section 24's false promise | **rewritten** to say what is true and where the rules live |

Evidence: 2 977 unit tests, 0 failed (section 88 adds 4); gates and the browser smoke run green.

## Review — "can red and black still be told apart?" (the operator)

The first pass cleared contrast against the **background** but did not measure
the two suits against **each other**. Measured now, CIEDE2000 between each
skin's ♠♣ and ♥♦, as seen and under simulated protanopia and deuteranopia
(Machado et al. 2009, severity 1). Reference, the classic deck: 47 / 34 / 49.

| skin | first pass (seen / protan / deutan) | revised |
|---|---|---|
| Golden | 28.6 / 14.9 / 10.1 | 37.2 / 25.2 / 16.9 |
| Neon | 38.6 / 26.9 / 26.7 | 49.5 / 43.7 / 37.9 |
| Shadow | 34.3 / 30.8 / 26.9 | 42.0 / 44.5 / 35.4 |
| Inferno | **21.8 / 15.2 / 12.3** | 35.4 / 30.1 / 24.2 |
| Frost | 34.8 / 21.9 / 23.4 | 42.0 / 36.8 / 34.7 |
| Emerald | 42.2 / 16.5 / 15.3 | 35.3 / 22.7 / 21.5 |
| Royal | 25.2 / 17.7 / 18.9 | 38.1 / 38.7 / 33.9 |
| Sakura | 26.8 / 22.9 / 19.7 | 35.7 / 35.4 / 30.5 |
| Phantom | 43.8 / 27.8 / 26.6 | 52.9 / 43.7 / 35.5 |
| Holographic | 28.5 / 22.5 / 23.6 | 39.5 / 40.8 / 34.6 |
| Obsidian | 33.5 / 29.7 / 26.1 | 43.1 / 46.7 / 36.3 |
| Deck of the Gods | **29.0 / 14.7 / 9.2** | 35.3 / 24.3 / 16.8 |
| Pharaoh's Deck | 31.6 / 21.2 / 30.5 | unchanged |

The operator was right: Inferno (peach vs salmon) and the Deck of the Gods
(ivory-gold vs coral) were two light colours of nearly one lightness; for a
deuteranope they were almost one colour. Revision: ♠♣ near-white with a trace
of the accent, ♥♦ a saturated red as deep as each face allows while still
clearing 4.5 : 1 against it — lightness now carries the difference where hue
cannot. Chosen by search over red hues 348°–4°, maximising the weakest of the
three distances. Golden and the Gods remain the tightest (16.8–16.9 for a
deuteranope): their faces are the brightest, so their red cannot be darker —
still above the new floor, and the suit symbol's shape always carries it too.

New floor in the gate (section 88): ΔE00 ≥ 30 as seen, ≥ 15 under each
simulation, for every paid skin and both art decks. Proven: putting back the
first-pass Inferno and Gods colours fails the test by name.

Note on stakes: no slap pattern in this game depends on suit or colour (the
seven patterns are all rank-based), so this is legibility and comfort, not a
rules risk.

Evidence: 2 979 unit tests, 0 failed.
