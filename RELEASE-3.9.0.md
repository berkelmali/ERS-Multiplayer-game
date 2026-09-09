# v3.9.0

Supersedes `RELEASE-3.8.0.md`. v3.9.0 is **v3.7 restored, with v3.8.0's real
repairs kept** — not a new design.

## What was reverted, and why

`public/lobby.css` (5 KB, introduced in v3.8.0) was deleted in full and
`public/index.html` returned to the v3.7 lobby markup. The council review found
the v3.8.0 *structure* defensible and recommended replacing only its visual
layer; the user rejected both the redesign and that recommendation — *"eski
dizayn bile daha iyiydi"*. The council answered "is this defensible as code";
the question being asked was "does this feel like a game". Those are different
questions, and on this one the user's answer governs.

Four concrete regressions the stylesheet had shipped:

| Rule | Effect |
|---|---|
| `body.menu-screen::after` at `z-index: 2`, `rgba(5,10,19,.94)` | A full-viewport scrim between the artwork (`z:1`) and the interface (`z:5`) — five themed backgrounds flattened to one blue-black |
| `!important` colour on `#main-menu .sleek-sub` | Beat the inline hues in `index.html`; Shop gold, Daily sky, Slap IQ mint and Practice purple all became the same grey |
| `#btn-play-bots { box-shadow: 0 8px 26px #0004 }` | Replaced the theme glow with a flat drop shadow — the single change that made an arcade lobby read as a settings page |
| `.lobby-edition`, `#main-menu .lobby-suit`, `#main-menu h1 > span:first-child` | Matched **nothing**. Written, reviewed, deployed, never once drawn |

The old file is kept as `_to_delete_lobby.css.bak` at the repository root —
outside `public/`, so it cannot be served.

## What was kept from v3.8.0

These were genuine repairs and were moved into `public/style.css`:

- `#main-menu { overflow-y: auto; overscroll-behavior: contain; }` — on short
  phones the Settings button sat below the fold and **could not be reached at
  all**. This is the most serious defect either release fixed.
- `:focus-visible` rings on `.btn`, `.link-btn` and `.ui-input`.
- A `@media (prefers-reduced-motion: reduce)` block.
- The play transition at 320 ms (was 800 ms).
- Browser zoom re-enabled; the player-name label bound to its input.

## What v3.9.0 added on its own

- `.lobby-spacer-top` / `.lobby-spacer-bottom` with viewport-height variants —
  what stops the name field from landing on the gold logo.
- A real `<h1 class="visually-hidden">`; the menu previously had **no `<h1>` at
  all**.
- Mobile readability scrim on `#main-menu::before` at `z-index: -1` — inside the
  interface's own stacking context, so it can never bury the artwork the way
  v3.8.0's body-level scrim did.
- Five missing locale keys (`profileIntro`, `profilePlayerCard`, `profileGames`,
  `profileWinRate`, `profileLocalHistory`) in all four languages. Without them
  the account panel printed raw keys — `Localization.get()` returns the key on a
  miss, not `undefined`.
- **`tools/check-lobby.mjs`**, deploy gate 7 of 8. It reads *every stylesheet
  `index.html` links* rather than a filename, so it arms itself the moment
  another focused stylesheet appears. It checks: no dead selectors in a small
  dedicated sheet, no body-level scrim between artwork and interface, no
  `!important` colour on `.sleek-sub`, the play button keeps a theme-coloured
  glow, and `prefers-reduced-motion` is present.

## Validation

`node test_gameLogic.mjs` — 1380 passed, 0 failed. All eight deploy gates green.

**Not verified:** typography. This build environment cannot reach
`fonts.googleapis.com`, so every screenshot taken here renders the fallback face,
not Outfit. Only a look at the live site confirms it.

## Still outstanding

The original brief asked for a level-up that v3.9.0 does not deliver: gold-leaf
arcade buttons with shimmer, a player identity card, categorised secondary
buttons, a slap shockwave, card-back textures, the shop as a treasure room, and a
victory coin scatter. **The game screen, the shop and the victory screen were not
touched by v3.8.0 or v3.9.0.** A card game is remembered from the table, not the
lobby.
