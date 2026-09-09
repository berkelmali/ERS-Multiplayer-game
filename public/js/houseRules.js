/**
 * houseRules.js — which slap rules are live right now.
 *
 * Deliberately dependency-light: it imports the rule registry and the event bus
 * and NOTHING else. `settings.js` pushes the player's local preference in;
 * `firebaseSync.js` pushes the table's rule set in when a multiplayer room
 * starts. That direction of flow is what keeps this out of an import cycle with
 * Settings → Localization → UI.
 *
 * Precedence is absolute: while a multiplayer room is active, THE ROOM DECIDES.
 * A player's local house-rule preferences never leak into someone else's table —
 * the host's set is written once into `gameRooms/{id}/houseRules` at deal time
 * and every client, including the host, reads the rules back from there. That
 * matters because slap validity is evaluated independently on each client
 * inside an RTDB transaction; if two clients disagreed about the rule set, they
 * would disagree about who won the pile.
 */

import { DEFAULT_RULES, normalizeRules, keyToRules, rulesToKey, isDefaultRuleSet } from './slapRules.js';
import EventBus from './eventbus.js';

export const HouseRules = {
    /** Player's own preference — used for offline play and when hosting. */
    local: { ...DEFAULT_RULES },

    /** Non-null only while a multiplayer room is active. */
    roomRules: null,

    /**
     * Non-null while something owns the rule set and will not share it.
     *
     * Currently only the Daily Challenge, which runs on the classic set BY
     * DEFINITION: every player on earth must be judged by the same patterns or
     * "I scored 2400 today" stops meaning anything.
     *
     * BE PRECISE ABOUT WHAT THIS CLOSES. Today the Settings panel lives in the
     * main menu, and the only way back to the menu mid-run is to quit — which
     * calls `stop()`, which unlocks anyway and settles the run as a loss. So
     * this is NOT plugging a hole a player can currently walk through with the
     * UI. It closes two other things:
     *
     *   1. The console. `HouseRules.setLocal(...)` from devtools during a scored
     *      run is the same class of tampering as writing a score straight to
     *      Firestore, and it used to work.
     *   2. The next person. "The daily is always classic" was an invariant that
     *      existed only as a line in `startRun()` and a UI that happened not to
     *      offer the path. Add an in-game pause menu with a settings shortcut —
     *      an obvious, harmless-looking feature — and the invariant breaks with
     *      nothing to catch it. Now it is enforced where the state lives.
     *
     * A string rather than a boolean, so the UI can say WHY the switches are dead.
     */
    lockedBy: null,

    /** The rule set that actually decides slaps right now. */
    active() {
        return this.roomRules || this.local;
    },

    isLocked() {
        return this.lockedBy !== null;
    },

    lock(owner) {
        this.lockedBy = owner || 'unknown';
        EventBus.emit('houseRulesLockChanged', this.lockedBy);
    },

    unlock() {
        if (this.lockedBy === null) return;
        this.lockedBy = null;
        EventBus.emit('houseRulesLockChanged', null);
    },

    /**
     * Refuses while locked, and returns the UNCHANGED set instead of throwing.
     *
     * That return value is load-bearing: settings.js already re-syncs its
     * checkboxes from the RESULT rather than from the click (so the "at least
     * one rule" invariant can bounce a switch back), which means a refused
     * toggle springs back on its own with no extra code.
     *
     * `force` exists for exactly one caller: the Daily Challenge itself, which
     * has to set the classic set on the way in and restore the player's own set
     * on the way out, both while it holds the lock.
     */
    setLocal(rules, { force = false } = {}) {
        if (this.isLocked() && !force) return this.local;
        this.local = normalizeRules(rules);
        if (!this.roomRules) EventBus.emit('houseRulesChanged', this.active());
        return this.local;
    },

    /** @param {string|object} incoming — wire key ("doubles,tens") or object. */
    applyRoom(incoming) {
        const next = typeof incoming === 'string' ? keyToRules(incoming) : normalizeRules(incoming);
        const changed = rulesToKey(next) !== (this.roomRules ? rulesToKey(this.roomRules) : null);
        this.roomRules = next;
        if (changed) EventBus.emit('houseRulesChanged', next);
        return next;
    },

    clearRoom() {
        if (!this.roomRules) return;
        this.roomRules = null;
        EventBus.emit('houseRulesChanged', this.active());
    },

    /** True when the live set is the classic one (lobby badge stays hidden). */
    isClassic() {
        return isDefaultRuleSet(this.active());
    },

    key() {
        return rulesToKey(this.active());
    },

    localKey() {
        return rulesToKey(this.local);
    }
};
