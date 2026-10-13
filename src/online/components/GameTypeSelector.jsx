import { useState } from "react";
import { Check, ArrowRight } from "lucide-react-online";
import { useGame } from "../context/GameContext";
import { GAME_TYPES } from "../constants/gameTypes";
import ModalShell from "./ModalShell";
import { useTapLock } from "../hooks/useTapLock";

import PlayingCard from "./ui/PlayingCard";

export default function GameTypeSelector() {
  const { selectGameType, usedTypes, leaderSeat, players, hand, round } =
    useGame();
  const [selected, setSelected] = useState(null);
  const [sent, once] = useTapLock();

  const usedByLeader = usedTypes?.[leaderSeat] ?? [];
  const leaderName =
    players.find((p) => p.seat === leaderSeat)?.name ??
    `მოთამაშე ${leaderSeat}`;
  const available = GAME_TYPES.filter((t) => !usedByLeader.includes(t.code));
  const used = GAME_TYPES.filter((t) => usedByLeader.includes(t.code));
  const selectedType = GAME_TYPES.find((t) => t.code === selected);

  return (
    <ModalShell
      className="z-40 p-3 items-center overflow-y-auto"
      panelClassName="k-contract-modal k-strategy-modal max-w-3xl my-auto"
    >
      <div className="k-contract-heading">
        <div>
          <span className="k-eyebrow">
            რაუნდი {round} / 27 · დარჩა {available.length} არჩევანი
          </span>
          <h2>აირჩიე სტრატეგია.</h2>
        </div>
        <span>
          {leaderName}
          <small>შენ ირჩევ თამაშს</small>
        </span>
      </div>
      <div className="k-contract-layout">
        <aside>
          <span className="k-eyebrow">შენი კარტები / {hand.length}</span>
          <div className="k-contract-hand">
            {hand.map((c, i) => (
              <PlayingCard key={`${c.rank}-${c.suit}-${i}`} card={c} />
            ))}
          </div>
          <p>შეაფასე შენი კარტები და აირჩიე თამაშის ტიპი.</p>
          {used.length > 0 && (
            <div className="k-used-types">
              <small>უკვე ნათამაშები</small>
              {used.map((t) => (
                <span key={t.code}>✓ {t.name}</span>
              ))}
            </div>
          )}
        </aside>
        <div className="k-contract-options">
          {available.map((type) => (
            <button
              key={type.code}
              style={{ "--contract-color": type.color }}
              className={type.pointPerUnit > 0 ? "is-positive" : "is-negative"}
              aria-pressed={selected === type.code}
              onClick={() => setSelected(type.code)}
            >
              <span className="k-contract-icon">
                <type.Icon size={18} />
              </span>
              <span>
                <strong>{type.name}</strong>
                <small>{type.description}</small>
              </span>
              <b>
                {type.pointPerUnit > 0 ? "+" : ""}
                {type.pointPerUnit}
                <small>× {type.totalUnits}</small>
              </b>
              <span className="k-radio">
                {selected === type.code && <Check size={12} />}
              </span>
            </button>
          ))}
        </div>
      </div>
      <footer className="k-contract-footer">
        <span>
          {selectedType
            ? selectedType.description
            : "ყოველი არჩევანი ახალი დასაწყისია."}
        </span>
        <button
          className="k-button"
          disabled={!selected || sent}
          onClick={() => selected && once(() => selectGameType(selected))}
        >
          {selectedType ? `${selectedType.name} — დავიწყოთ` : "აირჩიე თამაში"}
          <ArrowRight size={18} />
        </button>
      </footer>
    </ModalShell>
  );
}
