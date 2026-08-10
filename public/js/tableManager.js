import { getFirestore, doc, setDoc, getDoc, onSnapshot, deleteDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, set, onDisconnect, onValue, off, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
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
        const myStatusRef = ref(rtdb, `presence/${uid}`);
        set(myStatusRef, "online").catch(e => console.warn("RTDB presence set failed:", e));
        onDisconnect(myStatusRef).set("offline").catch(e => console.warn("RTDB onDisconnect failed:", e));

        // Sync to RTDB lobbyRooms with playerIds mapping
        const rtdbRef = ref(rtdb, `lobbyRooms/${tableId}`);
        const playerIdsCount = {};
        playerIdsCount[uid] = true;
        await set(rtdbRef, {
            tableId: tableId,
            hostId: uid,
            hostUsername: name,
            players: [{ uid, name, index: 0, status: 'online' }],
            playerIds: playerIdsCount,
            gameState: {
                status: 'waiting',
                playerCount: 1,
                roomId: null
            }
        });

        this.currentTableId = tableId;
        localStorage.setItem('ers_active_table', tableId);
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
        const uid = AuthSystem.currentUser.uid;
        const name = Settings.config.playerName || AuthSystem.currentUser.email.split('@')[0];

        const existingPlayer = data.players.find(p => p.uid === uid);
        if (existingPlayer) {
            if (existingPlayer.status === 'disconnected') {
                // Reconnect!
                existingPlayer.status = 'online';
                existingPlayer.disconnectedAt = null;
                await updateDoc(tableRef, { players: data.players });

                // Sync to RTDB lobbyRooms
                const rtdbRef = ref(rtdb, `lobbyRooms/${tableIdUpper}`);
                const playerIdsCount = {};
                data.players.forEach(p => {
                    if (!p.uid.startsWith('bot_')) playerIdsCount[p.uid] = true;
                });
                await set(rtdbRef, {
                    tableId: tableIdUpper,
                    hostId: data.hostId,
                    hostUsername: data.hostUsername,
                    players: data.players,
                    playerIds: playerIdsCount,
                    gameState: {
                        status: data.gameState.status,
                        playerCount: data.players.filter(p => !p.uid.startsWith('bot_') && p.status !== 'disconnected').length,
                        roomId: data.gameState.roomId || null
                    }
                });
            }
            this.currentTableId = tableIdUpper;
            localStorage.setItem('ers_active_table', tableIdUpper);
            return tableIdUpper;
        }

        if (data.gameState.status !== 'waiting') {
            throw new Error("Game already started!");
        }

        if (data.players.length >= 4) {
            throw new Error("Table is full!");
        }

        // Find an empty slot
        let newIndex = 0;
        const takenIndices = data.players.map(p => p.index);
        while (takenIndices.includes(newIndex) && newIndex < 4) {
            newIndex++;
        }

        if (newIndex >= 4) {
            throw new Error("Table is genuinely full!");
        }

        data.players.push({ uid, name, index: newIndex, status: 'online' });

        await updateDoc(tableRef, {
            players: data.players,
            "gameState.playerCount": data.players.filter(p => !p.uid.startsWith('bot_') && p.status !== 'disconnected').length
        });

        // Setup Player Presence
        const myStatusRef = ref(rtdb, `presence/${uid}`);
        set(myStatusRef, "online").catch(e => console.warn("RTDB presence set failed:", e));
        onDisconnect(myStatusRef).set("offline").catch(e => console.warn("RTDB onDisconnect failed:", e));

        // Sync to RTDB lobbyRooms
        const rtdbRef = ref(rtdb, `lobbyRooms/${tableIdUpper}`);
        const playerIdsCount = {};
        data.players.forEach(p => {
            if (!p.uid.startsWith('bot_')) playerIdsCount[p.uid] = true;
        });
        await set(rtdbRef, {
            tableId: tableIdUpper,
            hostId: data.hostId,
            hostUsername: data.hostUsername,
            players: data.players,
            playerIds: playerIdsCount,
            gameState: {
                status: data.gameState.status,
                playerCount: data.players.filter(p => !p.uid.startsWith('bot_') && p.status !== 'disconnected').length,
                roomId: data.gameState.roomId || null
            }
        });

        this.currentTableId = tableIdUpper;
        localStorage.setItem('ers_active_table', tableIdUpper);
        return tableIdUpper;
    },

    stopListening() {
        if (this.unsub) {
            this.unsub();
            this.unsub = null;
        }
        // Cleanup presence listeners
        Object.keys(this.presenceListeners).forEach(uid => {
            const listenerObj = this.presenceListeners[uid];
            off(listenerObj.ref, 'value', listenerObj.cb);
        });
        this.presenceListeners = {};
    },

    listenToTable(tableId, onUpdate) {
        if (this.unsub) {
            this.stopListening();
        }

        const tid = tableId.toUpperCase();
        const lobbyRoomsRef = ref(rtdb, `lobbyRooms/${tid}`);
        let innerUnsub = null;
        let isUsingFallback = false;

        // Firestore Fallback Setup
        const setupFirestoreFallback = () => {
            if (isUsingFallback) return;
            isUsingFallback = true;
            console.warn("RTDB Lobby sync failed or not found. Switching to Firestore fallback...");
            
            if (innerUnsub) {
                try { innerUnsub(); } catch(e) {}
            }
            
            const tableRef = doc(db, "multiplayer_tables", tid);
            const fsUnsub = onSnapshot(tableRef, (snap) => {
                if (snap.exists()) {
                    const data = snap.data();
                    onUpdate(data);
                    if (data.gameState.status === 'waiting') {
                        this.monitorPresence(tableId, data);
                    }
                } else {
                    onUpdate(null);
                }
            }, (err) => {
                console.error("Firestore fallback snapshot error:", err);
                onUpdate(null);
            });
            
            innerUnsub = fsUnsub;
        };

        // First attempt to listen using RTDB
        const rtdbUnsub = onValue(lobbyRoomsRef, (snap) => {
            if (snap.exists()) {
                const data = snap.val();
                onUpdate(data);
                if (data.gameState && data.gameState.status === 'waiting') {
                    this.monitorPresence(tableId, data);
                }
            } else {
                setupFirestoreFallback();
            }
        }, (error) => {
            console.error("RTDB waiting room connection error:", error);
            setupFirestoreFallback();
        });

        innerUnsub = rtdbUnsub;

        this.unsub = () => {
            if (innerUnsub) {
                innerUnsub();
                innerUnsub = null;
            }
        };
    },

    presenceListeners: {},

    monitorPresence(tableId, data) {
        if (!AuthSystem.currentUser) return;
        const myUid = AuthSystem.currentUser.uid;

        data.players.forEach(p => {
            if (p.uid === myUid || p.uid.startsWith('bot_')) return; // Don't monitor myself or bots

            if (!this.presenceListeners[p.uid]) {
                const presenceRef = ref(rtdb, `presence/${p.uid}`);
                const listener = onValue(presenceRef, async (snap) => {
                    const status = snap.val();
                    if (status === "offline") {
                        // Mobil dalgalanmalar için 10 saniyelik tolerans süresi (Grace Period)
                        setTimeout(async () => {
                            try {
                                // RTDB üzerinden durumu tekrar sorgula
                                const recheckSnap = await get(ref(rtdb, `presence/${p.uid}`));
                                if (recheckSnap.exists() && recheckSnap.val() === "offline") {
                                    // Kullanıcı hala çevrimdışı ise çıkartma işlemine başla
                                    const latestRef = doc(db, "multiplayer_tables", tableId);
                                    const latestSnap = await getDoc(latestRef);
                                    if (!latestSnap.exists()) return;
                                    const latestData = latestSnap.data();

                                    const isHostOffline = (p.uid === latestData.hostId);
                                    const isMyTurnToHandle = isHostOffline ?
                                        (latestData.players.find((rp, i) => rp.uid !== p.uid && !rp.uid.startsWith('bot_') && rp.status !== 'disconnected')?.uid === myUid)
                                        : (latestData.hostId === myUid);

                                    if (isMyTurnToHandle) {
                                        await this.handlePlayerDisconnect(tableId, latestData, p.uid, isHostOffline);

                                        setTimeout(async () => {
                                            const checkRef = doc(db, "multiplayer_tables", tableId);
                                            const checkSnap = await getDoc(checkRef);
                                            if (checkSnap.exists()) {
                                                const currentData = checkSnap.data();
                                                const targetP = currentData.players.find(x => x.uid === p.uid);
                                                if (targetP && targetP.status === 'disconnected' && currentData.gameState.status === 'waiting') {
                                                    let newPlayers = currentData.players.filter(x => x.uid !== p.uid);
                                                    await updateDoc(checkRef, { players: newPlayers, "gameState.playerCount": newPlayers.filter(x => !x.uid.startsWith('bot_') && x.status !== 'disconnected').length });
                                                    
                                                    // Sync to RTDB
                                                    const rtdbRef = ref(rtdb, `lobbyRooms/${tableId}`);
                                                    const playerIdsCount = {};
                                                    newPlayers.forEach(np => {
                                                        if (!np.uid.startsWith('bot_')) playerIdsCount[np.uid] = true;
                                                    });
                                                    await set(rtdbRef, {
                                                        tableId: tableId,
                                                        hostId: currentData.hostId,
                                                        hostUsername: currentData.hostUsername,
                                                        players: newPlayers,
                                                        playerIds: playerIdsCount,
                                                        gameState: {
                                                            status: currentData.gameState.status,
                                                            playerCount: newPlayers.filter(x => !x.uid.startsWith('bot_') && x.status !== 'disconnected').length,
                                                            roomId: currentData.gameState.roomId || null
                                                        }
                                                    });
                                                }
                                            }
                                        }, 60000);
                                    }
                                }
                            } catch (e) {
                                console.warn("Grace period presence check failed:", e);
                            }
                        }, 10000); // 10s Grace Period
                    }
                });
                this.presenceListeners[p.uid] = { ref: presenceRef, cb: listener };
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
        let newPlayers = [...data.players];

        // Host Migration
        let newHostId = data.hostId;
        let newHostUsername = data.hostUsername;

        if (isHostOffline) {
            const nextHost = newPlayers.find(p => !p.uid.startsWith('bot_') && p.uid !== offlineUid && p.status !== 'disconnected');
            if (nextHost) {
                newHostId = nextHost.uid;
                newHostUsername = nextHost.name;
            } else {
                // Everyone left or disconnected? Delete table entirely
                await deleteDoc(tableRef);
                // Delete RTDB too!
                await set(ref(rtdb, `lobbyRooms/${tableId}`), null);
                return;
            }
        }

        // Set status to disconnected instead of removing (only during active gameplay)
        if (data.gameState.status === 'playing') {
            const playerIdx = newPlayers.findIndex(p => p.uid === offlineUid);
            if (playerIdx !== -1) {
                newPlayers[playerIdx].status = 'disconnected';
                newPlayers[playerIdx].disconnectedAt = Date.now();
            }
        } else {
            // In waiting room, remove immediately to open slot
            newPlayers = newPlayers.filter(p => p.uid !== offlineUid);
        }

        try {
            await updateDoc(tableRef, {
                players: newPlayers,
                hostId: newHostId,
                hostUsername: newHostUsername,
                "gameState.playerCount": newPlayers.filter(p => !p.uid.startsWith('bot_') && p.status !== 'disconnected').length
            });

            // Sync to RTDB
            const rtdbRef = ref(rtdb, `lobbyRooms/${tableId}`);
            const playerIdsCount = {};
            newPlayers.forEach(p => {
                if (!p.uid.startsWith('bot_')) playerIdsCount[p.uid] = true;
            });
            await set(rtdbRef, {
                tableId: tableId,
                hostId: newHostId,
                hostUsername: newHostUsername,
                players: newPlayers,
                playerIds: playerIdsCount,
                gameState: {
                    status: data.gameState.status,
                    playerCount: newPlayers.filter(p => !p.uid.startsWith('bot_') && p.status !== 'disconnected').length,
                    roomId: data.gameState.roomId || null
                }
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
        localStorage.removeItem('ers_active_table');
        if (this.unsub) {
            this.unsub();
            this.unsub = null;
        }

        const tableRef = doc(db, "multiplayer_tables", tableId);
        const snap = await getDoc(tableRef);

        if (snap.exists()) {
            const data = snap.data();
            if (data.hostId === uid) {
                // Check if anyone else is still here
                if (data.players.filter(p => !p.uid.startsWith('bot_') && p.status !== 'disconnected').length <= 1) {
                    await deleteDoc(tableRef);
                    // Delete RTDB too!
                    await set(ref(rtdb, `lobbyRooms/${tableId}`), null);
                } else {
                    // Host migration, then actual removal
                    await this.handlePlayerDisconnect(tableId, data, uid, true);
                    // Fetch latest to get updated host info after migration
                    const snapCheck = await getDoc(tableRef);
                    if (snapCheck.exists()) {
                        const latestData = snapCheck.data();
                        let newPlayers = latestData.players.filter(p => p.uid !== uid);
                        await updateDoc(tableRef, {
                            players: newPlayers,
                            "gameState.playerCount": newPlayers.filter(p => !p.uid.startsWith('bot_') && p.status !== 'disconnected').length
                        });

                        // Sync to RTDB
                        const rtdbRef = ref(rtdb, `lobbyRooms/${tableId}`);
                        const playerIdsCount = {};
                        newPlayers.forEach(p => {
                            if (!p.uid.startsWith('bot_')) playerIdsCount[p.uid] = true;
                        });
                        await set(rtdbRef, {
                            tableId: tableId,
                            hostId: latestData.hostId,
                            hostUsername: latestData.hostUsername,
                            players: newPlayers,
                            playerIds: playerIdsCount,
                            gameState: {
                                status: latestData.gameState.status,
                                playerCount: newPlayers.filter(p => !p.uid.startsWith('bot_') && p.status !== 'disconnected').length,
                                roomId: latestData.gameState.roomId || null
                            }
                        });
                    }
                }
            } else {
                let newPlayers = data.players.filter(p => p.uid !== uid);
                await updateDoc(tableRef, {
                    players: newPlayers,
                    "gameState.playerCount": newPlayers.filter(p => !p.uid.startsWith('bot_') && p.status !== 'disconnected').length
                });

                // Sync to RTDB
                const rtdbRef = ref(rtdb, `lobbyRooms/${tableId}`);
                const playerIdsCount = {};
                newPlayers.forEach(p => {
                    if (!p.uid.startsWith('bot_')) playerIdsCount[p.uid] = true;
                });
                await set(rtdbRef, {
                    tableId: tableId,
                    hostId: data.hostId,
                    hostUsername: data.hostUsername,
                    players: newPlayers,
                    playerIds: playerIdsCount,
                    gameState: {
                        status: data.gameState.status,
                        playerCount: newPlayers.filter(p => !p.uid.startsWith('bot_') && p.status !== 'disconnected').length,
                        roomId: data.gameState.roomId || null
                    }
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

            const deck = createDeck();
            const playersCards = [[], [], [], []];
            let p = 0;
            while (deck.length > 0) {
                playersCards[p].push(deck.pop());
                p = (p + 1) % 4; // Always distribute to all 4 seats
            }

            const roomPlayers = [...data.players];
            // Format room players
            roomPlayers.forEach(p => {
                p.cards = playersCards[p.index];
                if (!p.status) p.status = 'online';
            });

            // Bot Auto-fill mapping
            for (let i = roomPlayers.length; i < 4; i++) {
                roomPlayers.push({
                    uid: `bot_${i}`,
                    name: `Bot ${i + 1}`,
                    index: i,
                    cards: playersCards[i]
                });
            }

            // Provide playerIds for the new security rules (Map for RTDB lookup)
            const playerIdsCount = {};
            roomPlayers.forEach(p => {
                if (!p.uid.startsWith('bot_')) playerIdsCount[p.uid] = true;
            });

            const rtdbRoomRef = ref(rtdb, `gameRooms/${roomId}`);
            await set(rtdbRoomRef, {
                tableId: this.currentTableId,
                hostId: data.hostId,
                players: roomPlayers,
                playerIds: playerIdsCount,
                pile: [],
                activePlayerId: 0,
                challenge: { active: false, attackerId: null, defenderId: null, chancesLeft: 0 },
                gameStarted: true,
                gameOver: false,
                winnerIndex: -1,
                lastPlayTime: Date.now()
            });

            await updateDoc(tableRef, {
                "gameState.status": 'playing',
                "gameState.roomId": roomId
            });

            // Sync status to RTDB to trigger instant page transitions for other players!
            const rtdbRef = ref(rtdb, `lobbyRooms/${this.currentTableId}`);
            await set(rtdbRef, {
                tableId: this.currentTableId,
                hostId: data.hostId,
                hostUsername: data.hostUsername,
                players: roomPlayers,
                playerIds: playerIdsCount,
                gameState: {
                    status: 'playing',
                    playerCount: data.players.filter(pr => !pr.uid.startsWith('bot_') && pr.status !== 'disconnected').length,
                    roomId: roomId
                }
            });
        }
    },

    async resetToWaiting() {
        if (!this.currentTableId) return;
        const tableRef = doc(db, "multiplayer_tables", this.currentTableId);
        
        try {
            const snap = await getDoc(tableRef);
            if (snap.exists() && snap.data().hostId === AuthSystem.currentUser.uid) {
                const data = snap.data();
                
                // 1. Remove all bots and disconnected players from waiting lobby
                let activeRealPlayers = data.players.filter(p => !p.uid.startsWith('bot_') && p.status !== 'disconnected');
                
                // 2. Re-pack active player indices to be contiguous starting from 0, and clear status fields
                activeRealPlayers = activeRealPlayers.map((p, idx) => ({
                    uid: p.uid,
                    name: p.name,
                    index: idx,
                    status: 'online',
                    disconnectedAt: null
                }));

                // 3. Resolve host migration if the active host has left
                let newHostId = data.hostId;
                let newHostUsername = data.hostUsername;
                if (!activeRealPlayers.some(p => p.uid === data.hostId)) {
                    if (activeRealPlayers.length > 0) {
                        newHostId = activeRealPlayers[0].uid;
                        newHostUsername = activeRealPlayers[0].name;
                    } else {
                        // Delete table completely if no real players are present
                        await deleteDoc(tableRef);
                        // Delete RTDB too!
                        await set(ref(rtdb, `lobbyRooms/${this.currentTableId}`), null);
                        return;
                    }
                }

                // 4. Update Firestore table with the new Waiting Room configuration, clearing the old game Room ID
                await updateDoc(tableRef, {
                    players: activeRealPlayers,
                    hostId: newHostId,
                    hostUsername: newHostUsername,
                    "gameState.status": 'waiting',
                    "gameState.playerCount": activeRealPlayers.length,
                    "gameState.roomId": null // Reset old Room ID to prevent ghost redirect loops
                });

                // Sync to RTDB
                const rtdbRef = ref(rtdb, `lobbyRooms/${this.currentTableId}`);
                const playerIdsCount = {};
                activeRealPlayers.forEach(p => {
                    if (!p.uid.startsWith('bot_')) playerIdsCount[p.uid] = true;
                });
                await set(rtdbRef, {
                    tableId: this.currentTableId,
                    hostId: newHostId,
                    hostUsername: newHostUsername,
                    players: activeRealPlayers,
                    playerIds: playerIdsCount,
                    gameState: {
                        status: 'waiting',
                        playerCount: activeRealPlayers.length,
                        roomId: null
                    }
                });
                console.log("Table reset successfully. Contiguous players remaining:", activeRealPlayers.length);
            }
        } catch (error) {
            console.error("Failed to reset table to waiting:", error);
        }
    }
};

