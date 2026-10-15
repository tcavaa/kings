// ჩაწერა's client-side rules: round entry, the sheet reducer, season
// standings and how saved games map back to players.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCount, validateRound, totalsByPlayer, cumulativeTotals } from "../src/score/utils/rounds.js";
import { sheetReducer, EMPTY_SHEET } from "../src/score/lib/sheetReducer.js";
import { seasonStandings } from "../src/score/utils/seasonStandings.js";
import { liveGameToLegacy } from "../src/score/lib/gameShapes.js";
import { isWinnerOf, winnerNamesOf } from "../src/score/utils/winners.js";
import { GAME_TYPES } from "../src/score/constants/gameTypes.js";

const Q = GAME_TYPES.find((t) => t.code === "Q");
const K = GAME_TYPES.find((t) => t.code === "K");
const players = [{ id: "a", name: "Ana" }, { id: "b", name: "Beka" }, { id: "c", name: "Gio" }];

test("card counts are whole numbers, and every count is checked", () => {
  assert.equal(normalizeCount("2.5"), 2);
  assert.equal(normalizeCount("-3"), 0);
  assert.equal(normalizeCount(""), 0);
  assert.equal(normalizeCount("abc"), 0);
  assert.equal(validateRound(Q, { a: 1.5, b: 2.5 }), "კარტების რაოდენობა მთელი რიცხვი უნდა იყოს");
  assert.match(validateRound(Q, { a: 1, b: 2 }), /დამები: მოთამაშეებს ზუსტად 4/);
  assert.equal(validateRound(Q, { a: 1, b: 3 }), "");
  assert.equal(validateRound(K, {}, null), "აირჩიე, ვინ აიღო");
  assert.equal(validateRound(K, {}, "a"), "");
  assert.equal(validateRound(null), "აირჩიე თამაში");
});

test("totals survive malformed rounds from another phone", () => {
  const rounds = [{ scores: { a: -10, b: -30 } }, null, { scores: null }, { scores: { a: "x", c: 8 } }];
  assert.deepEqual(totalsByPlayer(players, rounds), { a: -10, b: -30, c: 8 });
  assert.deepEqual(cumulativeTotals(players, rounds).at(-1), { a: -10, b: -30, c: 8 });
  assert.deepEqual(cumulativeTotals(players, rounds)[0], { a: -10, b: -30, c: 0 });
});

test("the sheet reducer plays, edits and undoes rounds", () => {
  let s = sheetReducer(EMPTY_SHEET, { type: "START", players });
  assert.equal(s.rounds.length, 0);
  assert.ok(s.sheetId && s.startedAt);
  const round = { leaderPlayerId: "a", gameTypeCode: "K", singleTargetPlayerId: "b", countsByPlayerId: null, scores: { a: 0, b: -40, c: 0 } };
  s = sheetReducer(s, { type: "END_ROUND", round });
  assert.equal(s.activePlayerIndex, 1);
  s = sheetReducer(s, { type: "EDIT_LAST", round: { ...round, singleTargetPlayerId: "c", scores: { a: 0, b: 0, c: -40 } } });
  assert.equal(s.rounds[0].singleTargetPlayerId, "c");
  s = sheetReducer(s, { type: "UNDO_LAST" });
  assert.equal(s.rounds.length, 0);
  assert.equal(s.activePlayerIndex, 0);
  assert.deepEqual(sheetReducer(s, { type: "RESET" }), EMPTY_SHEET);
});

test("entering the final round stops the clock, and undoing it starts it again", () => {
  let s = sheetReducer(EMPTY_SHEET, { type: "START", players });
  const round = { leaderPlayerId: "a", gameTypeCode: "K", singleTargetPlayerId: "b", countsByPlayerId: null, scores: { a: 0, b: -40, c: 0 } };
  for (let i = 0; i < players.length * GAME_TYPES.length; i++) s = sheetReducer(s, { type: "END_ROUND", round });
  assert.ok(s.endedAt);
  s = sheetReducer(s, { type: "UNDO_LAST" });
  assert.equal(s.endedAt, null);
});

test("season standings follow the champion rule: ties share, every game counts, after the start", () => {
  const results = [
    { type: "live", played_at: "2026-01-01T00:00:00Z", winners: ["Ana"], participants: [{ name: "Ana", score: 10 }] },  // = start: not counted
    { type: "live", played_at: "2026-01-02T00:00:00Z", winners: ["Ana", "Beka"], participants: [{ name: "Ana", score: 5 }, { name: "Beka", score: 5 }] },
    { type: "online", played_at: "2026-01-03T00:00:00Z", winners: ["Beka"], participants: [{ name: "Beka", score: 9 }, { name: "Gone", score: -9 }] },
    { type: "live", played_at: "2026-01-04T00:00:00Z", winners: ["Gone"], participants: [{ name: "Gone", score: 1 }] },  // no detail row, removed player
    { type: "live", played_at: "2026-02-01T00:00:00Z", winners: ["Ana"], participants: [{ name: "Ana", score: 1 }] },   // after the end
  ];
  const table = seasonStandings(results, "2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z");
  assert.deepEqual(table.map((r) => [r.name, r.wins, r.liveWins, r.onlineWins, r.games]), [
    ["Beka", 2, 1, 1, 2], ["Ana", 1, 1, 0, 1], ["Gone", 1, 1, 0, 2],
  ]);
});

test("a winner whose name contains ' & ' keeps their win", () => {
  const result = { winner_name: "Tom & Jerry", winners: ["Tom & Jerry"] };
  assert.deepEqual(winnerNamesOf(result), ["Tom & Jerry"]);
  assert.equal(isWinnerOf(result, "Tom"), false);
  assert.equal(isWinnerOf(result, "Tom & Jerry"), true);
});

test("a removed player's games resolve by name, not by their old profile id", () => {
  const game = {
    id: "g1", playedAt: "2026-01-02T00:00:00Z", winners: [{ seat: 0 }],
    players: [{ seat: 0, name: "Ana", score: 5, profileId: "p_ana" }, { seat: 1, name: "Old", score: -5, profileId: "p_old" },
      { seat: 2, name: "Gio", score: 0, profileId: "p_gio_deleted" }],
    roundDetails: [{ gameType: "K", leaderSeat: 1, targetSeat: 0, scores: { 0: -40, 1: 0, 2: 0 }, counts: null }],
  };
  const known = new Set(["p_ana", "p_gio_new"]);
  const idOfName = (name) => ({ Ana: "p_ana", Gio: "p_gio_new" }[name] ?? `guest:${name}`);
  const { result, detail } = liveGameToLegacy(game, { knownIds: known, idOfName });
  assert.deepEqual(detail.players.map((p) => p.id), ["p_ana", "guest:Old", "p_gio_new"]);
  assert.equal(detail.rounds[0].leaderPlayerId, "guest:Old");
  assert.deepEqual(result.winners, ["Ana"]);
});
