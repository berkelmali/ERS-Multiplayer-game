import { getFirestore, doc, setDoc, getDoc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import { AuthSystem } from "./auth.js";
import EventBus from "./eventbus.js";

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
        EventBus.on('gameOver', async (winnerId) => {
            if (this.gameProcessed) return;
            this.gameProcessed = true;

            if (AuthSystem.currentUser && this.sessionBestReflex !== null) {
                await this.saveBestReflexToFirestore(this.sessionBestReflex);
            }

            if (winnerId === 0 && AuthSystem.currentUser) {
                await this.addPoints(1);
                await this.incrementGames(true);
            } else if (winnerId !== 0 && AuthSystem.currentUser) {
                await this.incrementGames(false);
            }
            
            // Clear session best reflex after game finishes so the next session starts fresh
            this.sessionBestReflex = null;
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
    },

    async saveBestReflexToFirestore(reflexTime) {
        if (!AuthSystem.currentUser) return;
        try {
            const userRef = doc(db, "users", AuthSystem.currentUser.uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                const data = userSnap.data();
                const currentBest = data.bestReflex || Infinity;
                if (reflexTime < currentBest) {
                    await updateDoc(userRef, {
                        bestReflex: reflexTime
                    });
                    console.log(`[ScoreSystem] Firestore best reflex updated to ${reflexTime}ms`);
                    
                    // Trigger UI refresh with correct score/bestReflex schema
                    const updatedProfile = {
                        username: data.username || AuthSystem.currentUser.displayName || AuthSystem.currentUser.email.split('@')[0],
                        email: data.email || AuthSystem.currentUser.email,
                        score: data.totalScore || 0,
                        gamesPlayed: data.gamesPlayed || 0,
                        gamesWon: data.gamesWon || 0,
                        bestReflex: reflexTime
                    };
                    EventBus.emit('profileLoaded', updatedProfile);
                }
            } else {
                await setDoc(userRef, { bestReflex: reflexTime }, { merge: true });
                const newProfile = {
                    username: AuthSystem.currentUser.displayName || AuthSystem.currentUser.email.split('@')[0],
                    email: AuthSystem.currentUser.email,
                    score: this.currentScore,
                    gamesPlayed: 1,
                    gamesWon: 0,
                    bestReflex: reflexTime
                };
                EventBus.emit('profileLoaded', newProfile);
            }
        } catch (error) {
            console.error("Error saving best reflex:", error);
        }
    },

    async addPoints(points) {
        if (!AuthSystem.currentUser) return;

        try {
            this.currentScore += points;
            EventBus.emit('scoreUpdated', this.currentScore);

            const userRef = doc(db, "users", AuthSystem.currentUser.uid);
            await updateDoc(userRef, {
                totalScore: increment(points)
            });
        } catch (error) {
            console.error("Error updating score:", error);
        }
    },

    async incrementGames(won) {
        if (!AuthSystem.currentUser) return;

        try {
            const userRef = doc(db, "users", AuthSystem.currentUser.uid);
            const updates = { gamesPlayed: increment(1) };
            if (won) {
                updates.gamesWon = increment(1);
            }
            await updateDoc(userRef, updates);
        } catch (error) {
            console.error("Error updating game stats:", error);
        }
    }
};
