import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import { AuthSystem } from "./auth.js";
import EventBus from "./eventbus.js";
import { recordMatch } from "./playerRecord.js";

// Initialize Cloud Firestore and get a reference to the service
export const db = getFirestore(app);

export const ScoreSystem = {
    currentScore: 0,
    sessionBestReflex: null,
    gameProcessed: false,

    init() {
        EventBus.on('gameStarted', () => {
            this.gameProcessed = false;
        });

        // Simply listening for gameOver to award +1 win point
        // One finished match = one atomic commit of the private record and its
        // public leaderboard mirror (playerRecord.js). firestore.rules accepts
        // only a +1 step, at most once every RECORD_COOLDOWN_S.
        EventBus.on('gameOver', async (winnerId) => {
            if (this.gameProcessed) return;
            this.gameProcessed = true;
            const reflex = this.sessionBestReflex;
            this.sessionBestReflex = null;
            if (!AuthSystem.currentUser) return;
            try {
                const rec = await recordMatch(AuthSystem.currentUser, { won: winnerId === 0, reflex });
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
                console.error('[ScoreSystem] match not recorded:', error && error.code);
            }
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

    updateLocalBestReflex(rt) {
        if (this.sessionBestReflex === null || rt < this.sessionBestReflex) {
            this.sessionBestReflex = rt;
            console.log(`[ScoreSystem] New session best reflex: ${rt}ms`);
        }
    }

};
