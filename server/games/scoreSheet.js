'use strict';

// Games recorded on ჩაწერა's score sheet ("live" games, played at a real
// table) are stored in finished_games next to King Online's games, in the
// same payload shape, so both apps' leaderboards and analytics read every
// game the same way:
//
//   players      [{ seat, name, score, avatar: null, profileId }]  seat = sheet column
//   winners      [{ seat, name, score }]
//   roundDetails [{ round, gameType, leaderSeat, trumpSuit: null,
//                   scores, cumulativeScores,            ({ [seat]: points })
//                   queensTaken | jacksTaken | heartsTaken | tricksTaken,
//                   kingOfHeartsTakenBy, trickWinners,   (the round's own type only)
//                   counts, targetSeat }]                (the sheet's entry as typed)
//
// The sheet only records the cards of the round's own type, so only that
// type's King Online field is filled. `counts`/`targetSeat` keep the entry
// exactly as typed (the steppers someone touched), which is what lets
// ჩაწერა read its games back unchanged.

const crypto = require('crypto');
const { ALL_TYPE_CODES: GAME_TYPES } = require('../game/constants');
const { badRequest: invalid } = require('../lib/httpError');

const TAKEN_FIELD = {
  Q: 'queensTaken', J: 'jacksTaken', H: 'heartsTaken',
  T: 'tricksTaken', P1: 'tricksTaken', P2: 'tricksTaken', P3: 'tricksTaken',
};
const SEP = ' & ';

// How ჩაწერა scores a round (src/score/constants/gameTypes.js and
// computeScoresForRound in src/score/utils/scoring.js): a 'single' type costs
// its target the points, a 'count' type pays every player per unit taken,
// and the units handed out always add up to the type's total.
const SHEET_SCORING = {
  K:  { kind: 'single', points: -40 },
  Q:  { kind: 'count', perUnit: -10, units: 4 },
  J:  { kind: 'count', perUnit: -10, units: 4 },
  H:  { kind: 'count', perUnit: -5, units: 8 },
  L2: { kind: 'count', perUnit: -20, units: 2 },
  T:  { kind: 'count', perUnit: -4, units: 10 },
  P1: { kind: 'count', perUnit: 8, units: 10 },
  P2: { kind: 'count', perUnit: 8, units: 10 },
  P3: { kind: 'count', perUnit: 8, units: 10 },
};

/** A round's scores per player id, worked out from what the sheet recorded. */
function scoresForRound(round, ids) {
  const rule = SHEET_SCORING[round.gameTypeCode];
  const scores = {};
  if (rule.kind === 'single') {
    if (round.singleTargetPlayerId == null) throw invalid('Invalid round target.');
    for (const id of ids) scores[id] = id === round.singleTargetPlayerId ? rule.points : 0;
    return scores;
  }
  const counts = round.countsByPlayerId || {};
  const handedOut = ids.reduce((sum, id) => sum + (counts[id] || 0), 0);
  if (handedOut !== rule.units) throw invalid('Invalid round counts.');
  for (const id of ids) scores[id] = (counts[id] || 0) * rule.perUnit;
  return scores;
}

/** { [playerId]: v } → { [seat]: v } (null stays null). */
function toSeats(obj, seatOf) {
  if (obj == null) return null;
  const out = {};
  for (const [id, v] of Object.entries(obj)) {
    if (seatOf.has(id)) out[seatOf.get(id)] = v;
  }
  return out;
}

/** The last two tricks' winners, rebuilt from "how many of the last 2 each took". */
function lastTwoWinners(counts) {
  const winners = [];
  for (const [seat, n] of Object.entries(counts || {})) {
    for (let i = 0; i < n; i++) winners.push(Number(seat));
  }
  return winners;
}

