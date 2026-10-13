'use strict';

const { gameTypeRule, roundScores, unitCountsOf } = require('./gameTypes');

const SEATS = [0, 1, 2];

/**
 * Calculates scores for all 3 players after a round ends, by the scoring
 * rules in gameTypes.js (the ones ჩაწერა's sheet uses too).
 *
 * @param {string} gameType - One of 'K','Q','J','H','L2','T','P1','P2','P3'
 * @param {object} roundData
 * @param {object} roundData.tricksTaken        - { 0: n, 1: n, 2: n }
 * @param {object} roundData.queensTaken        - { 0: n, 1: n, 2: n }
 * @param {object} roundData.jacksTaken         - { 0: n, 1: n, 2: n }
 * @param {object} roundData.heartsTaken        - { 0: n, 1: n, 2: n }
 * @param {number|null} roundData.kingOfHeartsTakenBy - seat or null
 * @param {number[]} roundData.trickWinners     - ordered list of trick-winner seats
 * @returns {{ 0: number, 1: number, 2: number }}
 */
function calculate(gameType, roundData) {
  if (!gameTypeRule(gameType)) {
    console.warn(`[ScoreCalculator] Unknown game type: ${gameType}`);
    return { 0: 0, 1: 0, 2: 0 };
  }
  return roundScores(gameType, SEATS, {
    // Only the units of the round's own type count (queens in Q, the last
    // two tricks in L2, …); K costs whoever took the King of Hearts.
    counts: unitCountsOf({ ...roundData, gameType }),
    target: roundData.kingOfHeartsTakenBy ?? null,
  });
}

module.exports = { calculate };
