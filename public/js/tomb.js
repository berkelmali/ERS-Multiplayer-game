/**
 * tomb.js — Firavunun Mezarı / The Pharaoh's Tomb (v3.18.0).
 *
 * ERS has two ways to take a pile: the slap, and the face-card CHALLENGE — a
 * Jack gives the next player one card to answer with a face card, a Queen
 * two, a King three, an Ace four. Every other mode leaves the challenge to
 * luck: the card you turn is whatever is on top of your deck. Here it is a
 * decision.
 *
 * You raid the tomb chamber by chamber. Each chamber has a guardian with a
 * face-down deck; you hold THREE CARDS FACE UP (torchlight) and choose which
 * to play. Hold a King for the guardian's Queen — and mind what you lay:
 * a pattern YOU complete belongs to the guardian (slap it and you spring a
 * trap); only the guardian's cards give you a pattern to race for. Seeing
 * your cards would otherwise make every pattern a free pile. Take every card
 * the guardian holds and
 * the chamber is yours — then choose one treasure from three to add to your
 * deck. Seven chambers; the last is the pharaoh's sarcophagus. Run out of
 * cards and the tomb keeps you.
 *
 * Isolation: its own pile and screen on the practice mode's pattern; none of
 * the shared match events fire, so nothing here reaches Slap IQ, marks,
 * streaks or boards. The guardian's timing and discipline come from the bot
 * tiers (BotConfig); the one coin grant is the first full raid, worth one win.
 */
import { matchSlap, DEFAULT_RULES } from './slapRules.js';
import { getRankName, getSuitSymbol } from './game.js';
import { BotConfig } from './botConfig.js';
import { TRANSITION_MS } from './matchContext.js';
import { Localization } from './localization.js?v=3';
import { godSvg } from './godArt.js';

export const HAND_SIZE = 3;
export const START_DECK = 16;
export const RULES = DEFAULT_RULES;
const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'];
const STORE_KEY = 'ers_tomb_v1';

/** Seven chambers. Guardian decks grow; the tiers climb the bot ladder. */
export const CHAMBERS = Object.freeze([
    { id: 'corridor',    guardian: 'mummy',   cards: 6,  tier: 'easy' },
    { id: 'pillars',     guardian: 'cobra',   cards: 8,  tier: 'easy' },
    { id: 'snakes',      guardian: 'cobra',   cards: 10, tier: 'medium' },
    { id: 'treasury',    guardian: 'mummy',   cards: 10, tier: 'medium' },
    { id: 'anubis',      guardian: 'anubis',  cards: 12, tier: 'hard' },
    { id: 'ka',          guardian: 'mummy',   cards: 12, tier: 'hard' },
    { id: 'sarcophagus', guardian: 'pharaoh', cards: 16, tier: 'challenger' }
]);

/** ERS's own numbers: J 1, Q 2, K 3, A 4 chances; anything else opens nothing. */
export function chancesFor(rank) {
    return rank >= 11 ? rank - 10 : 0;
}

export function shuffled(rnd = Math.random) {
    const d = [];
    for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) d.push({ rank, suit });
    for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
}

const other = (who) => (who === 'you' ? 'guard' : 'you');

export function newRun(rnd = Math.random) {
    const d = shuffled(rnd);
    return { deck: d.slice(0, START_DECK), chamber: 0 };
}

/** A chamber: you bring your deck; the guardian gets a fresh one. */
export function newChamber(run, rnd = Math.random) {
    const spec = CHAMBERS[run.chamber];
    const deck = run.deck.slice();
    const hand = deck.splice(0, HAND_SIZE);
    return {
        spec,
        you: { deck, hand },
        guard: { deck: shuffled(rnd).slice(0, spec.cards) },
        pile: [],
        turn: 'you',
        challenge: null,        // { attacker, left }
        lastBy: null,           // who laid the top card
        over: null              // 'cleared' | 'lost'
    };
}

export function cardsOf(state, who) {
    return who === 'you' ? state.you.hand.length + state.you.deck.length : state.guard.deck.length;
}

function refill(state) {
    while (state.you.hand.length < HAND_SIZE && state.you.deck.length) state.you.hand.push(state.you.deck.shift());
}

/**
 * Lay a card. `index` picks from your hand; the guardian turns its top card.
 * Returns what happened: 'challenge' | 'answer-needed' | 'challenge-lost' | 'next'.
 */
