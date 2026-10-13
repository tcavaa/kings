import {
  ClipboardList,
  Map,
  LineChart,
  Layers,
  DoorOpen,
  Flag,
} from "lucide-react";
import Sheet from "../ui/Sheet";
import { useGame } from "../../context/GameContext";

const ITEMS = [
  { id: "scores", Icon: ClipboardList, label: "ქულები" },
  { id: "matrix", Icon: Map, label: "ნათამაშები ხელები" },
  { id: "chart", Icon: LineChart, label: "ქულების გრაფიკი" },
  { id: "last", Icon: Layers, label: "ბოლოს გასული" },
];

/** Left-side slide-in drawer triggered by the hamburger pill. */
export default function MenuDrawer({
  open,
  onClose,
  onPick,
  spectator = false,
}) {
  const { gamePhase, chosenGameType } = useGame();
  if (!open) return null;

  // Folding only makes sense once the hand is underway (type picked, cards
  // being discarded/played). Surrender is available any time mid-game.
  // A spectator holds no seat at this table, so neither vote is theirs to
  // start — and the server would resolve the proposal against whatever room
  // they last played in.
  const canQuitRound =
    !spectator &&
    !!chosenGameType &&
    (gamePhase === "discard" || gamePhase === "playing");
  const canSurrender = !spectator && gamePhase !== "game_over";

  return (
    <Sheet
      drawer
      title="მაგიდის მენიუ"
      eyebrow="TABLE / NAVIGATION"
      onClose={onClose}
    >
      <nav className="k-table-menu">
        {ITEMS.map(({ id, Icon, label }, i) => (
          <button
            key={id}
            onClick={() => {
              onPick(id);
              onClose();
            }}
          >
            <small>{String(i + 1).padStart(2, "0")}</small>
            <span>{label}</span>
            <Icon size={18} />
          </button>
        ))}
      </nav>
      <div className="k-table-menu k-table-menu-secondary">
        {canQuitRound && (
          <button
            onClick={() => {
              onPick("quitRound");
              onClose();
            }}
          >
            <span>ხელის დათმობა</span>
            <DoorOpen size={18} />
          </button>
        )}
        {canSurrender && (
          <button
            onClick={() => {
              onPick("surrender");
              onClose();
            }}
          >
            <span>დანებება</span>
            <Flag size={18} />
          </button>
        )}
      </div>
    </Sheet>
  );
}
