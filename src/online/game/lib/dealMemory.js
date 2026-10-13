// Telling a fresh deal (play the deal animation and the shuffle sound) from
// the same hand shown again. The last deal is kept in sessionStorage, so a
// page refresh in the middle of a round doesn't replay the deal.

const STORAGE_KEY = "king-online:last-deal";

const cardId = (c) => `${c.rank}${c.suit}`;

/**
 * Is `hand` in `round` a new deal, given the last one we animated?
 * Within a round the hand only loses played cards and, for the leader, gains
 * the two centre cards, so at most 2 of its cards are not from that deal. A
 * new game's round with the same number deals different cards.
 */
export function isFreshDeal(hand, round, last) {
  if (!hand || hand.length < 9) return false;
  if (!last || last.round !== round) return true;
  const dealt = new Set(last.cards);
  const kept = hand.filter((c) => dealt.has(cardId(c))).length;
  return kept < hand.length - 2;
}

export function dealRecord(hand, round) {
  return { round, cards: hand.map(cardId) };
}

export function loadLastDeal() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLastDeal(record) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* private mode or storage blocked: a refresh may replay the deal */
  }
}
