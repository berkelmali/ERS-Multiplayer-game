import { TableManager } from './tableManager.js?v=3';
import { UIManager } from './ui.js';
import { Localization } from './localization.js?v=3';
import { AuthSystem } from './auth.js';
import { GameManager } from './gameManager.js';
import { renderRulesBadge } from './rulesBadge.js';
import { renderQRCodeToCanvas } from './qrCode.js';
import { formatInviteUrl } from './inviteLink.js';
import { ERR, appError, classifyError, readOnline, withDeadline, createOperationToken, DEFAULT_DEADLINE_MS } from './errorCodes.js';
import { ErrorScreen } from './errorScreen.js';

export const LobbyUI = {
    /**
     * Several lobby code paths re-write `lobbyRooms/{id}` without carrying
     * `houseRules` along (player joins, bot backfill, host migration). Caching
     * the last value we saw keeps the badge from blinking out mid-lobby. The
     * rules that actually decide slaps are read from the GAME room, so this
     * cache is display-only and can never affect play.
     */
    lastKnownRules: null,

    init() {
        this.lobbyPanel = document.getElementById('lobby-panel');
        this.waitingRoomPanel = document.getElementById('waiting-room-panel');
        this.mainMenu = document.getElementById('main-menu');
        this.lastJoinedRoomId = null;
        this.timers = {};
        this.timerInterval = null;

        this.btnCreateTable = document.getElementById('btn-create-table');
        this.btnJoinTable = document.getElementById('btn-join-table');
        this.inputJoinId = document.getElementById('input-join-id');
        this.btnLobbyBack = document.getElementById('btn-lobby-back');

        this.displayTableId = document.getElementById('display-table-id');
        this.btnCopyId = document.getElementById('btn-copy-id');
        this.btnShareInvite = document.getElementById('btn-share-invite');
        this.inviteModal = document.getElementById('invite-modal');
        this.btnCloseInvite = document.getElementById('btn-close-invite');
        this.inviteLinkInput = document.getElementById('invite-link-input');
        this.btnCopyInviteLink = document.getElementById('btn-copy-invite-link');
        this.inviteQrCanvas = document.getElementById('invite-qr-canvas');
        this.inviteShareNativeRow = document.getElementById('invite-share-native-row');
        this.btnNativeShare = document.getElementById('btn-native-share');

        this.playersList = document.getElementById('waiting-players-list');
        this.btnStartTable = document.getElementById('btn-start-table');
        this.btnLeaveTable = document.getElementById('btn-leave-table');

        this.bindEvents();
    },

    bindEvents() {
        this.btnCreateTable.addEventListener('click', () => this.createTableFlow());

        this.btnJoinTable.addEventListener('click', () => {
            const tableId = this.inputJoinId.value.trim().toUpperCase();
            if (!tableId || tableId.length !== 6) {
                UIManager.showNotification(Localization.get('invalidTableId'), "var(--error)");
                return;
            }
            this.joinTableFlow(tableId, this.btnJoinTable);
        });

        this.btnLobbyBack.addEventListener('click', () => {
            this.clearTimers();
            this.lobbyPanel.classList.remove('active');
            this.mainMenu.classList.add('active');

            // Parallax'ı yeniden aktifle (onPlayClicked exit animasyonunu temizle)
            import('./parallax3d.js').then(m => {
                const p = m.Parallax3D;
                // Exit animasyonunu resetle ve parallax'ı resume et
                const bg = document.getElementById('parallax-bg');
                if (bg) {
                    bg.classList.remove('parallax-exit');
                    bg.style.transform = '';
                    bg.style.filter = '';
                }
                this.mainMenu.classList.remove('parallax-exit-ui');
                this.mainMenu.style.transform = '';
                this.mainMenu.style.opacity = '';

                // Eğer dispose edilmemişse (fire-and-forget), sadece exit'i temizle
                if (p.isActive) {
                    document.body.classList.add('parallax-active');
                    const scene = document.getElementById('parallax-scene');
                    if (scene) scene.classList.remove('parallax-hidden');
                } else {
                    p.resume();
                }
            }).catch(() => {});
        });

        this.btnCopyId.addEventListener('click', () => {
            this.copyToClipboard(this.displayTableId.innerText, this.btnCopyId, 'copied', this.displayTableId);
        });

        this.btnLeaveTable.addEventListener('click', () => {
            this.closeInviteModal();
            UIManager.showConfirmModal(async () => {
                await TableManager.leaveTable();
                this.clearTimers();
                this.lastJoinedRoomId = null;
                this.waitingRoomPanel.classList.remove('active');
                this.lobbyPanel.classList.add('active');
            });
        });

        if (this.btnShareInvite) {
            this.btnShareInvite.addEventListener('click', () => {
                this.openInviteModal();
            });
        }

        if (this.btnCloseInvite) {
            this.btnCloseInvite.addEventListener('click', () => {
                this.closeInviteModal();
            });
        }

        if (this.inviteModal) {
            this.inviteModal.addEventListener('click', (e) => {
                if (e.target === this.inviteModal) {
                    this.closeInviteModal();
                }
            });
        }

        if (this.btnCopyInviteLink) {
            this.btnCopyInviteLink.addEventListener('click', () => {
                const url = this.inviteLinkInput ? this.inviteLinkInput.value : this.getInviteUrl();
                this.copyToClipboard(url, this.btnCopyInviteLink, 'linkCopied', this.inviteLinkInput);
            });
        }

        if (this.btnNativeShare) {
            this.btnNativeShare.addEventListener('click', async () => {
                const tid = (this.displayTableId ? this.displayTableId.innerText : '').trim().toUpperCase();
                const url = this.getInviteUrl(tid);
                if (navigator.share) {
                    try {
                        await navigator.share({
                            title: 'ERS — Egyptian Rat Screw',
                            text: `${Localization.get('inviteModalTitle') || 'Join my ERS table'}: ${tid}`,
                            url: url
                        });
                    } catch (err) {
                        // Ignore abort/cancel
                    }
                }
            });
        }

        this.btnStartTable.addEventListener('click', async () => {
            this.closeInviteModal();
            try {
                this.btnStartTable.disabled = true;
                await TableManager.startGame();
            } catch (error) {
                // Until v3.7.0 this message went into #notifications while that
                // element still lived inside #game-container — a display:none
                // subtree on the waiting-room screen. A host with one player
                // pressed Start, got a correct explanation nobody could see, and
                // the button silently re-enabled. It looked like a dead button
                // and it was reported as one.
                console.error("Start Game Error:", error);
                this.reportFailure(error, 'errTitleStartGame', () => this.btnStartTable.click());
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
        this.lastKnownRules = null;
    },

    enterWaitingRoom(tableId, isHost) {
        const tid = tableId.toUpperCase();
        this.lobbyPanel.classList.remove('active');
        this.waitingRoomPanel.classList.add('active');
        this.displayTableId.innerText = tid;

        const bailToLobby = () => {
            this.clearTimers();
            this.closeInviteModal();
            TableManager.stopListening();
            this.waitingRoomPanel.classList.remove('active');
            this.lobbyPanel.classList.add('active');
        };

        TableManager.listenToTable(tid, (data) => {
            if (!data) {
                UIManager.showNotification(Localization.get('hostLeft') || "Host closed the table.", "var(--error)");
                this.clearTimers();
                this.closeInviteModal();
                TableManager.stopListening(); // Stop listeners to prevent leaks/console errors
                this.waitingRoomPanel.classList.remove('active');
                this.lobbyPanel.classList.add('active');
                return;
            }

            this.renderPlayers(data);

            if (typeof data.houseRules === 'string') this.lastKnownRules = data.houseRules;
            renderRulesBadge('lobby-rules-badge', this.lastKnownRules);

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
                    this.clearTimers();
                    this.closeInviteModal();
                    TableManager.stopListening(); // Stop lobby listener & presence checks
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
        }, (err) => {
            // The listener itself failed — NOT the host leaving. Reporting this
            // as "host closed the table", which is what happened before v3.7.0,
            // blames a person for a network fault.
            console.error("Waiting room sync error:", err);
            bailToLobby();
            this.reportFailure(
                appError(ERR.SYNC_LOST, err && err.message),
                'errTitleWaitingRoom',
                () => this.joinTableFlow(tid, null)
            );
        });
        UIManager.hideLoading();
    },

    renderPlayers(data) {
        if (!data || !data.players) return;
        const players = data.players;
        this.playersList.innerHTML = '';
        this.clearTimers();
        const hostId = data.hostId || ''; // SINGLE SOURCE OF TRUTH: Get host directly from Firestore hostId
        const realPlayersCount = players.filter(p => !p.uid.startsWith('bot_')).length;

        for (let i = 0; i < 4; i++) {
            const li = document.createElement('li');
            li.style.padding = '8px 0';
            li.style.borderBottom = '1px solid rgba(255,255,255,0.1)';

            const player = players.find(p => p.index === i);

            if (player) {
                const isHost = player.uid === hostId;
                const hostTag = isHost ? `<span style="color:var(--primary); font-size:0.8em; margin-left:10px;">(Host)</span>` : '';
                
                if (player.status === 'disconnected') {
                    li.innerHTML = `${i + 1}. <strong style="color:var(--error); text-decoration: line-through;">${player.name}</strong> <span style="color:var(--error); font-size:0.8em; font-style:italic; margin-left:5px;">(${Localization.get('disconnectedTag') || 'Disconnected'})</span> ${hostTag}`;
                } else {
                    li.innerHTML = `${i + 1}. <strong style="color:white;">${player.name}</strong> ${hostTag}`;
                }
            } else {
                li.innerHTML = `${i + 1}. <span style="font-style:italic;" data-i18n="waitingPlayer">${Localization.get('waitingPlayer') || "Waiting..."}</span>`;
            }
            this.playersList.appendChild(li);
        }
        
        this.startTimers();

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
    },

    startTimers() {
        if (Object.keys(this.timers).length === 0) return;
        if (!this.timerInterval) {
            this.timerInterval = setInterval(() => {
                const now = Date.now();
                Object.keys(this.timers).forEach(idx => {
                    const el = document.getElementById(`lobby-timer-${idx}`);
                    if (el) {
                        const elapsed = now - this.timers[idx];
                        const left = Math.max(0, Math.floor((60000 - elapsed) / 1000));
                        el.innerText = left;
                    }
                });
            }, 1000);
        }
    },

    clearTimers() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.timers = {};
    },

    /**
     * Copy with a visible outcome either way.
     *
     * Both copy buttons used to be a bare `navigator.clipboard.writeText(x).then(...)`
     * with no rejection path. Two things go wrong with that, and only one of them
     * is a rejection: over plain http (or in any non-secure context)
     * `navigator.clipboard` is `undefined`, so the member access throws a
     * SYNCHRONOUS TypeError before a promise object even exists — a trailing
     * .catch() would have nothing to attach to. try/catch around the await
     * covers both. The failure reports in the button itself, matching where the
     * success already reported, and the source text is selected so the player
     * can copy it by hand instead of being left with a button that does nothing.
     */
    async copyToClipboard(text, btn, okKey, selectEl) {
        const original = btn ? btn.innerText : '';
        const flash = (msg, color) => {
            if (!btn) return;
            btn.innerText = msg;
            btn.style.backgroundColor = color;
            btn.style.color = "white";
            setTimeout(() => {
                btn.innerText = original;
                btn.style.backgroundColor = "";
                btn.style.color = "";
            }, 2200);
        };

        try {
            if (typeof navigator === 'undefined' ||
                !navigator.clipboard ||
                typeof navigator.clipboard.writeText !== 'function') {
                throw appError(ERR.CLIPBOARD_DENIED, 'clipboard API unavailable (insecure context?)');
            }
            await navigator.clipboard.writeText(text);
            flash(Localization.get(okKey), "var(--primary)");
            return true;
        } catch (err) {
            console.warn("Clipboard copy failed:", err);
            flash(Localization.get('copyFailed'), "var(--error)");
            this.selectTextIn(selectEl);
            return false;
        }
    },

    /** Leave the value selected so a manual copy is one keystroke away. */
    selectTextIn(el) {
        if (!el) return;
        try {
            if (typeof el.select === 'function') { el.focus(); el.select(); return; }
            if (typeof window === 'undefined' || !window.getSelection || !document.createRange) return;
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (_) { /* selection is a nicety; never let it throw over the copy */ }
    },

    getInviteUrl(tableId) {
        const tid = (tableId || (this.displayTableId ? this.displayTableId.innerText : '') || '').trim().toUpperCase();
        return formatInviteUrl(tid, window.location.origin, window.location.pathname);
    },

    openInviteModal(tableId) {
        const tid = (tableId || (this.displayTableId ? this.displayTableId.innerText : '') || '').trim().toUpperCase();
        if (!tid || tid === '------') return;
        const url = this.getInviteUrl(tid);

        // Open modal first so code and link are immediately accessible even if canvas throws (F6)
        if (this.inviteModal) {
            this.inviteModal.classList.add('active');
        }

        const codeEl = document.getElementById('invite-code-display');
        if (codeEl) {
            codeEl.innerText = tid;
        }

        if (this.inviteLinkInput) {
            this.inviteLinkInput.value = url;
        }

        if (this.inviteShareNativeRow) {
            if (typeof navigator !== 'undefined' && navigator.share) {
                this.inviteShareNativeRow.style.display = 'block';
            } else {
                this.inviteShareNativeRow.style.display = 'none';
            }
        }

        // QR render with 4-module quiet zone, wrapped in try/catch (F6, F7)
        if (this.inviteQrCanvas) {
            try {
                renderQRCodeToCanvas(this.inviteQrCanvas, url, { size: 170, quietZone: 4 });
            } catch (err) {
                // The code and link above are already visible, so this is a
                // degradation, not a failure — say so instead of leaving a
                // blank square with no explanation.
                console.warn("QR code render error:", err);
                UIManager.showNotification(Localization.get('qrUnavailable'), "var(--text-secondary)");
            }
        }
    },

    closeInviteModal() {
        if (this.inviteModal) {
            this.inviteModal.classList.remove('active');
        }
    },

    async joinTableDirect(tableId) {
        return this.joinTableFlow((tableId || '').trim().toUpperCase(), null, 'joiningViaLink');
    },

    /**
     * Classify a failure and put the reason in front of the player.
     *
     * Before v3.7.0 every caller of joinTable() caught every error into one
     * hardcoded sentence — "Table not found or full" — so being signed out,
     * being offline, having a write refused, or arriving one second after the
     * host pressed Start all produced the same untrue explanation. The stable
     * code on the error is what makes the difference between telling someone
     * their connection dropped and telling them a table that exists does not.
     */
    reportFailure(error, titleKey, onRetry) {
        const code = classifyError(error, { online: readOnline() });
        return ErrorScreen.show({
            code,
            titleKey,
            technical: error && error.message,
            onRetry: typeof onRetry === 'function' ? onRetry : undefined
        });
    },

    /**
     * The single join path, shared by the manual code entry and the invite link.
     *
     * The deadline is the load-bearing part. Firestore does not reject on a
     * transport failure — it queues the read and retries with backoff forever —
     * so without it a dropped connection leaves this promise unsettled, the
     * `finally` unreached and the full-screen spinner permanent. The token
     * exists because Promise.race does not cancel the loser: a read that blew
     * its deadline can still resolve later, and without the guard it would walk
     * a player into a waiting room behind an error screen they already closed.
     */
    async joinTableFlow(tid, buttonEl, loadingKey) {
        if (!tid || tid.length !== 6) return false;

        const token = createOperationToken();
        const retry = () => this.joinTableFlow(tid, buttonEl, loadingKey);

        try {
            if (buttonEl) buttonEl.disabled = true;
            UIManager.showLoading(Localization.get(loadingKey || 'searchingTable'));

            const joinedId = await withDeadline(TableManager.joinTable(tid), DEFAULT_DEADLINE_MS, token);

            if (token.cancelled) return false;   // a late winner must not act
            UIManager.showLoading(Localization.get('joiningLobby'));
            this.enterWaitingRoom(joinedId, false);
            return true;
        } catch (error) {
            console.error("Join Table Error:", error);
            // Retry is safe to offer: joinTable() returns early for a player
            // already seated at the table (the existingPlayer branch), so a
            // second attempt after a partially-completed join cannot double-seat.
            this.reportFailure(error, 'errTitleJoinTable', retry);
            return false;
        } finally {
            if (buttonEl) buttonEl.disabled = false;
            UIManager.hideLoading();
        }
    },

    async createTableFlow() {
        const token = createOperationToken();
        try {
            this.btnCreateTable.disabled = true;
            UIManager.showLoading(Localization.get('creatingTable'));
            const tableId = await withDeadline(TableManager.createTable(), DEFAULT_DEADLINE_MS, token);
            if (token.cancelled) return false;
            this.enterWaitingRoom(tableId.toUpperCase(), true);
            return true;
        } catch (error) {
            // Was `showNotification(error.message)` — raw untranslated SDK prose
            // ("Missing or insufficient permissions.") shown to Turkish, German
            // and Russian players, into a hidden element.
            console.error("Create Table Error:", error);
            this.reportFailure(error, 'errTitleCreateTable', () => this.createTableFlow());
            return false;
        } finally {
            this.btnCreateTable.disabled = false;
            UIManager.hideLoading();
        }
    }
};

