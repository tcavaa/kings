// The game logic King Online, ჩაწერა and the game server share: the game
// types and their scoring, achievements, win probability, totals, winners
// and season tables. Each lives once (shared/, server/game/gameTypes.js,
// server/games/results.js); these tests also check that both apps' thin
// wrappers give the same answers for the same game.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { perGameAchievements, lifetimeAchievements, defineAchievements, countCodes, ACHIEVEMENTS } from "../shared/achievements.js";
import { winProbabilities, remainingSwing } from "../shared/winProbability.js";
import { totalsOf, runningTotals } from "../shared/totals.js";
import { formatDuration } from "../shared/duration.js";
import * as onlineAch from "../src/online/utils/achievements.js";
import * as scoreAch from "../src/score/utils/achievements.js";
import { onlineGameToLegacy } from "../src/score/lib/gameShapes.js";
import { GAME_TYPES as ONLINE_TYPES } from "../src/online/constants/gameTypes.js";
import { GAME_TYPES as SCORE_TYPES } from "../src/score/constants/gameTypes.js";

const require = createRequire(import.meta.url);
const { GAME_TYPE_CODES, roundScores, unitCountsOf, gameTypeRule, lastTwoWinners } = require("../server/game/gameTypes.js");
const { calculate } = require("../server/game/ScoreCalculator.js");
const { GAME_TYPES: SERVER_TYPES, ALL_TYPE_CODES } = require("../server/game/constants.js");
const { winnerNames, emptyRoundStats, addRoundStats, inSeason, seasonTable, playerStandings, championOf } = require("../server/games/results.js");

// ── game types ────────────────────────────────────────────────────────────

test("one game-type table: both apps and the server read the same rules", () => {
  assert.deepEqual(GAME_TYPE_CODES, ["K", "Q", "J", "H", "L2", "T", "P1", "P2", "P3"]);
  assert.deepEqual(ALL_TYPE_CODES, GAME_TYPE_CODES);
  for (const types of [ONLINE_TYPES, SCORE_TYPES]) {
    assert.deepEqual(types.map((t) => t.code), GAME_TYPE_CODES);
    for (const t of types) {
      const rule = gameTypeRule(t.code);
      assert.equal(t.kind, rule.kind);
      assert.equal(t.totalUnits, rule.totalUnits);
      assert.equal(t.pointsPerUnit, rule.pointsPerUnit);
    }
  }
  // Each app keeps its own wording.
  assert.equal(ONLINE_TYPES[0].name, "კინგი");
  assert.equal(SCORE_TYPES[0].label, "K — No King of hearts");
  // The server's positiveScoring flag (tournament tiebreak) comes from the rules.
  assert.deepEqual(GAME_TYPE_CODES.filter((c) => SERVER_TYPES[c].positiveScoring), ["P1", "P2", "P3"]);
});

test("a round scores the same for seats and for player ids", () => {
  assert.deepEqual(roundScores("K", [0, 1, 2], { target: 1 }), { 0: 0, 1: -40, 2: 0 });
  assert.deepEqual(roundScores("K", ["a", "b", "c"], { target: null }), { a: 0, b: 0, c: 0 });
  assert.deepEqual(roundScores("H", ["a", "b"], { counts: { a: 3, b: 5 } }), { a: -15, b: -25 });
  assert.deepEqual(roundScores("P2", [0, 1, 2], { counts: { 0: 10 } }), { 0: 80, 1: 0, 2: 0 });
  // Taking none of a penalty is a plain 0, not -0.
  assert.ok(Object.is(roundScores("Q", [0], { counts: { 0: 0 } })[0], 0));
  assert.deepEqual(roundScores("??", [0, 1], {}), { 0: 0, 1: 0 });
});

