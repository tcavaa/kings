// ჩაწერა games in the shared games table: a score-sheet game becomes King
// Online's payload shape (server/games/scoreSheet.js) and turns back into
// ჩაწერა's own rows (src/score/lib/gameShapes.js) unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { liveGameToLegacy, onlineGameToLegacy } from "../src/score/lib/gameShapes.js";
import { GAME_TYPES } from "../src/score/constants/gameTypes.js";
import { computeScoresForRound } from "../src/score/utils/scoring.js";

const require = createRequire(import.meta.url);
const { fromScoreSheet, fromLegacyRows } = require("../server/games/scoreSheet.js");
// The store's own row → API shape, so a change there is caught here too.
const { rowToGame } = require("../server/db/store.js");

const profiles = new Map([
  ["p_1", { id: "p_1", name: "Ana" }],
  ["p_2", { id: "p_2", name: "Beka" }],
  ["p_3", { id: "p_3", name: "Gio" }],
  ["p_4", { id: "p_4", name: "Dato" }],
]);
const resolve = (id) => profiles.get(id) || null;

/** A round as ჩაწერა records it, scored by ჩაწერა's own code. */
function round(ids, leaderPlayerId, gameTypeCode, countsByPlayerId, singleTargetPlayerId = null) {
  const type = GAME_TYPES.find((t) => t.code === gameTypeCode);
  const players = ids.map((id) => ({ id }));
  return {
    leaderPlayerId, gameTypeCode, countsByPlayerId, singleTargetPlayerId,
    scores: computeScoresForRound(type, players, countsByPlayerId, singleTargetPlayerId),
  };
}

/**
 * A finished sheet: every player leads every type once. `first` rounds come
 * first; the rest send every penalty to `loser` and split the Pluses' ten
 * tricks between `split`.
 */
function fullSheet(ids, first, { loser, split }) {
  const rounds = [...first];
  const done = new Set(first.map((r) => `${r.leaderPlayerId}:${r.gameTypeCode}`));
  for (const leader of ids) {
    for (const type of GAME_TYPES) {
      if (done.has(`${leader}:${type.code}`)) continue;
      if (type.kind === "single") rounds.push(round(ids, leader, type.code, null, loser));
      else if (type.pointsPerUnit > 0) rounds.push(round(ids, leader, type.code, { [split[0]]: 5, [split[1]]: 5 }));
      else rounds.push(round(ids, leader, type.code, { [loser]: type.totalUnits }));
    }
  }
  return { players: ids.map((id) => ({ id })), rounds, durationSeconds: 1800 };
}

const ids = ["p_1", "p_2", "p_3", "p_4"];
const opening = [
  round(ids, "p_1", "K", null, "p_2"),
  round(ids, "p_2", "L2", { p_3: 1, p_4: 1 }),
  round(ids, "p_3", "P1", { p_1: 6, p_2: 0, p_3: 4 }),
];
const sheet = fullSheet(ids, opening, { loser: "p_4", split: ["p_1", "p_3"] });
const totals = ids.map((id) => sheet.rounds.reduce((sum, r) => sum + r.scores[id], 0));

// What the API serves for a stored row.
const asServed = (row) => rowToGame(
  { id: row.id, type: row.type, played_at: new Date("2026-10-12T18:00:00.000Z"),
    winner_name: row.winner.name, winner_seat: row.winner.seat, winner_score: row.winner.score,
    is_championship: row.isChampionship },
  { ok: true, value: row.payload },
);

test("a finished score sheet is stored the way King Online stores its games", () => {
  const row = fromScoreSheet(sheet, resolve);
  assert.equal(row.type, "live");
  assert.equal(row.payload.roundDetails.length, 36);
  assert.deepEqual(row.payload.players.map((p) => [p.seat, p.name, p.score, p.profileId]),
    [[0, "Ana", totals[0], "p_1"], [1, "Beka", totals[1], "p_2"], [2, "Gio", totals[2], "p_3"], [3, "Dato", totals[3], "p_4"]]);
  const best = Math.max(...totals);
  assert.deepEqual(row.payload.winners.map((w) => w.score), totals.filter((t) => t === best));
  const [k, l2, p1] = row.payload.roundDetails;
  assert.equal(k.kingOfHeartsTakenBy, 1);
  assert.deepEqual(l2.trickWinners, [2, 3]);
  assert.deepEqual(p1.tricksTaken, { 0: 6, 1: 0, 2: 4 });
  assert.deepEqual(p1.cumulativeScores, { 0: 48, 1: -40, 2: 12, 3: -20 });
  assert.equal(row.payload.durationSeconds, 1800);
});

test("ჩაწერა reads its own game back unchanged", () => {
  const served = asServed(fromScoreSheet(sheet, resolve));
  assert.equal(served.playedAt, "2026-10-12T18:00:00.000Z");
  const { result, detail } = liveGameToLegacy(served);
  assert.deepEqual(result.participants, ids.map((id, i) => ({ name: profiles.get(id).name, score: totals[i] })));
  assert.equal(result.duration_seconds, 1800);
  assert.deepEqual(detail.players, ids.map((id) => ({ id, name: profiles.get(id).name })));
  assert.deepEqual(detail.rounds, sheet.rounds.map(({ leaderPlayerId, gameTypeCode, countsByPlayerId, singleTargetPlayerId, scores }) =>
    ({ scores, gameTypeCode, leaderPlayerId, countsByPlayerId, singleTargetPlayerId })));
});

