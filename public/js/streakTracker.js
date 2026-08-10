import EventBus from './eventbus.js';
import { Localization } from './localization.js?v=3';

// --- SESSION WIN-STREAK TRACKER (v2.9.0) ---
// Tracks how many games in a row the LOCAL player has won this session.
// Purely a client-side, in-memory, derived-from-events feature: it listens to the
// same 'gameOver' broadcast that ScoreSystem/VictoryScreen already consume, so it
// works identically in Bot Mode and Multiplayer with zero new Firebase writes and
// zero server-authority surface (consistent with how ScoreSystem/Leaderboard already
// track stats client-side).
//
// Deliberately positive-only: it celebrates win streaks but never surfaces or
// announces a *losing* streak — it just quietly resets. This keeps the feature fun
// and encouraging rather than turning a rough run into a visible, called-out slump.
//
// Resets when the page reloads or a fresh session starts — that's intentional, a
// streak is a "hot hand this sitting", not a permanent record.
export const StreakTracker = {
    currentStreak: 0,
    sessionBest: 0,
    initialized: false,

    init() {
        if (this.initialized) return;
        this.initialized = true;

        EventBus.on('gameOver', (winnerId) => {
            if (winnerId === 0) {
                this.currentStreak++;
                if (this.currentStreak > this.sessionBest) {
                    this.sessionBest = this.currentStreak;
                }
            } else {
                // Any other real outcome (another player won, or -1 total defeat/draw)
                // quietly ends the streak. No loss-streak messaging is ever shown.
                this.currentStreak = 0;
            }
            EventBus.emit('streakUpdated', { current: this.currentStreak, best: this.sessionBest });
        });
    },

    // Returns display info for the victory screen, or null when there's nothing
    // streak-worthy to show yet (streak below 2).
    getBannerInfo() {
        if (this.currentStreak < 2) return null;
        const isNewBest = this.currentStreak === this.sessionBest;
        const isMilestone = this.currentStreak % 5 === 0;
        const templateKey = isMilestone ? 'streakMilestoneTemplate' : (isNewBest ? 'streakNewBestTemplate' : 'streakBannerTemplate');
        const template = Localization.get(templateKey);
        return {
            text: template.replace('{n}', this.currentStreak),
            isNewBest,
            isMilestone
        };
    }
};