function roundDetailsOf(rounds, seatOf, seats) {
  const cumulative = Object.fromEntries(seats.map((s) => [s, 0]));
  return rounds.map((r, i) => {
    const scores = toSeats(r.scores, seatOf) || {};
    for (const s of seats) cumulative[s] += scores[s] || 0;
    const counts = toSeats(r.countsByPlayerId, seatOf);
    const targetSeat = r.singleTargetPlayerId == null ? null : (seatOf.get(r.singleTargetPlayerId) ?? null);
    const d = {
      round: i + 1,
      gameType: r.gameTypeCode,
      leaderSeat: seatOf.has(r.leaderPlayerId) ? seatOf.get(r.leaderPlayerId) : null,
      trumpSuit: null,
      scores,
      cumulativeScores: { ...cumulative },
      counts,
      targetSeat,
    };
    if (TAKEN_FIELD[r.gameTypeCode] && counts) d[TAKEN_FIELD[r.gameTypeCode]] = counts;
    if (r.gameTypeCode === 'L2' && counts) d.trickWinners = lastTwoWinners(counts);
    if (r.gameTypeCode === 'K') d.kingOfHeartsTakenBy = targetSeat;
    return d;
  });
}

/**
 * The finished_games row for one sheet game.
 *   slots    [{ id, name, profileId }] in sheet order
 *   finals   final score per seat
 *   winners  winning seats (sheet order)
 */
function buildRow({ id, playedAt, slots, rounds, finals, winnerSeats, durationSeconds, legacy }) {
  const seats = slots.map((_, seat) => seat);
  const seatOf = new Map(slots.map((p, seat) => [p.id, seat]));
  const players = slots.map((p, seat) => ({
    seat, name: p.name, score: finals[seat], avatar: null, profileId: p.profileId || null,
  }));
  const winners = winnerSeats.map((seat) => ({ seat, name: players[seat].name, score: players[seat].score }));
  const payload = {
    players,
    roundDetails: roundDetailsOf(rounds, seatOf, seats),
    winners,
    isTie: winners.length > 1,
  };
  if (durationSeconds != null) payload.durationSeconds = durationSeconds;
  if (legacy && Object.keys(legacy).length) payload.legacy = legacy;
  return {
    id,
    type: 'live',
    playedAt,
    isChampionship: 1,
    winner: winners[0],
    payload,
  };
}

// The sheet's own id makes the game id, so saving the same sheet twice (a
// retry after a lost response) stores one game. "sheet-" + id fits the
// 64-character column.
const SHEET_ID_RE = /^[A-Za-z0-9_-]{8,58}$/;

/**
 * A game ჩაწერა just finished: `players` are the sheet's columns ({ id }),
 * `rounds` its round records keyed by those ids. resolve(id) gives the
 * player's profile ({ id, name }) or null. Names come from the profiles,
 * totals from the rounds — the same arithmetic the sheet showed.
 */
