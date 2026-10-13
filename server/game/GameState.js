'use strict';

const { createDeck, shuffle, deal } = require('./Deck');
const { resolveTrick } = require('./TrickResolver');
const { calculate } = require('./ScoreCalculator');
const { ALL_TYPE_CODES, TOTAL_ROUNDS } = require('./constants');

const TRUMP_TYPES = new Set(['P1', 'P2', 'P3']);

// Full-round point totals per game type, used when a round is quit early via
// a unanimous "quit round" vote: on negative hands the quitter absorbs the
// entire penalty; on positive hands the quitter forfeits their share and the
// other two players split the total evenly.
const QUIT_ROUND_TOTALS = {
  K: -40, Q: -40, J: -40, H: -40, L2: -40, T: -40,
  P1: 80, P2: 80, P3: 80,
};

function cardsEqual(a, b) {
  return a.rank === b.rank && a.suit === b.suit;
}

function canDiscard(gameType, card) {
  switch (gameType) {
    case 'K':
    case 'H':
      return card.suit !== 'H';
    case 'Q':
      return card.rank !== 'Q';
    case 'J':
      return card.rank !== 'J';
    default:
      return true;
  }
}

class GameState {
  constructor(players) {
    this.players = players;

    this.round = 1;
    this.phase = 'type_selection'; // type_selection | trump_selection | discard | playing | round_end | game_over

    this.hands = { 0: [], 1: [], 2: [] };
    this.centerCards = [];
    this.lastCenterCards = []; // The 2 cards added to leader's hand this round
    this.chosenGameType = null;
    this.trumpSuit = null;

    this.usedTypes = { 0: [], 1: [], 2: [] };

    this.currentTrick = [];
    this.ledSuit = null;
    this.trickNumber = 0;
    this.currentTurn = null;

    this.tricksTaken = { 0: 0, 1: 0, 2: 0 };
    this.queensTaken = { 0: 0, 1: 0, 2: 0 };
    this.jacksTaken = { 0: 0, 1: 0, 2: 0 };
    this.heartsTaken = { 0: 0, 1: 0, 2: 0 };
    this.kingOfHeartsTakenBy = null;
    this.trickWinners = [];
    this.lastTrick = null; // { winnerSeat, trick: [{seat, card}] }

    this.roundScores = [];
    this.roundDetails = []; // detailed per-round stats for end-of-game review
    this.cumulativeScores = { 0: 0, 1: 0, 2: 0 };

    this.dealCards();
  }

  get leaderSeat() { return (this.round - 1) % 3; }
  get isGameOver() { return this.phase === 'game_over'; }

  // ─── persistence ───────────────────────────────────────────────────────────
  // Every field that's part of the game's mutable state. Anything derived
  // (leaderSeat, isGameOver) is recomputed via getters.
  serialize() {
    return {
      players: this.players,
      round: this.round,
      phase: this.phase,
      hands: this.hands,
      centerCards: this.centerCards,
      lastCenterCards: this.lastCenterCards,
      chosenGameType: this.chosenGameType,
      trumpSuit: this.trumpSuit,
      usedTypes: this.usedTypes,
      currentTrick: this.currentTrick,
      ledSuit: this.ledSuit,
      trickNumber: this.trickNumber,
      currentTurn: this.currentTurn,
      tricksTaken: this.tricksTaken,
      queensTaken: this.queensTaken,
      jacksTaken: this.jacksTaken,
      heartsTaken: this.heartsTaken,
      kingOfHeartsTakenBy: this.kingOfHeartsTakenBy,
      trickWinners: this.trickWinners,
      lastTrick: this.lastTrick,
      roundScores: this.roundScores,
      roundDetails: this.roundDetails,
      cumulativeScores: this.cumulativeScores,
    };
  }

