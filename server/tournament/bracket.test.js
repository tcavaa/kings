'use strict';

// Advancement rules for the tournament bracket. Pure functions, no sockets and
// no database — run with: node --test tournament/bracket.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  penaltyPoints, pickFinalists, seedTables, shuffle, VALID_SIZES,
} = require('./bracket');

const check = (name, cond, extra = '') => assert.ok(cond, `${name} ${extra}`);
const eq = (name, actual, expected) => assert.deepEqual(actual, expected, name);

/**
 * Build a finished-table record of the shape `reportResult` receives.
 * `spec` is [{ name, score, penalty }] in seat order; the top score(s) win,
 * mirroring how _finishGame derives its `winners` array.
 */
function table(tableIndex, spec) {
  const best = Math.max(...spec.map((p) => p.score));
  const finalScores = {};
  spec.forEach((p, seat) => { finalScores[seat] = p.score; });

  // One synthetic avoidance round ('T' is negative) carrying the requested
  // penalty, plus one positive round that must be ignored by penaltyPoints.
  const negScores = {}, posScores = {};
  spec.forEach((p, seat) => {
    negScores[seat] = p.penalty ?? 0;
    posScores[seat] = 999;            // must never influence the tiebreak
  });

  return {
    tableIndex,
    finalScores,
    players: spec.map((p, seat) => ({ name: p.name, seat, avatar: null })),
    winners: spec
      .map((p, seat) => ({ ...p, seat }))
      .filter((p) => p.score === best)
      .map((p) => ({ seat: p.seat, name: p.name, score: p.score })),
    roundDetails: [
      { gameType: 'T',  scores: negScores },
      { gameType: 'P1', scores: posScores },
    ],
  };
}

const names = (r) => r.finalists.map((f) => f.name);

test('penaltyPoints only counts avoidance rounds', () => {
  const rd = [
    { gameType: 'T',  scores: { 0: -12 } },   // negative → counts
    { gameType: 'K',  scores: { 0: -40 } },   // negative → counts
    { gameType: 'P2', scores: { 0: 64 } },    // positive → ignored
  ];
  eq('sums negative rounds, ignores positive', penaltyPoints(0, rd), -52);
  eq('missing seat is 0', penaltyPoints(2, rd), 0);
  eq('no rounds is 0', penaltyPoints(0, []), 0);
  eq('unknown game type ignored', penaltyPoints(0, [{ gameType: 'ZZ', scores: { 0: -5 } }]), 0);
});

test('6 players, no ties: 2 winners + best loser', () => {
  const r = pickFinalists([
    table(0, [{ name: 'A', score: 30 }, { name: 'B', score: 10 }, { name: 'C', score: -5 }]),
    table(1, [{ name: 'D', score: 20 }, { name: 'E', score: 15 }, { name: 'F', score: 0 }]),
  ]);
  eq('three finalists', r.finalists.length, 3);
  eq('winners then best loser', names(r), ['A', 'D', 'E']);
  check('E is flagged as the wildcard',
    r.standings.find((s) => s.name === 'E').wildcard === true);
  check('A is not a wildcard',
    r.standings.find((s) => s.name === 'A').wildcard === false);
});

test('a table winner is never displaced by a higher-scoring loser', () => {
  // B loses table 0 with 25 but out-scores table 1's winner D on 5.
  const r = pickFinalists([
    table(0, [{ name: 'A', score: 30 }, { name: 'B', score: 25 }, { name: 'C', score: -5 }]),
    table(1, [{ name: 'D', score: 5 }, { name: 'E', score: 2 }, { name: 'F', score: 0 }]),
  ]);
  eq('both winners seated, loser takes the wildcard', names(r), ['A', 'D', 'B']);
});

test('the specified double-tie case: 25/25 vs 5/5', () => {
  const r = pickFinalists([
    table(0, [{ name: 'A', score: 25, penalty: -30 }, { name: 'B', score: 25, penalty: -40 }, { name: 'C', score: -10 }]),
    table(1, [{ name: 'D', score: 5, penalty: -60 }, { name: 'E', score: 5, penalty: -20 }, { name: 'F', score: -30 }]),
  ]);
  eq('each table sends one (E on fewer penalties), then the second 25', names(r), ['A', 'E', 'B']);
  check('E beat D on fewer penalties',
    r.standings.find((s) => s.name === 'E').rank < r.standings.find((s) => s.name === 'D').rank);
  check('no wildcard — four winners filled the seats',
    r.finalists.every((f) => f.isWinner));
});

test('penalty tiebreak decides a straight two-way tie', () => {
  const r = pickFinalists([
    table(0, [{ name: 'A', score: 40 }, { name: 'B', score: 1 }, { name: 'C', score: 0 }]),
    table(1, [{ name: 'D', score: 10, penalty: -70 }, { name: 'E', score: 10, penalty: -10 }, { name: 'F', score: 3 }]),
  ]);
  eq('less-negative D/E ordering', names(r), ['A', 'E', 'D']);
});

test('9 players, no ties: the three winners', () => {
  const r = pickFinalists([
    table(0, [{ name: 'A', score: 30 }, { name: 'B', score: 10 }, { name: 'C', score: -5 }]),
    table(1, [{ name: 'D', score: 20 }, { name: 'E', score: 15 }, { name: 'F', score: 0 }]),
    table(2, [{ name: 'G', score: 12 }, { name: 'H', score: 11 }, { name: 'I', score: 1 }]),
  ]);
  eq('exactly the winners, ranked', names(r), ['A', 'D', 'G']);
  check('no wildcard in a 9-player bracket', r.finalists.every((f) => f.isWinner));
});

