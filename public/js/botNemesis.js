import EventBus from './eventbus.js';
import { Localization } from './localization.js?v=3';

// --- BOT NEMESIS TRACKER (v2.9.0) ---
// Persistent (localStorage, same pattern as profileUI.js's ers_match_history),
// offline-Bot-Mode-only record of how many times each bot personality
// (Blitz/Chaos/Viper — see ai.js::BotPersonalities and CLAUDE.md §6.15) has
// been the winner of a match you played. Distinct from StreakTracker (session-
// only, opponent-agnostic) and from any global Elo/leaderboard system (there
// isn't one) — this is a personal, long-term "which bot do I struggle
// against" record, scoped to offline mode the same way BotPersonalities
// itself is scoped, for the same reason: multiplayer bot-takeover seats don't
// carry a personality at all (see ai.js), so there's nothing meaningful to
// tally there.
const STORAGE_KEY = 'ers_bot_nemesis';
const BOT_KEYS = ['blitz', 'chaos', 'viper']; // seats 1, 2, 3 respectively
const BOT_ICONS = { blitz: '⚡', chaos: '🌀', viper: '🐍' };

export const BotNemesis = {
    initialized: false,

    init() {
        if (this.initialized) return;
        this.initialized = true;

        EventBus.on('gameOver', (winnerId) => {
            import('./game.js').then(({ GameState }) => {
                if (!GameState || GameState.isMultiplayer) return; // offline Bot Mode only
                if (winnerId >= 1 && winnerId <= 3) {
                    this._recordBotWin(winnerId);
                }
                this.renderUI();
            });
        });

        this.renderUI(); // Show whatever's already on record from previous sessions.
    },

    _recordBotWin(seatIndex) {
        const key = BOT_KEYS[seatIndex - 1];
        if (!key) return;
        try {
            const tallies = this._load();
            tallies[key] = (tallies[key] || 0) + 1;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(tallies));
        } catch (e) {
            console.error('Failed to save bot nemesis tally:', e);
        }
    },

    _load() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch (e) {
            return {};
        }
    },

    getAllTallies() {
        const tallies = this._load();
        return BOT_KEYS.map((key) => ({ key, wins: tallies[key] || 0 }));
    },

    renderUI() {
        const el = document.getElementById('bot-nemesis-content');
        if (!el) return;

        const tallies = this.getAllTallies();
        const total = tallies.reduce((sum, t) => sum + t.wins, 0);

        if (total === 0) {
            el.innerHTML = `<p class="profile-empty">${Localization.get('nemesisEmpty') || 'Play some offline matches to build a rivalry record.'}</p>`;
            return;
        }

        const nemesis = tallies.reduce((best, t) => (t.wins > (best?.wins || 0) ? t : best), null);

        // v3.10.0 — the look moved to style.css with the rest of the profile
        // card. `.is-nemesis` is the only per-row variation, so it is the only
        // class the loop decides.
        const rows = tallies.map((t) => `
            <div class="profile-nemesis-row">
                <span>${BOT_ICONS[t.key]} ${Localization.get('bot' + (BOT_KEYS.indexOf(t.key) + 1))}</span>
                <span class="profile-nemesis-count${t.key === nemesis?.key && t.wins > 0 ? ' is-nemesis' : ''}">${t.wins}</span>
            </div>
        `).join('');

        const nemesisLine = nemesis && nemesis.wins > 0
            ? `<p class="profile-nemesis-callout">${(Localization.get('nemesisCallout') || '{bot} is your nemesis!').replace('{bot}', BOT_ICONS[nemesis.key] + ' ' + Localization.get('bot' + (BOT_KEYS.indexOf(nemesis.key) + 1)))}</p>`
            : '';

        el.innerHTML = nemesisLine + rows;
    }
};
