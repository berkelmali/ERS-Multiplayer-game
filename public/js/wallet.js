/**
 * wallet.js — the signed-in player's coin ledger, on Firestore (v3.22.0).
 *
 * The balance and the owned skins are `wallets/{uid}`. This module:
 *   · at sign-in, creates the wallet once — importing the old local balance,
 *     capped by walletRules.planImport and by the rules — and then follows it
 *     with a snapshot listener, handing each state to CardSkins;
 *   · gives CardSkins a ledger whose every move is a transaction computed by
 *     walletRules.js, the mirror of firestore.rules block 6;
 *   · offers the admin half (WalletAdmin): look a player up, read a wallet,
 *     grant coins with an audit record. The rules refuse every one of those
 *     calls unless the caller has a document in `admins/` — the button being
 *     hidden is convenience, not the protection.
 *
 * Days are counted on the SERVER's clock (NetQuality.serverNow) because the
 * rules count them on request.time; a phone whose clock is an hour off would
 * otherwise see its first win after midnight refused.
 */
import { getFirestore, doc, collection, onSnapshot, runTransaction, serverTimestamp, getDoc, getDocs, query, where, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import EventBus from "./eventbus.js";
import { CardSkins } from "./cardSkins.js";
import { NetQuality } from "./netQuality.js";
import { cleanName } from "./safeText.js";
import { safeId } from "./adminCore.js";
import { normalizeWallet, planEarn, planSpend, planPurchase, planSpin, planImport, planGrant, planAdminDaily, previewAward } from "./walletRules.js";

const db = getFirestore(app);
const now = () => NetQuality.serverNow();

export const Wallet = {
    _uid: null,
    _unsub: null,
    _gen: 0,          // bumped on every sign-in/out: a late answer for an old session is dropped
    initialized: false,

    init() {
        if (this.initialized) return;
        this.initialized = true;
        EventBus.on('authStateChanged', (user) => { if (user) this._open(user); else this._close(); });
    },

    async _open(user) {
        this._close();
        const gen = ++this._gen;
        this._uid = user.uid;
        const ref = doc(db, 'wallets', user.uid);
        CardSkins.attachLedger(this._ledger(ref));      // 'loading' until the first snapshot
        try {
            await this._ensure(ref);
        } catch (e) {
            console.warn('[wallet] could not create the wallet:', e && (e.code || e.message));
        }
        if (gen !== this._gen) return;
        this._unsub = onSnapshot(ref, (snap) => {
            if (gen === this._gen && snap.exists()) CardSkins.setWallet(normalizeWallet(snap.data()));
        }, (e) => console.warn('[wallet] listener stopped:', e && e.code));
    },

    _close() {
        this._gen++;
        if (this._unsub) { try { this._unsub(); } catch (e) { /* already gone */ } }
        this._unsub = null;
        this._uid = null;
        CardSkins.detachLedger();
    },

    /** First sign-in on the new ledger: create the wallet, importing the local balance once. */
    async _ensure(ref) {
        const legacy = CardSkins.readLegacyLocal();
        const imported = await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            if (snap.exists()) return false;
            tx.set(ref, { ...planImport(legacy.coins, legacy.owned), updatedAt: serverTimestamp() });
            return true;
        });
        // Only after the server took it: an import that failed stays on the
        // device and is tried again at the next sign-in.
        if (imported) CardSkins.clearLegacyLocal();
    },

    _ledger(ref) {
        const tx = (plan) => runTransaction(db, async (t) => {
            const snap = await t.get(ref);
            if (!snap.exists()) throw Object.assign(new Error('no wallet'), { code: 'no-wallet' });
            const [update, result] = plan(normalizeWallet(snap.data()));
            if (update) t.update(ref, { ...update, updatedAt: serverTimestamp() });
            return result;
        });
        return {
            kind: 'firestore',
            preview(amount) {
                const w = CardSkins.getWallet();
                return w ? previewAward(w, amount, now()) : 0;
            },
            canSpin() {
                const w = CardSkins.getWallet();
                return !!w && planSpin(w, 0, now()).ok;
            },
            earn: (amount) => tx((w) => {
                const p = planEarn(w, amount, now());
                return p ? [{ coins: p.coins, earnDay: p.earnDay, earnedToday: p.earnedToday }, p.granted] : [null, 0];
            }),
            spend: (amount) => tx((w) => {
                const p = planSpend(w, amount);
                return p ? [{ coins: p.coins }, -p.taken] : [null, 0];
            }),
            purchase: (skinId) => tx((w) => {
                const p = planPurchase(w, skinId);
                return p.ok ? [{ coins: p.coins, owned: p.owned }, { ok: true }] : [null, p];
            }),
            claimSpin: (amount) => tx((w) => {
                const p = planSpin(w, amount, now());
                return p.ok ? [{ coins: p.coins, spinDay: p.spinDay }, p] : [null, p];
            })
        };
    }
};

