#!/usr/bin/env bash
# ERS v3.4.0 — Firebase Hosting deploy (macOS / Linux / WSL).
# Hosting only, on purpose — see DEPLOY.md for why rules go separately.
set -euo pipefail
cd "$(dirname "$0")"

echo "=== 1/5  Unit tests ==="
node test_gameLogic.mjs

echo
echo "=== 2/5  Server rule mirror in sync ==="
node tools/sync-rules.mjs

echo
echo "=== 3/5  Score bounds match firestore.rules ==="
node tools/check-score-bounds.mjs

echo
echo "=== 4/5  Every string exists in all four languages ==="
node tools/check-locales.mjs

echo
echo "=== 5/5  Firebase Hosting deploy ==="
# Pinned, and non-interactive. "@latest" re-resolves against the registry on
# every run and silently downloads ~40 MB when a new version lands — which looks
# exactly like a freeze. Interactive mode waits forever on a prompt nobody sees.
echo "(first run may download firebase-tools, ~40 MB — this can take minutes)"
npx --yes firebase-tools@15.28.2 deploy --only hosting --project ers-card-game --non-interactive

echo
echo "Done.  https://ers-card-game.web.app"
echo
echo "Firestore rules are UNCHANGED in this release (the hardened block shipped"
echo "in v3.1.1). No rules deploy needed. If you do change them, they go out"
echo "separately — see deploy-rules.bat / DEPLOY.md."
echo
echo "v3.4.0: Google AdSense, confined to menu and panel screens. Never during"
echo "a match, a Daily run, practice, the lobby or the victory screen — 50 ms of"
echo "jank is 72 points on a scored slap, and a whole pile in multiplayer."
echo
echo "PUBLISHER_ID ships EMPTY: no script, no request, no cookie until you set"
echo "it in public/js/adsConfig.js. Turn AUTO ADS OFF in the AdSense dashboard —"
echo "auto ads place units anywhere, including over the game, and no code here"
echo "can stop that. A privacy policy page was added in all four languages."
echo
echo "AFTER DEPLOY, verify in a browser (nothing else can reach the site):"
echo "  - / responds with Cache-Control: no-store"
echo "  - no CSP violation for .lp in the console"
echo "  - set difficulty to Easy, start the Daily: the turn clock must stay 10000ms"
echo "  - the Privacy link next to the version label opens the policy"
echo "  - zero requests to googlesyndication while PUBLISHER_ID is empty"
