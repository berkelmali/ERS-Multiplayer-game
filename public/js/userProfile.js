import EventBus from "./eventbus.js";
import { readRecord, createRecord, tidyRecord } from "./playerRecord.js";
import { cleanName } from "./safeText.js";

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
            let record = await readRecord(user);
            if (!record) {
                await createRecord(user, user.displayName || (user.email || '').split('@')[0]);
                record = await readRecord(user);
            }
            this.data = {
                username: cleanName((record && record.username) || user.displayName || (user.email || '').split('@')[0]),
                // Shown to the player only, from Authentication — never stored in Firestore.
                email: user.email || '',
                score: (record && record.totalScore) || 0,
                gamesPlayed: (record && record.gamesPlayed) || 0,
                gamesWon: (record && record.gamesWon) || 0,
                bestReflex: (record && Number.isInteger(record.bestReflex)) ? record.bestReflex : null
            };
            await tidyRecord(user, record);
            EventBus.emit('profileLoaded', this.data);
            EventBus.emit('scoreUpdated', this.data.score); // emit for compatibility
        } catch (error) {
            console.error("Error loading user profile:", error && error.code);
        }
    },

    clearProfile() {
        this.data = { username: '', email: '', score: 0, gamesPlayed: 0, gamesWon: 0 };
        EventBus.emit('profileLoaded', null);
    }
};