test("a round's own units come from its own King Online field", () => {
  const d = { queensTaken: { 0: 4 }, jacksTaken: { 1: 4 }, heartsTaken: { 2: 8 }, tricksTaken: { 0: 6, 1: 4 },
    trickWinners: [0, 1, 0, 1, 0, 0, 1, 0, 2, 2], kingOfHeartsTakenBy: 1 };
  assert.deepEqual(unitCountsOf({ ...d, gameType: "Q" }), { 0: 4 });
  assert.deepEqual(unitCountsOf({ ...d, gameType: "J" }), { 1: 4 });
  assert.deepEqual(unitCountsOf({ ...d, gameType: "H" }), { 2: 8 });
  assert.deepEqual(unitCountsOf({ ...d, gameType: "P1" }), { 0: 6, 1: 4 });
  assert.deepEqual(unitCountsOf({ ...d, gameType: "L2" }), { 2: 2 });
  assert.equal(unitCountsOf({ ...d, gameType: "L2", trickWinners: [1] }), null);
  assert.equal(unitCountsOf({ ...d, gameType: "K" }), null);
  assert.equal(unitCountsOf({ gameType: "T" }), null);
  assert.deepEqual(lastTwoWinners({ 2: 2 }), [2, 2]);
});

test("the game server scores a played round by the shared rules", () => {
  const d = { tricksTaken: { 0: 3, 1: 3, 2: 4 }, queensTaken: { 0: 1, 1: 0, 2: 3 }, jacksTaken: { 0: 2, 1: 2, 2: 0 },
    heartsTaken: { 0: 0, 1: 5, 2: 3 }, kingOfHeartsTakenBy: 2, trickWinners: [0, 1, 2, 2, 0, 1, 0, 1, 2, 2] };
  assert.deepEqual(calculate("K", d), { 0: 0, 1: 0, 2: -40 });
  assert.deepEqual(calculate("Q", d), { 0: -10, 1: 0, 2: -30 });
  assert.deepEqual(calculate("J", d), { 0: -20, 1: -20, 2: 0 });
  assert.deepEqual(calculate("H", d), { 0: 0, 1: -25, 2: -15 });
  assert.deepEqual(calculate("L2", d), { 0: 0, 1: 0, 2: -40 });
  assert.deepEqual(calculate("T", d), { 0: -12, 1: -12, 2: -16 });
  assert.deepEqual(calculate("P3", d), { 0: 24, 1: 24, 2: 32 });
});

test("a quit round costs or splits the type's full total", () => {
  const GameState = require("../server/game/GameState.js");
  const quit = (code, seat) => {
    const gs = new GameState();
    gs.selectGameType(gs.leaderSeat, code);
    if (gs.phase === "trump_selection") gs.selectTrump(gs.leaderSeat, "S");
    assert.equal(gs.endRoundEarly(seat).ok, true);
    return gs.roundDetails.at(-1).scores;
  };
  assert.deepEqual(quit("H", 2), { 0: 0, 1: 0, 2: -40 });
  assert.deepEqual(quit("L2", 0), { 0: -40, 1: 0, 2: 0 });
  assert.deepEqual(quit("P2", 1), { 0: 40, 1: 0, 2: 40 });
});

// ── achievements ──────────────────────────────────────────────────────────

// A King Online game: seat 0 leads every penalty type and takes nothing in
// them, takes 10/10 in every Plus round and wins by a mile.
function onlineGame() {
  const rounds = [];
  const seats = [0, 1, 2];
  const add = (gameType, leaderSeat, fields) => {
    const d = { round: rounds.length + 1, gameType, leaderSeat, tricksTaken: {}, queensTaken: {}, jacksTaken: {},
      heartsTaken: {}, kingOfHeartsTakenBy: null, trickWinners: [], ...fields };
    d.scores = calculate(gameType, d);
    rounds.push(d);
  };
  for (const leader of seats) {
    add("K", leader, { kingOfHeartsTakenBy: leader === 0 ? 1 : leader });
    add("Q", leader, { queensTaken: { 1: 2, 2: 2 } });
    add("J", leader, { jacksTaken: { 1: 4 } });
    add("H", leader, { heartsTaken: { 1: 4, 2: 4 } });
    add("L2", leader, { trickWinners: [0, 0, 1, 1, 2, 2, 0, 0, 1, 2] });
    add("T", leader, { tricksTaken: { 1: 5, 2: 5 } });
    add("P1", leader, { tricksTaken: { 0: 10 } });
    add("P2", leader, { tricksTaken: { 0: 10 } });
    add("P3", leader, { tricksTaken: { 0: 10 } });
  }
  const totals = totalsOf(seats, rounds);
  const players = seats.map((seat) => ({ seat, name: ["Ana", "Beka", "Gio"][seat], score: totals[seat] }));
  const winners = [{ seat: 0, name: "Ana", score: totals[0] }];
  return { id: "g1", playedAt: "2026-01-01T10:00:00Z", type: "online", winner: winners[0], winners, players, roundDetails: rounds };
}