export function playCard(state, who, index = 0) {
    if (state.over || state.turn !== who) return null;
    let card;
    if (who === 'you') {
        if (!state.you.hand[index]) return null;
        card = state.you.hand.splice(index, 1)[0];
        refill(state);
    } else {
        card = state.guard.deck.shift();
        if (!card) return null;
    }
    state.pile.push(card);
    state.lastBy = who;
    const c = chancesFor(card.rank);
    if (c > 0) {
        state.challenge = { attacker: who, left: c };
        state.turn = other(who);
        return 'challenge';
    }
    if (state.challenge) {
        state.challenge.left--;
        return state.challenge.left <= 0 ? 'challenge-lost' : 'answer-needed';
    }
    state.turn = other(who);
    return 'next';
}

/** The pile goes to the BOTTOM of the winner's deck, burned cards first (ERS). */
export function awardPile(state, who) {
    const cards = state.pile.splice(0);
    if (who === 'you') state.you.deck.push(...cards);
    else state.guard.deck.push(...cards);
    refill(state);
    state.challenge = null;
    state.turn = who;
    checkOver(state);
    return cards.length;
}

/**
 * A slap. Valid: the pile. Wrong: your top card goes under the pile.
 * Your own pattern is the tomb's trap: you laid it with your cards in view,
 * so it is not yours to take — slapping it burns like a wrong slap.
 */
export function slap(state, who) {
    if (state.over || state.pile.length === 0) return { valid: false, burned: false };
    const m = matchSlap(state.pile, RULES);
    const ownTrap = !!m && who === 'you' && state.lastBy === 'you';
    if (m && !ownTrap) {
        awardPile(state, who);
        return { valid: true, rule: m.id };
    }
    let burned = null;
    if (who === 'you') burned = state.you.deck.shift() || state.you.hand.pop() || null;
    else burned = state.guard.deck.shift() || null;
    if (burned) state.pile.unshift(burned);
    refill(state);
    checkOver(state);
    return { valid: false, burned: !!burned, ownTrap };
}

/**
 * Whose card is it, and can they play one? A side with nothing to lay when it
 * must — a normal turn or an answer to a challenge — loses the pile.
 */
export function resolveEmptyTurn(state) {
    if (state.over) return null;
    const who = state.turn;
    if (cardsOf(state, who) > 0) return null;
    const winner = state.challenge ? state.challenge.attacker : other(who);
    if (state.pile.length) awardPile(state, winner);
    checkOver(state, who);
    return winner;
}

function checkOver(state, stuck = null) {
    if (state.over) return;
    if (state.guard.deck.length === 0 && (state.pile.length === 0 || stuck === 'guard')) state.over = 'cleared';
    else if (cardsOf(state, 'you') === 0 && (state.pile.length === 0 || stuck === 'you')) state.over = 'lost';
}

/** Three treasures to choose from, one always a face card. */
export function draftOffer(rnd = Math.random) {
    const d = shuffled(rnd);
    const face = d.find(c => c.rank >= 11);
    const rest = d.filter(c => c !== face).slice(0, 2);
    const offer = [face, ...rest];
    for (let i = offer.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [offer[i], offer[j]] = [offer[j], offer[i]];
    }
    return offer;
}

/** The guardian's reflexes: the bot tier's own window and discipline. */
export function guardianReflex(spec) {
    const c = BotConfig[spec.tier];
    return { min: c.minReaction, max: c.maxReaction, accuracy: c.accuracy, falseSlap: c.falseSlap, playDelay: c.playDelay };
}

function cardEl(card, tag = 'div') {
    const el = document.createElement(tag);
    const red = card.suit === 'hearts' || card.suit === 'diamonds';
    const inner = document.createElement('div');
    inner.className = `card ${red ? 'red' : 'black'}`;
    const r = getRankName(card.rank), s = getSuitSymbol(card.suit);
    inner.innerHTML = `<div class="card-top">${r} ${s}</div><div class="card-center">${s}</div><div class="card-bottom">${r} ${s}</div>`;
    el.appendChild(inner);
    return el;
}

