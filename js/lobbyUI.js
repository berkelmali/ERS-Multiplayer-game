import { TableManager } from './tableManager.js?v=3';
import { UIManager } from './ui.js';
import { Localization } from './localization.js?v=2';
import { AuthSystem } from './auth.js';
import { GameManager } from './gameManager.js';

export const LobbyUI = {
    init() {
        this.lobbyPanel = document.getElementById('lobby-panel');
        this.waitingRoomPanel = document.getElementById('waiting-room-panel');
        this.mainMenu = document.getElementById('main-menu');
        this.lastJoinedRoomId = null;

        this.btnCreateTable = document.getElementById('btn-create-table');
        this.btnJoinTable = document.getElementById('btn-join-table');
        this.inputJoinId = document.getElementById('input-join-id');
        this.btnLobbyBack = document.getElementById('btn-lobby-back');

        this.displayTableId = document.getElementById('display-table-id');
        this.btnCopyId = document.getElementById('btn-copy-id');
        this.playersList = document.getElementById('waiting-players-list');
        this.btnStartTable = document.getElementById('btn-start-table');
        this.btnLeaveTable = document.getElementById('btn-leave-table');

        this.bindEvents();
    },

    bindEvents() {
        this.btnCreateTable.addEventListener('click', async () => {
            try {
                this.btnCreateTable.disabled = true;
                const tableId = await TableManager.createTable();
                this.enterWaitingRoom(tableId, true);
            } catch (error) {
                UIManager.showNotification(error.message, "var(--error)");
            } finally {
                this.btnCreateTable.disabled = false;
            }
        });

        this.btnJoinTable.addEventListener('click', async () => {
            const tableId = this.inputJoinId.value.trim();
            if (!tableId || tableId.length !== 6) {
                UIManager.showNotification(Localization.get('invalidTableId') || "Invalid Table ID", "var(--error)");
                return;
            }
            try {
                this.btnJoinTable.disabled = true;
                UIManager.showLoading("Searching for table...");
                await TableManager.joinTable(tableId);
                UIManager.showLoading("Joining lobby...");
                this.enterWaitingRoom(tableId, false);
            } catch (error) {
                console.error("Join Table Error:", error);
                UIManager.showNotification(Localization.get('tableNotFound') || "Table not found or full", "var(--error)");
            } finally {
                this.btnJoinTable.disabled = false;
                UIManager.hideLoading();
            }
        });

        this.btnLobbyBack.addEventListener('click', () => {
            this.lobbyPanel.classList.remove('active');
            this.mainMenu.classList.add('active');
        });

        this.btnCopyId.addEventListener('click', () => {
            const tableId = this.displayTableId.innerText;
            navigator.clipboard.writeText(tableId).then(() => {
                const originalText = this.btnCopyId.innerText;
                this.btnCopyId.innerText = Localization.get('copied') || "Copied!";
                this.btnCopyId.style.backgroundColor = "var(--primary)";
                this.btnCopyId.style.color = "white";
                setTimeout(() => {
                    this.btnCopyId.innerText = originalText;
                    this.btnCopyId.style.backgroundColor = "";
                    this.btnCopyId.style.color = "";
                }, 2000);
            });
        });

        this.btnLeaveTable.addEventListener('click', async () => {
            await TableManager.leaveTable();
            this.lastJoinedRoomId = null;
            this.waitingRoomPanel.classList.remove('active');
            this.lobbyPanel.classList.add('active');
        });

        this.btnStartTable.addEventListener('click', async () => {
            try {
                this.btnStartTable.disabled = true;
                await TableManager.startGame();
            } catch (error) {
                console.error("Start Game Error:", error);
                UIManager.showNotification("Failed to start game: " + error.message, "var(--error)");
                this.btnStartTable.disabled = false;
            }
        });
    },

    openLobby() {
        if (!AuthSystem.currentUser) {
            UIManager.showNotification(Localization.get('loginRequired') || "Please log in to play multiplayer.", "var(--error)");
            document.getElementById('display-username').click();
            return;
        }
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        this.lobbyPanel.classList.add('active');
        this.inputJoinId.value = '';
        this.lastJoinedRoomId = null;
    },

    enterWaitingRoom(tableId, isHost) {
        this.lobbyPanel.classList.remove('active');
        this.waitingRoomPanel.classList.add('active');
        this.displayTableId.innerText = tableId;

        TableManager.listenToTable(tableId, (data) => {
            if (!data) {
                UIManager.showNotification(Localization.get('hostLeft') || "Host closed the table.", "var(--error)");
                this.waitingRoomPanel.classList.remove('active');
                this.lobbyPanel.classList.add('active');
                return;
            }

            this.renderPlayers(data.players);

            const amIHost = data.hostId === AuthSystem.currentUser.uid;
            if (amIHost) {
                this.btnStartTable.style.display = 'block';
            } else {
                this.btnStartTable.style.display = 'none';
            }

            if (data.gameState.status === 'playing') {
                if (data.gameState.roomId === this.lastJoinedRoomId) {
                    return; // Ignore if it's identical to the room we just finished
                }

                const myPlayer = data.players.find(p => p.uid === AuthSystem.currentUser.uid);
                if (myPlayer) {
                    this.lastJoinedRoomId = data.gameState.roomId;
                    TableManager.unsub(); // Stop lobby listener
                    this.waitingRoomPanel.classList.remove('active');
                    document.getElementById('game-container').classList.add('active');

                    document.body.classList.remove('menu-screen');
                    document.body.classList.add('game-screen');

                    import('./eventbus.js').then(module => {
                        module.default.emit('gameStateChanged', 'gameplay');
                    });

                    UIManager.hideLoading();
                    GameManager.startMultiplayerGame(data.gameState.roomId, myPlayer.index);
                }
            }
        });
        UIManager.hideLoading();
    },

    renderPlayers(players) {
        this.playersList.innerHTML = '';
        const hostId = players.length > 0 ? players[0].uid : '';
        const realPlayersCount = players.filter(p => !p.uid.startsWith('bot_')).length;

        for (let i = 0; i < 4; i++) {
            const li = document.createElement('li');
            li.style.padding = '8px 0';
            li.style.borderBottom = '1px solid rgba(255,255,255,0.1)';

            if (i < players.length) {
                const isHost = players[i].uid === hostId;
                const hostTag = isHost ? `<span style="color:var(--primary); font-size:0.8em; margin-left:10px;">(Host)</span>` : '';
                li.innerHTML = `${i + 1}. <strong style="color:white;">${players[i].name}</strong> ${hostTag}`;
            } else {
                li.innerHTML = `${i + 1}. <span style="font-style:italic;" data-i18n="waitingPlayer">${Localization.get('waitingPlayer') || "Waiting..."}</span>`;
            }
            this.playersList.appendChild(li);
        }

        // Dynamic Start Button Logic (Minimum 2 players requirement)
        if (realPlayersCount >= 2) {
            this.btnStartTable.disabled = false;
            this.btnStartTable.innerText = Localization.get('startGame') || "Start Game";
            this.btnStartTable.classList.add('vibrant-play');
        } else {
            this.btnStartTable.disabled = true;
            this.btnStartTable.innerText = Localization.get('waitingForPlayers') || "Waiting for another player...";
            this.btnStartTable.classList.remove('vibrant-play');
        }
    }
};
