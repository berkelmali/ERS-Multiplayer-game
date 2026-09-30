import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import { AuthSystem } from "./auth.js";
import { BanStatus } from "./banStatus.js";
import EventBus from "./eventbus.js";
import { recordMatch } from "./playerRecord.js";

// Initialize Cloud Firestore and get a reference to the service
export const db = getFirestore(app);

export const ScoreSystem = {
    currentScore: 0,
    sessionBestReflex: null,
    gameProcessed: false,
    // Injectable so the browser smoke can watch what a match writes without a
    // real Firestore. Production never reassigns it.
    recorder: recordMatch,

    init() {
        EventBus.on('gameStarted', () => {
            this.gameProcessed = false;
        });

        // One finished match = one atomic commit of the private record and its
        // public leaderboard mirror (playerRecord.js). firestore.rules accepts
        // only a +1 step, at most once every RECORD_COOLDOWN_S.
        EventBus.on('gameOver', (winnerId) => this.record(winnerId === 0));

        // v3.23.3 — a quit is a loss. CardSkins.applyQuitPenalty() announces it
        // as coinsAwarded { winnerId: -2 } (the only emitter of -2). v2.9.0 wrote
        // that loss to the permanent record; the v3.18 rewrite of this file kept
        // only the gameOver path and quietly made walking out free. Same guard as
        // gameOver, so a match is written once whichever signal arrives first.
        EventBus.on('coinsAwarded', ({ winnerId } = {}) => {
            if (winnerId !== -2) return;
            this.record(false);
        });

        EventBus.on('scoreUpdated', (newScore) => {
            this.currentScore = newScore;
        });

        EventBus.on('pileWon', ({ winnerId, reason, reactionTime }) => {
            if (winnerId === 0 && reason === 'slap' && reactionTime !== null && reactionTime !== undefined) {
                this.updateLocalBestReflex(reactionTime);
            }
        });
    },

    async record(won) {
        if (this.gameProcessed) return;
        this.gameProcessed = true;
        const reflex = this.sessionBestReflex;
        this.sessionBestReflex = null;
        if (!AuthSystem.currentUser) return;
        // v3.24.0: a suspended record does not move (firestore.rules block 7).
        if (BanStatus.isActive()) return;
        try {
            const rec = await this.recorder(AuthSystem.currentUser, { won, reflex });
            this.currentScore = rec.totalScore || 0;
            EventBus.emit('scoreUpdated', this.currentScore);
            EventBus.emit('profileLoaded', {
                username: rec.username,
                email: AuthSystem.currentUser.email,
                score: rec.totalScore || 0,
                gamesPlayed: rec.gamesPlayed || 0,
                gamesWon: rec.gamesWon || 0,
                bestReflex: Number.isInteger(rec.bestReflex) ? rec.bestReflex : null
            });
        } catch (error) {
            // Refused (the 10 s cooldown, offline...) — never surfaced: a
            // quit must not throw an error screen over the menu.
            console.error('[ScoreSystem] match not recorded:', error && error.code);
        }
    },

    updateLocalBestReflex(rt) {
        if (this.sessionBestReflex === null || rt < this.sessionBestReflex) {
            this.sessionBestReflex = rt;
            console.log(`[ScoreSystem] New session best reflex: ${rt}ms`);
        }
    }

};
