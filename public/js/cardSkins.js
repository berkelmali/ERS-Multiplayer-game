import EventBus from './eventbus.js';

// --- CARD SKINS + SHOP (v2.9.0; ledger moved to the server in v3.22.0) ---
// Play matches to earn Coins, spend them in the Shop to unlock card skins,
// equip one to change how YOUR played cards look.
//
// v3.22.0 — THE BROWSER NO LONGER OWNS THE BALANCE. Until then the coins were
// localStorage['ers_coins'] and the skins localStorage['ers_owned_skins'], on
// the reasoning that a cosmetic unlock hurts nobody. The owner judged
// otherwise: one console line minted any amount, for anyone. The ledger is now
// `wallets/{uid}` in Firestore, and firestore.rules (block 6) accepts only the
// moves walletRules.js describes. This module keeps the catalogue, the reward
// formula and a CACHE of the wallet; every change goes through the ledger that
// wallet.js attaches at sign-in. A guest has no ledger: guests play, but earn
// and buy nothing — the shop and the wheel ask them to sign in.
//
// This module imports nothing from Firebase on purpose: the test suite loads
// it in node, and gives it an in-memory ledger (walletRules.js) instead.

// Rarity tiers used in shop UI badges
// 'common' = free/no badge, 'epic' = mid-tier, 'rare' = premium, 'legendary' = ultra-premium,
// 'mythic' = the art decks above them (v3.20.0 the Pharaoh's Deck, v3.21.0 the Deck of the Gods)
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
    // v3.20.0 (council ERS-24) — the deck painted into the lobby art. No
    // `color`: it carries none of the particle/orbit FX above; its effect
    // (the sunrise, the glyph light) is its own, drawn by pharaohDeck.js and
    // style.css, and only the top card of the pile moves. `art` names the
    // decorator that draws its figures. 1 000: twice the dearest skin.
    { id: 'pharaoh',     nameKey: 'skinPharaohName',     cost: 1000, cssClass: 'card-skin-pharaoh',    rarity: 'mythic',    art: 'pharaoh' },
    // v3.21.0 (council ERS-25) — its sister by night: lapis lazuli, the gods on
    // the court cards, the winged sun and the stars. The operator's price.
    { id: 'gods',        nameKey: 'skinGodsName',        cost: 2000, cssClass: 'card-skin-gods',       rarity: 'mythic',    art: 'gods' },
];

// The pre-v3.22.0 local ledger. Nothing reads it as a balance any more: it is
// read ONCE, at a signed-in player's first wallet creation, as a capped import
// (walletRules.planImport — the rules refuse more than IMPORT_CAP), then removed.
const LEGACY_COINS_KEY = 'ers_coins';
const LEGACY_OWNED_KEY = 'ers_owned_skins';

