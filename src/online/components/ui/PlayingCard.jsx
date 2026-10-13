import { SUIT_SYMBOLS as SUITS, isRedSuit } from "../../constants/suits";
export default function PlayingCard({ card, highlight = false }) {
  return (
    <div
      className={`k-playing-card ${highlight ? "is-winning" : ""} ${isRedSuit(card.suit) ? "is-red" : ""}`}
      aria-label={`${card.rank} ${SUITS[card.suit]}`}
    >
      <span className="k-playing-rank">
        {card.rank}
        <small>{SUITS[card.suit]}</small>
      </span>
      <b>{SUITS[card.suit]}</b>
      <footer>KING / 01</footer>
    </div>
  );
}