test("per-game achievements: perfection, clean leading, never below zero, runaway", () => {
  const g = onlineGame();
  const bySeat = onlineAch.computePerGameAchievements(g.players, g.roundDetails);
  assert.deepEqual(countCodes(bySeat[0]), {
    PERFECT_PLUS: 9, PLUS_PERFECTIONIST: 1, UNTOUCHABLE: 1, NEVER_BELOW_ZERO: 1, RUNAWAY_WIN: 1,
  });
  assert.deepEqual(bySeat[1], []);
  assert.deepEqual(bySeat[2], []);
});

test("ჩაწერა and King Online give the same achievements for the same game", () => {
  const g = onlineGame();
  const idOfName = (name) => `p_${name}`;
  const { result, detail } = onlineGameToLegacy(g, idOfName);
  const online = onlineAch.computePerGameAchievements(g.players, g.roundDetails);
  const score = scoreAch.computePerGameAchievements(detail.players, detail.rounds);
  for (const p of g.players) assert.deepEqual(score[idOfName(p.name)], online[p.seat]);
  const games = [g, { ...g, id: "g2", playedAt: "2026-01-02T10:00:00Z" }, { ...g, id: "g3", playedAt: "2026-01-03T10:00:00Z" }];
  const rows = games.map((x) => onlineGameToLegacy(x, idOfName));
  assert.deepEqual(
    scoreAch.computeAllLifetimeAchievements(rows.map((r) => r.detail), rows.map((r) => r.result)),
    onlineAch.computeAllLifetimeAchievements(games),
  );
  assert.equal(result.winner_name, "Ana");
});

test("ties: every tied winner can be an underdog, nobody gets a runaway", () => {
  const r = (code, scores, extra = {}) => ({ code, leader: null, scores, counts: null, target: null, ...extra });
  const rounds = [
    r("T", { a: -40, b: 0, c: 0 }),
    r("Q", { a: 0, b: -40, c: 0 }),
    r("P1", { a: 40, b: 40, c: -0 }),
  ];
  // a and b both finish on 0, c on 0 too → a three-way tie, no "others".
  assert.deepEqual(perGameAchievements(["a", "b", "c"], rounds), { a: [], b: [], c: ["NEVER_BELOW_ZERO"] });
  // a and b sit last for two rounds, c for one, then a and b tie 160 clear.
  const two = [r("T", { a: -40, b: -40, c: 0 }), r("Q", { a: 0, b: 0, c: 0 }), r("P1", { a: 200, b: 200, c: 0 })];
  const out = perGameAchievements(["a", "b", "c"], two);
  assert.ok(out.a.includes("UNDERDOG") && out.b.includes("UNDERDOG"));
  assert.ok(!out.a.includes("RUNAWAY_WIN") && !out.b.includes("RUNAWAY_WIN"));
  // A round without its counts (bad data) doesn't count as led clean.
  const bad = perGameAchievements(["a"], [r("Q", { a: 0 }, { leader: "a" })]);
  assert.deepEqual(bad, { a: ["NEVER_BELOW_ZERO"] });
});

