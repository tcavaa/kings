'use strict';

const { RANKS, SUITS, CARDS_PER_PLAYER, CENTER_CARD_COUNT } = require('./constants');

/**
 * Creates a full 32-card deck.
 * @returns {Array<{rank: string, suit: string}>}
 */
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/**
 * Fisher-Yates in-place shuffle.
 * @param {Array} deck
 * @returns {Array} same array, shuffled
 */
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Deals cards from a shuffled deck.
 * 3 players × 10 cards + 2 center cards.
 * @param {Array} deck - A shuffled 32-card deck
 * @returns {{ hands: {0: Card[], 1: Card[], 2: Card[]}, center: Card[] }}
 */
function deal(deck) {
  const hands = { 0: [], 1: [], 2: [] };
  const center = [];

  // Deal 10 cards to each player
  for (let seat = 0; seat < 3; seat++) {
    for (let i = 0; i < CARDS_PER_PLAYER; i++) {
      hands[seat].push(deck[seat * CARDS_PER_PLAYER + i]);
    }
  }

  // Last 2 cards go to center
  const offset = 3 * CARDS_PER_PLAYER;
  for (let i = 0; i < CENTER_CARD_COUNT; i++) {
    center.push(deck[offset + i]);
  }

  return { hands, center };
}

module.exports = { createDeck, shuffle, deal };
