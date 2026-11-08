'use strict';

const { createDeck, shuffle, deal } = require('./Deck');
const { resolveTrick } = require('./TrickResolver');
const { calculate } = require('./ScoreCalculator');
const { ALL_TYPE_CODES, CARDS_PER_PLAYER, roundsFor, normalizeSeatCount } = require('./constants');
const { TRUMP_TYPES, canDiscard, playError } = require('./rules');
const { GAME_TYPE_RULES, gameTypeRule, isPenaltyCard } = require('./gameTypes');

// Full-round point totals per game type (every unit's points: -40 for each
// penalty type, +80 for a Plus round), used when a round is quit early via
// a unanimous "quit round" vote: on negative hands the quitter absorbs the
// entire penalty; on positive hands the quitter forfeits their share and the
// other two players split the total evenly.
const QUIT_ROUND_TOTALS = Object.fromEntries(
  GAME_TYPE_RULES.map((t) => [t.code, t.totalUnits * t.pointsPerUnit])
);

function cardsEqual(a, b) {
  return a.rank === b.rank && a.suit === b.suit;
}

// A card as the client sends it: only `rank` and `suit` are ever looked at,
// and only the copy held in the hand is stored or relayed.
function isCardShape(card) {
  return !!card && typeof card.rank === 'string' && typeof card.suit === 'string';
}

/** { 0: v, 1: v, … } for every seat at a table of `seatCount`. */
function perSeat(seatCount, v) {
  const out = {};
  for (let s = 0; s < seatCount; s++) out[s] = typeof v === 'function' ? v(s) : v;
  return out;
}

// Everything that starts over with each round. The constructor and
// startNextRound both begin from this.
function freshRoundState(seatCount = 3) {
  return {
    phase: 'type_selection', // type_selection | trump_selection | discard | playing | round_end | game_over
    hands: perSeat(seatCount, () => []),
    centerCards: [],
    lastCenterCards: [], // the 2 cards added to the leader's hand this round
    chosenGameType: null,
    trumpSuit: null,
    currentTrick: [],
    ledSuit: null,
    trickNumber: 0,
    currentTurn: null,
    tricksTaken: perSeat(seatCount, 0),
    queensTaken: perSeat(seatCount, 0),
    jacksTaken: perSeat(seatCount, 0),
    heartsTaken: perSeat(seatCount, 0),
    kingOfHeartsTakenBy: null,
    trickWinners: [],
    lastTrick: null, // { winnerSeat, trick: [{seat, card}], trickNumber }
  };
}

class GameState {
  /**
   * `seatCount` is 3 (everyone plays every round) or 4: then the dealer —
   * the seat just before the round's leader — sits the round out and the
   * other three play it exactly like a 3-player round. Every player still
   * leads each of the 9 game types once, so a 4-player game is 36 rounds.
   */
  constructor(seatCount = 3) {
    this.seatCount = normalizeSeatCount(seatCount);
    this.round = 1;
    Object.assign(this, freshRoundState(this.seatCount));
    this.usedTypes = perSeat(this.seatCount, () => []);
    this.roundScores = [];
    this.roundDetails = []; // detailed per-round stats for end-of-game review
    this.cumulativeScores = perSeat(this.seatCount, 0);
    // Bumped on every change. Every state the clients get carries it, so a
    // resync from a client that already holds this version can be answered
    // with "up to date" instead of the whole table.
    this.version = 1;

    this.dealCards();
  }

  get seats() { return Array.from({ length: this.seatCount }, (_, s) => s); }
  get totalRounds() { return roundsFor(this.seatCount); }
  get leaderSeat() { return (this.round - 1) % this.seatCount; }
  /** The dealer, who sits this round out at a 4-player table (null at 3). */
  get restingSeat() {
    return this.seatCount === 4 ? (this.leaderSeat + this.seatCount - 1) % this.seatCount : null;
  }
  /** The three seats playing this round, in turn order from the leader. */
  get activeSeats() {
    const out = [];
    for (let i = 0; i < this.seatCount; i++) {
      const s = (this.leaderSeat + i) % this.seatCount;
      if (s !== this.restingSeat) out.push(s);
    }
    return out;
  }
  get isGameOver() { return this.phase === 'game_over'; }

  _changed() { this.version += 1; }

  /** The playing seat after `seat` (clockwise, skipping the resting dealer). */
  _nextSeat(seat) {
    let next = (seat + 1) % this.seatCount;
    if (next === this.restingSeat) next = (next + 1) % this.seatCount;
    return next;
  }

  /** How many cards each seat holds — what opponents' card fans are drawn from. */
  cardCounts() {
    return perSeat(this.seatCount, (s) => (this.hands[s] || []).length);
  }

