import { Ban, Star, Check, ArrowRight } from "lucide-react";
import { useGame } from "../context/GameContext";
import { SuitLabel } from "./Icons";
import ModalShell from "./ModalShell";
import PlayingCard from "./ui/PlayingCard";
import { SUIT_SYMBOLS } from "../constants/suits";
// The server's own discard rule, so the dialog can't drift from it.
import { canDiscard } from "../../../server/game/rules.js";

const cardKey = (c) => `${c.rank}-${c.suit}`;

function MiniCard({ card, selected, restricted, onClick, isCenter }) {
  return (
    <button
      className={`k-discard-card ${selected ? "is-selected" : ""}`}
      onClick={() => !restricted && onClick(card)}
      disabled={restricted}
      aria-pressed={selected}
      aria-label={`${card.rank} ${SUIT_SYMBOLS[card.suit]}${isCenter ? " · პრიკუპიდან" : ""}`}
    >
      <PlayingCard card={card} highlight={selected} />
      {(selected || isCenter) && (
        <span className="k-discard-marker">
          {selected ? <Check size={12} /> : "პ"}
        </span>
      )}
    </button>
  );
}

export default function DiscardSelector() {
  const {
    hand,
    lastCenterCards,
    selectedDiscards,
    toggleDiscard,
    discardCards,
    chosenGameType,
    trumpSuit,
  } = useGame();

  const restrictionType =
    chosenGameType === "K" || chosenGameType === "H"
      ? "გულებს"
      : chosenGameType === "Q"
        ? "დამებს"
        : chosenGameType === "J"
          ? "ვალეტებს"
          : null;

  const centerKeys = new Set((lastCenterCards || []).map(cardKey));
  const isSelected = (card) =>
    selectedDiscards.some((c) => c.rank === card.rank && c.suit === card.suit);
  // Must keep at least one center card — picking both as discards is illegal.
  const bothCenterPicked =
    selectedDiscards.length === 2 &&
    selectedDiscards.every((c) => centerKeys.has(cardKey(c)));
  const canConfirm = selectedDiscards.length === 2 && !bothCenterPicked;

  return (
    <ModalShell
      className="items-center z-30 p-3 overflow-y-auto"
      panelClassName="k-contract-modal max-w-2xl my-auto"
    >
      <div className="k-contract-heading">
        <div>
          <span className="k-eyebrow">MAKE ROOM FOR YOUR NEXT MOVE</span>
          <h2>რას დატოვებ უკან?</h2>
        </div>
        <span>
          {selectedDiscards.length} / 2<small>კარტი მონიშნულია</small>
        </span>
      </div>
      <div className="k-discard-body">
        <p>აირჩიე ორი კარტი გადასადებად. პრიკუპიდან ერთი მაინც დაიტოვე.</p>
        <div className="k-discard-hand">
          {hand.map((card) => (
            <MiniCard
              key={cardKey(card)}
              card={card}
              selected={isSelected(card)}
              restricted={!canDiscard(chosenGameType, card)}
              onClick={toggleDiscard}
              isCenter={centerKeys.has(cardKey(card))}
            />
          ))}
        </div>
        <div className="k-discard-notes">
          {restrictionType && (
            <span>
              <Ban size={14} />
              {restrictionType} ამ ხელში ვერ გადადებ.
            </span>
          )}
          {trumpSuit && (
            <span>
              <Star size={14} />
              კოზირი: <SuitLabel suit={trumpSuit} size={14} />
            </span>
          )}
          <span>
            <span className="k-center-key">პ</span>პრიკუპიდან მიღებული კარტი
          </span>
        </div>
        {bothCenterPicked && (
          <p role="alert" className="k-form-error">
            პრიკუპის ორი კარტიდან ერთი მაინც უნდა დაიტოვო.
          </p>
        )}
      </div>
      <footer className="k-contract-footer">
        <span>{selectedDiscards.length} / 2 კარტი მონიშნულია</span>
        <button
          className="k-button"
          disabled={!canConfirm}
          onClick={() => discardCards(selectedDiscards)}
        >
          გადადე და ითამაშე <ArrowRight size={18} />
        </button>
      </footer>
    </ModalShell>
  );
}
