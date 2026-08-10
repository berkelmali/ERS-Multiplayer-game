import { getRankName, getSuitSymbol } from './game.js';
import { evaluateSlap } from './slapRules.js';
import { Localization } from './localization.js?v=3';
import { AudioManager } from './audioManager.js';
import EventBus from './eventbus.js';

// --- PRACTICE / TUTORIAL MODE (v2.9.0) ---
// A scripted, deterministic walkthrough of every slap pattern plus the challenge
// flow. Deliberately does NOT touch the real GameState singleton or fire the
// shared 'gameOver' / 'pileWon' / 'cardPlayed' events that ScoreSystem,
// StreakTracker, VictoryScreen, and AIController all listen on — this runs its
// own tiny local pile so a scripted practice hand can never leak into a real
// player's stats, leaderboard record, or win streak.
//
// It DOES reuse the real pattern-checking logic from slapRules.js (the project's
// single source of truth for slap rules) and the same card-rendering look, so
// what it teaches is accurate and it still feels like the real game.
const C = (rank, suit) => ({ rank, suit });

const STEPS = [
    { cards: [C(5, 'spades'), C(5, 'hearts')], expected: 'doubles', logKey: 'tutorialDoublesLog' },
    { cards: [C(4, 'clubs'), C(6, 'diamonds')], expected: 'tens', logKey: 'tutorialTensLog' },
    { cards: [C(13, 'spades'), C(12, 'hearts')], expected: 'marriage', logKey: 'tutorialMarriageLog' },
    { cards: [C(9, 'clubs'), C(3, 'hearts'), C(9, 'diamonds')], expected: 'sandwich', logKey: 'tutorialSandwichLog' }
];
const TOTAL_STEPS = STEPS.length + 1; // +1 for the closing challenge demo

