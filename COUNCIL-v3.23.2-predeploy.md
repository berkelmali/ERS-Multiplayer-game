# Council ERS-34 — pre-deploy hard review of v3.23.0 + v3.23.1 (result in v3.23.2)

Independent judges (5 agents that saw only the transcript). Full transcript and
tally are in the ERS project doc COUNCIL-ERS-34-predeploy.md.

**Verdict: Defensible, 4-1 (J3 Partially Defensible), strength Weak** — no judge in
the majority was highly confident. Every quote was checked against the transcript.

Decisive line: a refused skin write "leaves everyone seeing only their own skin,
exactly as before v3.23.1". The one unobserved link is that write: the rules
emulator could not be downloaded here and the browser stub's update() is a no-op,
so "no rules change is needed" is a reading of the rule text plus sibling
scenarios, not an observation.

Measured before the verdict: 3273 unit tests; full Chromium smoke including three
new steps (hall, duel sized by level and a fall recording the level, another
seat's card in that seat's skin, hostile room value drawn as nothing, only a
wallet-owned skin shared); mutants on those steps caught, except that accepting
any string in cleanSkinId is caught by the unit suite, not the browser (a second
layer, getSkinClass, blocks it there); host-mode fuzzer through the real
syncToLocal with no invariant broken.

Changes from the review (v3.23.2):
- "no coins" -> "no extra coins" in four languages and the notes: a win against an
  ascended god pays the ordinary bot-match 40, capped per day by the server.
- The hall names the next level's effect in words (no tooltip on a phone); pills
  are 40 px.
- Kill switch SHARE_SKINS in seatSkins.js: false = nothing written, nothing drawn.
- tools/smoke.mjs covers both features from now on.
- deploy.bat: a post-deploy two-player check with the kill switch as the answer.
