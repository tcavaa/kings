import test from "node:test";
import assert from "node:assert/strict";
import { computeGameStats } from "../src/online/utils/gameStats.js";

const players = [{ seat: 0 }, { seat: 1 }, { seat: 2 }];
// Every round records queens, jacks, hearts and the K♥ taker, whatever the
// contract — only the matching round type may count them.
const round = (r, gameType, extra = {}) => ({
  round: r,
  gameType,
  leaderSeat: r % 3,
  scores: { 0: 0, 1: 0, 2: 0 },
  tricksTaken: { 0: 1, 1: 1, 2: 0 },
  queensTaken: { 0: 2, 1: 1, 2: 1 },
  jacksTaken: { 0: 1, 1: 2, 2: 1 },
  heartsTaken: { 0: 3, 1: 3, 2: 2 },
  kingOfHeartsTakenBy: 0,
  ...extra,
});

test("cards count only in their own round type", () => {
  const details = [
    round(1, "T"),
    round(2, "Q"),
    round(3, "J"),
    round(4, "H"),
    round(5, "K"),
    round(6, "P1"),
  ];
  const s = computeGameStats(players, details);
  assert.equal(s[0].queens, 2);
  assert.equal(s[1].jacks, 2);
  assert.equal(s[2].hearts, 2);
  assert.equal(s[0].kingsOfHearts, 1);
  assert.equal(s[1].kingsOfHearts, 0);
  // Tricks count in every round.
  assert.equal(s[0].totalTricks, 6);
  assert.equal(s[2].totalTricks, 0);
});

test("rounds led and best/worst round", () => {
  const details = [
    round(1, "T", { scores: { 0: -20, 1: 0, 2: 0 } }),
    round(2, "P1", { scores: { 0: 40, 1: 30, 2: 10 } }),
    round(3, "Q", { scores: { 0: 0, 1: -60, 2: -20 } }),
  ];
  const s = computeGameStats(players, details);
  assert.deepEqual(
    [s[0].roundsLed, s[1].roundsLed, s[2].roundsLed],
    [1, 1, 1],
  );
  assert.deepEqual(s[0].bestRound, { score: 40, round: 2, type: "P1" });
  assert.deepEqual(s[0].worstRound, { score: -20, round: 1, type: "T" });
  assert.deepEqual(s[1].worstRound, { score: -60, round: 3, type: "Q" });
});

test("no rounds: zero totals and empty best/worst", () => {
  const s = computeGameStats(players, []);
  assert.equal(s[1].queens, 0);
  assert.equal(s[1].bestRound.round, null);
});