  /**
   * Reconstruct a GameState from a previously-serialised snapshot, without
   * reshuffling/redealing. Used to resume a mid-flight game out of the database.
   */
  static fromSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.players)) return null;
    // Skip the constructor (we don't want a fresh deal). Build the prototype
    // chain manually and copy all fields in.
    const gs = Object.create(GameState.prototype);
    Object.assign(gs, {
      // sane defaults so callers can rely on every field existing even if
      // an older snapshot is missing one
      hands: { 0: [], 1: [], 2: [] },
      centerCards: [],
      lastCenterCards: [],
      chosenGameType: null,
      trumpSuit: null,
      usedTypes: { 0: [], 1: [], 2: [] },
      currentTrick: [],
      ledSuit: null,
      trickNumber: 0,
      currentTurn: null,
      tricksTaken: { 0: 0, 1: 0, 2: 0 },
      queensTaken: { 0: 0, 1: 0, 2: 0 },
      jacksTaken: { 0: 0, 1: 0, 2: 0 },
      heartsTaken: { 0: 0, 1: 0, 2: 0 },
      kingOfHeartsTakenBy: null,
      trickWinners: [],
      lastTrick: null,
      roundScores: [],
      roundDetails: [],
      cumulativeScores: { 0: 0, 1: 0, 2: 0 },
      round: 1,
      phase: 'type_selection',
    }, snapshot);
    return gs;
  }

  dealCards() {
    const deck = shuffle(createDeck());
    const { hands, center } = deal(deck);
    this.hands = hands;
    this.centerCards = center;
  }

  selectGameType(seat, typeCode) {
    if (this.phase !== 'type_selection') {
      return { ok: false, error: 'Not in type selection phase.' };
    }
    if (seat !== this.leaderSeat) {
      return { ok: false, error: 'Only the leader can select the game type.' };
    }
    if (!ALL_TYPE_CODES.includes(typeCode)) {
      return { ok: false, error: `Unknown game type: ${typeCode}` };
    }
    if (this.usedTypes[seat].includes(typeCode)) {
      return { ok: false, error: `Game type ${typeCode} already used by seat ${seat}.` };
    }

    this.chosenGameType = typeCode;
    this.usedTypes[seat].push(typeCode);

    if (TRUMP_TYPES.has(typeCode)) {
      // Pluses: leader picks trump FIRST. Center cards are merged in
      // selectTrump() so the leader hasn't seen them yet when choosing trump.
      this.phase = 'trump_selection';
    } else {
      // Non-trump types: merge center cards immediately and go to discard.
      this.lastCenterCards = [...this.centerCards];
      this.hands[seat] = this.hands[seat].concat(this.centerCards);
      this.centerCards = [];
      this.trumpSuit = null;
      this.phase = 'discard';
    }

    return { ok: true };
  }

  selectTrump(seat, suit) {
    if (this.phase !== 'trump_selection') {
      return { ok: false, error: 'Not in trump selection phase.' };
    }
    if (seat !== this.leaderSeat) {
      return { ok: false, error: 'Only the leader can select trump.' };
    }
    if (!['H', 'D', 'S', 'C'].includes(suit) && suit !== null) {
      return { ok: false, error: 'Invalid suit.' };
    }
    this.trumpSuit = suit; // null means "no trump"
    // NOW that trump is locked in, give the leader the 2 center cards.
    this.lastCenterCards = [...this.centerCards];
    this.hands[seat] = this.hands[seat].concat(this.centerCards);
    this.centerCards = [];
    this.phase = 'discard';
    return { ok: true };
  }

  discardCards(seat, cards) {
    if (this.phase !== 'discard') {
      return { ok: false, error: 'Not in discard phase.' };
    }
    if (seat !== this.leaderSeat) {
      return { ok: false, error: 'Only the leader can discard.' };
    }
    if (!Array.isArray(cards) || cards.length !== 2) {
      return { ok: false, error: 'Must discard exactly 2 cards.' };
    }

    for (const card of cards) {
      if (!canDiscard(this.chosenGameType, card)) {
        return { ok: false, error: `Cannot discard ${card.rank}${card.suit} in game type ${this.chosenGameType}.` };
      }
    }

    // Cannot discard BOTH center cards — must keep at least one.
    if (this.lastCenterCards && this.lastCenterCards.length === 2) {
      const isCenter = (c) =>
        this.lastCenterCards.some((lc) => lc.rank === c.rank && lc.suit === c.suit);
      if (cards.every(isCenter)) {
        return { ok: false, error: 'You must keep at least one of the 2 center cards.' };
      }
    }

    const hand = this.hands[seat].slice();
    for (const card of cards) {
      const idx = hand.findIndex((c) => cardsEqual(c, card));
      if (idx === -1) {
        return { ok: false, error: `Card ${card.rank}${card.suit} not in hand.` };
      }
      hand.splice(idx, 1);
    }

    this.hands[seat] = hand;

    this.phase = 'playing';
    this.currentTurn = this.leaderSeat;
    this.trickNumber = 1;
    this.currentTrick = [];
    this.ledSuit = null;

    return { ok: true };
  }

  validatePlay(seat, card) {
    if (this.phase !== 'playing') {
      return { valid: false, error: 'Not in playing phase.' };
    }
    if (seat !== this.currentTurn) {
      return { valid: false, error: 'Not your turn.' };
    }

    const hand = this.hands[seat];
    if (!hand.find((c) => cardsEqual(c, card))) {
      return { valid: false, error: 'Card not in hand.' };
    }

    const isLeading = this.currentTrick.length === 0;

    if (isLeading && (this.chosenGameType === 'K' || this.chosenGameType === 'H')) {
      if (card.suit === 'H') {
        const hasNonHeart = hand.some((c) => c.suit !== 'H');
        if (hasNonHeart) {
          return { valid: false, error: 'Cannot lead a heart unless you only have hearts.' };
        }
      }
    }

    if (!isLeading && this.ledSuit) {
      const hasSuit = hand.some((c) => c.suit === this.ledSuit);
      if (hasSuit) {
        // Following-suit rule: if you have the led suit, you must play it.
        if (card.suit !== this.ledSuit) {
          return { valid: false, error: `Must follow suit: ${this.ledSuit}.` };
        }
      } else {
        // Cannot follow suit — additional forced-play rules kick in.

        // 'K' (No King of Hearts): if the player still holds K♥, they have to
        // dump it on this trick. Without this rule the K♥ holder can sit on
        // it forever, defeating the round.
        if (this.chosenGameType === 'K') {
          const hasKingOfHearts    = hand.some((c) => c.rank === 'K' && c.suit === 'H');
          const playingKingOfHearts = card.rank === 'K' && card.suit === 'H';
          if (hasKingOfHearts && !playingKingOfHearts) {
            return { valid: false, error: 'You must play the King of Hearts when you cannot follow suit.' };
          }
        }

        // P1/P2/P3 (Pluses) with a chosen trump suit: if you have any trump
        // and can't follow led suit, you must trump in. Standard "trick-
        // taking with trumps" rule.
        if (this.trumpSuit && TRUMP_TYPES.has(this.chosenGameType)) {
          const hasTrump = hand.some((c) => c.suit === this.trumpSuit);
          if (hasTrump && card.suit !== this.trumpSuit) {
            return { valid: false, error: 'Must play a trump card when you cannot follow suit.' };
          }
        }
      }
    }

    return { valid: true };
  }

  playCard(seat, card) {
    const validation = this.validatePlay(seat, card);
    if (!validation.valid) {
      return {
        ok: false,
        error: validation.error,
        trickComplete: false,
        trick: null,
        winnerSeat: null,
        roundEnds: false,
        scores: null,
        cumulativeScores: null,
        round: this.round,
        isGameOver: false,
        gameType: this.chosenGameType,
      };
    }

    const handIdx = this.hands[seat].findIndex((c) => cardsEqual(c, card));
    this.hands[seat].splice(handIdx, 1);

    if (this.currentTrick.length === 0) {
      this.ledSuit = card.suit;
    }

    this.currentTrick.push({ seat, card });

    this.currentTurn = (seat + 1) % 3;

    if (this.currentTrick.length < 3) {
      return {
        ok: true,
        trickComplete: false,
        trick: null,
        winnerSeat: null,
        roundEnds: false,
        scores: null,
        cumulativeScores: null,
        round: this.round,
        isGameOver: false,
        gameType: this.chosenGameType,
      };
    }

    const completedTrick = this.currentTrick.slice();
    const winnerSeat = resolveTrick(completedTrick, this.ledSuit, this.trumpSuit);

    this.tricksTaken[winnerSeat]++;
    this.trickWinners.push(winnerSeat);

    for (const { card: c } of completedTrick) {
      if (c.rank === 'Q') this.queensTaken[winnerSeat]++;
      if (c.rank === 'J') this.jacksTaken[winnerSeat]++;
      if (c.suit === 'H') this.heartsTaken[winnerSeat]++;
      if (c.rank === 'K' && c.suit === 'H') this.kingOfHeartsTakenBy = winnerSeat;
    }

    this.lastTrick = { winnerSeat, trick: completedTrick.slice(), trickNumber: this.trickNumber };

    this.currentTrick = [];
    this.ledSuit = null;
    this.currentTurn = winnerSeat;

    const roundEnds = this._checkRoundEnd();

    if (!roundEnds) {
      this.trickNumber++;
      return {
        ok: true,
        trickComplete: true,
        trick: completedTrick,
        winnerSeat,
        roundEnds: false,
        scores: null,
        cumulativeScores: null,
        round: this.round,
        isGameOver: false,
        gameType: this.chosenGameType,
      };
    }

    const roundData = {
      tricksTaken: { ...this.tricksTaken },
      queensTaken: { ...this.queensTaken },
      jacksTaken: { ...this.jacksTaken },
      heartsTaken: { ...this.heartsTaken },
      kingOfHeartsTakenBy: this.kingOfHeartsTakenBy,
      trickWinners: [...this.trickWinners],
    };

    const scores = calculate(this.chosenGameType, roundData);

    for (let s = 0; s < 3; s++) {
      this.cumulativeScores[s] += scores[s];
    }

    this.roundScores.push({
      round: this.round,
      gameType: this.chosenGameType,
      scores: { ...scores },
    });

    this.roundDetails.push({
      round: this.round,
      gameType: this.chosenGameType,
      leaderSeat: this.leaderSeat,
      trumpSuit: this.trumpSuit,
      scores: { ...scores },
      cumulativeScores: { ...this.cumulativeScores },
      tricksTaken: { ...this.tricksTaken },
      queensTaken: { ...this.queensTaken },
      jacksTaken: { ...this.jacksTaken },
      heartsTaken: { ...this.heartsTaken },
      kingOfHeartsTakenBy: this.kingOfHeartsTakenBy,
      trickWinners: [...this.trickWinners],
      tricksPlayed: this.trickWinners.length,
    });

    this.phase = 'round_end';

    const isGameOver = this.round >= TOTAL_ROUNDS;

    return {
      ok: true,
      trickComplete: true,
      trick: completedTrick,
      winnerSeat,
      roundEnds: true,
      scores,
      cumulativeScores: { ...this.cumulativeScores },
      round: this.round,
      isGameOver,
      gameType: this.chosenGameType,
    };
  }

  /**
   * End the current round immediately because a "quit round" vote passed.
   * Scores are flat — whatever was already taken this round is ignored:
   * the quitter simply eats the round's full penalty (or, on a positive
   * hand, hands its full reward to the other two).
   */
  endRoundEarly(quitterSeat) {
    if (!this.chosenGameType) {
      return { ok: false, error: 'No game type chosen yet.' };
    }
    if (this.phase !== 'discard' && this.phase !== 'playing') {
      return { ok: false, error: 'The round cannot be quit right now.' };
    }

    const total = QUIT_ROUND_TOTALS[this.chosenGameType] || 0;
    const scores = { 0: 0, 1: 0, 2: 0 };
    if (total < 0) {
      scores[quitterSeat] = total;
    } else {
      for (let s = 0; s < 3; s++) {
        if (s !== quitterSeat) scores[s] = total / 2;
      }
    }

    for (let s = 0; s < 3; s++) {
      this.cumulativeScores[s] += scores[s];
    }

    this.roundScores.push({
      round: this.round,
      gameType: this.chosenGameType,
      scores: { ...scores },
    });

    this.roundDetails.push({
      round: this.round,
      gameType: this.chosenGameType,
      leaderSeat: this.leaderSeat,
      trumpSuit: this.trumpSuit,
      scores: { ...scores },
      cumulativeScores: { ...this.cumulativeScores },
      tricksTaken: { ...this.tricksTaken },
      queensTaken: { ...this.queensTaken },
      jacksTaken: { ...this.jacksTaken },
      heartsTaken: { ...this.heartsTaken },
      kingOfHeartsTakenBy: this.kingOfHeartsTakenBy,
      trickWinners: [...this.trickWinners],
      tricksPlayed: this.trickWinners.length,
      quitBySeat: quitterSeat,
    });

    this.currentTrick = [];
    this.ledSuit = null;
    this.phase = 'round_end';

    return {
      ok: true,
      scores,
      cumulativeScores: { ...this.cumulativeScores },
      round: this.round,
      isGameOver: this.round >= TOTAL_ROUNDS,
      gameType: this.chosenGameType,
    };
  }

  _checkRoundEnd() {
    switch (this.chosenGameType) {
      case 'K':
        return this.kingOfHeartsTakenBy !== null;
      case 'Q':
        return (
          (this.queensTaken[0] || 0) +
          (this.queensTaken[1] || 0) +
          (this.queensTaken[2] || 0) >= 4
        );
      case 'J':
        return (
          (this.jacksTaken[0] || 0) +
          (this.jacksTaken[1] || 0) +
          (this.jacksTaken[2] || 0) >= 4
        );
      case 'H':
        return (
          (this.heartsTaken[0] || 0) +
          (this.heartsTaken[1] || 0) +
          (this.heartsTaken[2] || 0) >= 8
        );
      default:
        return this.trickWinners.length >= 10;
    }
  }

  startNextRound() {
    if (this.phase !== 'round_end') {
      return { ok: false, error: 'Round is not over yet.' };
    }
    if (this.round >= TOTAL_ROUNDS) {
      return { ok: false, error: 'Game is already over.' };
    }

    this.round++;
    this.phase = 'type_selection';
    this.chosenGameType = null;
    this.trumpSuit = null;
    this.lastCenterCards = [];

    this.tricksTaken = { 0: 0, 1: 0, 2: 0 };
    this.queensTaken = { 0: 0, 1: 0, 2: 0 };
    this.jacksTaken = { 0: 0, 1: 0, 2: 0 };
    this.heartsTaken = { 0: 0, 1: 0, 2: 0 };
    this.kingOfHeartsTakenBy = null;
    this.trickWinners = [];
    this.lastTrick = null;
    this.currentTrick = [];
    this.ledSuit = null;
    this.trickNumber = 0;
    this.currentTurn = null;

    this.dealCards();

    return { ok: true };
  }

  /**
   * Returns a state snapshot for a given player's seat.
   * Hand/center visibility (identical in every round, including the 1st):
   *  - Own hand always visible to its owner.
   *  - centerCards (prikup) hidden from the leader during type_selection;
   *    visible to the other players until merged into the leader's hand.
   */
  getStateForPlayer(seat) {
    const cardCounts = {};
    for (let s = 0; s < 3; s++) {
      cardCounts[s] = this.hands[s].length;
    }

    const isLeader = seat === this.leaderSeat;
    const handToSend = this.hands[seat] || [];
    const centerToSend =
      this.phase === 'type_selection' && isLeader ? [] : this.centerCards;

    return {
      round: this.round,
      phase: this.phase,
      leaderSeat: this.leaderSeat,
      hand: handToSend,
      centerCards: centerToSend,
      lastCenterCards: isLeader ? this.lastCenterCards : [],
      cardCounts,
      chosenGameType: this.chosenGameType,
      trumpSuit: this.trumpSuit,
      usedTypes: { ...this.usedTypes },
      currentTrick: this.currentTrick,
      ledSuit: this.ledSuit,
      trickNumber: this.trickNumber,
      currentTurn: this.currentTurn,
      tricksTaken: { ...this.tricksTaken },
      queensTaken: { ...this.queensTaken },
      jacksTaken: { ...this.jacksTaken },
      heartsTaken: { ...this.heartsTaken },
      kingOfHeartsTakenBy: this.kingOfHeartsTakenBy,
      lastTrick: this.lastTrick,
      cumulativeScores: { ...this.cumulativeScores },
      roundScores: this.roundScores,
      roundDetails: this.roundDetails,
      players: this.players,
      isGameOver: this.isGameOver,
    };
  }

  /**
   * A watcher's view of the table: everything the room already broadcasts,
   * minus anything only a seated player should know.
   *
   * Spectators are other tournament entrants who may still have to play these
   * opponents, so this is a competitive-integrity boundary, not a cosmetic
   * one. Three things are withheld:
   *   • `hand`      — nobody's cards, obviously.
   *   • `centerCards` — the prikup. Two of the three players can see it, but
   *     a watcher knowing it would leak information into a later round.
   *   • `lastCenterCards` — the same cards after the merge.
   *
   * The trick on the table, trick counts, scores, whose turn it is and the
   * round/phase all stay visible — that's the point of watching.
   */
  getStateForSpectator() {
    const cardCounts = {};
    for (let s = 0; s < 3; s++) cardCounts[s] = this.hands[s].length;

    return {
      round: this.round,
      phase: this.phase,
      leaderSeat: this.leaderSeat,
      hand: [],
      centerCards: [],
      lastCenterCards: [],
      cardCounts,
      chosenGameType: this.chosenGameType,
      trumpSuit: this.trumpSuit,
      usedTypes: { ...this.usedTypes },
      currentTrick: this.currentTrick,
      ledSuit: this.ledSuit,
      trickNumber: this.trickNumber,
      currentTurn: this.currentTurn,
      tricksTaken: { ...this.tricksTaken },
      queensTaken: { ...this.queensTaken },
      jacksTaken: { ...this.jacksTaken },
      heartsTaken: { ...this.heartsTaken },
      kingOfHeartsTakenBy: this.kingOfHeartsTakenBy,
      lastTrick: this.lastTrick,
      cumulativeScores: { ...this.cumulativeScores },
      roundScores: this.roundScores,
      roundDetails: this.roundDetails,
      players: this.players,
      isGameOver: this.isGameOver,
      spectator: true,
    };
  }
}

module.exports = GameState;
