/**
 * adminPanel.js — send coins to a player (v3.22.0). Admin accounts only.
 *
 * The panel sits in the account screen and stays hidden unless the signed-in
 * account has a document in `admins/` — which only the Firebase console can
 * create. Hiding it is a convenience: firestore.rules refuses every call
 * WalletAdmin makes for anyone else, so a player who un-hides this markup gets
 * a refusal, not coins. Each grant commits together with an immutable
 * `coin_grants/` audit record naming who sent what, to whom, and why.
 */
import EventBus from './eventbus.js';
import { Localization } from './localization.js?v=3';
import { WalletAdmin } from './wallet.js';
import { ADMIN_GRANT_MAX } from './walletRules.js';

const $ = (id) => document.getElementById(id);
const fill = (key, vars = {}) => Object.entries(vars).reduce(
    (t, [k, v]) => t.split(`{${k}}`).join(String(v)), Localization.get(key));

export const AdminPanel = {
    initialized: false,
    selected: null,       // { uid, username }
    _checkGen: 0,

    init() {
        if (this.initialized) return;
        this.initialized = true;
        this.panel = $('admin-coin-panel');
        if (!this.panel) return;

        EventBus.on('authStateChanged', (user) => this.refresh(user));
        $('btn-admin-search')?.addEventListener('click', () => this.search());
        $('admin-player-search')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.search(); } });
        $('btn-admin-grant')?.addEventListener('click', () => this.grant());
    },

    /** Shown only when the account is an admin; checked once per sign-in. */
    async refresh(user) {
        const gen = ++this._checkGen;
        this.panel.hidden = true;
        this.select(null);
        if (!user) return;
        const isAdmin = await WalletAdmin.isAdmin(user.uid);
        if (gen === this._checkGen) this.panel.hidden = !isAdmin;
    },

    status(text, kind = '') {
        const el = $('admin-status');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'admin-status' + (kind ? ` is-${kind}` : '');
    },

    select(player) {
        this.selected = player;
        const btn = $('btn-admin-grant');
        if (btn) btn.disabled = !player;
    },

    async search() {
        const input = ($('admin-player-search')?.value || '').trim();
        const list = $('admin-player-results');
        if (!input || !list) return;
        list.textContent = '';
        this.select(null);
        this.status(Localization.get('adminSearching'));
        const players = await WalletAdmin.findPlayers(input);
        if (!players.length) { this.status(Localization.get('adminNotFound'), 'error'); return; }
        this.status('');
        players.forEach((p) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn secondary admin-result';
            // textContent, never innerHTML: a display name is player-chosen text.
            b.textContent = `${p.username || '—'} · ${p.uid.slice(0, 8)}…`;
            b.addEventListener('click', () => this.pick(p, b));
            list.appendChild(b);
        });
        if (players.length === 1) this.pick(players[0], list.firstChild);
    },

    async pick(player, btn) {
        document.querySelectorAll('#admin-player-results .admin-result').forEach(el => el.classList.toggle('is-picked', el === btn));
        this.select(null);
        const name = player.username || player.uid;
        try {
            const w = await WalletAdmin.readWallet(player.uid);
            if (!w) { this.status(fill('adminNoWallet', { name }), 'error'); return; }
            this.select(player);
            this.status(fill('adminBalance', { name, n: w.coins }));
        } catch (e) {
            this.status(fill('adminFailed', { code: (e && e.code) || 'error' }), 'error');
        }
    },

    async grant() {
        const player = this.selected;
        if (!player) { this.status(Localization.get('adminPickPlayer'), 'error'); return; }
        const raw = ($('admin-amount')?.value || '').trim();
        const n = Number(raw);
        if (!/^-?\d+$/.test(raw) || n === 0 || Math.abs(n) > ADMIN_GRANT_MAX) {
            this.status(fill('adminBadAmount', { max: ADMIN_GRANT_MAX }), 'error');
            return;
        }
        const name = player.username || player.uid;
        if (!window.confirm(fill('adminConfirm', { n, name }))) return;
        const btn = $('btn-admin-grant');
        if (btn) btn.disabled = true;
        try {
            const r = await WalletAdmin.grant(player.uid, n, $('admin-note')?.value || '');
            if (r && r.ok) {
                this.status(fill('adminGranted', { n, name, after: r.after }), 'ok');
                const amount = $('admin-amount'); if (amount) amount.value = '';
            } else {
                this.status(fill(r && r.reason === 'no_wallet' ? 'adminNoWallet' : 'adminFailed', { name, code: (r && r.reason) || 'refused' }), 'error');
            }
        } catch (e) {
            this.status(fill('adminFailed', { code: (e && e.code) || 'error' }), 'error');
        } finally {
            if (btn) btn.disabled = !this.selected;
        }
    }
};
