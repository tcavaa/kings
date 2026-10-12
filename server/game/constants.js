'use strict';

const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['H', 'D', 'S', 'C'];

// All 9 game types every player must play (3 players × 9 = 27 rounds total)
const GAME_TYPES = {
  K: {
    code: 'K',
    name: 'King of Hearts',
    description: 'Avoid taking the King of Hearts trick. -40 points.',
    scoring: 'king_of_hearts',
    earlyEnd: true,
    positiveScoring: false,
  },
  Q: {
    code: 'Q',
    name: 'No Queens',
    description: 'Avoid taking queens. -10 points per queen.',
    scoring: 'queens',
    earlyEnd: true,
    positiveScoring: false,
  },
  J: {
    code: 'J',
    name: 'No Jacks',
    description: 'Avoid taking jacks. -10 points per jack.',
    scoring: 'jacks',
    earlyEnd: true,
    positiveScoring: false,
  },
  H: {
    code: 'H',
    name: 'No Hearts',
    description: 'Avoid taking hearts. -5 points per heart.',
    scoring: 'hearts',
    earlyEnd: true,
    positiveScoring: false,
  },
  L2: {
    code: 'L2',
    name: 'Last Two',
    description: 'Avoid winning the last two tricks. -20 points per trick.',
    scoring: 'last_two',
    earlyEnd: false,
    positiveScoring: false,
  },
  T: {
    code: 'T',
    name: 'No Tricks',
    description: 'Avoid taking tricks. -4 points per trick.',
    scoring: 'tricks',
    earlyEnd: false,
    positiveScoring: false,
  },
  P1: {
    code: 'P1',
    name: 'Positive 1',
    description: 'Take as many tricks as possible. +8 points per trick.',
    scoring: 'positive_tricks',
    earlyEnd: false,
    positiveScoring: true,
  },
  P2: {
    code: 'P2',
    name: 'Positive 2',
    description: 'Take as many tricks as possible. +8 points per trick.',
    scoring: 'positive_tricks',
    earlyEnd: false,
    positiveScoring: true,
  },
  P3: {
    code: 'P3',
    name: 'Positive 3',
    description: 'Take as many tricks as possible. +8 points per trick.',
    scoring: 'positive_tricks',
    earlyEnd: false,
    positiveScoring: true,
  },
};

// Ordered list of all type codes for tracking usage
const ALL_TYPE_CODES = ['K', 'Q', 'J', 'H', 'L2', 'T', 'P1', 'P2', 'P3'];

// Total number of rounds in a full game (9 types × 3 players)
const TOTAL_ROUNDS = 27;

// Number of players
const PLAYER_COUNT = 3;

// Cards dealt to each player
const CARDS_PER_PLAYER = 10;

// Center cards
const CENTER_CARD_COUNT = 2;

// Cards leader discards
const DISCARD_COUNT = 2;

module.exports = {
  RANKS,
  SUITS,
  GAME_TYPES,
  ALL_TYPE_CODES,
  TOTAL_ROUNDS,
  PLAYER_COUNT,
  CARDS_PER_PLAYER,
  CENTER_CARD_COUNT,
  DISCARD_COUNT,
};