test('9 players with a tied table: every table still sends its winner', () => {
  const r = pickFinalists([
    table(0, [{ name: 'A', score: 30 }, { name: 'B', score: 5 }, { name: 'C', score: -5 }]),
    table(1, [{ name: 'D', score: 20, penalty: -50 }, { name: 'E', score: 20, penalty: -15 }, { name: 'F', score: 0 }]),
    table(2, [{ name: 'G', score: 12 }, { name: 'H', score: 11 }, { name: 'I', score: 1 }]),
  ]);
  eq('the drawn table goes to its less-penalised winner', names(r), ['A', 'E', 'G']);
  check('D lost the tiebreak at their own table',
    r.standings.find((s) => s.name === 'D').advanced === false);
});

test('9 players: a drawn table never knocks out a lower-scoring winner', () => {
  // Table 0 draws on 40 — both out-score table 2's winner on 2.
  const r = pickFinalists([
    table(0, [{ name: 'A', score: 40, penalty: -60 }, { name: 'B', score: 40, penalty: -20 }, { name: 'C', score: -5 }]),
    table(1, [{ name: 'D', score: 20 }, { name: 'E', score: 5 }, { name: 'F', score: 0 }]),
    table(2, [{ name: 'G', score: 2 }, { name: 'H', score: 1 }, { name: 'I', score: 0 }]),
  ]);
  eq('B, D and G', names(r), ['B', 'D', 'G']);
});

test('9 players: a three-way tied table sends one', () => {
  const r = pickFinalists([
    table(0, [{ name: 'A', score: 10, penalty: -30 }, { name: 'B', score: 10, penalty: -10 }, { name: 'C', score: 10, penalty: -20 }]),
    table(1, [{ name: 'D', score: 20 }, { name: 'E', score: 5 }, { name: 'F', score: 0 }]),
    table(2, [{ name: 'G', score: 2 }, { name: 'H', score: 1 }, { name: 'I', score: 0 }]),
  ]);
  eq('D, B (cleanest of the trio) and G', names(r), ['D', 'B', 'G']);
});

test('6 players: one drawn table sends both, the other its winner', () => {
  const r = pickFinalists([
    table(0, [{ name: 'A', score: 15 }, { name: 'B', score: 15 }, { name: 'C', score: -30 }]),
    table(1, [{ name: 'D', score: 40 }, { name: 'E', score: 35 }, { name: 'F', score: -75 }]),
  ]);
  eq('A, B and D — E misses out despite out-scoring both', names(r).sort(), ['A', 'B', 'D']);
  check('no wildcard', r.finalists.every((f) => f.isWinner));
});

test('a three-way tied table', () => {
  const r = pickFinalists([
    table(0, [{ name: 'A', score: 10, penalty: -10 }, { name: 'B', score: 10, penalty: -20 }, { name: 'C', score: 10, penalty: -30 }]),
    table(1, [{ name: 'D', score: 40 }, { name: 'E', score: 2 }, { name: 'F', score: 1 }]),
  ]);
  eq('D plus the two cleanest of the tied trio', names(r), ['D', 'A', 'B']);
  eq('still exactly three', r.finalists.length, 3);
});

test('determinism', () => {
  const build = () => [
    table(0, [{ name: 'A', score: 10, penalty: -5 }, { name: 'B', score: 10, penalty: -5 }, { name: 'C', score: 0 }]),
    table(1, [{ name: 'D', score: 10, penalty: -5 }, { name: 'E', score: 3 }, { name: 'F', score: 1 }]),
  ];
  // Identical score AND penalty across tables — the fallback must still settle it.
  const a = names(pickFinalists(build()));
  const b = names(pickFinalists(build()));
  eq('same inputs give the same bracket', a, b);
  eq('three finalists even when fully tied', a.length, 3);
});

test('seeding', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}` }));
  const nine = Array.from({ length: 9 }, (_, i) => ({ name: `P${i}` }));
  eq('6 players → 2 tables', seedTables(six).map((t) => t.length), [3, 3]);
  eq('9 players → 3 tables', seedTables(nine).map((t) => t.length), [3, 3, 3]);

  const seated = seedTables(nine).flat().map((p) => p.name).sort();
  eq('every entrant seated exactly once', seated, nine.map((p) => p.name).sort());

  for (const bad of [0, 1, 3, 5, 7, 8, 10, 12]) {
    const players = Array.from({ length: bad }, (_, i) => ({ name: `P${i}` }));
    let threw = false;
    try { seedTables(players); } catch { threw = true; }
    check(`${bad} players is rejected`, threw);
  }
  eq('valid sizes are 6 and 9', VALID_SIZES, [6, 9]);

  // Seeding must actually be random, not a fixed slice of the input order.
  const layouts = new Set();
  for (let i = 0; i < 200; i++) {
    layouts.add(seedTables(nine).map((t) => t.map((p) => p.name).join(',')).join('|'));
  }
  check('seeding is randomised', layouts.size > 5, `only ${layouts.size} distinct layouts`);

  // shuffle must not mutate its input.
  const src = [1, 2, 3, 4, 5];
  shuffle(src);
  eq('shuffle leaves the source untouched', src, [1, 2, 3, 4, 5]);
});
