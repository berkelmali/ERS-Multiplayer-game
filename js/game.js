import EventBus from './eventbus.js';

const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 11=J, 12=Q, 13=K, 14=A
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const FACE_CHANCES = { 11: 1, 12: 2, 13: 3, 14: 4 };

export function getRankName(rank) {
    if (rank <= 10) return rank.toString();
    if (rank === 11) return 'J';
    if (rank === 12) return 'Q';
    if (rank === 13) return 'K';
    if (rank === 14) return 'A';
}

export function getSuitSymbol(suit) {
    switch (suit) {
        case 'hearts': return '♥';
        case 'diamonds': return '♦';
        case 'clubs': return '♣';
        case 'spades': return '♠';
    }
}

export function createDeck() {
    let deck = [];
    for (let s of SUITS) {
        for (let r of RANKS) {
            deck.push({ rank: r, suit: s });
        }
    }
    // Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

export const GameState = {
    players: [[], [], [], []], // 0: Human, 1: Left Bot, 2: Top Bot, 3: Right Bot
    pile: [],
    activePlayerId: 0,
    challenge: {
        active: false,
        attackerId: null,
        defenderId: null,
        chancesLeft: 0
    },
    gameStarted: false,
    gameOver: false,
    lastPlayTime: 0,

    init() {
        const deck = createDeck();
        this.players = [[], [], [], []];
        let p = 0;
        while (deck.length > 0) {
            this.players[p].push(deck.pop());
            p = (p + 1) % 4;
        }
        this.activePlayerId = 0;
        this.pile = [];
        this.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
        this.gameStarted = true;
        this.gameOver = false;
        this.lastPlayTime = Date.now();

        EventBus.emit('gameStarted');
        EventBus.emit('turnChanged', this.activePlayerId);
        window.GameState = this; // Exposed for testing
    },

    quitGame() {
        this.gameOver = true;
        this.gameStarted = false;
        this.pile = [];
        this.players = [[], [], [], []];
    },

    getNextPlayer(id) {
        let next = (id + 1) % 4;
        let count = 0;
        while (this.players[next].length === 0 && count < 4) {
            next = (next + 1) % 4;
            count++;
        }
        if (count >= 4) return null; // No one has cards
        return next;
    },

    checkGameOver() {
        if (this.gameOver) return;

        let playersWithCards = 0;
        let winner = -1;
        for (let i = 0; i < 4; i++) {
            if (this.players[i].length > 0 || this.pile.length > 0) {
                if (this.players[i].length > 0) {
                    playersWithCards++;
                    winner = i;
                }
            }
        }

        if (this.players.some(p => p.length === 52)) {
            this.gameOver = true;
            let pId = this.players.findIndex(p => p.length === 52);
            EventBus.emit('gameOver', pId);
        }
    },

    playCard(playerId) {
        if (this.gameOver || !this.gameStarted) return;
        if (playerId !== this.activePlayerId) return;
        if (this.players[playerId].length === 0) {
            // Skip if no cards
            const next = this.getNextPlayer(playerId);
            if (next !== null) {
                this.activePlayerId = next;
                EventBus.emit('turnChanged', this.activePlayerId);
            }
            return;
        }

        const card = this.players[playerId].shift(); // Draw from top
        this.pile.push(card);
        this.lastPlayTime = Date.now();
        EventBus.emit('cardPlayed', { playerId, card });

        const isFaceCard = card.rank >= 11;

        if (this.challenge.active) {
            if (isFaceCard) {
                // Challenge passed to next person
                this.challenge.attackerId = playerId;
                const next = this.getNextPlayer(playerId);
                this.challenge.defenderId = next;
                this.challenge.chancesLeft = FACE_CHANCES[card.rank];
                this.activePlayerId = next;
                EventBus.emit('challengeStarted', this.challenge);

                // 1 SECOND DELAY before next turn
                setTimeout(() => { EventBus.emit('turnChanged', this.activePlayerId); }, 1000);
            } else {
                this.challenge.chancesLeft--;
                EventBus.emit('challengeUpdated', this.challenge);
                if (this.challenge.chancesLeft <= 0) {
                    // Defender failed, attacker wins pile

                    // 1 SECOND DELAY before winning pile
                    setTimeout(() => { this.winPile(this.challenge.attackerId, 'challenge'); }, 1000);
                } else {
                    // Defender still has chances

                    // 1 SECOND DELAY before next chance
                    setTimeout(() => { EventBus.emit('turnChanged', this.activePlayerId); }, 1000);
                }
            }
        } else {
            if (isFaceCard) {
                // Start Challenge
                this.challenge.active = true;
                this.challenge.attackerId = playerId;
                const next = this.getNextPlayer(playerId);
                this.challenge.defenderId = next;
                this.challenge.chancesLeft = FACE_CHANCES[card.rank];
                this.activePlayerId = next;
                EventBus.emit('challengeStarted', this.challenge);

                // 1 SECOND DELAY before next turn
                setTimeout(() => { EventBus.emit('turnChanged', this.activePlayerId); }, 1000);
            } else {
                // Normal play
                const next = this.getNextPlayer(playerId);
                this.activePlayerId = next;

                // 1 SECOND DELAY before next turn
                setTimeout(() => { EventBus.emit('turnChanged', this.activePlayerId); }, 1000);
            }
        }
        this.checkGameOver();
    },

    isValidSlap() {
        const p = this.pile;
        if (p.length < 2) return false;
        const top = p[p.length - 1];
        const prev = p[p.length - 2];

        // Doubles
        if (top.rank === prev.rank) return true;

        // Tens (only number cards summing to 10)
        if (top.rank <= 10 && prev.rank <= 10 && top.rank + prev.rank === 10) return true;

        // Marriage (K and Q)
        if ((top.rank === 12 && prev.rank === 13) || (top.rank === 13 && prev.rank === 12)) return true;

        // Sandwich
        if (p.length >= 3) {
            const prev2 = p[p.length - 3];
            if (top.rank === prev2.rank) return true;
        }

        return false;
    },

    slap(playerId) {
        if (this.gameOver || !this.gameStarted) return;
        EventBus.emit('slapAttempt', playerId);

        // Check reaction speed
        const timeSincePlay = Date.now() - this.lastPlayTime;
        const isFastSlap = timeSincePlay < 400 && this.pile.length > 0;

        if (this.isValidSlap()) {
            if (isFastSlap && playerId === 0) {
                EventBus.emit('fastSlapBonus', playerId);
            }
            this.winPile(playerId, 'slap');
        } else {
            // Burn card
            if (this.players[playerId].length > 0) {
                const burned = this.players[playerId].shift(); // Take from top
                this.pile.unshift(burned); // Add to VERY Bottom of pile 
                EventBus.emit('invalidSlap', { playerId, burned });
            }
        }
        this.checkGameOver();
    },

    winPile(winnerId, reason) {
        // Add all cards to bottom of winner's deck
        this.players[winnerId].push(...this.pile);
        this.pile = [];
        this.challenge = { active: false, attackerId: null, defenderId: null, chancesLeft: 0 };
        this.activePlayerId = winnerId;
        EventBus.emit('pileWon', { winnerId, reason });

        this.checkGameOver();
        if (this.gameOver) return;

        // 1 SECOND DELAY before next turn
        setTimeout(() => { EventBus.emit('turnChanged', this.activePlayerId); }, 1000);
    }
};