export const TombMode = {
    run: null,
    state: null,
    _token: 0,
    _initialized: false,
    store: { bestChamber: 0, raids: 0, paid: false },

    init() {
        if (this._initialized) return;
        this._initialized = true;
        const $ = (id) => document.getElementById(id);
        this.screen = $('tomb-screen');
        if (!this.screen) return;
        this.el = {
            progress: $('tomb-progress'), portrait: $('tomb-portrait'), chamber: $('tomb-chamber'),
            guardName: $('tomb-guard-name'), guardCount: $('tomb-guard-count'), challenge: $('tomb-challenge'),
            pile: $('tomb-pile'), coach: $('tomb-coach'), hand: $('tomb-hand'), deck: $('tomb-deck'),
            table: $('tomb-table'), draft: $('tomb-draft'), draftCards: $('tomb-draft-cards'),
            done: $('tomb-done'), doneTitle: $('tomb-done-title'), doneText: $('tomb-done-text'), best: $('tomb-best')
        };
        this._load();
        this.el.intro = $('tomb-intro');
        // The hub opens the rules first (ERS-18 fix 3); "Enter again" skips them.
        $('btn-tomb-start').addEventListener('click', () => this.openIntro());
        $('btn-tomb-go').addEventListener('click', () => this.begin());
        $('btn-tomb-again').addEventListener('click', () => this.begin());
        $('btn-tomb-exit').addEventListener('click', () => this.exit());
        $('btn-tomb-back').addEventListener('click', () => this.exit());
        this.el.pile.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onSlap(); });
        this.el.hand.addEventListener('click', (e) => {
            const b = e.target.closest('[data-i]');
            if (b) this.onPlay(Number(b.getAttribute('data-i')));
        });
        this.el.draftCards.addEventListener('click', (e) => {
            const b = e.target.closest('[data-i]');
            if (b) this.onDraft(Number(b.getAttribute('data-i')));
        });
        document.addEventListener('keydown', (e) => {
            if (!this.screen.classList.contains('active') || !this.state || this.state.over || e.repeat) return;
            if (e.code === 'Space') { e.preventDefault(); this.onSlap(); }
            else if (['1', '2', '3'].includes(e.key)) this.onPlay(Number(e.key) - 1);
        });
        this.renderHub();
    },

    renderHub() {
        const emblem = document.getElementById('tomb-emblem');
        if (emblem && !emblem.firstChild) emblem.innerHTML = godSvg('tomb');
        if (!this.el || !this.el.best) return;
        const L = (k, f) => Localization.get(k) || f;
        const bits = [];
        if (this.store.bestChamber > 0) bits.push(L('tombBest', 'Deepest: chamber {n}/7').replace('{n}', this.store.bestChamber));
        if (this.store.raids > 0) bits.push(L('tombRaids', '☥ Raids completed: {n}').replace('{n}', this.store.raids));
        this.el.best.textContent = bits.join(' · ');
    },

    /** The rules, before the first card — as Practice opens. */
    openIntro() {
        this._token++;
        this.state = null;
        document.getElementById('legends-panel').classList.remove('active');
        document.getElementById('main-menu').classList.remove('active');
        this.screen.classList.add('active');
        const emblem = document.getElementById('tomb-intro-emblem');
        if (emblem && !emblem.firstChild) emblem.innerHTML = godSvg('tomb');
        this.el.intro.hidden = false;
        this.el.table.hidden = true;
        this.el.draft.hidden = true;
        this.el.done.hidden = true;
        this.el.progress.hidden = true;
    },

    begin() {
        this._token++;
        document.getElementById('legends-panel').classList.remove('active');
        document.getElementById('main-menu').classList.remove('active');
        this.screen.classList.add('active');
        this.el.intro.hidden = true;
        this.el.progress.hidden = false;
        this.run = newRun();
        this.el.done.hidden = true;
        this.enterChamber();
    },

    enterChamber() {
        this._token++;
        this.state = newChamber(this.run);
        this.el.draft.hidden = true;
        this.el.table.hidden = false;
        const L = (k, f) => Localization.get(k) || f;
        this.el.portrait.innerHTML = godSvg(this.state.spec.guardian);
        this.say(L('tombEnter', '{chamber}: the guardian wakes.').replace('{chamber}', this.chamberName()));
        this.render();
    },

    chamberName() {
        return Localization.get('tombChamber_' + this.state.spec.id) || this.state.spec.id;
    },

    guardianName() {
        const g = this.state.spec.guardian;
        return Localization.get(g === 'anubis' ? 'god_anubis_name' : 'tombGuard_' + g) || g;
    },

    onPlay(i) {
        const s = this.state;
        if (!s || s.over || s.turn !== 'you') return;
        const outcome = playCard(s, 'you', i);
        if (!outcome) return;
        this.afterPlay('you', outcome);
    },

    onSlap() {
        const s = this.state;
        if (!s || s.over || !s.pile.length) return;
        const res = slap(s, 'you');
        const L = (k, f) => Localization.get(k) || f;
        if (res.valid) {
            this.flash('tutorial-flash-correct', 500);
            this.say('✅ ' + (Localization.get('ruleName_' + res.rule) || res.rule) + ' — ' + L('tombWonPile', 'the pile is yours'));
        } else {
            this.flash('tutorial-flash-miss', 400);
            this.say(res.ownTrap
                ? L('tombOwnTrap', 'A trap! You laid that pattern yourself — it belongs to the guardian. A card slides under the pile.')
                : L('tombTrap', 'A trap! A wrong slap: your top card slides under the pile.'));
        }
        this._token++;
        this.render();
        this.next();
    },

    afterPlay(who, outcome) {
        const s = this.state;
        const L = (k, f) => Localization.get(k) || f;
        const top = s.pile[s.pile.length - 1];
        const name = `${getRankName(top.rank)}${getSuitSymbol(top.suit)}`;
        if (outcome === 'challenge') {
            const n = s.challenge.left;
            this.say(who === 'you'
                ? L('tombYouChallenge', '{card}: the guardian has {n} to answer with a face card.').replace('{card}', name).replace('{n}', n)
                : L('tombGuardChallenge', '{card}! You have {n} to answer with a face card.').replace('{card}', name).replace('{n}', n));
        }
        this.render();
        this.armGuardSlap();
        if (outcome === 'challenge-lost') {
            const myToken = ++this._token;
            // The pile waits one beat before the challenger takes it — a slap
            // on a pattern can still steal it, exactly as at the table.
            setTimeout(() => {
                if (myToken !== this._token || !this.state || this.state.over) return;
                const winner = this.state.challenge.attacker;
                const n = awardPile(this.state, winner);
                this.say(winner === 'you'
                    ? L('tombTookChallenge', 'Unanswered — you take {n} cards.').replace('{n}', n)
                    : L('tombLostChallenge', 'Unanswered — the guardian takes {n} cards.').replace('{n}', n));
                this.render();
                this.next();
            }, TRANSITION_MS.slap);
            return;
        }
        this.next();
    },

    /** The guardian eyes the pile after every card: a pattern, or a bluff. */
    armGuardSlap() {
        const s = this.state;
        if (!s || s.over || !s.pile.length) return;
        const r = guardianReflex(s.spec);
        const live = !!matchSlap(s.pile, RULES);
        const go = live ? Math.random() < r.accuracy : Math.random() < r.falseSlap;
        if (!go) return;
        const myToken = this._token;
        const pileLen = s.pile.length;
        setTimeout(() => {
            if (myToken !== this._token || !this.state || this.state.over || this.state.pile.length !== pileLen) return;
            const res = slap(this.state, 'guard');
            const L = (k, f) => Localization.get(k) || f;
            this.say(res.valid ? L('tombGuardSlapped', 'The guardian slaps first and takes the pile.') : L('tombGuardBurned', 'The guardian slaps wrong and loses a card.'));
            this._token++;
            this.render();
            this.next();
        }, r.min + Math.random() * (r.max - r.min));
    },

    /** Whoever is to play: you wait for a click; the guardian plays on its tier's clock. */
    next() {
        const s = this.state;
        if (!s) return;
        const stuck = resolveEmptyTurn(s);
        if (stuck) this.render();
        if (s.over) return this.endChamber();
        if (s.turn !== 'guard') return;
        const myToken = ++this._token;
        setTimeout(() => {
            if (myToken !== this._token || !this.state || this.state.over || this.state.turn !== 'guard') return;
            const outcome = playCard(this.state, 'guard');
            if (outcome) this.afterPlay('guard', outcome);
        }, guardianReflex(s.spec).playDelay);
    },

    endChamber() {
        const s = this.state;
        const L = (k, f) => Localization.get(k) || f;
        this._token++;
        if (s.over === 'lost') return this.finish(false);
        this.run.deck = [...s.you.hand, ...s.you.deck];
        this.run.chamber++;
        if (this.run.chamber > this.store.bestChamber) { this.store.bestChamber = this.run.chamber; this._save(); }
        if (this.run.chamber >= CHAMBERS.length) return this.finish(true);
        const cleared = L('tombCleared', '{chamber} is yours!').replace('{chamber}', this.chamberName());
        this.say(cleared);
        const note = document.getElementById('tomb-draft-note');
        if (note) note.textContent = '☥ ' + cleared;
        this.offer = draftOffer();
        this.el.draftCards.innerHTML = '';
        this.offer.forEach((c, i) => {
            const b = cardEl(c, 'button');
            b.type = 'button';
            b.className = 'tomb-card';
            b.setAttribute('data-i', String(i));
            this.el.draftCards.appendChild(b);
        });
        this.el.table.hidden = true;
        this.el.draft.hidden = false;
        this.renderProgress();
    },

    onDraft(i) {
        if (!this.offer || !this.offer[i]) return;
        this.run.deck.push(this.offer[i]);
        this.offer = null;
        this.enterChamber();
    },

    async finish(won) {
        const L = (k, f) => Localization.get(k) || f;
        this.el.table.hidden = true;
        this.el.draft.hidden = true;
        this.el.done.hidden = false;
        this.el.doneTitle.textContent = won ? L('tombVictory', "The pharaoh's treasure is yours!") : L('tombDefeat', 'The tomb keeps you.');
        this.el.doneText.textContent = L('tombDoneText', 'Chambers cleared: {n}/7').replace('{n}', this.run.chamber);
        if (won) {
            this.store.raids++;
            if (!this.store.paid) {
                // One grant, ever, worth exactly one win (DESIGN.md §3.1).
                const { CardSkins } = await import('./cardSkins.js');
                const coins = CardSkins.computeReward(0);
                CardSkins.addCoins(coins);
                this.store.paid = true;
                this.el.doneText.textContent += ' · ' + L('tombPaid', 'First full raid: +{coins} 🪙').replace('{coins}', coins);
            }
            this._save();
        }
        this.renderHub();
    },

    exit() {
        this._token++;
        this.state = null;
        this.screen.classList.remove('active');
        document.getElementById('main-menu').classList.add('active');
        this.renderHub();
    },

    say(text) {
        this.el.coach.textContent = text;
        this.el.coach.classList.add('visible');
    },

    flash(cls, ms) {
        this.el.pile.classList.remove('tutorial-flash-correct', 'tutorial-flash-miss');
        void this.el.pile.offsetWidth;
        this.el.pile.classList.add(cls);
        setTimeout(() => this.el.pile.classList.remove(cls), ms);
    },

    renderProgress() {
        this.el.progress.innerHTML = '';
        for (let i = 0; i < CHAMBERS.length; i++) {
            const d = document.createElement('span');
            d.className = 'tutorial-dot' + (i < this.run.chamber ? ' done' : i === this.run.chamber ? ' active' : '');
            this.el.progress.appendChild(d);
        }
    },

    render() {
        const s = this.state;
        if (!s) return;
        const L = (k, f) => Localization.get(k) || f;
        this.renderProgress();
        this.el.chamber.textContent = `${this.run.chamber + 1}/7 · ${this.chamberName()}`;
        this.el.guardName.textContent = this.guardianName();
        this.el.guardCount.textContent = L('tombGuardCount', '{n} cards').replace('{n}', s.guard.deck.length);
        this.el.deck.textContent = L('tombDeckCount', 'Your deck: {n}').replace('{n}', s.you.deck.length);
        if (s.challenge) {
            this.el.challenge.hidden = false;
            this.el.challenge.textContent = (s.challenge.attacker === 'you'
                ? L('tombChallengeLeftGuard', 'The guardian must answer: {n} left')
                : L('tombChallengeLeftYou', 'Answer with a face card: {n} left')).replace('{n}', s.challenge.left);
        } else {
            this.el.challenge.hidden = true;
        }
        // Pile: the last three, fanned so every corner index reads.
        this.el.pile.innerHTML = '';
        const shown = s.pile.slice(-3);
        shown.forEach((c, j) => {
            const w = cardEl(c);
            const inner = w.firstChild;
            inner.style.transform = `translate(${j * 30}px, ${-j * 3}px) rotate(${(j % 2 ? 2 : -2)}deg)`;
            inner.style.zIndex = String(j);
            this.el.pile.appendChild(inner);
        });
        // Hand: face up, yours to choose.
        this.el.hand.innerHTML = '';
        s.you.hand.forEach((c, i) => {
            const b = cardEl(c, 'button');
            b.type = 'button';
            b.className = 'tomb-card';
            b.setAttribute('data-i', String(i));
            b.disabled = s.turn !== 'you' || !!s.over;
            this.el.hand.appendChild(b);
        });
        this.el.hand.classList.toggle('your-turn', s.turn === 'you' && !s.over);
    },

    _load() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (raw) this.store = { bestChamber: 0, raids: 0, paid: false, ...JSON.parse(raw) };
        } catch { /* private window */ }
    },

    _save() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(this.store)); } catch { /* see _load */ }
    }
};
