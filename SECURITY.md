# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Email
**berk9elmali9@gmail.com** with what you found and the steps to reproduce it.
You will get a reply within a few days; a fix ships as a normal release and
the report is credited if you want it to be.

## What is public on purpose

- **The Firebase web configuration** (API key, project id, app id) is served to
  every browser that opens the game. It identifies the project; it does not
  grant access. Access is decided by `firestore.rules` and
  `database.rules.json`, both in this repository and both tested
  (`tools/rules-test.mjs`, test section 64).
- The AdSense publisher id and the Search Console verification token are
  public by design.

## How player data is protected (v3.18.1)

- `users/{uid}` — a player's private record. Readable and writable only by
  that player. It holds no email (Firebase Authentication does); a counter
  moves by at most one per finished match, at most once every 10 seconds.
- `leaderboard/{uid}` — public: a cleaned display name and a score that must
  equal the private record's score in the same commit.
- `multiplayer_tables/{id}` — writable by the host, by seated players, or by a
  newcomer adding exactly themselves to a waiting table.
- Display names are restricted to letters, digits, spaces and `_ . -`, in the
  client (`public/js/safeText.js`) and in the rules.
- Every rule change is run against the Firestore emulator, with deliberately
  broken copies that must be caught, before `deploy-rules.bat` sends it
  (`tools/firestore-rules-test.mjs`).

## Known limits

- **The browser referees the match.** Rules bound how a record may change;
  they cannot prove a match was played or won. In multiplayer any seated
  player can rewrite the shared room in the Realtime Database. Closing this
  needs server-side refereeing (the `attemptSlap` / `attemptPlayCard` Cloud
  Functions exist but are not enabled) and Firebase App Check.
- The Daily Challenge board is marked unverified in the game for the same
  reason.

## What must never be in this repository

- `public/js/firebaseConfig.js` (generated locally or in CI from a secret)
- any service-account key (`*firebase-adminsdk*.json`, `serviceAccount*.json`)
- `.env` files, private keys, personal access tokens

`.githooks/pre-commit` refuses a commit that stages any of these, or a line
that looks like one. CI never receives a service-account key on pull requests.