/**
 * The admin half. Every call here is refused by firestore.rules for anyone
 * without an `admins/{uid}` document — which only the Firebase console can
 * create.
 */
export const WalletAdmin = {
    async isAdmin(uid = Wallet._uid) {
        if (!safeId(uid)) return false;
        try { return (await getDoc(doc(db, 'admins', uid))).exists(); }
        catch (e) { return false; }
    },

    /** Players by exact display name (the public leaderboard), or by uid. */
    async findPlayers(input) {
        const raw = String(input || '').trim();
        if (!raw) return [];
        const found = new Map();
        try {
            const snap = await getDocs(query(collection(db, 'leaderboard'), where('username', '==', cleanName(raw)), limit(10)));
            snap.forEach((d) => found.set(d.id, { uid: d.id, username: d.data().username }));
        } catch (e) { console.warn('[wallet-admin] name lookup failed:', e && e.code); }
        if (safeId(raw) && raw.length >= 20 && !found.has(raw)) {
            try {
                const lb = await getDoc(doc(db, 'leaderboard', raw));
                found.set(raw, { uid: raw, username: lb.exists() ? lb.data().username : '' });
            } catch (e) { /* not a uid after all */ }
        }
        return [...found.values()];
    },

    async readWallet(uid) {
        if (!safeId(uid)) return null;          // path guard: never a '/' in a document path
        const snap = await getDoc(doc(db, 'wallets', uid));
        return snap.exists() ? normalizeWallet(snap.data()) : null;
    },

    /**
     * One grant: the audit record and the balance change, in one commit.
     * `byUid` is the signed-in admin — the rules require it to be request.auth.uid.
     */
    async grant(uid, amount, note, byUid = Wallet._uid) {
        if (!byUid) return { ok: false, reason: 'signin_required' };
        if (!safeId(uid)) return { ok: false, reason: 'bad_id' };
        if (!safeId(byUid)) return { ok: false, reason: 'bad_id' };
        const walletRef = doc(db, 'wallets', uid);
        const dailyRef = doc(db, 'admin_daily', byUid);
        const grantRef = doc(collection(db, 'coin_grants'));
        return runTransaction(db, async (t) => {
            const snap = await t.get(walletRef);
            const dailySnap = await t.get(dailyRef);
            if (!snap.exists()) return { ok: false, reason: 'no_wallet' };
            const w = normalizeWallet(snap.data());
            const p = planGrant(w, amount);
            if (!p.ok) return p;
            // The admin's own daily ceiling (council O1) — the rules enforce it too.
            const d = planAdminDaily(dailySnap.exists() ? dailySnap.data() : null, p.amount, now());
            if (!d.ok) return d;
            t.set(grantRef, {
                to: uid, by: byUid, amount: p.amount, before: w.coins, after: p.coins,
                note: String(note || '').slice(0, 120), at: serverTimestamp()
            });
            t.update(walletRef, { coins: p.coins, lastGrantId: grantRef.id, updatedAt: serverTimestamp() });
            t.set(dailyRef, { day: d.day, given: d.given, lastGrantId: grantRef.id });
            return { ok: true, before: w.coins, after: p.coins, id: grantRef.id };
        });
    }
};
