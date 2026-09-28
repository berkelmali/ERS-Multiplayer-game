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
- `wallets/{uid}` (v3.22.0) — a player's coins and owned card skins. Until
  v3.22.0 both lived in localStorage and one console line could mint any
  amount. Readable only by the player (and admins). A player may move the
  balance in five shapes only: spend (down), buy one catalogue skin at exactly
  its price (the price list is in the rules), earn at most 80 per write and
  1200 per UTC day, claim the wheel once per UTC day for at most 200, and a
  one-time import of the old local balance worth at most 1000.
- Sending coins is admin-only. An admin is an account with a document in
  `admins/{uid}`, which has **no client write rule** — it can only be created
  in the Firebase console. Every grant commits atomically with an immutable
  `coin_grants/{id}` record (who, to whom, amount, before, after, reason); an
  old record cannot be replayed to cover a new change.
- The admin page (`/admin`, v3.22.1) is an ordinary page: signing in proves
  nothing, the rules decide. It is noindex, disallowed in robots.txt and
  never cached. There is no SQL anywhere; Firestore/RTDB queries are
  parameterised. The injection surfaces that exist are guarded: every id that
  becomes part of a database path must match `[A-Za-z0-9_-]` (`safeId`), no
  player-chosen text ever reaches `innerHTML` (the page builds DOM nodes),
  and the CSV export defuses formula-leading cells.
- An admin may GIVE at most 20000 coins per UTC day (council ERS-28): the
  counter `admin_daily/{uid}` moves in the same commit as every grant and
  cannot be written on its own, so a stolen admin password is capped too.
  Recommended: enable multi-factor sign-in for admin accounts, and use the
  admin page in a separate browser profile — it shares the game's origin
  and sign-in session.
- Admins may READ live game rooms (v3.22.2, RTDB `admins/{uid} === true`,
  set in the console). That includes every player's hand, so an admin
  account must not be used to play. Revoking an admin means removing BOTH
  flags: Firestore `admins/{uid}` and RTDB `admins/{uid}`. The room feed on
  the admin page is derived from snapshot differences and is best-effort.
- Admins may DELETE — never edit — what the server's own data calls dead
  (v3.22.3, council ERS-30): a game room that is over or has had no move
  for 15 minutes; a lobby mirror whose room is gone or dead, or whose host
  has no connection marker; a Firestore table that is finished, a lobby
  unstarted for 30 minutes, or opened more than 2 hours ago. A live room
  cannot be deleted. Known limit: Firestore cannot see the room, so a table
  record over 2 hours old can be deleted while a replayed match is still
  running in its room (the match continues; reconnecting to it breaks). The
  admin page never offers that, but a stolen admin password could. A seated
  player can also pin their room as "alive" by writing a future
  `lastPlayTime`; the console can still remove it.
- `online/{uid}/{connectionId}` (v3.22.3, activity v3.22.4) holds one marker
  per open signed-in tab — `{ at, t, s }`: when it connected, when its
  activity last changed, and one word from a closed list (menu, bots, daily,
  legends, match), written on a screen change only. The server removes it on
  disconnect. Only the owner writes it, the rules refuse any other word or
  field, and only admins can list it.
  During a bot, Daily or Legends match (v3.22.5) the marker also carries `g`:
  hand sizes, pile and burn size, whose turn, move count, over, and a count of
  page errors — integers and a boolean with fixed bounds, never a card. At most
  one write per 5 s, only when it changed; removed when the match ends. These
  matches run in the browser, so a player can write any summary they like —
  it is a diagnostic an admin reads, not a record anything trusts. It is deliberately separate from
  `presence/{uid}`, which decides whether a seated player is dropped.
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
- For the same reason a forged client can claim match wins and so earn coins —
  but no more than the daily cap a real player meets (1200). It cannot set a
  balance, buy below price, or spin twice in a day.

## What must never be in this repository

- `public/js/firebaseConfig.js` (generated locally or in CI from a secret)
- any service-account key (`*firebase-adminsdk*.json`, `serviceAccount*.json`)
- `.env` files, private keys, personal access tokens

`.githooks/pre-commit` refuses a commit that stages any of these, or a line
that looks like one. CI never receives a service-account key on pull requests.