  // ─── persistence ───────────────────────────────────────────────────────────
  // Every field that's part of the game's mutable state. Anything derived
  // (leaderSeat, isGameOver) is recomputed via getters. The roster isn't here:
  // the room owns it, and every emitter sends the room's.
  serialize() {
    return {
      version: this.version,
      seatCount: this.seatCount,
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
    // Snapshots written before the roster moved out still carry `players`;
    // either way a real one always has the hands.
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.hands) return null;
    // Skip the constructor (we don't want a fresh deal). Build the prototype
    // chain manually and copy all fields in.
    const gs = Object.create(GameState.prototype);
    // Snapshots from before 4-player tables are all 3-seat games.
    const seatCount = normalizeSeatCount(snapshot.seatCount);
    Object.assign(gs, {
      // sane defaults so callers can rely on every field existing even if
      // an older snapshot is missing one
      ...freshRoundState(seatCount),
      usedTypes: perSeat(seatCount, () => []),
      roundScores: [],
      roundDetails: [],
      cumulativeScores: perSeat(seatCount, 0),
      round: 1,
      version: 1,
    }, snapshot, { seatCount });
    delete gs.players;
    return gs;
  }

  dealCards() {
    const deck = shuffle(createDeck());
    // The resting dealer gets no cards: the three players get 10 each, as at
    // a 3-player table.
    // Dealt in seat order (not turn order), so a 3-seat deal is exactly what
    // it always was.
    const { hands, center } = deal(deck, [...this.activeSeats].sort((a, b) => a - b));
    this.hands = { ...perSeat(this.seatCount, () => []), ...hands };
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

    this._changed();
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
    this._changed();
    return { ok: true };
  }

  discardCards(seat, cards) {
    if (this.phase !== 'discard') {
      return { ok: false, error: 'Not in discard phase.' };
    }
    if (seat !== this.leaderSeat) {
      return { ok: false, error: 'Only the leader can discard.' };
    }
    if (!Array.isArray(cards) || cards.length !== 2 || !cards.every(isCardShape)) {
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

    this._changed();
    return { ok: true };
  }

  validatePlay(seat, card) {
    if (!isCardShape(card)) {
      return { valid: false, error: 'Invalid card object.' };
    }
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

    const error = playError(card, {
      hand,
      leading: this.currentTrick.length === 0,
      ledSuit: this.ledSuit,
      chosenGameType: this.chosenGameType,
      trumpSuit: this.trumpSuit,
    });
    if (error) return { valid: false, error };

    return { valid: true };
  }

  playCard(seat, card) {
    // Every outcome carries the same fields, so callers can read any of them.
    const outcome = (fields) => ({
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
      ...fields,
    });

    const validation = this.validatePlay(seat, card);
    if (!validation.valid) return outcome({ ok: false, error: validation.error });

    // Keep the hand's own copy: it is what gets stored and relayed, never the
    // object the client sent (which could carry anything).
    const handIdx = this.hands[seat].findIndex((c) => cardsEqual(c, card));
    const [played] = this.hands[seat].splice(handIdx, 1);

    if (this.currentTrick.length === 0) {
      this.ledSuit = played.suit;
    }

    this.currentTrick.push({ seat, card: played });

    this.currentTurn = this._nextSeat(seat);
    this._changed();

    if (this.currentTrick.length < 3) return outcome({ card: played });

    const completedTrick = this.currentTrick.slice();
    const winnerSeat = resolveTrick(completedTrick, this.ledSuit, this.trumpSuit);

    this.tricksTaken[winnerSeat]++;
    this.trickWinners.push(winnerSeat);

    for (const { card: c } of completedTrick) {
      if (isPenaltyCard('Q', c)) this.queensTaken[winnerSeat]++;
      if (isPenaltyCard('J', c)) this.jacksTaken[winnerSeat]++;
      if (isPenaltyCard('H', c)) this.heartsTaken[winnerSeat]++;
      if (isPenaltyCard('K', c)) this.kingOfHeartsTakenBy = winnerSeat;
    }

    this.lastTrick = { winnerSeat, trick: completedTrick.slice(), trickNumber: this.trickNumber };

    this.currentTrick = [];
    this.ledSuit = null;
    this.currentTurn = winnerSeat;

    const trickDone = { card: played, trickComplete: true, trick: completedTrick, winnerSeat };
    if (!this._checkRoundEnd()) {
      this.trickNumber++;
      return outcome(trickDone);
    }

    const scores = calculate(this.chosenGameType, this.seats, {
      tricksTaken: { ...this.tricksTaken },
      queensTaken: { ...this.queensTaken },
      jacksTaken: { ...this.jacksTaken },
      heartsTaken: { ...this.heartsTaken },
      kingOfHeartsTakenBy: this.kingOfHeartsTakenBy,
      trickWinners: [...this.trickWinners],
    });
    this._recordRound(scores, {
      tricksTaken: { ...this.tricksTaken },
      queensTaken: { ...this.queensTaken },
      jacksTaken: { ...this.jacksTaken },
      heartsTaken: { ...this.heartsTaken },
      kingOfHeartsTakenBy: this.kingOfHeartsTakenBy,
      trickWinners: [...this.trickWinners],
    });

    return outcome({
      ...trickDone,
      roundEnds: true,
      scores,
      cumulativeScores: { ...this.cumulativeScores },
      isGameOver: this.round >= this.totalRounds,
    });
  }

  /**
   * Add a finished round's scores and its review record, and move to
   * round_end. `cards` is what was taken this round (see roundDetails).
   */
  _recordRound(scores, cards) {
    for (const s of this.seats) {
      this.cumulativeScores[s] = (this.cumulativeScores[s] || 0) + (scores[s] || 0);
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
      // 4-player tables only: the dealer, who sat this round out.
      ...(this.restingSeat !== null && { restingSeat: this.restingSeat }),
      trumpSuit: this.trumpSuit,
      scores: { ...scores },
      cumulativeScores: { ...this.cumulativeScores },
      ...cards,
      tricksPlayed: this.trickWinners.length,
    });

    this.currentTrick = [];
    this.ledSuit = null;
    this.phase = 'round_end';
    this._changed();
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
    const scores = perSeat(this.seatCount, 0);
    // The resting dealer is not in the round, so a quit costs or pays only
    // the three players.
    const playing = this.activeSeats;
    if (total < 0) {
      if (playing.includes(quitterSeat)) scores[quitterSeat] = total;
      else scores[this.leaderSeat] = total;
    } else {
      const others = playing.filter((s) => s !== quitterSeat);
      for (const s of others) scores[s] = total / others.length;
    }

    // The cards taken before the quit don't match the flat scores, so they
    // aren't recorded: stats and ჩაწერა's history would count a half-played
    // round as if it had been played out.
    this._recordRound(scores, {
      tricksTaken: null,
      queensTaken: null,
      jacksTaken: null,
      heartsTaken: null,
      kingOfHeartsTakenBy: null,
      trickWinners: [],
      quitBySeat: quitterSeat,
    });

    return {
      ok: true,
      scores,
      cumulativeScores: { ...this.cumulativeScores },
      round: this.round,
      isGameOver: this.round >= this.totalRounds,
      gameType: this.chosenGameType,
    };
  }

