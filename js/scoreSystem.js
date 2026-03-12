import { getFirestore, doc, setDoc, getDoc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import { AuthSystem } from "./auth.js";
import EventBus from "./eventbus.js";

// Initialize Cloud Firestore and get a reference to the service
export const db = getFirestore(app);

export const ScoreSystem = {
    currentScore: 0,

    init() {
        // Simply listening for gameOver to award +1 win point
        EventBus.on('gameOver', async (winnerId) => {
            if (winnerId === 0 && AuthSystem.currentUser) {
                await this.addPoints(1);
                await this.incrementGames(true);
            } else if (winnerId !== 0 && AuthSystem.currentUser) {
                await this.incrementGames(false);
            }
        });

        EventBus.on('scoreUpdated', (newScore) => {
            this.currentScore = newScore;
        });
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
