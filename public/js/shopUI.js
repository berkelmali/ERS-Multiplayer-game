import { Settings } from './settings.js';
import { Localization } from './localization.js?v=3';
import { CardSkins, CARD_SKINS } from './cardSkins.js';
import { getRankName, getSuitSymbol } from './game.js';
import EventBus from './eventbus.js';

// Rarity badge config — color palette + label per tier
const RARITY_CONFIG = {
    epic:      { label: '● EPIC',      color: '#00e5ff', bg: 'rgba(0,229,255,0.2)',   border: 'rgba(0,229,255,0.3)' },
    rare:      { label: '✦ RARE',      color: '#c4b5fd', bg: 'rgba(167,139,250,0.2)', border: 'rgba(167,139,250,0.3)' },
    legendary: { label: '★ LEGENDARY', color: '#ffd700', bg: 'rgba(255,215,0,0.2)',   border: 'rgba(255,215,0,0.3)' },
};

// Multiple preview cards for variety — cycles through on hover
const PREVIEW_CARDS = [
    { rank: 14, suit: 'spades' },
    { rank: 13, suit: 'hearts' },
    { rank: 12, suit: 'diamonds' },
    { rank: 11, suit: 'clubs' },
];

export const ShopUI = {
    initialized: false,

    init() {
        if (this.initialized) return;
        this.initialized = true;

        document.getElementById('btn-shop')?.addEventListener('click', () => this.open());
        document.getElementById('btn-shop-back')?.addEventListener('click', () => this.close());

        EventBus.on('coinsUpdated', () => this.updateCoinBalance());
    },

    open() {
        document.getElementById('main-menu').classList.remove('active');
        document.getElementById('shop-panel').classList.add('active');
        this.render();
    },

    close() {
        document.getElementById('shop-panel').classList.remove('active');
        document.getElementById('main-menu').classList.add('active');
    },

    updateCoinBalance() {
        const el = document.getElementById('shop-coin-balance');
        if (!el) return;
        const newTotal = CardSkins.getCoins();
        const prevTotal = this._lastKnownCoins;
        el.textContent = `🪙 ${newTotal}`;
        if (typeof prevTotal === 'number' && newTotal > prevTotal) {
            this._animateCoinAdd();
        }
        this._lastKnownCoins = newTotal;
    },

    _animateCoinAdd() {
        const el = document.getElementById('shop-coin-balance');
        if (!el) return;
        el.style.transform = 'scale(1.25)';
        el.style.transition = 'transform 0.2s ease-out';
        setTimeout(() => { el.style.transform = 'scale(1)'; }, 200);
    },

    _injectSkinEffects(cardEl, skinId) {
        const fx = CardSkins.getSkinFX(skinId);
        if (!fx) return;

        const overlay = document.createElement('div');
        overlay.className = 'card-skin-overlay';

        // Shimmer sweep (all skins)
        const shimmer = document.createElement('div');
        shimmer.className = 'card-skin-shimmer';
        overlay.appendChild(shimmer);

        // Floating particles
        for (let i = 0; i < fx.particleCount; i++) {
            const p = document.createElement('div');
            p.className = 'card-skin-particle';
            const size = 2 + Math.random() * 3;
            // Legendary skins: alternate between primary and secondary colors
            let particleColor = fx.color;
            if (fx.rarity === 'legendary' && fx.color2 && i % 3 === 1) {
                particleColor = fx.color2;
            } else if (fx.rarity === 'legendary' && fx.color3 && i % 3 === 2) {
                particleColor = fx.color3;
            }
            p.style.width = `${size}px`;
            p.style.height = `${size}px`;
            p.style.left = `${5 + Math.random() * 90}%`;
            p.style.bottom = `${Math.random() * 40}%`;
            p.style.background = `rgba(${particleColor}, ${0.6 + Math.random() * 0.4})`;
            p.style.boxShadow = `0 0 ${3 + Math.random() * 5}px rgba(${particleColor}, 0.7)`;
            p.style.animationDelay = `${Math.random() * 3}s`;
            p.style.animationDuration = `${2 + Math.random() * 2}s`;
            overlay.appendChild(p);
        }

        cardEl.appendChild(overlay);

        // Edge glow (all skins)
        const edgeGlow = document.createElement('div');
        edgeGlow.className = 'card-skin-edge-glow';
        cardEl.appendChild(edgeGlow);

        // ─── LEGENDARY-ONLY ENHANCED JS EFFECTS ───
        if (fx.rarity === 'legendary') {
            this._injectLegendaryFX(cardEl, fx, skinId);
        }
    },

    // Legendary skins get extra JS-driven visual layers
    _injectLegendaryFX(cardEl, fx, skinId) {
        // 1. Orbiting energy ring — a thin line that rotates around the card
        const orbitRing = document.createElement('div');
        orbitRing.style.cssText = `
            position: absolute; inset: -4px; border-radius: inherit;
            border: 1px solid rgba(${fx.color}, 0.3);
            pointer-events: none; z-index: 3;
            animation: legendaryOrbit ${skinId === 'holographic' ? '2s' : '3s'} linear infinite;
        `;
        cardEl.appendChild(orbitRing);

        // 2. Pulsing ambient aura — outer glow that breathes
        const aura = document.createElement('div');
        const auraColor2 = fx.color2 || fx.color;
        aura.style.cssText = `
            position: absolute; inset: -8px; border-radius: inherit;
            background: radial-gradient(ellipse at 50% 50%,
                rgba(${fx.color}, 0.08) 0%,
                rgba(${auraColor2}, 0.04) 40%,
                transparent 70%
            );
            pointer-events: none; z-index: 0;
            animation: legendaryAura 2.5s ease-in-out infinite alternate;
        `;
        cardEl.appendChild(aura);

        // 3. Traveling spark — a small bright dot that moves along the card edge
        const spark = document.createElement('div');
        spark.style.cssText = `
            position: absolute; width: 4px; height: 4px;
            background: rgba(${fx.color2 || fx.color}, 0.9);
            border-radius: 50%;
            box-shadow: 0 0 8px rgba(${fx.color2 || fx.color}, 0.8),
                        0 0 16px rgba(${fx.color}, 0.4);
            pointer-events: none; z-index: 5;
            animation: legendarySpark 4s linear infinite;
        `;
        cardEl.appendChild(spark);

        // 4. Holographic-only: second shimmer with opposite direction
        if (skinId === 'holographic') {
            const shimmer2 = document.createElement('div');
            shimmer2.className = 'card-skin-shimmer';
            shimmer2.style.animation = 'skinShimmerReverse 2.5s linear infinite';
            shimmer2.style.background = `linear-gradient(120deg,
                transparent 25%,
                rgba(255,107,107,0.08) 38%,
                rgba(78,205,196,0.12) 50%,
                rgba(255,217,61,0.08) 62%,
                transparent 75%)`;
            cardEl.querySelector('.card-skin-overlay')?.appendChild(shimmer2);
        }

        // Inject legendary keyframes if not yet added
        if (!document.getElementById('legendary-fx-keyframes')) {
            const style = document.createElement('style');
            style.id = 'legendary-fx-keyframes';
            style.textContent = `
                @keyframes legendaryOrbit {
                    0%   { transform: rotate(0deg); border-color: rgba(${fx.color}, 0.3); }
                    50%  { border-color: rgba(${fx.color2 || fx.color}, 0.5); }
                    100% { transform: rotate(360deg); border-color: rgba(${fx.color}, 0.3); }
                }
                @keyframes legendaryAura {
                    0%   { opacity: 0.4; transform: scale(1); }
                    100% { opacity: 0.8; transform: scale(1.03); }
                }
                @keyframes legendarySpark {
                    0%   { top: 0; left: 10%; opacity: 0; }
                    5%   { opacity: 1; }
                    25%  { top: 0; left: 90%; }
                    50%  { top: 90%; left: 90%; }
                    75%  { top: 90%; left: 10%; }
                    95%  { opacity: 1; }
                    100% { top: 0; left: 10%; opacity: 0; }
                }
                @keyframes skinShimmerReverse {
                    0%   { transform: translateX(60%) translateY(20%) rotate(25deg); }
                    100% { transform: translateX(-60%) translateY(-20%) rotate(25deg); }
                }
            `;
            document.head.appendChild(style);
        }
    },

    render() {
        this.updateCoinBalance();
        const grid = document.getElementById('shop-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const owned = CardSkins.getOwnedSkins();
        const equipped = Settings.config.equippedCardSkin;

        CARD_SKINS.forEach((skin, idx) => {
            const isOwned = owned.includes(skin.id);
            const isEquipped = equipped === skin.id;

            const item = document.createElement('div');
            item.className = 'shop-item' + (isEquipped ? ' shop-item-active' : '');
            item.setAttribute('data-skin', skin.id);

            // --- Rarity badge ---
            const rarityInfo = RARITY_CONFIG[skin.rarity];
            if (rarityInfo) {
                const badge = document.createElement('div');
                badge.style.cssText = `position:absolute;top:5px;left:6px;font-size:0.55rem;font-weight:800;
                    padding:2px 5px;border-radius:5px;letter-spacing:0.4px;text-transform:uppercase;z-index:5;`;
                badge.style.background = rarityInfo.bg;
                badge.style.color = rarityInfo.color;
                badge.style.border = `1px solid ${rarityInfo.border}`;
                badge.textContent = rarityInfo.label;
                item.appendChild(badge);
            }

            // --- Preview card with effects ---
            const preview = document.createElement('div');
            preview.className = 'shop-item-preview';

            const previewCard = PREVIEW_CARDS[0];
            const cardEl = this._buildCardElement(previewCard, skin);

            if (skin.cssClass) {
                this._injectSkinEffects(cardEl, skin.id);
            }

            preview.appendChild(cardEl);

            // Hover: cycle preview card
            if (skin.cssClass) {
                let hoverIdx = 0;
                item.addEventListener('mouseenter', () => {
                    hoverIdx = (hoverIdx + 1) % PREVIEW_CARDS.length;
                    const nextCard = PREVIEW_CARDS[hoverIdx];
                    const rankStr = getRankName(nextCard.rank);
                    const suitStr = getSuitSymbol(nextCard.suit);
                    const colorClass = (nextCard.suit === 'hearts' || nextCard.suit === 'diamonds') ? 'red' : 'black';
                    cardEl.className = `card ${colorClass} ${skin.cssClass}`.trim();
                    cardEl.querySelector('.card-top').textContent = `${rankStr} ${suitStr}`;
                    cardEl.querySelector('.card-center').textContent = suitStr;
                    cardEl.querySelector('.card-bottom').textContent = `${rankStr} ${suitStr}`;
                });
            }

            // --- Name ---
            const name = document.createElement('div');
            name.className = 'shop-item-name';
            name.textContent = Localization.get(skin.nameKey);

            // --- Price tag (shown under name for locked items) ---
            if (!isOwned && skin.cost > 0) {
                const price = document.createElement('div');
                price.style.cssText = 'font-size:0.7rem;opacity:0.7;margin-bottom:0.3rem;color:#ffd700;';
                price.textContent = `🪙 ${skin.cost}`;
                item.appendChild(preview);
                item.appendChild(name);
                item.appendChild(price);
            } else {
                item.appendChild(preview);
                item.appendChild(name);
            }

            // --- Action button ---
            const action = document.createElement('button');
            action.className = 'btn shop-item-btn';
            if (isEquipped) {
                action.textContent = Localization.get('shopEquipped') || 'Equipped ✓';
                action.classList.add('shop-equipped');
                action.disabled = true;
            } else if (isOwned) {
                action.textContent = Localization.get('shopEquip') || 'Equip';
                action.classList.add('primary');
                action.addEventListener('click', () => this.equip(skin.id));
            } else {
                action.textContent = `${Localization.get('shopUnlock') || 'Unlock'} — 🪙 ${skin.cost}`;
                if (CardSkins.getCoins() < skin.cost) {
                    action.classList.add('shop-locked');
                } else {
                    action.classList.add('primary');
                }
                action.addEventListener('click', () => this.purchase(skin.id, item));
            }

            item.appendChild(action);
            grid.appendChild(item);

            // Staggered entrance
            item.style.opacity = '0';
            item.style.transform = 'translateY(16px)';
            item.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            setTimeout(() => {
                item.style.opacity = '1';
                item.style.transform = 'translateY(0)';
            }, 50 * idx);
        });
    },

    _buildCardElement(card, skin) {
        const colorClass = (card.suit === 'hearts' || card.suit === 'diamonds') ? 'red' : 'black';
        const cardEl = document.createElement('div');
        cardEl.className = `card ${colorClass} ${skin.cssClass}`.trim();
        const rankStr = getRankName(card.rank);
        const suitStr = getSuitSymbol(card.suit);
        cardEl.innerHTML = `
            <div class="card-top">${rankStr} ${suitStr}</div>
            <div class="card-center">${suitStr}</div>
            <div class="card-bottom">${rankStr} ${suitStr}</div>
        `;
        return cardEl;
    },

    purchase(skinId, itemEl) {
        const result = CardSkins.purchase(skinId);
        if (result.ok) {
            if (itemEl) {
                itemEl.classList.add('shop-item-purchased');
                setTimeout(() => itemEl.classList.remove('shop-item-purchased'), 600);
            }
            this._spawnPurchaseParticles(itemEl);
            const skin = CARD_SKINS.find((s) => s.id === skinId);
            import('./audioManager.js').then((m) => m.AudioManager.playSkinUnlock(skin?.rarity));
            this.equip(skinId, true); // Silent — the unlock chime already covers this moment.
        } else {
            if (itemEl) {
                itemEl.style.transform = 'translateX(-6px)';
                setTimeout(() => { itemEl.style.transform = 'translateX(6px)'; }, 60);
                setTimeout(() => { itemEl.style.transform = 'translateX(-3px)'; }, 120);
                setTimeout(() => { itemEl.style.transform = 'translateX(3px)'; }, 180);
                setTimeout(() => { itemEl.style.transform = 'translateX(0)'; }, 240);
            }
            if (result.reason === 'insufficient_funds') {
                const msg = (Localization.get('shopInsufficientFunds') || 'Not enough coins — need {n} more')
                    .replace('{n}', result.needed);
                this.showAlert(msg);
                import('./audioManager.js').then((m) => m.AudioManager.playSFX('invalidSlap'));
            }
            this.render();
        }
    },

    showAlert(msg) {
        const el = document.getElementById('shop-notification');
        if (!el) return;
        el.textContent = msg;
        el.style.transform = 'translate(-50%, -50%) scale(0)';
        el.style.opacity = '1';
        setTimeout(() => {
            el.style.transform = 'translate(-50%, -50%) scale(1.05)';
            setTimeout(() => {
                el.style.transform = 'translate(-50%, -50%) scale(1)';
                setTimeout(() => { el.style.opacity = '0'; }, 1400);
            }, 150);
        }, 10);
    },

    _spawnPurchaseParticles(itemEl) {
        if (!itemEl) return;
        const rect = itemEl.getBoundingClientRect();
        for (let i = 0; i < 12; i++) {
            const p = document.createElement('div');
            p.style.cssText = `
                position: fixed;
                width: ${3 + Math.random() * 5}px;
                height: ${3 + Math.random() * 5}px;
                background: #ffd700;
                border-radius: 50%;
                pointer-events: none;
                z-index: 9999;
                left: ${rect.left + rect.width / 2}px;
                top: ${rect.top + rect.height / 2}px;
                box-shadow: 0 0 6px rgba(255, 215, 0, 0.8);
            `;
            document.body.appendChild(p);
            const angle = (Math.PI * 2 * i) / 12 + (Math.random() - 0.5) * 0.5;
            const dist = 40 + Math.random() * 60;
            const tx = Math.cos(angle) * dist;
            const ty = Math.sin(angle) * dist;
            p.animate([
                { transform: 'translate(0, 0) scale(1)', opacity: 1 },
                { transform: `translate(${tx}px, ${ty}px) scale(0)`, opacity: 0 }
            ], { duration: 500 + Math.random() * 300, easing: 'ease-out', fill: 'forwards' });
            setTimeout(() => p.remove(), 900);
        }
    },

    equip(skinId, silent = false) {
        Settings.config.equippedCardSkin = skinId;
        Settings.save();
        if (!silent) {
            import('./audioManager.js').then((m) => m.AudioManager.playSkinEquip());
        }
        this.render();
    }
};
