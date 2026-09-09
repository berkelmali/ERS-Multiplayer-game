# v3.8.0

> **SUPERSEDED by v3.9.0 — see `RELEASE-3.9.0.md`.**
> The first two bullets below no longer describe the shipped product. The
> redesigned lobby and its stylesheet (`public/lobby.css`) were reverted in
> full; the v3.7 lobby is what ships. The transition timing, reduced-motion
> guards, focus states, zoom and label fixes listed here were *kept* and moved
> into `public/style.css`. This file is left in place because why the redesign
> was abandoned is worth more than the fact that it happened.


- Redesigned the lobby with a visible game title, two prominent play options and a responsive grid for existing modes.
- Added staggered lobby entrances, panel transitions, clearer focus states and quieter button feedback.
- Shortened the desktop play transition from 1,000 ms to 340 ms and limited background pointer updates to one per animation frame.
- Preserved all themes, translations and game modes; added reduced-motion guards to pointer effects.
- Enabled browser zoom and connected the player-name label to its input.
- Aligned package, lockfile and client cache versions at 3.8.0.

Validation: `npm run verify` passed (1,380 tests, JavaScript syntax, local links, four locales, score bounds, error-modal structure and CSP hash). `npm run smoke` passed all 49 checks with zero unexpected console errors, using stubbed Firebase services.

Live browser QA covered desktop, 390×844 and 320×568 viewports, menu scrolling, a bot match/card play, quit/cancel/leave, practice entry, multiplayer login gating, Turkish localization, reduced motion and keyboard focus. No live two-account multiplayer match was run.

QA found and fixed a notification race: callbacks belonging to an older notification could hide a newer one. Notification generations now guard all delayed callbacks, with a browser regression check for replacement notifications.