test("lifetime milestones, tie-aware wins and the longest streak", () => {
  const games = [];
  for (let i = 0; i < 50; i++) {
    games.push({
      playedAt: new Date(Date.UTC(2026, 0, 1, i)).toISOString(),
      players: [{ key: 0, name: "Ana" }, { key: 1, name: "Beka" }],
      // Ana wins 10 in a row, then they tie every game after the 40th.
      winners: i < 10 ? ["Ana"] : i < 40 ? ["Beka"] : ["Ana", "Beka"],
      rounds: [],
    });
  }
  const out = lifetimeAchievements(games.reverse()); // order given doesn't matter
  assert.deepEqual(out.Ana, { GAMES_50: 1, WINS_10: 1, WIN_STREAK_3: 1, WIN_STREAK_5: 1, WIN_STREAK_10: 1 });
  assert.deepEqual(out.Beka, { GAMES_50: 1, WINS_10: 1, WINS_25: 1, WIN_STREAK_3: 1, WIN_STREAK_5: 1, WIN_STREAK_10: 1 });
});

test("each app labels every achievement, in one order", () => {
  const codes = ACHIEVEMENTS.map((a) => a.code);
  assert.deepEqual(Object.keys(onlineAch.ACHIEVEMENT_DEFS), codes);
  assert.deepEqual(Object.keys(scoreAch.ACHIEVEMENT_DEFS), codes);
  assert.equal(onlineAch.ACHIEVEMENT_DEFS.GAMES_50.label, "ერთგული");
  assert.equal(scoreAch.ACHIEVEMENT_DEFS.GAMES_50.label, "Dedicated");
  assert.equal(scoreAch.ACHIEVEMENT_DEFS.GAMES_50.repeatable, false);
  assert.throws(() => defineAchievements({ PERFECT_PLUS: { label: "x" } }), /No label/);
});

// ── win probability ───────────────────────────────────────────────────────

test("win probability: the remaining swing and the bars", () => {
  // A whole 3-player game: 3 × (40 + 40 + 40 + 40 + 40 + 40) lost, 3 × 3 × 80 gained.
  assert.deepEqual(remainingSwing([], 3), { maxGain: 720, maxLoss: 720, swing: 1440 });
  assert.deepEqual(winProbabilities([0, 0, 0], []).map((p) => p.toFixed(4)), ["0.3333", "0.3333", "0.3333"]);
  const lead = winProbabilities([100, 0, 0], ["K", "Q"]);
  assert.ok(lead[0] > lead[1] && lead[1] === lead[2]);
  assert.ok(Math.abs(lead.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  // Every round played: the leaders have it.
  const all = GAME_TYPE_CODES.flatMap((c) => [c, c, c]);
  assert.deepEqual(winProbabilities([10, 10, -20], all), [1, 1, 0]);
  assert.deepEqual(winProbabilities([], []), []);
});

// ── totals and clocks ─────────────────────────────────────────────────────

test("running totals tolerate missing rounds and scores", () => {
  const rounds = [{ scores: { 0: -10, 1: 5 } }, null, { scores: { 0: "x", 1: 3 } }];
  assert.deepEqual(totalsOf([0, 1], rounds), { 0: -10, 1: 8 });
  assert.deepEqual(runningTotals([0, 1], rounds), [{ 0: -10, 1: 5 }, { 0: -10, 1: 5 }, { 0: -10, 1: 8 }]);
});

test("game clocks", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3725), "1:02:05");
  assert.equal(formatDuration(-3), "0:00");
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(NaN), null);
});

// ── results: winners, per-round stats, seasons ────────────────────────────

test("winner names read ties, old single winners and store rows", () => {
  assert.deepEqual(winnerNames({ winners: [{ name: "A" }, { name: "B" }], winner: { name: "A" } }), ["A", "B"]);
  assert.deepEqual(winnerNames({ winners: [], winner: { name: "A" } }), ["A"]);
  assert.deepEqual(winnerNames({ winners: null, winner_name: "Tom & Jerry" }), ["Tom & Jerry"]);
  assert.deepEqual(winnerNames(null), []);
});