export const CardSkins = {
    initialized: false,
    gameProcessed: false,
    /** The server ledger (wallet.js) while signed in; null for a guest. */
    _ledger: null,
    /** The last wallet the ledger reported: { coins, owned, earnDay, earnedToday, spinDay }. */
    _wallet: null,

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
                // cosmetic whatever the mode.
                if (GameManager.activeMode !== 'bots' && GameManager.activeMode !== 'multiplayer') return;
                const reward = this.computeReward(winnerId);
                // victoryScreen.js listens for this (registered at its own init,
                // well before this fires) to display the coin change — it does
                // NOT recompute the formula itself, to avoid re-creating the
                // exact "same data in two places" problem §6.29 already fixed
                // once for skin FX data. The amount is what the ledger WILL
                // apply (a full day, a zero balance), decided synchronously so
                // the screen never waits on the network; a guest gets `guest`.
                EventBus.emit('coinsAwarded', { winnerId, ...this._preview(reward) });
                this.addCoins(reward);
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

    // Quitting mid-match used to be a free way to dodge the loss penalty
    // above — closes that loophole by applying the exact same loss amount.
    // Reuses the gameProcessed guard so this can't double-penalize a game
    // that already ended normally (gameOver fired first) right before the
    // quit click registers, and so a real gameOver right after a quit can't
    // re-penalize either.
    applyQuitPenalty() {
        if (this.gameProcessed) return 0;
        this.gameProcessed = true;
        const penalty = this.computeReward(1); // Same value a real loss uses.
        // -2 = quit, distinguishable from a real loss/draw if anything downstream ever cares.
        EventBus.emit('coinsAwarded', { winnerId: -2, ...this._preview(penalty) });
        this.addCoins(penalty);
        return penalty;
    },

    // ── The ledger ───────────────────────────────────────────────────────────

    /** wallet.js calls this at sign-in; the in-memory ledger in tests does too. */
    attachLedger(ledger) {
        this._ledger = ledger || null;
        if (!ledger) this.setWallet(null);
    },

    /** At sign-out: back to a guest, who owns nothing and earns nothing. */
    detachLedger() {
        this._ledger = null;
        this.setWallet(null);
    },

    /** The ledger reports every wallet change here (a Firestore snapshot). */
    setWallet(w) {
        this._wallet = w ? { ...w, owned: Array.isArray(w.owned) ? [...w.owned] : ['classic'] } : null;
        EventBus.emit('coinsUpdated', this.getCoins());
        EventBus.emit('walletChanged', this.walletState());
    },

    /** 'guest' (no account), 'loading' (signed in, wallet not read yet) or 'ready'. */
    walletState() {
        if (!this._ledger) return 'guest';
        return this._wallet ? 'ready' : 'loading';
    },

    getWallet() {
        return this._wallet ? { ...this._wallet, owned: [...this._wallet.owned] } : null;
    },

    getCoins() {
        return this._wallet ? this._wallet.coins : 0;
    },

    /** What quitting the current match would really take: 0 for a guest or an empty wallet. */
    quitCost() {
        const p = this._preview(this.computeReward(1));
        return typeof p.amount === 'number' ? Math.abs(p.amount) : 0;
    },

    /** What an award of `amount` will actually apply, decided without the network. */
    _preview(amount) {
        if (!this._ledger || !this._wallet) return { amount: null, guest: this.walletState() === 'guest' };
        return { amount: this._ledger.preview(amount), guest: false };
    },

    /**
     * Earn (amount > 0) or spend (amount < 0) through the ledger. Resolves
     * with what was applied; a guest, a full day or a failed write give 0.
     * `addCoins` is still the ONE writer every award goes through — the wheel
     * uses claimSpin, which is a different shape in the rules.
     */
    addCoins(amount) {
        const n = Math.trunc(Number(amount)) || 0;
        if (!this._ledger || !this._wallet || n === 0) return Promise.resolve(0);
        const op = n < 0 ? this._ledger.spend(-n) : this._ledger.earn(n);
        return Promise.resolve(op).catch((e) => {
            console.warn('[coins] not saved:', e && (e.code || e.message));
            return 0;
        });
    },

    /** Is today's wheel spin still unclaimed, by the server's day? False for a guest. */
    spinAvailable() {
        return !!(this._ledger && this._wallet && this._ledger.canSpin());
    },

    /** Today's wheel prize (0 for an empty segment). Resolves with { ok, reason?, granted? }. */
    claimSpin(amount) {
        if (!this._ledger || !this._wallet) return Promise.resolve({ ok: false, reason: 'signin_required' });
        return Promise.resolve(this._ledger.claimSpin(amount)).catch((e) => {
            console.warn('[coins] spin not saved:', e && (e.code || e.message));
            return { ok: false, reason: 'network' };
        });
    },

    getOwnedSkins() {
        return this._wallet ? [...this._wallet.owned] : ['classic'];
    },

    isOwned(skinId) {
        return skinId === 'classic' || this.getOwnedSkins().includes(skinId);
    },

    /**
     * The skin to draw. The equipped choice is a SETTING (localStorage), so it
     * is only honoured for a skin the wallet says is owned — otherwise editing
     * ersSettings would be a way round the shop.
     */
    effectiveSkin(equipped) {
        return equipped && this.isOwned(equipped) ? equipped : 'classic';
    },

    // Attempts to unlock a skin with Coins. Resolves { ok, coins } — ok is
    // false if already owned, insufficient Coins, signed out or refused by the
    // server; ui code should check ok before treating the purchase as done.
    async purchase(skinId) {
        const skin = CARD_SKINS.find((s) => s.id === skinId);
        if (!skin) return { ok: false, reason: 'not_found', coins: this.getCoins() };
        if (!this._ledger || !this._wallet) return { ok: false, reason: 'signin_required', coins: 0 };
        if (this.isOwned(skinId)) return { ok: false, reason: 'already_owned', coins: this.getCoins() };

        const coins = this.getCoins();
        if (coins < skin.cost) return { ok: false, reason: 'insufficient_funds', coins, needed: skin.cost - coins };

        try {
            const r = await this._ledger.purchase(skinId);
            return r && r.ok
                ? { ok: true, coins: this.getCoins() }
                : { ok: false, reason: (r && r.reason) || 'refused', coins: this.getCoins(), needed: r && r.needed };
        } catch (e) {
            console.warn('[coins] purchase not saved:', e && (e.code || e.message));
            return { ok: false, reason: 'network', coins };
        }
    },

    // ── The pre-v3.22.0 local ledger, for the one-time import ────────────────

    readLegacyLocal() {
        try {
            const coins = parseInt(localStorage.getItem(LEGACY_COINS_KEY) || '0', 10) || 0;
            const owned = JSON.parse(localStorage.getItem(LEGACY_OWNED_KEY) || '[]');
            return { coins, owned: Array.isArray(owned) ? owned : [] };
        } catch (e) {
            return { coins: 0, owned: [] };
        }
    },

    clearLegacyLocal() {
        try {
            localStorage.removeItem(LEGACY_COINS_KEY);
            localStorage.removeItem(LEGACY_OWNED_KEY);
        } catch (e) { /* private mode: nothing was stored */ }
    },

    getSkinClass(skinId) {
        const skin = CARD_SKINS.find((s) => s.id === skinId);
        return skin ? skin.cssClass : '';
    },

    /** Which art deck draws a skin's figures ('pharaoh', 'gods'), or null. */
    getSkinArt(skinId) {
        const skin = CARD_SKINS.find((s) => s.id === skinId);
        return (skin && skin.art) || null;
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
