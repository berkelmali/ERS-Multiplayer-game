# v3.10.0

> **Amended by v3.10.1 — see `RELEASE-3.10.1.md`.** The footer/Settings
> collision below is genuinely fixed at 1920×914 and 1366×768, both verified on
> the live site. It came back below ~660px of viewport height, for a structural
> reason this release missed.

The player card, and the gate that would have caught it.

## The defect

The account panel's logged-in view shipped in v3.8.0 with **no stylesheet rules
at all**. Seven classes were named in `index.html` and defined nowhere:

```
.profile-identity  .profile-emblem  .profile-eyebrow  .profile-stats
.profile-stat      .profile-intro   .profile-history-note
```

The browser drew exactly what it was told to — bare inline text. The ♠ avatar
was a 12px glyph. Every statistic ran its label into its value (`Skor1`,
`Oynanan maç0`) because a `<span>` and a `<strong>` with no rules are inline
siblings with nothing between them. The win-rate line was clipped by the card
below it. It survived v3.8.0 and v3.9.0 and was found by a user looking at the
screen.

**Nothing in the project could have caught it.** The unit suite reads logic, not
layout. `check-locales` proved every one of those labels translated correctly —
into a panel where they were unreadable. `check-lobby` scans stylesheets for
dead selectors and by construction cannot see a class that is in no stylesheet.

## What changed

### The card

The seven classes are written, and the whole panel now speaks one language:

- A banner with a real 60px gold-ringed avatar, an uppercase eyebrow, the name
  and the email.
- The four statistics in a 2×2 grid, each a **column** — label above, value
  below. That column is the entire fix for `Skor1`.
- The two panels beneath it were fourteen inline declarations carrying a
  hardcoded `rgba(22,27,34,.45)`: the same grey in all five themes. They are
  classes now, and their surfaces come from `--panel-bg` / `--panel-border`.
- The match rows `profileUI.js` builds carried eleven inline declarations each,
  rewritten on every render, including a `#58a6ff` no theme could reach. The
  reflex trend curve hardcoded that colour four more times — a blue graph inside
  a gold card.

**Why gold, and only gold.** Surfaces follow the theme; the accent is gold in all
five on purpose. `--primary` is declared once at `:root` and **no theme
overrides it**, so a `var(--primary)` accent would have been the same blue
everywhere — which is the flatness this card exists to avoid.

### The gate — `tools/check-orphan-classes.mjs`, deploy gate 8 of 9

The inverse of `check-lobby`. A class named in markup must be **defined in a
stylesheet**, unless one of two things derived from the source is true:

1. every element carrying it also carries an inline `style` (`.spinner`,
   `.boot-error-tech` — the boot error screen must render before any stylesheet
   loads, which is its whole point);
2. some module queries it (`.ers-error-retry`, reached by `querySelector`).

There is no hand-written allowlist. Both exemptions are computed.

**Nine mutations, all accounted for:**

| | Mutation | Want | Got |
|---|---|---|---|
| M1 | naked class in `index.html` | fail | fail |
| M2′ | **every** `.profile-stat` rule removed | fail | fail |
| M3 | naked class in a JS template literal | fail | fail |
| M4 | unstyled but inline-styled | pass | pass |
| M5 | unstyled but queried by JS | pass | pass |
| M6 | interpolated class (`rank-${mode}`) | pass | pass |
| M7′ | **every** `.profile-emblem` rule removed | fail | fail |
| M8 | every `.profile-identity` rule removed | fail | fail |
| M9 | class left only inside a CSS comment | fail | fail |

M2 and M7 were first written as "delete one rule block" and both survived —
correctly. They were **equivalent mutants**: `.profile-stat span` and the media
query still mention the class, so it was still defined. Replaced with M2′/M7′,
which remove every rule.

The gate immediately found five more dead labels, none styled and none queried:
`.bot`, `.human`, `.glassmorphic-card`, `.table-action`, `.tutorial-card`.
Removed from the markup.

### Three measured lobby defects

Found by rendering at real viewport sizes and reading the geometry back, not by
reading CSS.

| | Before | After |
|---|---|---|
| Wordmark cropped — `cover` on a 1.795 image in a 2.10 window scales by width, 156px falls out, `center` splits the loss | "EGYPTIAN" lost its top | crop pinned to 15%; wordmark whole |
| `#main-menu` overflow → a permanent scrollbar down the artwork | 4px at 1920×914, 9px at 1440×900, 58px at 1366×768 | **0** at all three |
| Version footer inside the Settings button at 1366×768 | button 736–776, footer 743–758 | 37px clear |

The third was not cosmetic: `#game-version` is `pointer-events: none` but the
About and Privacy links inside it are `pointer-events: auto`, so a click aimed at
Settings could open About.

The overflow fix is one property. `min-height` is what blocks `flex-shrink`, so
the spacer's floor moved to `height` with `min-height: 0` — it still grows to
hold the interface clear of the wordmark when there is room, and now yields
instead of buying a scrollbar when there is not. All five `.lobby-spacer-top`
rules were **edited**, not shadowed by a later override.

### Two more, found while verifying

- **The account panel's own title was unreachable on short screens.**
  `justify-content: center` on an overflowing flex column pushes content out of
  *both* ends, and the top end cannot be scrolled back to — `scrollTop` is
  already 0. Measured: the `<h2>` at `top:-21` on 1920×914 and `top:-138` on
  390×844. Now `justify-content: safe center`, with a plain `flex-start` ahead of
  it for browsers that drop the keyword.
- **CSP:** `www.gstatic.com` was in `script-src` but not `connect-src`, so the
  Firebase SDK's `.js.map` sourcemap fetches were blocked — five red console
  lines, visible only with DevTools open. Added.

## AdSense

Unchanged and still off. `ads.js`, `adsConfig.js` and the seven `.ad-slot`
containers are all in place; `PUBLISHER_ID` and every entry in `AD_SLOTS` are
empty, so the build makes no third-party request at runtime. To switch ads on,
set `PUBLISHER_ID` to `ca-pub-…` and fill the slot ids — and turn **Auto ads off**
in the AdSense dashboard, because auto ads bypass every protection in
`adsConfig.js` and nothing in this codebase can stop that.

## Validation

1434 unit tests, 0 failed. Nine deploy gates green. `npm run smoke` — 49 checks,
0 unexpected console errors. Rendered and inspected at 1920×914, 1440×900,
1366×768, 1366×650, 1400×1250 and 390×844, across the classic, blue, red and
green themes.

**Not verified:** typography. This build environment cannot reach
`fonts.googleapis.com`, so every screenshot renders the fallback face, not
Outfit. Only the live site confirms it.

## Still outstanding

The game screen, the shop and the victory screen have not been touched by
v3.8.0, v3.9.0 or v3.10.0. The original brief's slap shockwave, card-back
textures, treasure-room shop and victory coin scatter remain undone. A card game
is remembered from the table.
