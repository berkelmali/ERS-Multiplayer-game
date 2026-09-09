# v3.12.0 — The sign-in card

The council's ranked list for the account screen, done in its order.

## What the card was

A `<div>` of loose inputs and four buttons. In one shape it carried six
separate defects:

| | Defect |
|---|---|
| 1 | **Not a form.** Enter did nothing. No password manager offered to fill or save. The browser warned about password fields outside a form on every load. |
| 2 | **No `autocomplete` anywhere.** Even a manual fill was guesswork. |
| 3 | **Two cards.** `.account-section` (a glass panel) wrapped `.auth-card` (a second glass panel): two borders, two blurs, ~70px of dead margin. |
| 4 | **The mode lived in six places.** `isRegisterMode` plus five `style.display` writes across three functions. |
| 5 | **Eight hardcoded English sentences**, and a `default` branch that printed the raw SDK code: `Error [auth/network-request-failed]: …` |
| 6 | **No password reset, no submit lock.** A double-tap on a slow connection could open two accounts. |

## The fix, in one sentence each

**A real `<form id="auth-form" novalidate>`** with one `type="submit"` button,
a `submit` listener that calls `preventDefault()`, and four `autocomplete`
values — `username`, `email`, `current-password`, and `new-password` the moment
register mode opens, because a password manager offers to *save* on the second
and to *fill* on the first.

**One card.** `.auth-card` keeps its name and gives up its skin: no background,
no border, no shadow, no padding, no second backdrop blur. It is now purely the
form's flex column.

**The mode is one attribute.** `data-mode` on the form; CSS derives every
appearance from it. No element carries an inline `display` any more — which is
also the reason the username field can *animate* in. An element the JavaScript
is not touching is an element CSS can move.

**Every message is a localization key.** `authErrorKey(code)` maps a Firebase
code to a key; 17 new keys × 4 languages. `check-locales` proves literal keys
resolve but cannot see `Localization.get(variable)`, which is now most of this
card's text — so the test suite collects the keys from the source and checks all
four languages itself.

**A password reset**, whose result is deliberately identical whether or not the
address has an account. `auth/user-not-found` reports success: otherwise the
form is a tool for answering *"is this email registered here?"*

**A submit lock** on `data-busy`, released in a `finally` — without which one
failed request would lock the card until reload.

## The part that was wrong the first time

The first cut gave the card a palette of its own: 0.68rem gold uppercase
labels, gold input icons, a gold focus ring, gold links. Internally consistent,
and wrong — it read as a different application from the settings panel, the
lobby and every popup around it, all of which take `.setting-group label`,
`.ui-input` and `var(--primary)` exactly as they come.

The card now invents no colour at all. `.auth-field label` sets one property,
`margin-bottom: 0`, and everything else about that text is the app's. The test
for it is a **negative** one, which is the only kind that could catch this: the
whole v3.12.0 stylesheet block must contain no `var(--gold…)`.

## The gate this round added

`sendPasswordResetEmail` was added to `auth.js`, and `npm run smoke` died at
`waitForBoot` with a bare 20-second timeout and **no console output at all**. A
missing named export is a *link-time* failure in ES modules: the graph never
evaluates, `main.js` never runs, so nothing in the app is alive to report
anything. It is indistinguishable from a hung page.

The instance was one line missing from `tools/firebase-stub.mjs`. The class is
*a test double drifting behind the code it doubles*, and it is now closed
mechanically: every name the app imports from the Firebase CDN must be exported
by the stub the smoke server serves for those URLs.

## Validation

- **1625 unit tests, 0 failed.** Ten deploy gates green. `npm run smoke` — 0
  unexpected console errors.
- **12 mutations, 12 caught**, including the two that no other assertion would
  have seen: an inline `display` back on the username group (it outranks the
  mode rule, and the field stays invisible with everything else green), and the
  two `.auth-card` blocks swapped (later wins at equal specificity, so the
  *order* is the whole mechanism).
- **22 behavioural checks in a real browser**: Enter submits without
  navigating, the lock engages and releases, the error is a sentence rather
  than a code, the reset confirmation is the accent colour and not the error
  one, the mode round-trips leaving nothing stranded, the label measures
  identical to a settings label, and no horizontal overflow at 1280 / 768 /
  414 / 360.

**Not verified here:** the password-reset email actually arriving, and what a
real password manager does with the form. Both need the live site.
