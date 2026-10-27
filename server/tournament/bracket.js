'use strict';

const { GAME_TYPES } = require('../game/constants');
const { randomInt } = require('../lib/util');

// A tournament is always 3 semifinal tables at most, and the final always
// seats exactly 3. Everything below is derived from those two facts.
const FINAL_SEATS = 3;
const VALID_SIZES = [6, 9];

/**
 * Penalty points a seat accumulated across a finished game.
 *
 * Six of the nine King game types are avoidance rounds (K/Q/J/H/L2/T — flagged
 * `positiveScoring: false`); the other three pay +8 per trick. Summing only the
 * avoidance rounds gives "how much damage did this player take", which is the
 * agreed tiebreak: of two players on the same final score, the one who ate
 * fewer penalties played the tighter game.
 *
 * The result is <= 0, and LESS negative is better.
 */
function penaltyPoints(seat, roundDetails = []) {
  let total = 0;
  for (const d of roundDetails) {
    const type = GAME_TYPES[d?.gameType];
    if (!type || type.positiveScoring) continue;
    total += Number(d?.scores?.[seat]) || 0;
  }
  return total;
}

/**
 * Turn one finished semifinal table into ranked candidate records.
 *
 * `winners` comes straight from the game-over payload, which already treats a
 * shared top score as multiple winners — that's precisely the case the ranking
 * below has to resolve.
 */
function tableCandidates(table) {
  const winnerSeats = new Set((table.winners || []).map((w) => w.seat));
  return (table.players || []).map((p) => ({
    name: p.name,
    avatar: p.avatar || null,
    tableIndex: table.tableIndex,
    seat: p.seat,
    score: Number(table.finalScores?.[p.seat]) || 0,
    penalty: penaltyPoints(p.seat, table.roundDetails),
    isWinner: winnerSeats.has(p.seat),
  }));
}

/**
 * Rank two candidates. Higher score first; on a tie the player who took fewer
 * penalty points (less negative) goes ahead. The final fallback keeps the sort
 * deterministic so the same inputs always produce the same bracket — important
 * because a tournament restored after a restart (see TournamentManager.hydrateAll)
 * draws its final from the same recorded results.
 */
function compareCandidates(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.penalty !== a.penalty) return b.penalty - a.penalty;
  if (a.tableIndex !== b.tableIndex) return a.tableIndex - b.tableIndex;
  return a.seat - b.seat;
}

/**
 * Choose the three finalists from every finished semifinal table.
 *
 * Three tiers, each internally ranked:
 *   1. every table's winner — one seat per table, always
 *   2. the other co-winners of a drawn table
 *   3. everyone else
 *
 * Tier 1 is what makes "each table winner goes to the final" hold: a drawn
 * table settles its own winner by penalty points (less negative goes through)
 * and can never push another table's winner out, however low that winner
 * scored. In a 9-player bracket the three tables fill the final there and
 * then.
 *
 * In a 6-player bracket the third seat goes to a drawn table's other winner
 * when there is one ("a draw sends both"), otherwise to the best player who
 * didn't win their table — the wildcard. Winners always rank before
 * non-winners, so a strong runner-up can never bump a table's winner. With
 * both tables drawn (25/25 and 5/5) there are four winners for three seats:
 * each table sends one, and the last seat is decided by score then penalty
 * points — so the second 25 goes through.
 *
 * @returns {{ finalists: object[], standings: object[] }}
 */
function pickFinalists(tables = []) {
  const byTable = tables.map((t) => tableCandidates(t).sort(compareCandidates));
  // Sorted by score then penalty, so the first winner listed is the one who
  // wins the table's own tiebreak.
  const heads = byTable.map((list) => list.find((c) => c.isWinner) || list[0]).filter(Boolean);
  const coWinners = byTable.flatMap((list) => list.filter((c) => c.isWinner && !heads.includes(c)));
  const rest = byTable.flatMap((list) => list.filter((c) => !c.isWinner && !heads.includes(c)));

  const ordered = [
    ...heads.sort(compareCandidates),
    ...coWinners.sort(compareCandidates),
    ...rest.sort(compareCandidates),
  ];
  const finalists = ordered.slice(0, FINAL_SEATS);
  const finalistNames = new Set(finalists.map((f) => f.name));

  return {
    finalists,
    // Full ordering, so the bracket UI can show who just missed out and why.
    standings: ordered.map((c, i) => ({
      ...c,
      rank: i + 1,
      advanced: finalistNames.has(c.name),
      // True only for a seat that got in without winning its table.
      wildcard: finalistNames.has(c.name) && !c.isWinner,
    })),
  };
}

/**
 * Fisher-Yates, so seeding is genuinely uniform rather than sort-ish. Draws
 * from the secure generator unless a test passes its own `rand` ([0, 1)).
 */
function shuffle(list, rand = null) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand ? Math.floor(rand() * (i + 1)) : randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Randomly split entrants into tables of 3. 6 players → 2, 9 → 3. */
function seedTables(players, rand = null) {
  if (!VALID_SIZES.includes(players.length)) {
    throw new Error(`A tournament needs exactly ${VALID_SIZES.join(' or ')} players.`);
  }
  const shuffled = shuffle(players, rand);
  const tables = [];
  for (let i = 0; i < shuffled.length; i += 3) {
    tables.push(shuffled.slice(i, i + 3));
  }
  return tables;
}

module.exports = {
  FINAL_SEATS,
  VALID_SIZES,
  penaltyPoints,
  pickFinalists,
  seedTables,
  shuffle,
};
