# Council ERS-33 — Ascension (v3.23.0)

Raised by the operator: "evaluate the project, think of 3 new features, but ask
my permission before adding". Full panel (5 judges, quorum 4), in conversation.
(The repository's ERS-32 is the admin bot-match view in v3.22.5; this one is 33.)

## The three proposals and the panel's tally

| Feature | Verdict | Strength |
|---|---|---|
| F1 Tanrı Yükselişi (Ascension I-III on a beaten god) | Partially Defensible (3-2 with 2 Defensible) | Moderate |
| F2 Zayıf Yönünü Çalış (drill from Slap IQ) | Partially Defensible after one deliberation round | Weak |
| F3 Görünen Kaplama (your equipped skin visible to opponents) | Partially Defensible (4-1) | Moderate |

The operator chose F1 and F3 (F2 not built). Decisive lines: F1 — "twists are a
data table", bands are measurable. F3 — ownership cannot be verified in the
Realtime Database (the wallet is in Firestore), so the field can be spoofed;
accepted by the operator, removable with one rules deploy.

## What the build measured (tools/sim-pantheon.mjs --levels 0,1,2,3, n=1500)

The council's first idea was three twists (ghosts at the start, a smaller
priest share, Blitz). The simulation said two of them move a duel by under
three points and were dropped. A flat "at least this tier" floor jumped from a
walkover to a wall. The shipped table blends the god's tier toward Challenger
and lengthens its life; only level III takes Blitz (= Ra at noon).

Win rate %, average hero, level 0/1/2/3: Bastet 100/100/99.7/39, Thoth
99.9/99.9/99.6/14.7, Hathor 99.9/99.8/95.1/50.1, Anubis 99.9/99.5/96.9/30.9,
Set 88.3/62.7/29.8/1.7, Ra 66.9/54.7/46.2/19.5.

## Conditions the suite pins (section 93)

- One table (`ascension.js`); slapDamage takes no level; no coins (G3).
- No god at any level plays faster than Ra at noon (reaction midpoint, delay).
- Solo only: `pantheonRoom.js` and the multiplayer host do not mention it.
- A level needs the one before it; a fall records the highest level only.

## Honest limits

- Levels I-II are still easy for the early gods and III is a wall; the fast
  scripted hero is barely affected (the simulated reflex is sharper than a
  person's). A manual play is part of the gate and has not been done here.
- No telemetry: nobody knows how many players have beaten all six gods.
- The judges are separate contexts of one model.

## Addendum — F3 built as v3.23.1 (visible skin)

Built after the operator's yes, accepting the unverifiable-ownership risk.
Reading the rules changed the plan: `gameRooms/$roomId/.write` already lets any
seated player write inside the room (the same reason `activeEmoji` works), so
**no rules change and no deploy** — the council had assumed a diff. Ownership
is still unverifiable (wallet in Firestore, room in RTDB): a patched client can
write any catalogue id. The reader therefore never trusts the value as markup;
it maps it through the catalogue's closed list, and draws class and art only.
Opponents' skins are static (no live particle effects) — stricter than the
council's "only each seat's top card animates". Pinned by section 94.
