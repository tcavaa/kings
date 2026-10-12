// ჩაწერა games in the shared games table: a score-sheet game becomes King
// Online's payload shape (server/games/scoreSheet.js) and turns back into
// ჩაწერა's own rows (src/score/lib/gameShapes.js) unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { liveGameToLegacy, onlineGameToLegacy } from "../src/score/lib/gameShapes.js";

const require = createRequire(import.meta.url);
const { fromScoreSheet, fromLegacyRows } = require("../server/games/scoreSheet.js");

const profiles = new Map([
  ["p_1", { id: "p_1", name: "Ana" }],
  ["p_2", { id: "p_2", name: "Beka" }],
  ["p_3", { id: "p_3", name: "Gio" }],
  ["p_4", { id: "p_4", name: "Dato" }],
]);
const resolve = (id) => profiles.get(id) || null;
const rounds = [
  { leaderPlayerId: "p_1", gameTypeCode: "K", countsByPlayerId: null, singleTargetPlayerId: "p_2",
    scores: { p_1: 0, p_2: -40, p_3: 0, p_4: 0 } },
  { leaderPlayerId: "p_2", gameTypeCode: "L2", countsByPlayerId: { p_3: 1, p_4: 1 }, singleTargetPlayerId: null,
    scores: { p_1: 0, p_2: 0, p_3: -20, p_4: -20 } },
  { leaderPlayerId: "p_3", gameTypeCode: "P1", countsByPlayerId: { p_1: 6, p_2: 0, p_3: 4 }, singleTargetPlayerId: null,
    scores: { p_1: 48, p_2: 0, p_3: 32, p_4: 0 } },
];
const sheet = { players: ["p_1", "p_2", "p_3", "p_4"].map((id) => ({ id })), rounds, durationSeconds: 1800 };

// What the store's rowToGame hands the API for a stored row.
const asServed = (row) => ({
  id: row.id, type: row.type, playedAt: "2026-10-12T18:00:00.000Z",
  winners: row.payload.winners, players: row.payload.players, roundDetails: row.payload.roundDetails,
  ...(row.payload.durationSeconds != null && { durationSeconds: row.payload.durationSeconds }),
  ...(row.payload.legacy && { legacy: row.payload.legacy }),
});

test("a finished score sheet is stored the way King Online stores its games", () => {
  const row = fromScoreSheet(sheet, resolve);
  assert.equal(row.type, "live");
  assert.deepEqual(row.payload.players.map((p) => [p.seat, p.name, p.score, p.profileId]),
    [[0, "Ana", 48, "p_1"], [1, "Beka", -40, "p_2"], [2, "Gio", 12, "p_3"], [3, "Dato", -20, "p_4"]]);
  assert.deepEqual(row.payload.winners, [{ seat: 0, name: "Ana", score: 48 }]);
  const [k, l2, p1] = row.payload.roundDetails;
  assert.equal(k.kingOfHeartsTakenBy, 1);
  assert.deepEqual(l2.trickWinners, [2, 3]);
  assert.deepEqual(p1.tricksTaken, { 0: 6, 1: 0, 2: 4 });
  assert.deepEqual(p1.cumulativeScores, { 0: 48, 1: -40, 2: 12, 3: -20 });
  assert.equal(row.payload.durationSeconds, 1800);
});

test("ჩაწერა reads its own game back unchanged", () => {
  const { result, detail } = liveGameToLegacy(asServed(fromScoreSheet(sheet, resolve)));
  assert.equal(result.winner_name, "Ana");
  assert.deepEqual(result.participants, [
    { name: "Ana", score: 48 }, { name: "Beka", score: -40 }, { name: "Gio", score: 12 }, { name: "Dato", score: -20 },
  ]);
  assert.equal(result.duration_seconds, 1800);
  assert.deepEqual(detail.players, ["p_1", "p_2", "p_3", "p_4"].map((id) => ({ id, name: profiles.get(id).name })));
  assert.deepEqual(detail.rounds, rounds.map(({ leaderPlayerId, gameTypeCode, countsByPlayerId, singleTargetPlayerId, scores }) =>
    ({ scores, gameTypeCode, leaderPlayerId, countsByPlayerId, singleTargetPlayerId })));
});