test("ties crown every top scorer", () => {
  const three = ["p_1", "p_2", "p_3"];
  const row = fromScoreSheet(fullSheet(three, [], { loser: "p_3", split: ["p_1", "p_2"] }), resolve);
  assert.equal(row.payload.isTie, true);
  assert.deepEqual(liveGameToLegacy(asServed(row)).result.winner_name, "Ana & Beka");
});

test("bad sheets are refused", () => {
  const withRound = (i, r) => ({ ...sheet, rounds: sheet.rounds.map((x, j) => (j === i ? r : x)) });
  assert.throws(() => fromScoreSheet({ ...sheet, players: sheet.players.slice(0, 2) }, resolve), /3 ან 4 მოთამაშე/);
  assert.throws(() => fromScoreSheet({ ...sheet, players: [...sheet.players.slice(0, 3), { id: "p_9" }] }, resolve), /უცნობი მოთამაშე/);
  assert.throws(() => fromScoreSheet(withRound(0, { ...opening[0], gameTypeCode: "X" }), resolve), /არასწორი რაუნდი/);
  assert.throws(() => fromScoreSheet(withRound(0, { ...opening[0], scores: { p_1: "a" } }), resolve), /არასწორი ქულები/);
});

test("only a finished sheet can be saved", () => {
  assert.throws(() => fromScoreSheet({ ...sheet, rounds: [] }, resolve), /არ დასრულებულა/);
  assert.throws(() => fromScoreSheet({ ...sheet, rounds: sheet.rounds.slice(0, 35) }, resolve), /არ დასრულებულა/);
});

test("a surrendered sheet saves early, and the highest score at that point wins", () => {
  const row = fromScoreSheet({ ...sheet, rounds: opening, surrenderedBy: "p_2" }, resolve);
  assert.equal(row.payload.roundDetails.length, 3);
  assert.equal(row.payload.surrenderedBySeat, 1);
  assert.deepEqual(row.payload.players.map((p) => p.score), [48, -40, 12, -20]);
  assert.deepEqual(row.payload.winners.map((w) => w.name), ["Ana"]);
  assert.equal(asServed(row).surrenderedBySeat, 1);
  // A finished game has no surrender in it.
  assert.equal(fromScoreSheet(sheet, resolve).payload.surrenderedBySeat, undefined);
});

test("a surrender needs a player of the game and a game in progress", () => {
  assert.throws(() => fromScoreSheet({ ...sheet, rounds: opening, surrenderedBy: "p_9" }, resolve), /დანებებული მოთამაშე/);
  assert.throws(() => fromScoreSheet({ ...sheet, rounds: [], surrenderedBy: "p_1" }, resolve), /დანებება შეიძლება/);
  assert.throws(() => fromScoreSheet({ ...sheet, surrenderedBy: "p_1" }, resolve), /დანებება შეიძლება/);
});

test("scores must be the ones the recorded cards give", () => {
  const forged = sheet.rounds.map((r, i) => (i === 0 ? { ...r, scores: { ...r.scores, p_1: 1000 } } : r));
  assert.throws(() => fromScoreSheet({ ...sheet, rounds: forged }, resolve), /არ ემთხვევა/);
  const short = sheet.rounds.map((r, i) => (i === 1 ? round(ids, "p_2", "L2", { p_3: 1 }) : r));
  assert.throws(() => fromScoreSheet({ ...sheet, rounds: short }, resolve), /კარტების რაოდენობა/);
  const noTarget = sheet.rounds.map((r, i) => (i === 0 ? { ...r, singleTargetPlayerId: null } : r));
  assert.throws(() => fromScoreSheet({ ...sheet, rounds: noTarget }, resolve), /ვინ აიღო/);
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

test("the sheet's own id is the game id, so a retried save stores one game", () => {
  const first = fromScoreSheet({ ...sheet, sheetId: "a1b2c3d4-e5f6" }, resolve);
  const retry = fromScoreSheet({ ...sheet, sheetId: "a1b2c3d4-e5f6" }, resolve);
  assert.equal(first.id, "sheet-a1b2c3d4-e5f6");
  assert.equal(retry.id, first.id);
  // A missing or malformed sheet id still saves, under a fresh id.
  assert.notEqual(fromScoreSheet(sheet, resolve).id, fromScoreSheet(sheet, resolve).id);
  assert.match(fromScoreSheet({ ...sheet, sheetId: "bad id!" }, resolve).id, /^[0-9a-f-]{36}$/);
});

test("a leader can't play the same game type twice", () => {
  const twice = sheet.rounds.map((r, i) => (i === sheet.rounds.length - 1 ? opening[0] : r));
  assert.throws(() => fromScoreSheet({ ...sheet, rounds: twice }, resolve), /ორჯერ აირჩია/);
});

test("a player removed while the sheet was open is saved by name", () => {
  const named = { ...sheet, players: sheet.players.map((p) => ({ ...p, name: p.id === "p_4" ? "Dato" : undefined })) };
  const resolveGone = (id, name) => (id === "p_4" ? { id: null, name } : profiles.get(id) || null);
  const row = fromScoreSheet(named, resolveGone);
  const dato = row.payload.players.find((p) => p.name === "Dato");
  assert.equal(dato.profileId, null);
  assert.equal(dato.score, totals[3]);
  // Without a name to fall back on it's still refused.
  assert.throws(() => fromScoreSheet(sheet, (id) => (id === "p_4" ? null : profiles.get(id))), /უცნობი მოთამაშე/);
});
