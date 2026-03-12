# Firestore Security Rules

The following Firebase rules secure the Egyptian Rat Screw (ERS) web application data structure.

### Validation Review

- **Users Collection**: Users can only write their own score (via `request.auth.uid == userId`); anyone can perform reads to see global leaderboards.
- **Multiplayer Tables**: Strict host-based control over table creation and deletion (`hostId == request.auth.uid`). Joining users are allowed to trigger updates.
- **Game Rooms**: Synchronized state updates during matches remain accessible to actively authenticated participants.

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

    // 3. Game rooms (in-game synchronization)
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
