'use strict';

// The card rules that both sides need: the game server enforces them
// (GameState) and the King Online table uses the same code to grey out the
// cards the server would reject. Plain CommonJS with no dependencies, so the
// Next.js client bundle can import it from here too.

// Game types played with a trump suit (the three "pluses" rounds).
const TRUMP_TYPES = new Set(['P1', 'P2', 'P3']);

// Whether the leader may put `card` aside after taking the 2 centre cards.
function canDiscard(gameType, card) {
  switch (gameType) {
    case 'K':
    case 'H':
      return card.suit !== 'H';
    case 'Q':
      return card.rank !== 'Q';
    case 'J':
      return card.rank !== 'J';
    default:
      return true;
  }
}

/**
 * Why `card` can't be played from `hand` right now, or null when it can.
 * Only the card-choice rules live here; whose turn it is, the phase and
 * whether the card is really in the hand are checked by the caller.
 *
 * `leading` is true when the trick is empty (this card starts it).
 */
function playError(card, { hand, leading, ledSuit, chosenGameType, trumpSuit }) {
  const cards = hand || [];

  if (leading && (chosenGameType === 'K' || chosenGameType === 'H')) {
    if (card.suit === 'H' && cards.some((c) => c.suit !== 'H')) {
      return 'Cannot lead a heart unless you only have hearts.';
    }
  }

  if (!leading && ledSuit) {
    if (cards.some((c) => c.suit === ledSuit)) {
      // Following-suit rule: if you have the led suit, you must play it.
      if (card.suit !== ledSuit) return `Must follow suit: ${ledSuit}.`;
    } else {
      // Cannot follow suit — additional forced-play rules kick in.

      // 'K' (No King of Hearts): if the player still holds K♥, they have to
      // dump it on this trick. Without this rule the K♥ holder can sit on
      // it forever, defeating the round.
      if (chosenGameType === 'K') {
        const hasKingOfHearts = cards.some((c) => c.rank === 'K' && c.suit === 'H');
        const playingKingOfHearts = card.rank === 'K' && card.suit === 'H';
        if (hasKingOfHearts && !playingKingOfHearts) {
          return 'You must play the King of Hearts when you cannot follow suit.';
        }
      }

      // P1/P2/P3 (Pluses) with a chosen trump suit: if you have any trump
      // and can't follow led suit, you must trump in. Standard "trick-
      // taking with trumps" rule.
      if (trumpSuit && TRUMP_TYPES.has(chosenGameType)) {
        if (cards.some((c) => c.suit === trumpSuit) && card.suit !== trumpSuit) {
          return 'Must play a trump card when you cannot follow suit.';
        }
      }
    }
  }

  return null;
}

module.exports = { TRUMP_TYPES, canDiscard, playError };
