import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import EventBus from "./eventbus.js";

const db = getFirestore(app);

export const UserProfile = {
    data: {
        username: '',
        email: '',
        score: 0,
        gamesPlayed: 0,
        gamesWon: 0
    },

    init() {
        EventBus.on('authStateChanged', async (user) => {
            if (user) {
                await this.loadUserProfile(user);
            } else {
                this.clearProfile();
            }
        });
    },

    async loadUserProfile(user) {
        try {
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);

            if (userSnap.exists()) {
                const fetchedData = userSnap.data();
                this.data = {
                    username: fetchedData.username || user.displayName || user.email.split('@')[0],
                    email: fetchedData.email || user.email,
                    score: fetchedData.totalScore || 0,
                    gamesPlayed: fetchedData.gamesPlayed || 0,
                    gamesWon: fetchedData.gamesWon || 0
                };
            } else {
                // If it doesn't exist, create it.
                this.data = {
                    username: user.displayName || user.email.split('@')[0],
                    email: user.email,
                    score: 0,
                    gamesPlayed: 0,
                    gamesWon: 0
                };
                await setDoc(userRef, {
                    username: this.data.username,
                    email: this.data.email,
                    totalScore: this.data.score,
                    gamesPlayed: this.data.gamesPlayed,
                    gamesWon: this.data.gamesWon
                });
            }
            EventBus.emit('profileLoaded', this.data);
            EventBus.emit('scoreUpdated', this.data.score); // emit for compatibility
        } catch (error) {
            console.error("Error loading user profile:", error);
        }
    },

    clearProfile() {
        this.data = { username: '', email: '', score: 0, gamesPlayed: 0, gamesWon: 0 };
        EventBus.emit('profileLoaded', null);
    }
};
