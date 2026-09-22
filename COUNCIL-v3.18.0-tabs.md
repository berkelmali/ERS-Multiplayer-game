# Adversarial Council ERS-19 — "Tabs for the Legends panel?"

Mode: in-conversation, full panel (5 judges, quorum 4). Date: 2026-09-22.
Raised by: the operator, who could not find the Duat and Tomb entries and then
handed the call over — *"sen tam yetkilisin"*. The five ERS-18 fixes are
already ruled; this council decides only how the panel is navigated.

## Step 0 — Analyst
- F1. The Legends panel stacks: Pantheon heading and paragraph, **six god
  cards**, then the Duat and Tomb cards. At 1280×860 the journeys start below
  the fold; the operator asked where their buttons were.
- F2. **No screen in the app uses tabs** (searched index.html and style.css:
  no tab role, class or segmented control). Every panel is one scrolling
  column of sections with `h3` headings in the shared blue (`.rules-content h3`,
  Slap IQ's `iq-h3`).
- F3. The god list is a progression that grows by one card per win; the two
  journeys are two fixed entries.

## Step 1 — Opposition (against tabs)
1. Tabs are a UI language this app has never spoken (F2) — P6 says a feature
   does not bring its own.
2. Tabs hide two of three modes behind a control; the complaint was
   discoverability, and hiding is its opposite.
3. The real cause is order (F1, F3): a long, growing list placed in front of
   two short fixed entries.

## Step 2 — Defense (for tabs)
1. Partially concede: no tabs exist. But a segmented control is small.
2. Refute: tabs show all three names at once, at the top — that is
   discoverable. 3. Concede: order is the cause; tabs treat the symptom.
Strength: tabs scale if more Legends come.

## Step 3 — Cross-examination
- **Opp → Def:** *"Tabs show all three names at once."* So does a column whose
  first screen holds all three entries. — **Def:** yes, if the journeys move up
  and the gods are introduced by one heading.
- **Def → Opp:** *"hiding is its opposite"* — tabs hide the gods only after
  the player has seen the tab labels. — **Opp:** and the gods are the one list
  that grows; putting them last loses nothing.

## Step 5 — Judges (each written alone)
- **J1 logic · Not Defensible (tabs) · High.** The cause is order, conceded by
  the defense; tabs are the wrong remedy. *"order is the cause; tabs treat the symptom."*
- **J2 risk · Not Defensible · Medium.** A new pattern on one screen is how
  this project has had to roll back UI before (P6 evidence: v3.9.0, v3.13.0).
- **J3 feasibility · Not Defensible · High.** Reordering is a markup move;
  tabs need state, focus handling and keyboard support nothing else needs.
- **J4 skeptic · Not Defensible · High.** The strongest pro-tab argument —
  all three names up front — was matched by the column. *"So does a column whose first screen holds all three entries."*
- **J5 balancer · Partially Defensible · Medium.** Tabs would scale; not today.

## Step 6 — Tally
Not Defensible 4 (J1, J2, J3, J4), Partially Defensible 1. Quorum 5/5.
High-confidence majority judges: 3 → **Strong**.

### Verdict: NO TABS (Strong). Reorder instead.
1. The two journeys come first, side by side, under a shared-style heading.
2. The Table of the Gods follows under its own shared-style heading, with its
   one-line rule, then the god cards.
3. Section headings take the shared panel style (ERS-18 fix 4).

## Implemented (v3.18.0, same day)
- Legends panel: `Journeys` section (Duat + Tomb cards) first, then `Table of the Gods`
  with its rule and grid. No tab markup. Test section 79 pins the order and the absence of tabs.
- ERS-18 fixes 1–5 shipped with it; 7 mutations run, 7 caught; smoke green; rendered at 1280 and 390 px.
