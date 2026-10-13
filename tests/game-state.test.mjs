// The King engine's view rules and bookkeeping (server/game/GameState.js).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const GameState = require("../server/game/GameState.js");

test("the leader doesn't see the prikup until it is in their hand", () => {
  const gs = new GameState();
  const leader = gs.leaderSeat;
  const other = (leader + 1) % 3;
  assert.deepEqual(gs.getStateForPlayer(leader).centerCards, []);
  assert.equal(gs.getStateForPlayer(other).centerCards.length, 2);

  assert.equal(gs.selectGameType(leader, "P1").ok, true);
  assert.equal(gs.phase, "trump_selection");
  assert.deepEqual(gs.getStateForPlayer(leader).centerCards, [], "hidden while picking trump");
  assert.equal(gs.getStateForPlayer(other).centerCards.length, 2);

  assert.equal(gs.selectTrump(leader, "S").ok, true);
  assert.equal(gs.getStateForPlayer(leader).hand.length, 12);
  assert.equal(gs.getStateForPlayer(leader).lastCenterCards.length, 2);
});

test("a played card is the hand's own copy, never the client's object", () => {
  const gs = new GameState();
  const leader = gs.leaderSeat;
  gs.selectGameType(leader, "T");
  gs.discardCards(leader, gs.hands[leader].slice(0, 2));
  const card = { ...gs.hands[leader][0], junk: "x".repeat(1000) };
  const result = gs.playCard(leader, card);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.card).sort(), ["rank", "suit"]);
  assert.deepEqual(Object.keys(gs.currentTrick[0].card).sort(), ["rank", "suit"]);
  assert.equal(gs.playCard((leader + 1) % 3, { rank: 7, suit: ["H"] }).ok, false);
  assert.equal(gs.playCard((leader + 1) % 3, null).ok, false);
});

test("a quit round records its flat scores, not the half-played cards", () => {
  const gs = new GameState();
  const leader = gs.leaderSeat;
  gs.selectGameType(leader, "Q");
  const result = gs.endRoundEarly(1);
  assert.equal(result.ok, true);
  const detail = gs.roundDetails.at(-1);
  assert.equal(detail.quitBySeat, 1);
  assert.equal(detail.queensTaken, null);
  assert.equal(detail.kingOfHeartsTakenBy, null);
  assert.deepEqual(detail.scores, { 0: 0, 1: -40, 2: 0 });
});

test("every change moves the version, and a snapshot keeps it", () => {
  const gs = new GameState();
  const v0 = gs.version;
  gs.selectGameType(gs.leaderSeat, "K");
  assert.ok(gs.version > v0);
  assert.equal(gs.getStateForSpectator().version, gs.version);
  const back = GameState.fromSnapshot(JSON.parse(JSON.stringify(gs.serialize())));
  assert.equal(back.version, gs.version);
  assert.equal(back.phase, "discard");
  assert.equal("players" in gs.serialize(), false);
  // Snapshots from before the roster moved out still restore.
  assert.ok(GameState.fromSnapshot({ ...gs.serialize(), players: [{ seat: 0 }] }));
  assert.equal(GameState.fromSnapshot({ round: 3 }), null);
});
