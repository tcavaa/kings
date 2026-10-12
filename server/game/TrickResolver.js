'use strict';

const { RANKS } = require('./constants');

function rankValue(rank) {
  return RANKS.indexOf(rank);
}

/**
 * Resolves a completed trick and returns the seat of the winner.
 *
 * - If trumpSuit is set and any trump was played, highest trump wins.
 * - Otherwise, highest card of the led suit wins.
 *
 * @param {Array<{seat: number, card: {rank: string, suit: string}}>} trick
 * @param {string} ledSuit
 * @param {string|null} trumpSuit
 * @returns {number} winnerSeat
 */
function resolveTrick(trick, ledSuit, trumpSuit = null) {
  const trumpPlayed =
    trumpSuit && trick.some(({ card }) => card.suit === trumpSuit);

  let winnerSeat = null;
  let highestValue = -1;

  if (trumpPlayed) {
    for (const { seat, card } of trick) {
      if (card.suit === trumpSuit) {
        const v = rankValue(card.rank);
        if (v > highestValue) {
          highestValue = v;
          winnerSeat = seat;
        }
      }
    }
  } else {
    for (const { seat, card } of trick) {
      if (card.suit === ledSuit) {
        const v = rankValue(card.rank);
        if (v > highestValue) {
          highestValue = v;
          winnerSeat = seat;
        }
      }
    }
  }

  if (winnerSeat === null) {
    winnerSeat = trick[0].seat;
  }

  return winnerSeat;
}

module.exports = { rankValue, resolveTrick };
