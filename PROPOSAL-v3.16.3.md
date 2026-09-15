# v3.16.3 — the boot safety net is catching the wrong things

## The defect

`public/index.html`, inline `<head>` script (the BOOT SAFETY NET, v3.7.0). Its
own comment states the intent:

> Only a failure to LOAD the app counts here.

Its condition does not implement that intent:

```js
var isResource = t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK');
reveal(isResource ? ('failed to load ' + (t.src || t.href)) : (e && e.message));
```

Any `LINK` that fails is treated as a failure to load the app. The document has
four of them:

| line | element | fatal today | should be fatal |
|---|---|---|---|
| 17 | `rel="icon"` → `assets/logo.png` | yes | no — cosmetic |
| 30 | `rel="manifest"` → `manifest.webmanifest` | yes | no — install metadata |
| 31 | `rel="stylesheet"` → `style.css?v=3.16.2` (same-origin) | yes | **yes** |
| 32 | Google Fonts stylesheet (cross-origin, `display=swap`) | yes | no — has a fallback stack |

Plus one `<script type="module" src="js/main.js">` at line 1129, which must stay
fatal and does.

## Evidence

Measured, not argued. Rendering `public/` in a cold headless Chromium on a
network where `fonts.googleapis.com` does not answer produced the full-screen
boot notice instead of the game, with this technical line underneath:

```
failed to load https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;900&display=swap
```

The game is fully playable without that stylesheet. `display=swap` plus the
fallback stack is exactly the mechanism that makes it optional.

**Confidence is not uniform across the four rows.** The Google Fonts row is
*certain* — reproduced above. The `icon` and `manifest` rows are *suspected*:
both are fetched by browser subsystems that do not reliably fire an `error`
event on the element, so they may already be harmless in practice. The proposal
must not be sold on rows that were not measured.

## Who this hits

Not an edge case. `googleapis.com` is blanket-blocked by several ad and tracker
blockers, by some corporate and school networks, and is unreachable in China.
Those users get a dead game and a notice telling them their connection dropped,
which is false.

It is also an AdSense risk on the live review path: if Google's own renderer
misses that stylesheet once, the page submitted for review is an error screen,
not a game. The site is currently in review for "insufficient content".

## The change

One condition, in the same inline net, with no new file and no import:

```js
window.addEventListener('error', function (e) {
    if (window.__ersBooted) return;
    var t = e && e.target;
    if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) {
        var url = t.src || t.href || '';
        // The app is its own files. A third-party CDN and an optional rel=
        // are not the app, and must not be able to hide it.
        var own = url.indexOf(location.origin + '/') === 0;
        var required = (t.tagName === 'SCRIPT') || (t.rel === 'stylesheet' && own);
        if (!own || !required) return;
        reveal('failed to load ' + url);
        return;
    }
    reveal(e && e.message);
}, true);
```

Everything else in the net is untouched, including the line that makes this
safe to loosen:

```js
setTimeout(function () { if (!window.__ersBooted) reveal('application did not start'); }, 12000);
```

A genuine failure to start still fails loudly after 12 seconds, whatever caused
it. The narrowed condition removes false positives, not the net.

## The gate

Test section 66, and it must not repeat the v3.16.2 mistake — a gate whose
expectation is a copy of the thing it checks is not a gate. So the test does
**not** restate the predicate. It extracts the inline script's source text out
of `index.html`, evaluates it in a sandbox with a stub `window` and `document`,
then dispatches synthetic `error` events carrying fake targets and asserts which
ones reveal the notice:

- same-origin module `<script>` → fatal
- same-origin `rel="stylesheet"` → fatal
- cross-origin stylesheet → **not** fatal
- `rel="manifest"` → **not** fatal
- `rel="icon"` → **not** fatal
- a fifth, newly added cross-origin `<link>` → **not** fatal (mutation case)
- the 12s timeout still reveals when nothing booted

## Honest limits

1. Two of the four rows in the defect table are unmeasured. The change is
   justified by row 32 alone; rows 17 and 30 are tidied on the same pass.
2. This narrows a safety mechanism. If a future same-origin resource is added
   with a `rel` other than `stylesheet` and the app genuinely needs it, the net
   will no longer catch it — the 12-second timeout will, later and with a
   vaguer message.
3. The sandbox test exercises the predicate, not a real browser. It cannot prove
   that Chrome fires an `error` event for a failed manifest; it proves what the
   net does when one arrives.