export const TutorialMode = {
    stepIndex: 0,
    pile: [],
    tapEnabled: false,
    _dealToken: 0,
    _initialized: false,

    init() {
        if (this._initialized) return;
        this._initialized = true;

        this.screen = document.getElementById('tutorial-screen');
        this.introEl = document.getElementById('tutorial-intro');
        this.tableEl = document.getElementById('tutorial-table');
        this.doneEl = document.getElementById('tutorial-done');
        this.pileEl = document.getElementById('tutorial-pile');
        this.coachEl = document.getElementById('tutorial-coach');
        this.progressEl = document.getElementById('tutorial-progress');

        document.getElementById('btn-tutorial-start').addEventListener('click', () => this.startSteps());
        document.getElementById('btn-tutorial-finish').addEventListener('click', () => this.exit());
        document.getElementById('btn-tutorial-exit').addEventListener('click', () => this.exit());
        this.pileEl.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this.onTap();
        });
    },

    start() {
        this.stepIndex = 0;
        this.pile = [];
        this.tapEnabled = false;
        this._dealToken++;

        document.getElementById('main-menu').classList.remove('active');
        this.screen.classList.add('active');
        this.introEl.style.display = '';
        this.tableEl.style.display = 'none';
        this.doneEl.style.display = 'none';
        this.pileEl.innerHTML = '';
        this.coachEl.textContent = '';
        this.coachEl.classList.remove('visible');
        this._renderProgress();
    },

    startSteps() {
        this.introEl.style.display = 'none';
        this.tableEl.style.display = '';
        this.runStep();
    },

    async runStep() {
        if (this.stepIndex >= STEPS.length) {
            return this.runChallengeStep();
        }
        const myToken = ++this._dealToken;
        const step = STEPS[this.stepIndex];
        this.pile = [];
        this.tapEnabled = false;
        this.pileEl.innerHTML = '';
        this.coachEl.classList.remove('visible');

        for (const card of step.cards) {
            await this._wait(650);
            if (myToken !== this._dealToken) return; // superseded — user exited or advanced
            this.pile.push(card);
            this._renderPile();
            AudioManager.playSFX('cardPlace');
        }

        await this._wait(250);
        if (myToken !== this._dealToken) return;

        this.coachEl.textContent = Localization.get(step.logKey);
        this.coachEl.classList.add('visible');
        this.tapEnabled = true;
        this._renderProgress();
    },

    onTap() {
        if (this.doneEl.style.display !== 'none') return;
        if (!this.tapEnabled) {
            this._flashMiss();
            return;
        }
        const step = STEPS[this.stepIndex];
        const result = evaluateSlap(this.pile);
        if (result === step.expected) {
            this.tapEnabled = false;
            AudioManager.playSFX('slap');
            this._flashCorrect();
            this.stepIndex++;
            const myToken = this._dealToken;
            setTimeout(() => {
                if (myToken === this._dealToken) this.runStep();
            }, 900);
        } else {
            AudioManager.playSFX('invalidSlap');
            this._flashMiss();
        }
    },

    async runChallengeStep() {
        const myToken = this._dealToken;
        this.pile = [];
        this.pileEl.innerHTML = '';
        this.tapEnabled = false;
        this.coachEl.classList.remove('visible');
        this._renderProgress();

        await this._wait(650);
        if (myToken !== this._dealToken) return;
        this.pile.push(C(11, 'spades')); // Jack — a face card, opens a challenge
        this._renderPile();
        AudioManager.playSFX('cardPlace');
        this.coachEl.textContent = Localization.get('tutorialChallengeLog');
        this.coachEl.classList.add('visible');
        this._renderProgress();

        await this._wait(1900);
        if (myToken !== this._dealToken) return;
        this.pile.push(C(12, 'diamonds')); // Queen — the "opponent" answers the challenge
        this._renderPile();
        AudioManager.playSFX('cardPlace');
        this.stepIndex = TOTAL_STEPS;
        this._renderProgress();

        await this._wait(1500);
        if (myToken !== this._dealToken) return;
        AudioManager.playSFX('win');
        this.finish();
    },

    _renderProgress() {
        if (!this.progressEl) return;
        this.progressEl.innerHTML = '';
        const current = Math.min(this.stepIndex, TOTAL_STEPS - 1);
        for (let i = 0; i < TOTAL_STEPS; i++) {
            const dot = document.createElement('span');
            dot.className = 'tutorial-dot' + (i < current ? ' done' : i === current ? ' active' : '');
            this.progressEl.appendChild(dot);
        }
    },

    _renderPile() {
        this.pileEl.innerHTML = '';
        this.pile.forEach((card, i) => {
            const div = document.createElement('div');
            const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
            div.className = `card ${isRed ? 'red' : 'black'} tutorial-card`;
            div.style.zIndex = String(i);
            div.style.transform = `translate(${i * 4}px, ${-i * 3}px) rotate(${(i % 2 === 0 ? -1 : 1) * (2 + i)}deg)`;
            const rankStr = getRankName(card.rank);
            const suitStr = getSuitSymbol(card.suit);
            div.innerHTML = `
                <div class="card-top">${rankStr} ${suitStr}</div>
                <div class="card-center">${suitStr}</div>
                <div class="card-bottom">${rankStr} ${suitStr}</div>
            `;
            this.pileEl.appendChild(div);
        });
    },

    _flashCorrect() {
        this.pileEl.classList.remove('tutorial-flash-miss');
        this.pileEl.classList.add('tutorial-flash-correct');
        setTimeout(() => this.pileEl.classList.remove('tutorial-flash-correct'), 500);
    },

    _flashMiss() {
        this.pileEl.classList.remove('tutorial-flash-correct');
        this.pileEl.classList.add('tutorial-flash-miss');
        setTimeout(() => this.pileEl.classList.remove('tutorial-flash-miss'), 400);
    },

    finish() {
        this.tableEl.style.display = 'none';
        this.doneEl.style.display = '';
    },

    exit() {
        this._dealToken++; // invalidates any in-flight scripted step
        this.screen.classList.remove('active');
        document.getElementById('main-menu').classList.add('active');
        EventBus.emit('gameStateChanged', 'menu');
    },

    _wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};
