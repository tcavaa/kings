import test from "node:test";
import assert from "node:assert/strict";
import {
  tableReducer,
  initialTable,
  sortHand,
} from "../src/online/context/tableReducer.js";

const card = (rank, suit) => ({ rank, suit });
const run = (actions, from = initialTable) => actions.reduce(tableReducer, from);

test("sortHand orders by suit, then rank", () => {
  const hand = [card("7", "C"), card("A", "H"), card("10", "S"), card("K", "H")];
  assert.deepEqual(sortHand(hand).map((c) => c.rank + c.suit), ["10S", "AH", "KH", "7C"]);
});

test("hand-dealt sorts the hand and starts a fresh hand", () => {
  const dirty = {
    ...initialTable,
    chosenGameType: "Q",
    trumpSuit: "H",
    currentTrick: [{ seat: 0, card: card("A", "S") }],
    selectedDiscards: [card("7", "C")],
    playPending: true,
  };
  const s = tableReducer(dirty, {
    type: "hand-dealt",
    hand: [card("7", "C"), card("A", "S")],
    centerCards: [card("8", "D")],
    leaderSeat: 2,
    round: 4,
    cardCounts: { 0: 8, 1: 8, 2: 8 },
  });
  assert.deepEqual(s.hand.map((c) => c.rank + c.suit), ["AS", "7C"]);
  assert.equal(s.chosenGameType, null);
  assert.equal(s.trumpSuit, null);
  assert.deepEqual(s.currentTrick, []);
  assert.deepEqual(s.selectedDiscards, []);
  assert.equal(s.playPending, false);
  assert.equal(s.leaderSeat, 2);
  assert.equal(s.round, 4);
});

test("our own play: card leaves the hand at once, the ack releases the lock", () => {
  const start = { ...initialTable, hand: [card("A", "S"), card("7", "C")] };
  const sent = tableReducer(start, { type: "play-sent", card: card("A", "S") });
  assert.equal(sent.playPending, true);
  assert.equal(sent.hand.length, 1);
  const acked = tableReducer(sent, {
    type: "card-played",
    card: card("A", "S"),
    currentTrick: [{ seat: 0, card: card("A", "S") }],
    currentTurn: 1,
    ledSuit: "S",
    mine: true,
  });
  assert.equal(acked.playPending, false);
  assert.equal(acked.currentTurn, 1);
  assert.equal(acked.hand.length, 1);
});

test("a trick is shown, flown, then cleared with the next turn", () => {
  const trick = [
    { seat: 0, card: card("A", "S") },
    { seat: 1, card: card("7", "S") },
    { seat: 2, card: card("9", "S") },
  ];
  const shown = tableReducer(initialTable, { type: "trick-complete", winnerSeat: 0, trick });
  assert.equal(shown.trickAnimation.status, "showing");
  assert.equal(shown.ledSuit, "S");
  assert.deepEqual(shown.lastTrickResult, { winnerSeat: 0, trick });
  const flown = tableReducer(shown, { type: "trick-animate", winnerSeat: 0, trick, status: "animating" });
  assert.equal(flown.trickAnimation.status, "animating");
  const cleared = tableReducer(flown, { type: "trick-cleared", nextTurn: 0 });
  assert.deepEqual(cleared.currentTrick, []);
  assert.equal(cleared.trickAnimation, null);
  assert.equal(cleared.currentTurn, 0);
  // The round's last trick clears without moving the turn.
  const last = tableReducer({ ...flown, currentTurn: 2 }, { type: "trick-cleared" });
  assert.equal(last.currentTurn, 2);
});

test("a late trick: the next card ends the old animation", () => {
  const animating = { ...initialTable, trickAnimation: { winnerSeat: 1, trick: [], status: "animating" } };
  const s = tableReducer(animating, {
    type: "card-played",
    card: card("K", "D"),
    currentTrick: [{ seat: 1, card: card("K", "D") }],
    currentTurn: 2,
    ledSuit: "D",
    mine: false,
    endsTrickAnimation: true,
  });
  assert.equal(s.trickAnimation, null);
  assert.equal(s.currentTrick.length, 1);
});

test("round-complete appends the round; a passed quit vote skips to the summary", () => {
  const base = { ...initialTable, gamePhase: "playing", selectedDiscards: [card("7", "C")] };
  const done = tableReducer(base, {
    type: "round-complete",
    trick: null,
    scores: { 0: -40, 1: 0, 2: 0 },
    cumulativeScores: { 0: -40, 1: 0, 2: 0 },
    round: 1,
    gameType: "T",
    roundDetail: { round: 1 },
  });
  assert.equal(done.gamePhase, "round_end");
  assert.equal(done.roundScores.length, 1);
  assert.equal(done.roundDetails.length, 1);
  assert.deepEqual(done.selectedDiscards, []);
  // After the last round there's no summary: game-over follows.
  const last = tableReducer(base, {
    type: "round-complete",
    trick: null,
    scores: {},
    cumulativeScores: {},
    round: 27,
    gameType: "P",
    isGameOver: true,
  });
  assert.equal(last.gamePhase, "playing");
});

test("game-state assigns by key, so nulls clear old values", () => {
  const stale = {
    ...initialTable,
    chosenGameType: "Q",
    lastTrickResult: { winnerSeat: 1, trick: [] },
    trickAnimation: { winnerSeat: 1, trick: [] },
    playPending: true,
    round: 5,
  };
  const s = tableReducer(stale, {
    type: "game-state",
    state: { phase: "type_selection", chosenGameType: null, lastTrick: null, hand: [card("7", "C")] },
  });
  assert.equal(s.chosenGameType, null);
  assert.equal(s.lastTrickResult, null);
  assert.equal(s.trickAnimation, null);
  assert.equal(s.playPending, false);
  assert.equal(s.gamePhase, "type_selection");
  // Fields the snapshot doesn't mention are kept.
  assert.equal(s.round, 5);
});

test("toggle-discard picks at most two cards and unpicks on a second tap", () => {
  const s = run([
    { type: "toggle-discard", card: card("7", "C") },
    { type: "toggle-discard", card: card("8", "C") },
    { type: "toggle-discard", card: card("9", "C") },
  ]);
  assert.equal(s.selectedDiscards.length, 2);
  const un = tableReducer(s, { type: "toggle-discard", card: card("7", "C") });
  assert.deepEqual(un.selectedDiscards, [card("8", "C")]);
});

test("game-started wipes the previous game's ledger", () => {
  const old = {
    ...initialTable,
    usedTypes: { 0: ["Q"], 1: [], 2: [] },
    roundScores: [{ round: 1 }],
    cumulativeScores: { 0: 10, 1: 0, 2: -10 },
  };
  const s = tableReducer(old, { type: "game-started", round: 1, leaderSeat: 0 });
  assert.deepEqual(s.usedTypes, { 0: [], 1: [], 2: [] });
  assert.deepEqual(s.roundScores, []);
  assert.deepEqual(s.cumulativeScores, { 0: 0, 1: 0, 2: 0 });
  assert.equal(s.gamePhase, "type_selection");
});