test("a round adds its stats only for its own type", () => {
  const t = emptyRoundStats();
  const base = { leaderSeat: 1, tricksTaken: { 1: 3 }, queensTaken: { 1: 2 }, jacksTaken: { 1: 1 }, heartsTaken: { 1: 4 }, kingOfHeartsTakenBy: 1 };
  addRoundStats(t, { ...base, gameType: "Q" }, 1);
  addRoundStats(t, { ...base, gameType: "K" }, 1);
  addRoundStats(t, { ...base, gameType: "T", leaderSeat: 0 }, 1);
  assert.deepEqual(t, { roundsLed: 2, totalTricks: 9, queens: 2, jacks: 0, hearts: 0, kingsOfHearts: 1 });
});

test("seasons: after the start, up to the end; ties share; champion", () => {
  const g = (playedAt, winners, players, type = "live") => ({ playedAt, type, winners, players });
  const games = [
    g("2026-01-01T00:00:00Z", ["Ana"], [{ name: "Ana", score: 9 }]),                  // = start: not counted
    g("2026-01-02T00:00:00Z", ["Ana", "Beka"], [{ name: "Ana", score: 5 }, { name: "Beka", score: 5 }]),
    g("2026-01-03T00:00:00Z", ["Beka"], [{ name: "Beka", score: 9 }, { name: "Gone", score: -9 }], "online"),
    g("2026-01-31T00:00:00Z", ["Ana"], [{ name: "Ana", score: 1 }]),                   // = end: counted
    g("2026-02-01T00:00:00Z", ["Gio"], [{ name: "Gio", score: 1 }]),                   // after the end
  ];
  assert.equal(inSeason("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"), false);
  assert.equal(inSeason(Date.parse("2026-01-31T00:00:00Z"), new Date("2026-01-01"), "2026-01-31T00:00:00Z"), true);
  assert.equal(inSeason("2020-01-01T00:00:00Z", null), true);
  const table = seasonTable(games, "2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z");
  assert.deepEqual(table.map((r) => [r.name, r.wins, r.liveWins, r.onlineWins, r.games, r.totalScore]), [
    ["Ana", 2, 2, 0, 2, 6], ["Beka", 2, 1, 1, 2, 14], ["Gone", 0, 0, 0, 1, -9],
  ]);
  assert.equal(championOf(table), "Ana & Beka");
  assert.equal(championOf([]), null);
  assert.equal(playerStandings(games).length, 4);
});

test("a season's champions are a list, so a tie never splits a name", async () => {
  const { championsOf, championOf } = require("../server/games/results.js");
  const table = [{ name: "Tom & Jerry", wins: 3 }, { name: "Ana", wins: 3 }, { name: "Gio", wins: 1 }];
  assert.deepEqual(championsOf(table), ["Ana", "Tom & Jerry"]);
  assert.equal(championOf(table), "Ana & Tom & Jerry");
  assert.deepEqual(championsOf([]), []);
  const { isChampionName } = await import("../src/score/utils/winners.js");
  assert.equal(isChampionName(["Ana", "Tom & Jerry"], "Tom & Jerry"), true);
  assert.equal(isChampionName(["Ana", "Tom & Jerry"], "Tom"), false);
});

test("penalty cards are K♥ in King, queens, jacks and hearts — none in the trick rounds", () => {
  const { isPenaltyCard } = require("../server/game/gameTypes.js");
  const c = (rank, suit) => ({ rank, suit });
  assert.equal(isPenaltyCard("K", c("K", "H")), true);
  assert.equal(isPenaltyCard("K", c("K", "S")), false);
  assert.equal(isPenaltyCard("Q", c("Q", "D")), true);
  assert.equal(isPenaltyCard("J", c("J", "C")), true);
  assert.equal(isPenaltyCard("H", c("7", "H")), true);
  assert.equal(isPenaltyCard("H", c("7", "S")), false);
  for (const code of ["T", "L2", "P1", "P2", "P3"]) assert.equal(isPenaltyCard(code, c("Q", "H")), false);
});
