import EventBus from './eventbus.js';

// --- CARD SKINS + SHOP (v2.9.0) ---
// A cosmetic-only progression system: play offline matches to earn Coins,
// spend them in the Shop to unlock card skins, equip one to change how YOUR
// played cards look. Deliberately simple and client-local (localStorage,
// same pattern as StreakTracker/BotNemesis) — no Firestore, no Cloud
// Function gating. That's a conscious choice, not an oversight: unlike
// competitive stats (Elo, leaderboard) where a client-side "cheat" would hurt
// other players, a cosmetic-only unlock is stakes-free even if someone
// edited their own localStorage — it changes nothing for anyone else, and
// nothing about matchmaking, scoring, or fairness. If this ever grows real
// monetary value (real-money purchases) it would need the server-authority
// treatment §7.4 gives game logic; as a free, offline, cosmetic-only system,
// it doesn't.

// Rarity tiers used in shop UI badges
// 'common' = free/no badge, 'epic' = mid-tier, 'rare' = premium, 'legendary' = ultra-premium
//
// color/color2/color3/particleCount drive the in-game particle/glow effects
// (see ui.js::_injectCardSkinFX and shopUI.js's preview rendering). This used
// to be defined a second (and third) time, independently, in each of those
// files — a real drift risk with no single source of truth. It's consolidated
// here now: ui.js and shopUI.js both import CARD_SKINS for this data instead
// of keeping their own copies. Add a skin ONCE, here, and both the shop
// preview and actual gameplay rendering pick it up automatically.
export const CARD_SKINS = [
    { id: 'classic',     nameKey: 'skinClassicName',     cost: 0,   cssClass: '',                      rarity: 'common' },
    { id: 'golden',      nameKey: 'skinGoldenName',      cost: 150, cssClass: 'card-skin-golden',      rarity: 'epic',      color: '255, 215, 0',  particleCount: 5 },
    { id: 'neon',        nameKey: 'skinNeonName',        cost: 150, cssClass: 'card-skin-neon',        rarity: 'epic',      color: '0, 229, 255',  particleCount: 6 },
    { id: 'shadow',      nameKey: 'skinShadowName',      cost: 200, cssClass: 'card-skin-shadow',      rarity: 'epic',      color: '229, 62, 62',  particleCount: 4 },
    { id: 'inferno',     nameKey: 'skinInfernoName',     cost: 200, cssClass: 'card-skin-inferno',     rarity: 'epic',      color: '255, 107, 53', particleCount: 7 },
    { id: 'frost',       nameKey: 'skinFrostName',       cost: 200, cssClass: 'card-skin-frost',       rarity: 'epic',      color: '125, 211, 252', particleCount: 5 },
    { id: 'emerald',     nameKey: 'skinEmeraldName',     cost: 250, cssClass: 'card-skin-emerald',     rarity: 'rare',      color: '52, 211, 153', particleCount: 5 },
    { id: 'royal',       nameKey: 'skinRoyalName',       cost: 250, cssClass: 'card-skin-royal',       rarity: 'rare',      color: '167, 139, 250', particleCount: 5 },
    { id: 'sakura',      nameKey: 'skinSakuraName',      cost: 300, cssClass: 'card-skin-sakura',      rarity: 'rare',      color: '249, 168, 212', particleCount: 6 },
    { id: 'phantom',     nameKey: 'skinPhantomName',     cost: 350, cssClass: 'card-skin-phantom',     rarity: 'legendary', color: '79, 209, 197', color2: '100, 255, 218', particleCount: 8 },
    { id: 'holographic', nameKey: 'skinHolographicName', cost: 400, cssClass: 'card-skin-holographic', rarity: 'legendary', color: '167, 139, 250', color2: '78, 205, 196', color3: '255, 107, 107', particleCount: 10 },
    { id: 'obsidian',    nameKey: 'skinObsidianName',    cost: 500, cssClass: 'card-skin-obsidian',    rarity: 'legendary', color: '180, 180, 180', color2: '255, 255, 255', particleCount: 6 },
];

const COINS_KEY = 'ers_coins';
const OWNED_SKINS_KEY = 'ers_owned_skins';

