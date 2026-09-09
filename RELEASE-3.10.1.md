# v3.10.1

Amends `RELEASE-3.10.0.md`. One defect, found by checking v3.10.0 on the live
site rather than by trusting its own release notes.

## What v3.10.0 got right

Verified on `https://ers-card-game.web.app` after deploy, at real viewport sizes:

| | Result |
|---|---|
| Console | 0 errors. The five `.js.map` CSP violations are gone. |
| `connect-src` | now carries `https://www.gstatic.com` |
| `Cache-Control` on `/` | `no-cache, no-store, must-revalidate` |
| Version, cache busters | `v3.10.0` everywhere, `style.css?v=3.10.0` |
| Menu overflow @ 1920×914 | **0** (was 4px, and a scrollbar) |
| Menu overflow @ 1366×768 | **0** (was 58px) |
| Footer vs Settings @ 1366×768 | 34px clear, boxes do not intersect |
| Misrouted click | `elementFromPoint` at the Settings button's centre returns `btn-settings`, not the About link |
| Wordmark | complete, top not cropped |
| Account panel `<h2>` @ 1366×640 | `top: 24` (was `-138` on a phone) |
| Player card, red theme | surface `rgba(42,11,11,.75)` = the theme's `--panel-bg`; stat values and trend curve `rgb(255,215,0)` |
| Stat cells | `display: grid`, two columns; each cell `flex-direction: column`, label above value |
| Raw locale keys | none |
| `googlesyndication` requests | none |

## What it missed

The footer/Settings collision returns below roughly 660px of viewport height,
and the reason is structural rather than a matter of degree.

`#game-version` is `position: absolute; bottom: 10px`, so it is pinned to
`#main-menu`'s **padding box** — a box of fixed height. The buttons are in
normal flow, and once the content outgrows that box they carry on into the
scrollable overflow. v3.10.0's 44px bottom reserve sits at the end of the
*content*; it cannot separate two things when only one of them is in the
content.

Measured live at 1366×640: Settings `574–615`, footer `613–630` — two pixels of
overlap. At 560px tall it is forty.

## The fix

At the heights where the menu genuinely scrolls, the footer stops being pinned
and joins the flow: it lands after the last button plus its own margin, and is
reached by scrolling like everything else. The breakpoint is the
`max-height: 760px` query that already exists, comfortably above where overflow
begins (~677px of content), so the two can never disagree.

Measured across nine heights — 1920×914, 1366×768 and 390×844 unchanged;
1366×700 / 660 / 640 / 600 / 560 and 390×667 all now hold a constant **38px**
gap. Four mutations, four caught.

## Validation

1441 unit tests, 0 failed. Eight gates green. `npm run smoke` — 49 checks, 0
unexpected console errors.

Typography is now confirmed too: the live check ran in a real browser that can
reach Google Fonts, so Outfit is what renders. That was the one claim v3.9.0 and
v3.10.0 could not make.