test("ties crown every top scorer", () => {
  const tie = { players: sheet.players.slice(0, 3), rounds: [
    { leaderPlayerId: "p_1", gameTypeCode: "Q", countsByPlayerId: { p_3: 4 }, singleTargetPlayerId: null, scores: { p_1: 0, p_2: 0, p_3: -40 } },
  ] };
  const row = fromScoreSheet(tie, resolve);
  assert.equal(row.payload.isTie, true);
  assert.deepEqual(liveGameToLegacy(asServed(row)).result.winner_name, "Ana & Beka");
});

test("bad sheets are refused", () => {
  assert.throws(() => fromScoreSheet({ players: sheet.players.slice(0, 2), rounds }, resolve), /3 or 4 players/);
  assert.throws(() => fromScoreSheet({ ...sheet, players: [...sheet.players.slice(0, 3), { id: "p_9" }] }, resolve), /Unknown player/);
  assert.throws(() => fromScoreSheet({ ...sheet, rounds: [{ ...rounds[0], gameTypeCode: "X" }] }, resolve), /Invalid round/);
  assert.throws(() => fromScoreSheet({ ...sheet, rounds: [{ ...rounds[0], scores: { p_1: "a" } }] }, resolve), /scores/);
});

test("old ჩაწერა rows import with online names, keeping unlinked players by name", () => {
  const result = { id: "r1", played_at: "2026-04-08T21:58:00.123456+00:00", winner_name: "ცავ",
    participants: [{ name: "რევ", score: -5 }, { name: "ცავ", score: 45 }, { name: "საბა", score: -40 }] };
  const detail = { played_at: "2026-04-08T21:58:01.000000+00:00",
    players: [{ id: "u1", name: "რეგ" }, { id: "u2", name: "ცავ" }, { id: "u3", name: "საბა" }],   // pre-rename name
    rounds: [{ leaderPlayerId: "u2", gameTypeCode: "K", countsByPlayerId: null, singleTargetPlayerId: "u3",
               scores: { u1: 0, u2: 0, u3: -40 } }] };
  const linked = { "რევ": { id: "p_r", name: "Revia" }, "ცავ": { id: "p_c", name: "Cavkusha" } };
  const row = fromLegacyRows(result, detail, (n) => linked[n] || null);
  assert.deepEqual(row.payload.players.map((p) => [p.name, p.profileId]), [["Revia", "p_r"], ["Cavkusha", "p_c"], ["საბა", null]]);
  const back = liveGameToLegacy(asServed(row));
  assert.equal(back.result.winner_name, "Cavkusha");
  assert.equal(back.detail.played_at, detail.played_at);
  assert.deepEqual(back.detail.players, [{ id: "p_r", name: "Revia" }, { id: "p_c", name: "Cavkusha" }, { id: "guest:საბა", name: "საბა" }]);
  assert.equal(back.detail.rounds[0].singleTargetPlayerId, "guest:საბა");
});

test("King Online games read as ჩაწერა rows with the same player ids", () => {
  const game = { id: "g1", playedAt: "2026-10-10T19:46:39.000Z", winners: [{ seat: 2, name: "Gio", score: 64 }],
    players: [{ seat: 0, name: "Ana", score: 46 }, { seat: 1, name: "Beka", score: -110 }, { seat: 2, name: "Gio", score: 64 }],
    roundDetails: [
      { round: 1, gameType: "H", leaderSeat: 0, scores: { 0: -5, 1: -35, 2: 0 }, heartsTaken: { 0: 1, 1: 7, 2: 0 } },
      { round: 2, gameType: "L2", leaderSeat: 1, scores: { 0: 0, 1: -20, 2: -20 }, trickWinners: [0, 2, 1, 2] },
      { round: 3, gameType: "K", leaderSeat: 2, scores: { 0: -40, 1: 0, 2: 0 }, kingOfHeartsTakenBy: 0 },
    ] };
  const { result, detail } = onlineGameToLegacy(game, (name) => [...profiles.values()].find((p) => p.name === name)?.id ?? `guest:${name}`);
  assert.equal(result.winner_name, "Gio");
  assert.deepEqual(detail.rounds[0].countsByPlayerId, { p_1: 1, p_2: 7, p_3: 0 });
  assert.deepEqual(detail.rounds[1].countsByPlayerId, { p_1: 0, p_2: 1, p_3: 1 });
  assert.equal(detail.rounds[2].singleTargetPlayerId, "p_1");
  assert.equal(detail.rounds[2].leaderPlayerId, "p_3");
});