function fromScoreSheet({ sheetId, players, rounds, durationSeconds } = {}, resolve) {
  if (!Array.isArray(players) || players.length < 3 || players.length > 4) {
    throw invalid('A game needs 3 or 4 players.');
  }
  const ids = players.map((p) => p && p.id);
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
    throw invalid('Players must be distinct.');
  }
  const slots = ids.map((id) => {
    const profile = resolve(id);
    if (!profile) throw invalid('Unknown player — reload the player list.');
    return { id, name: profile.name, profileId: profile.id };
  });
  if (new Set(slots.map((s) => s.profileId)).size !== slots.length) throw invalid('Players must be distinct.');
  // A finished sheet: every player led every game type once.
  if (!Array.isArray(rounds) || rounds.length !== ids.length * GAME_TYPES.length) {
    throw invalid('The game is not finished: every player leads every game type once.');
  }
  const idSet = new Set(ids);
  const played = new Set();   // each leader plays each type once
  const isPoints = (v) => Number.isInteger(v) && Math.abs(v) <= 1000;
  const isUnits = (v) => Number.isInteger(v) && v >= 0 && v <= 10;
  for (const r of rounds) {
    if (!r || !GAME_TYPES.includes(r.gameTypeCode) || !idSet.has(r.leaderPlayerId)) throw invalid('Invalid round.');
    if (!r.scores || typeof r.scores !== 'object' || Object.entries(r.scores).some(([k, v]) => !idSet.has(k) || !isPoints(v))) {
      throw invalid('Invalid round scores.');
    }
    if (r.countsByPlayerId != null && (typeof r.countsByPlayerId !== 'object'
        || Object.entries(r.countsByPlayerId).some(([k, v]) => !idSet.has(k) || !isUnits(v)))) {
      throw invalid('Invalid round counts.');
    }
    if (r.singleTargetPlayerId != null && !idSet.has(r.singleTargetPlayerId)) throw invalid('Invalid round target.');
    const pair = `${r.leaderPlayerId}:${r.gameTypeCode}`;
    if (played.has(pair)) throw invalid('A leader played the same game type twice.');
    played.add(pair);
    // The totals and winners come from the scores, so they must be the ones
    // the recorded cards give.
    const expected = scoresForRound(r, ids);
    if (ids.some((id) => (r.scores[id] || 0) !== expected[id])) {
      throw invalid('Round scores do not match the recorded cards.');
    }
  }
  const clean = rounds.map((r) => ({
    scores: scoresForRound(r, ids),
    gameTypeCode: r.gameTypeCode,
    leaderPlayerId: r.leaderPlayerId,
    countsByPlayerId: r.countsByPlayerId ?? null,
    singleTargetPlayerId: r.singleTargetPlayerId ?? null,
  }));
  const finals = ids.map((id) => clean.reduce((sum, r) => sum + (r.scores[id] || 0), 0));
  const best = Math.max(...finals);
  const duration = Number.isInteger(durationSeconds) && durationSeconds >= 0 && durationSeconds < 86400
    ? durationSeconds : undefined;
  return buildRow({
    id: typeof sheetId === 'string' && SHEET_ID_RE.test(sheetId) ? `sheet-${sheetId}` : crypto.randomUUID(),
    playedAt: undefined,
    slots,
    rounds: clean,
    finals,
    winnerSeats: finals.flatMap((score, seat) => (score === best ? [seat] : [])),
    durationSeconds: duration,
  });
}

/**
 * One game from ჩაწერა's old tables (game_results + game_details), for the
 * one-off import. The result row is what the app counted (final scores,
 * winners); the detail row has the rounds. profileOf(name) → { id, name } for
 * players linked to a King Online profile, null for the rest (kept by name).
 */
function fromLegacyRows(result, detail, profileOf) {
  const resultNames = result.participants.map((p) => p.name);
  // A few early detail rows still carry a player's pre-rename name ("რეგ"
  // where the result says "რევ"); the result's name in the same column wins.
  const sheet = detail
    ? detail.players.map((p, i) => ({ id: p.id, name: resultNames.includes(p.name) ? p.name : resultNames[i] }))
    : result.participants.map((p, i) => ({ id: `slot${i}`, name: p.name }));
  const slots = sheet.map((p) => {
    const profile = profileOf(p.name);
    return { id: p.id, name: profile ? profile.name : p.name, profileId: profile ? profile.id : null, sheetName: p.name };
  });
  const scoreOf = new Map(result.participants.map((p) => [p.name, p.score]));
  const winnerNames = result.winner_name.split(SEP);
  const legacy = {};
  const order = result.participants.map((p) => sheet.findIndex((s) => s.name === p.name));
  if (order.some((seat, i) => seat !== i)) legacy.participantsOrder = order;
  if (detail && new Date(detail.played_at).getTime() !== new Date(result.played_at).getTime()) {
    legacy.detailPlayedAt = detail.played_at;
  }
  if (!detail) legacy.noRounds = true;
  return buildRow({
    id: result.id,
    playedAt: result.played_at,
    slots,
    rounds: detail ? detail.rounds : [],
    finals: slots.map((s) => scoreOf.get(s.sheetName)),
    winnerSeats: slots.flatMap((s, seat) => (winnerNames.includes(s.sheetName) ? [seat] : [])),
    durationSeconds: result.duration_seconds ?? undefined,
    legacy,
  });
}

module.exports = { fromScoreSheet, fromLegacyRows };
