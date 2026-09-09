# Firestore Security Rules

The following Firebase rules secure the Egyptian Rat Screw (ERS) web application data structure.

### Validation Review

- **Users Collection**: Users can only write their own score (via `request.auth.uid == userId`); anyone can perform reads to see global leaderboards.
- **Multiplayer Tables**: Strict host-based control over table creation and deletion (`hostId == request.auth.uid`). Joining users are allowed to trigger updates.
- **Game Rooms**: Synchronized state updates during matches remain accessible to actively authenticated participants.
- **Daily Challenges** (v3.0.0): one score document per player per UTC day, at
  `daily_challenges/{YYYY-MM-DD}/scores/{uid}`. Public read (it is a global
  board); a player may only write the document whose id is their own uid, which
  is what makes `dailyChallenge.js`'s "never downgrade an existing entry" check
  meaningful rather than merely polite. The board query is
  `orderBy('score','desc').limit(20)` on a single field, so it needs **no
  composite index** — this is exactly why scores live in a per-date
  subcollection instead of one flat collection with a `date` field.

## Rules Block

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // 1. Users collection: public read, private write
    match /users/{userId} {
      allow read: if true; 
      allow write: if request.auth != null && request.auth.uid == userId;
    }

    // 2. Multiplayer tables
    match /multiplayer_tables/{tableId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.resource.data.hostId == request.auth.uid;
      allow delete: if request.auth != null && resource.data.hostId == request.auth.uid;
      // Allow if the user is in the players array, or if they are updating to join/leave
      allow update: if request.auth != null; 
    }

    // 3. Daily Challenge boards (v3.0.0)
    match /daily_challenges/{dateKey}/scores/{userId} {
      allow read: if true;
      allow create, update: if request.auth != null
                            && request.auth.uid == userId
                            && request.resource.data.uid == userId
                            && request.resource.data.score is int
                            && request.resource.data.score >= 0
                            && request.resource.data.score <= 5000;
      allow delete: if false;
    }

    // 4. Game rooms (in-game synchronization)
    match /gameRooms/{roomId} {
      allow read: if request.auth != null;
      // Allow creation by hosts starting the game
      allow create: if request.auth != null && request.auth.uid in request.resource.data.playerIds;

      // Strict rule: only players participating in this room can modify it
      allow update: if request.auth != null && request.auth.uid in resource.data.playerIds;
      
      // Slap Attempt Subcollection - Anyone in the room can slap at any time
      match /slapAttempts/{attemptId} {
        allow create: if request.auth != null && 
                      request.auth.uid in get(/databases/$(database)/documents/gameRooms/$(roomId)).data.playerIds;
        allow read: if request.auth != null;
      }
    }
  }
}
```