  _checkRoundEnd() {
    // K, Q, J and H end as soon as every unit of the type has been taken
    // (gameTypes.js says how many); the rest play all 10 tricks.
    const all = (taken) => this.seats.reduce((sum, s) => sum + (taken[s] || 0), 0)
      >= gameTypeRule(this.chosenGameType).totalUnits;
    switch (this.chosenGameType) {
      case 'K':
        return this.kingOfHeartsTakenBy !== null;
      case 'Q':
        return all(this.queensTaken);
      case 'J':
        return all(this.jacksTaken);
      case 'H':
        return all(this.heartsTaken);
      default:
        return this.trickWinners.length >= CARDS_PER_PLAYER;
    }
  }

  startNextRound() {
    if (this.phase !== 'round_end') {
      return { ok: false, error: 'Round is not over yet.' };
    }
    if (this.round >= this.totalRounds) {
      return { ok: false, error: 'Game is already over.' };
    }

    this.round++;
    Object.assign(this, freshRoundState(this.seatCount));
    this.dealCards();
    this._changed();

    return { ok: true };
  }

  /** The game is over (played out, or ended by a vote). */
  finish() {
    this.phase = 'game_over';
    this._changed();
  }

  /** What every viewer of the table may see: no hand, no prikup. */
  _publicView() {
    return {
      version: this.version,
      seatCount: this.seatCount,
      totalRounds: this.totalRounds,
      round: this.round,
      phase: this.phase,
      leaderSeat: this.leaderSeat,
      restingSeat: this.restingSeat,
      cardCounts: this.cardCounts(),
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
      isGameOver: this.isGameOver,
    };
  }

  /**
   * Returns a state snapshot for a given player's seat.
   * Hand/center visibility (identical in every round, including the 1st):
   *  - Own hand always visible to its owner.
   *  - centerCards (prikup) hidden from the leader until it is merged into
   *    their hand: through type selection, and in the Pluses through trump
   *    selection too, since the leader picks trump without seeing it.
   *    The other players see it until the merge.
   * The roster isn't included — callers add the room's.
   */
  getStateForPlayer(seat) {
    const isLeader = seat === this.leaderSeat;
    const leaderBlind = this.phase === 'type_selection' || this.phase === 'trump_selection';
    return {
      ...this._publicView(),
      hand: this.hands[seat] || [],
      centerCards: isLeader && leaderBlind ? [] : this.centerCards,
      lastCenterCards: isLeader ? this.lastCenterCards : [],
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
    return {
      ...this._publicView(),
      hand: [],
      centerCards: [],
      lastCenterCards: [],
      spectator: true,
    };
  }
}

module.exports = GameState;