export const CardSkins = {
    initialized: false,
    gameProcessed: false,

    init() {
        if (this.initialized) return;
        this.initialized = true;

        EventBus.on('gameStarted', () => {
            this.gameProcessed = false;
        });

        EventBus.on('gameOver', (winnerId) => {
            if (this.gameProcessed) return; // Same guard scoreSystem.js uses — gameOver can fire more than once per game in some edge cases.
            this.gameProcessed = true;

            import('./gameManager.js').then(({ GameManager }) => {
                // Bots AND multiplayer — both emit 'gameOver' with the same
                // shape (winnerId === 0 means "you", in both modes, since
                // firebaseSync.js already rotates multiplayer's visual index
                // the same way offline mode's is inherently 0-based). Coins stay
                // purely cosmetic/client-local regardless of mode — see the
                // module comment above for why that's safe in multiplayer too.
                if (GameManager.activeMode !== 'bots' && GameManager.activeMode !== 'multiplayer') return;
                const reward = this.computeReward(winnerId);
                this.addCoins(reward);
                // victoryScreen.js listens for this (registered at its own init,
                // well before this fires) to display the coin change — it does
                // NOT recompute the formula itself, to avoid re-creating the
                // exact "same data in two places" problem §6.29 already fixed
                // once for skin FX data.
                EventBus.emit('coinsAwarded', { winnerId, amount: reward });
            });
        });
    },

    // Single source of truth for the reward formula — used both to actually
    // award coins above AND by victoryScreen.js's display (indirectly, via
    // the coinsAwarded event) so the two can never drift apart.
    //
    // A real, asymmetric penalty on loss (not just "fewer coins") is
    // deliberate: the previous version gave positive coins for ANY outcome,
    // which meant a player could deliberately lose fast, over and over, and
    // farm coins with zero effort — arguably faster than actually trying to
    // win. Losing now costs more than a single win recovers in isolation,
    // but the break-even win rate is only ~27% (40x = 15(1-x) => x ≈ 0.267),
    // well under the ~25% "fair share" baseline in a 4-player free-for-all,
    // so anyone actually trying to win comes out ahead over time — only
    // farming via deliberate loss is discouraged.
    computeReward(winnerId) {
        return winnerId === 0 ? 40 : -15;
    },

    getCoins() {
        try {
            return parseInt(localStorage.getItem(COINS_KEY) || '0', 10) || 0;
        } catch (e) {
            return 0;
        }
    },

    addCoins(amount) {
        try {
            const total = Math.max(0, this.getCoins() + amount);
            localStorage.setItem(COINS_KEY, String(total));
            EventBus.emit('coinsUpdated', total);
            return total;
        } catch (e) {
            console.error('Failed to save coins:', e);
            return this.getCoins();
        }
    },

    getOwnedSkins() {
        try {
            const owned = JSON.parse(localStorage.getItem(OWNED_SKINS_KEY) || '["classic"]');
            return Array.isArray(owned) ? owned : ['classic'];
        } catch (e) {
            return ['classic'];
        }
    },

    isOwned(skinId) {
        return skinId === 'classic' || this.getOwnedSkins().includes(skinId);
    },

    // Attempts to unlock a skin with Coins. Returns { ok, coins } — ok is
    // false if already owned or insufficient Coins; ui code should check ok
    // before treating the purchase as having happened.
    purchase(skinId) {
        const skin = CARD_SKINS.find((s) => s.id === skinId);
        if (!skin) return { ok: false, reason: 'not_found', coins: this.getCoins() };
        if (this.isOwned(skinId)) return { ok: false, reason: 'already_owned', coins: this.getCoins() };

        const coins = this.getCoins();
        if (coins < skin.cost) return { ok: false, reason: 'insufficient_funds', coins, needed: skin.cost - coins };

        const owned = this.getOwnedSkins();
        owned.push(skinId);
        try {
            localStorage.setItem(OWNED_SKINS_KEY, JSON.stringify(owned));
            const remaining = this.addCoins(-skin.cost);
            return { ok: true, coins: remaining };
        } catch (e) {
            console.error('Failed to save skin purchase:', e);
            return { ok: false, reason: 'storage_error', coins };
        }
    },

    getSkinClass(skinId) {
        const skin = CARD_SKINS.find((s) => s.id === skinId);
        return skin ? skin.cssClass : '';
    },

    // Single source of truth for a skin's particle/glow FX data — ui.js and
    // shopUI.js both call this instead of keeping their own copy (see the
    // comment on CARD_SKINS above for why that used to be a problem).
    getSkinFX(skinId) {
        const skin = CARD_SKINS.find((s) => s.id === skinId);
        if (!skin || !skin.color) return null; // 'classic' (and any skin with no color) has no FX.
        return {
            color: skin.color,
            color2: skin.color2,
            color3: skin.color3,
            particleCount: skin.particleCount,
            rarity: skin.rarity
        };
    }
};
