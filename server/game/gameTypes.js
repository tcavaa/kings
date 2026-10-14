'use strict';

// The nine game types and how each one scores — the one copy every part of
// the project reads: the game server (GameState via ScoreCalculator), the
// ჩაწერა games it stores (games/scoreSheet.js), King Online and ჩაწერა.
// Each app keeps only its own names, icons and colours next to these
// (src/online/constants/gameTypes.js, src/score/constants/gameTypes.js).
// Plain CommonJS with no dependencies, like rules.js, so the Next.js client
// bundle can import it from here; it lives under server/ because Render only
// deploys that folder.
//
//   kind 'single'  one player takes the type's only unit (K♥) and its points
//   kind 'count'   every player scores pointsPerUnit for each unit taken,
//                  and the units handed out add up to totalUnits

const GAME_TYPE_RULES = [
  { code: 'K',  kind: 'single', totalUnits: 1,  pointsPerUnit: -40 },
  { code: 'Q',  kind: 'count',  totalUnits: 4,  pointsPerUnit: -10 },
  { code: 'J',  kind: 'count',  totalUnits: 4,  pointsPerUnit: -10 },
  { code: 'H',  kind: 'count',  totalUnits: 8,  pointsPerUnit: -5 },
  { code: 'L2', kind: 'count',  totalUnits: 2,  pointsPerUnit: -20 },
  { code: 'T',  kind: 'count',  totalUnits: 10, pointsPerUnit: -4 },
  { code: 'P1', kind: 'count',  totalUnits: 10, pointsPerUnit: 8 },
  { code: 'P2', kind: 'count',  totalUnits: 10, pointsPerUnit: 8 },
  { code: 'P3', kind: 'count',  totalUnits: 10, pointsPerUnit: 8 },
];

const GAME_TYPE_CODES = GAME_TYPE_RULES.map((t) => t.code);
const RULE_BY_CODE = Object.fromEntries(GAME_TYPE_RULES.map((t) => [t.code, t]));

/** The rule for a type code, or null for an unknown code. */
function gameTypeRule(code) {
  return RULE_BY_CODE[code] || null;
}

// The six avoidance rounds and the three "pluses".
const PENALTY_CODES = GAME_TYPE_CODES.filter((c) => RULE_BY_CODE[c].pointsPerUnit < 0);
const PLUS_CODES = GAME_TYPE_CODES.filter((c) => RULE_BY_CODE[c].pointsPerUnit > 0);

/**
 * One round's points for each of `keys` (seats or player ids): the target of
 * a 'single' type takes its points, a 'count' type pays per unit in `counts`
 * ({ [key]: units }; a missing count is 0). Unknown types score 0.
 */
function roundScores(code, keys, { counts = null, target = null } = {}) {
  const rule = gameTypeRule(code);
  const scores = {};
  for (const key of keys) {
    if (!rule) scores[key] = 0;
    else if (rule.kind === 'single') scores[key] = key === target ? rule.pointsPerUnit * rule.totalUnits : 0;
    // `|| 0` keeps "took none of a penalty" a plain 0 rather than -0.
    else scores[key] = Number((counts && counts[key]) || 0) * rule.pointsPerUnit || 0;
  }
  return scores;
}

// Where a King Online round record keeps the units of its own type. The
// server records queens, jacks, hearts and tricks for every round whatever
// the type, but only the round's own type counts. L2 is worked out from the
// last two trick winners and K from kingOfHeartsTakenBy.
const UNIT_FIELD = {
  Q: 'queensTaken', J: 'jacksTaken', H: 'heartsTaken',
  T: 'tricksTaken', P1: 'tricksTaken', P2: 'tricksTaken', P3: 'tricksTaken',
};

/** { [seat]: n } — how many of the last two tricks each seat won. */
function lastTwoCounts(trickWinners) {
  const counts = {};
  for (const seat of trickWinners.slice(-2)) counts[seat] = (counts[seat] || 0) + 1;
  return counts;
}

/** The last two tricks' winners, rebuilt from "how many of the last 2 each took". */
function lastTwoWinners(counts) {
  const winners = [];
  for (const [seat, n] of Object.entries(counts || {})) {
    for (let i = 0; i < n; i++) winners.push(Number(seat));
  }
  return winners;
}

/**
 * The units of a round's own type per seat, from a King Online round record
 * ({ gameType, queensTaken, …, trickWinners }), or null when the record
 * doesn't have them (bad data, or K, which has no count).
 */
function unitCountsOf(round) {
  const code = round && round.gameType;
  if (code === 'L2') {
    const tw = round.trickWinners;
    return Array.isArray(tw) && tw.length >= 2 ? lastTwoCounts(tw) : null;
  }
  const field = UNIT_FIELD[code];
  return (field && round[field]) || null;
}

// The cards that cost points in a card round: K♥ in King, every queen,
// every jack, every heart. Minus (T), Last two (L2) and the pluses are about
// tricks, not cards, so no card is a penalty card there.
const PENALTY_CARD = {
  K: (c) => c.rank === 'K' && c.suit === 'H',
  Q: (c) => c.rank === 'Q',
  J: (c) => c.rank === 'J',
  H: (c) => c.suit === 'H',
};

/** Whether `card` costs points in a round of type `code`. */
function isPenaltyCard(code, card) {
  return !!card && !!PENALTY_CARD[code]?.(card);
}

module.exports = {
  GAME_TYPE_RULES,
  GAME_TYPE_CODES,
  PENALTY_CODES,
  PLUS_CODES,
  UNIT_FIELD,
  gameTypeRule,
  isPenaltyCard,
  roundScores,
  unitCountsOf,
  lastTwoCounts,
  lastTwoWinners,
};
