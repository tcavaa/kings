'use strict';

const { GAME_TYPES } = require('../game/constants');

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
 * because this runs again after a server restart rehydrates a tournament.
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
 * Two tiers, each internally ranked:
 *   1. table winners
 *   2. everyone else
 *
 * Winners are always seated before non-winners regardless of score, so a
 * strong player who lost their table can never bump a weaker table's winner —
 * the leftover seat (the "wildcard", only reachable in a 6-player bracket) is
 * what the best non-winner competes for.
 *
 * Ties fall out of the same ranking rather than needing a special case. With
 * two tables tied 25/25 and 5/5 there are four winners for three seats: both
 * 25s rank first, and the 5s are split by penalty points — matching the rule
 * the tournament was specified with.
 *
 * @returns {{ finalists: object[], standings: object[] }}
 */
function pickFinalists(tables = []) {
  const candidates = tables.flatMap(tableCandidates);
  const winners = candidates.filter((c) => c.isWinner).sort(compareCandidates);
  const rest    = candidates.filter((c) => !c.isWinner).sort(compareCandidates);

  const ordered = [...winners, ...rest];
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

/** Fisher-Yates, so seeding is genuinely uniform rather than sort-ish. */
function shuffle(list, rand = Math.random) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Randomly split entrants into tables of 3. 6 players → 2, 9 → 3. */
function seedTables(players, rand = Math.random) {
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
  compareCandidates,
  pickFinalists,
  seedTables,
  shuffle,
};
