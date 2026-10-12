'use strict';

/**
 * Calculates scores for all 3 players after a round ends.
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
  const scores = { 0: 0, 1: 0, 2: 0 };
  const {
    tricksTaken,
    queensTaken,
    jacksTaken,
    heartsTaken,
    kingOfHeartsTakenBy,
    trickWinners,
  } = roundData;

  switch (gameType) {
    case 'K': {
      // -40 to whoever took the King of Hearts trick
      if (kingOfHeartsTakenBy !== null && kingOfHeartsTakenBy !== undefined) {
        scores[kingOfHeartsTakenBy] = -40;
      }
      break;
    }

    case 'Q': {
      // -10 per queen taken
      for (let seat = 0; seat < 3; seat++) {
        scores[seat] = -10 * (queensTaken[seat] || 0);
      }
      break;
    }

    case 'J': {
      // -10 per jack taken
      for (let seat = 0; seat < 3; seat++) {
        scores[seat] = -10 * (jacksTaken[seat] || 0);
      }
      break;
    }

    case 'H': {
      // -5 per heart taken
      for (let seat = 0; seat < 3; seat++) {
        scores[seat] = -5 * (heartsTaken[seat] || 0);
      }
      break;
    }

    case 'L2': {
      // -20 per trick for the winners of the last two tricks
      if (trickWinners && trickWinners.length >= 2) {
        const lastTwo = trickWinners.slice(-2);
        for (const seat of lastTwo) {
          scores[seat] -= 20;
        }
      } else if (trickWinners && trickWinners.length === 1) {
        // Edge case: only one trick was played
        scores[trickWinners[0]] -= 20;
      }
      break;
    }

    case 'T': {
      // -4 per trick taken
      for (let seat = 0; seat < 3; seat++) {
        scores[seat] = -4 * (tricksTaken[seat] || 0);
      }
      break;
    }

    case 'P1':
    case 'P2':
    case 'P3': {
      // +8 per trick taken
      for (let seat = 0; seat < 3; seat++) {
        scores[seat] = 8 * (tricksTaken[seat] || 0);
      }
      break;
    }

    default:
      console.warn(`[ScoreCalculator] Unknown game type: ${gameType}`);
      break;
  }

  return scores;
}

module.exports = { calculate };
