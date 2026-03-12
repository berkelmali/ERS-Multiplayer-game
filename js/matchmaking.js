import { getFirestore, collection, doc, setDoc, onSnapshot, getDocs, query, orderBy, limit, deleteDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import { AuthSystem } from "./auth.js";
import { GameManager } from "./gameManager.js";
import { Settings } from "./settings.js";
import { createDeck } from "./game.js";

const db = getFirestore(app);

export const Matchmaking = {
    myQueueId: null,
    unsub: null,

    async joinQueue(onStatusChange) {
        if (!AuthSystem.currentUser) return;
        const uid = AuthSystem.currentUser.uid;
        const name = Settings.config.playerName || AuthSystem.currentUser.email.split('@')[0];

        onStatusChange("Joining matchmaking queue...");

        const qRef = doc(collection(db, "queues"));
        this.myQueueId = qRef.id;

        await setDoc(qRef, {
            uid: uid,
            name: name,
            joinedAt: serverTimestamp(),
            roomId: null
        });

        this.unsub = onSnapshot(qRef, (snap) => {
            const data = snap.data();
            if (data && data.roomId) {
                // Matched!
                this.cleanup();
                onStatusChange("Match found!");
                setTimeout(() => {
                    GameManager.startMultiplayerGame(data.roomId, data.playerIndex);
                }, 1000); // 1s delay to show match found
            } else {
                onStatusChange("Looking for players...");
                this.tryMatchmake();
            }
        });
    },

    async tryMatchmake() {
        const qColl = collection(db, "queues");
        const matchQuery = query(qColl, orderBy("joinedAt", "asc"), limit(4));
        const snap = await getDocs(matchQuery);

        if (snap.docs.length === 4) {
            // Check if I am the oldest. The oldest creates the room.
            if (snap.docs[0].id === this.myQueueId) {
                const roomId = "room_" + Date.now();
                await this.createRoom(roomId, snap.docs);

                // Assign room to all
                for (let i = 0; i < 4; i++) {
                    await updateDoc(snap.docs[i].ref, {
                        roomId: roomId,
                        playerIndex: i
                    });
                }
            }
        }
    },

    async createRoom(roomId, playerDocs) {
        const roomRef = doc(db, "gameRooms", roomId);
        const deck = createDeck();
        const playersCards = [[], [], [], []];
        let p = 0;
        while (deck.length > 0) {
            playersCards[p].push(deck.pop());
            p = (p + 1) % 4;
        }

        const players = playerDocs.map((d, i) => ({
            uid: d.data().uid,
            name: d.data().name,
            index: i,
            cards: playersCards[i]
        }));

        await setDoc(roomRef, {
            players: players,
            pile: [],
            activePlayerId: 0,
            challenge: { active: false, attackerId: null, defenderId: null, chancesLeft: 0 },
            slapEvents: [],
            gameStarted: true,
            gameOver: false,
            winnerIndex: -1,
            lastPlayTime: Date.now()
        });
    },

    cleanup() {
        if (this.unsub) {
            this.unsub();
            this.unsub = null;
        }
        if (this.myQueueId) {
            deleteDoc(doc(db, "queues", this.myQueueId)).catch(e => console.error("Cleanup error:", e));
            this.myQueueId = null;
        }
    }
};
