import test from "node:test";
import assert from "node:assert/strict";
import {
  resultOf,
  recentForm,
  streaksOf,
  comparePlayers,
  allTimeRecords,
  buildTrioStats,
} from "../src/online/lib/playerStats.js";

let day = 0;
// A finished game: scores by name, winners = every top score (ties shared).
const game = (scores, extra = {}) => {
  const players = Object.entries(scores).map(([name, score], seat) => ({ name, score, seat }));
  const top = Math.max(...players.map((p) => p.score));
  return {
    id: `g${++day}`,
    playedAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
    type: "online",
    players,
    winners: players.filter((p) => p.score === top).map(({ name, score }) => ({ name, score })),
    roundDetails: [],
    ...extra,
  };
};

test("results read W, D on a shared win, L otherwise", () => {
  const g = game({ A: 50, B: 50, C: 10 });
  assert.equal(resultOf(g, "A"), "D");
  assert.equal(resultOf(g, "C"), "L");
  assert.equal(resultOf(g, "Z"), null);
  assert.equal(resultOf(game({ A: 9, B: 1 }), "A"), "W");
});

test("form is newest first, with the table sorted by score", () => {
  const games = [game({ A: 1, B: 9 }), game({ A: 9, B: 1 }), game({ B: 5, C: 2 })];
  const form = recentForm(games, "A", 5);
  assert.deepEqual(form.map((f) => f.result), ["W", "L"]);
  assert.deepEqual(form[1].players.map((p) => p.name), ["B", "A"]);
  assert.equal(recentForm(games, "B", 1).length, 1);
});

test("streaks track the current run and the longest win and loss runs", () => {
  const games = [
    game({ A: 9, B: 1 }),
    game({ A: 9, B: 9 }),
    game({ A: 9, B: 1 }),
    game({ A: 1, B: 9 }),
    game({ A: 1, B: 9 }),
  ];
  const s = streaksOf(games, "A");
  assert.deepEqual(s.current, { result: "L", length: 2 });
  assert.equal(s.longestWin, 3);
  assert.equal(s.longestLoss, 2);
});

test("comparison counts shared games, finishing ahead and the live split", () => {
  const games = [
    game({ A: 30, B: 20, C: 10 }),
    game({ A: 10, B: 40, C: 0 }, { type: "live" }),
    game({ A: 5, C: 50 }),
  ];
  const cmp = comparePlayers(games, ["A", "B"]);
  assert.equal(cmp.shared.length, 2);
  assert.equal(cmp.live, 1);
  assert.equal(cmp.online, 1);
  assert.equal(cmp.ahead.A.B, 1);
  assert.equal(cmp.ahead.B.A, 1);
  const a = cmp.rows.find((r) => r.name === "A");
  assert.equal(a.games, 2);
  assert.equal(a.wins, 1);
  assert.equal(a.avg, 20);
  assert.equal(a.avgPlace, 1.5);
  assert.equal(comparePlayers(games, ["A", "B"], { scope: "all" }).rows[0].games, 3);
});

test("records find the extremes and skip removed players", () => {
  const games = [
    game({ A: 80, B: 10 }, { durationSeconds: 3600 }),
    game({ A: 30, B: 28 }),
    game({ A: 10, B: -60 }),
    game({ A: 200, Gone: -5 }),
  ];
  games[3].players[1].profileId = null;
  games[3].players[0].profileId = null;
  games[1].roundDetails = [{ gameType: "P1", scores: { 0: 8, 1: 64 } }];
  const r = allTimeRecords(games);
  assert.equal(r.highScore.value, 80);
  assert.equal(r.lowScore.name, "B");
  assert.equal(r.biggestMargin.value, 70);
  assert.equal(r.closestFinish.value, 2);
  assert.deepEqual([r.bestRound.name, r.bestRound.value, r.bestRound.gameType], ["B", 64, "P1"]);
  assert.equal(r.longestStreak.name, "A");
  assert.equal(r.longestStreak.value, 3);
  assert.equal(r.longestGame.value, 3600);
});

test("club achievement stats: holders, rates, firsts and collectors", async () => {
  const { clubAchievementStats, rarityOf } = await import("../src/online/utils/achievements.js");
  const games = [];
  for (let i = 0; i < 16; i++) {
    // A wins the first 5 in a row, B the other 11; C never wins.
    const aWins = i < 5;
    const g = game(aWins ? { A: 50, B: 10, C: 0 } : { A: 0, B: 50, C: 10 });
    games.push(g);
  }
  const stats = clubAchievementStats(games, ["A", "B", "C"], { minGames: 10 });
  const streak5 = stats.badges.find((b) => b.code === "WIN_STREAK_5");
  assert.deepEqual(streak5.holders.map((h) => h.name).sort(), ["A", "B"]);
  assert.equal(streak5.first.name, "A");
  assert.equal(streak5.first.first, games[4].playedAt);
  assert.equal(streak5.latest.name, "B");
  // No rounds recorded, so no per-game badges.
  assert.equal(stats.badges.find((b) => b.code === "NEVER_BELOW_ZERO").holders.length, 0);
  // B adds WINS_10, WIN_STREAK_10 and STREAK_BREAKER (ending A's five in a
  // row) to the two streak badges both hold.
  assert.deepEqual(stats.collectors.map((c) => [c.name, c.unique]), [["B", 5], ["A", 2], ["C", 0]]);
  const breaker = stats.badges.find((b) => b.code === "STREAK_BREAKER");
  assert.deepEqual(breaker.holders.map((h) => [h.name, h.count]), [["B", 1]]);
  // Not a per-game badge, so no "share of games" rate.
  assert.equal(breaker.perGame, false);
  assert.equal(breaker.bestRate, null);
  assert.equal(stats.badges.find((b) => b.code === "GAMES_50").rarity.id, "unclaimed");
  assert.equal(rarityOf(0.08).id, "legendary");
  assert.equal(stats.rarest.code, "STREAK_BREAKER");
  assert.equal(stats.latest.name, "B");
});

test("trios count each three who shared a table, their wins and the newest game first", () => {
  const first = game({ A: 9, B: 1, C: 1 });
  const tie = game({ A: 5, B: 5, C: 1 });
  const fourth = game({ A: 1, B: 2, C: 3, D: 9 });
  const pair = game({ A: 9, B: 1 });
  const trios = buildTrioStats([first, tie, fourth, pair]);
  // ABC from all three games; ABD, ACD and BCD from the four-player one.
  assert.equal(trios.length, 4);
  const abc = trios.find((t) => t.names.join("") === "ABC");
  assert.deepEqual(abc.games.map((g) => g.id), [fourth.id, tie.id, first.id]);
  assert.deepEqual(abc.wins, { A: 2, B: 1, C: 0 });
  assert.equal(abc.otherWins, 1);
  const abd = trios.find((t) => t.names.join("") === "ABD");
  assert.deepEqual(abd.wins, { A: 0, B: 0, D: 1 });
  assert.equal(abd.otherWins, 0);
});

test("trios leave out players taken off the list", () => {
  const g = game({ A: 9, B: 1, C: 1 });
  g.players[2].profileId = null;
  assert.equal(buildTrioStats([g]).length, 0);
});
