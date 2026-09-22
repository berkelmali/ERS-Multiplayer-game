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

## What must never be in this repository

- `public/js/firebaseConfig.js` (generated locally or in CI from a secret)
- any service-account key (`*firebase-adminsdk*.json`, `serviceAccount*.json`)
- `.env` files, private keys, personal access tokens

`.githooks/pre-commit` refuses a commit that stages any of these, or a line
that looks like one. CI never receives a service-account key on pull requests.
