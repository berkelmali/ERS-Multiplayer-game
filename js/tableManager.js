import { getFirestore, doc, setDoc, getDoc, onSnapshot, deleteDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, set, onDisconnect, onValue, off } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { app, rtdb } from "./firebaseConfig.js";
import { AuthSystem } from "./auth.js";
import { Settings } from "./settings.js";
import { createDeck } from "./game.js";

const db = getFirestore(app);

export const TableManager = {
    currentTableId: null,
    unsub: null,

    generateTableId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let id = '';
        for (let i = 0; i < 6; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    },

    async createTable() {
        if (!AuthSystem.currentUser) throw new Error("Not logged in");

        const tableId = this.generateTableId();
        const uid = AuthSystem.currentUser.uid;
        const name = Settings.config.playerName || AuthSystem.currentUser.email.split('@')[0];

        const tableRef = doc(db, "multiplayer_tables", tableId);

        await setDoc(tableRef, {
            tableId: tableId,
            hostId: uid,
            hostUsername: name,
            players: [{ uid, name, index: 0 }],
            gameState: {
                status: 'waiting',
                playerCount: 1
            },
            createdAt: serverTimestamp()
        });

        // Setup Player Presence
        const myStatusRef = ref(rtdb, `status/${uid}`);
        set(myStatusRef, "online").catch(e => console.warn("RTDB presence set failed:", e));
        onDisconnect(myStatusRef).set("offline").catch(e => console.warn("RTDB onDisconnect failed:", e));

        this.currentTableId = tableId;
        return tableId;
    },

    async joinTable(tableId) {
        if (!AuthSystem.currentUser) throw new Error("Not logged in");

        const tableIdUpper = tableId.toUpperCase();
        const tableRef = doc(db, "multiplayer_tables", tableIdUpper);
        const snap = await getDoc(tableRef);

        if (!snap.exists()) {
            throw new Error("Table not found or already full!");
        }

        const data = snap.data();
        if (data.gameState.status !== 'waiting') {
            throw new Error("Game already started!");
        }

        if (data.players.length >= 4) {
            throw new Error("Table is full!");
        }

        const uid = AuthSystem.currentUser.uid;
        const name = Settings.config.playerName || AuthSystem.currentUser.email.split('@')[0];

        if (data.players.find(p => p.uid === uid)) {
            this.currentTableId = tableIdUpper;
            return tableIdUpper;
        }

        const newIndex = data.players.length;
        data.players.push({ uid, name, index: newIndex });

        await updateDoc(tableRef, {
            players: data.players,
            "gameState.playerCount": data.players.length
        });

        // Setup Player Presence
        const myStatusRef = ref(rtdb, `status/${uid}`);
        set(myStatusRef, "online").catch(e => console.warn("RTDB presence set failed:", e));
        onDisconnect(myStatusRef).set("offline").catch(e => console.warn("RTDB onDisconnect failed:", e));

        this.currentTableId = tableIdUpper;
        return tableIdUpper;
    },

    listenToTable(tableId, onUpdate) {
        if (this.unsub) this.unsub();

        const tableRef = doc(db, "multiplayer_tables", tableId);
        this.unsub = onSnapshot(tableRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                onUpdate(data);

                // Setup Shared Presence Listeners for this room's players
                if (data.gameState.status === 'waiting') {
                    this.monitorPresence(tableId, data);
                }
            } else {
                onUpdate(null);
            }
        });
    },

    presenceListeners: {},

    monitorPresence(tableId, data) {
        if (!AuthSystem.currentUser) return;
        const myUid = AuthSystem.currentUser.uid;

        data.players.forEach(p => {
            if (p.uid === myUid || p.uid.startsWith('bot_')) return; // Don't monitor myself or bots

            if (!this.presenceListeners[p.uid]) {
                const statusRef = ref(rtdb, `status/${p.uid}`);
                const listener = onValue(statusRef, async (snap) => {
                    const status = snap.val();
                    if (status === "offline") {
                        // User went offline! 
                        // To avoid race conditions, only the CURRENT host, OR the NEXT valid player if the host is the one who died, should execute the change.

                        const isHostOffline = (p.uid === data.hostId);
                        const isMyTurnToHandle = isHostOffline ?
                            (data.players.find((rp, i) => rp.uid !== p.uid && !rp.uid.startsWith('bot_'))?.uid === myUid)
                            : (data.hostId === myUid);

                        if (isMyTurnToHandle) {
                            await this.handlePlayerDisconnect(tableId, data, p.uid, isHostOffline);
                        }
                    }
                });
                this.presenceListeners[p.uid] = { ref: statusRef, cb: listener };
            }
        });

        // Cleanup obsolete listeners
        Object.keys(this.presenceListeners).forEach(uid => {
            if (!data.players.find(p => p.uid === uid)) {
                off(this.presenceListeners[uid].ref, 'value', this.presenceListeners[uid].cb);
                delete this.presenceListeners[uid];
            }
        });
    },

    async handlePlayerDisconnect(tableId, data, offlineUid, isHostOffline) {
        const tableRef = doc(db, "multiplayer_tables", tableId);
        let newPlayers = data.players.filter(p => p.uid !== offlineUid);

        // Host Migration
        let newHostId = data.hostId;
        let newHostUsername = data.hostUsername;

        if (isHostOffline) {
            const nextHost = newPlayers.find(p => !p.uid.startsWith('bot_'));
            if (nextHost) {
                newHostId = nextHost.uid;
                newHostUsername = nextHost.name;
            } else {
                // Everyone left? Delete table entirely
                await deleteDoc(tableRef);
                return;
            }
        }

        // Shift indices & fill with bot logic (to maintain 4 slots if needed, but in waiting we just compress)
        newPlayers = newPlayers.map((p, i) => ({ ...p, index: i }));

        try {
            await updateDoc(tableRef, {
                players: newPlayers,
                hostId: newHostId,
                hostUsername: newHostUsername,
                "gameState.playerCount": newPlayers.length
            });
        } catch (error) {
            console.error("Failed to update disconnect:", error);
        }
    },

    async leaveTable() {
        if (!this.currentTableId || !AuthSystem.currentUser) return;

        const tableId = this.currentTableId;
        const uid = AuthSystem.currentUser.uid;
        this.currentTableId = null;
        if (this.unsub) {
            this.unsub();
            this.unsub = null;
        }

        const tableRef = doc(db, "multiplayer_tables", tableId);
        const snap = await getDoc(tableRef);

        if (snap.exists()) {
            const data = snap.data();
            if (data.hostId === uid) {
                await deleteDoc(tableRef);
            } else {
                let newPlayers = data.players.filter(p => p.uid !== uid);
                // Shift indices to prevent gaps
                newPlayers = newPlayers.map((p, i) => ({ ...p, index: i }));
                await updateDoc(tableRef, {
                    players: newPlayers,
                    "gameState.playerCount": newPlayers.length
                });
            }
        }
    },

    async startGame() {
        if (!this.currentTableId) return;
        const tableRef = doc(db, "multiplayer_tables", this.currentTableId);
        const snap = await getDoc(tableRef);

        if (snap.exists()) {
            const data = snap.data();

            // Minimum 2 real players required
            const realPlayersCount = data.players.filter(p => !p.uid.startsWith('bot_')).length;
            if (realPlayersCount < 2) {
                throw new Error("Cannot start: At least 2 real players are required.");
            }

            const roomId = "room_" + this.currentTableId + "_" + Date.now();
            const roomRef = doc(db, "gameRooms", roomId);

            const deck = createDeck();
            const playersCards = [[], [], [], []];
            let p = 0;
            while (deck.length > 0) {
                playersCards[p].push(deck.pop());
                p = (p + 1) % 4; // Always distribute to all 4 seats
            }

            const roomPlayers = data.players.map(pData => ({
                uid: pData.uid,
                name: pData.name,
                index: pData.index,
                cards: playersCards[pData.index]
            }));

            // Bot Auto-fill mapping
            for (let i = roomPlayers.length; i < 4; i++) {
                roomPlayers.push({
                    uid: `bot_${i}`,
                    name: `Bot ${i}`,
                    index: i,
                    cards: playersCards[i]
                });
            }

            // Provide playerIds for the new security rules
            const playerIds = roomPlayers.filter(p => !p.uid.startsWith('bot_')).map(p => p.uid);

            await setDoc(roomRef, {
                players: roomPlayers,
                playerIds: playerIds,
                pile: [],
                activePlayerId: 0,
                challenge: { active: false, attackerId: null, defenderId: null, chancesLeft: 0 },
                slapEvents: [], // Now unused (replaced by subcollection), keeping for backward compat during migration
                gameStarted: true,
                gameOver: false,
                winnerIndex: -1,
                lastPlayTime: Date.now()
            });

            await updateDoc(tableRef, {
                "gameState.status": 'playing',
                "gameState.roomId": roomId
            });
        }
    },

    async resetToWaiting() {
        if (!this.currentTableId) return;
        const tableRef = doc(db, "multiplayer_tables", this.currentTableId);
        const snap = await getDoc(tableRef);
        if (snap.exists() && snap.data().hostId === AuthSystem.currentUser.uid) {
            await updateDoc(tableRef, { "gameState.status": 'waiting' });
        }
    }
};
