import { useEffect, useRef, useState, memo } from "react";
import {
  Menu,
  Layers,
  Copy,
  Check,
  MessageCircle,
  ChartNoAxesColumnIncreasing,
} from "lucide-react-online";
import { useGame } from "../../context/GameContext";
import { getGameType } from "../../constants/gameTypes";
import GameTimer from "./GameTimer";
const PHASES = {
  type_selection: "აირჩიე თამაში",
  trump_selection: "აირჩიე კოზირი",
  discard: "გადადე კარტები",
  playing: "თამაში მიმდინარეობს",
  round_end: "რაუნდი დასრულდა",
};
const SUITS = { H: "♥ გული", D: "♦ აგური", S: "♠ ყვავი", C: "♣ ჯვარი" };
function TopBar({
  onToggleMenu,
  onToggleScores,
  onToggleChat,
  onToggleRounds,
  waiting,
}) {
  const {
    round,
    chosenGameType,
    trumpSuit,
    roomCode,
    gamePhase,
    connected,
  } = useGame();
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  const type = getGameType(chosenGameType);
  return (
    <header className="k-game-header">
      <div className="k-game-brand">
        <button
          className="k-game-icon"
          aria-label="მენიუ"
          onClick={onToggleMenu}
        >
          <Menu size={20} />
        </button>
        <span>
          kıng<small>TABLE / {roomCode}</small>
        </span>
        <button
          className="k-game-copy"
          aria-label="კოდის კოპირება"
          onClick={copy}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <div className="k-round-group">
        {waiting && (
          <div className="k-turn-status" role="status">
            <span className="k-live-dot" />
            <span>
              <b>{waiting.name}</b>
              <small>ველოდებით {waiting.label}</small>
            </span>
          </div>
        )}
        <div className="k-game-round">
          <span>რაუნდი</span>
          <strong>{String(round).padStart(2, "0")}</strong>
          <small>/ 27</small>
          <i />
          <b>
            {type?.name || PHASES[gamePhase] || "კინგი"}
            {trumpSuit && (
              <em className={`k-trump-label suit-${trumpSuit}`}>
                კოზირი: {SUITS[trumpSuit]}
              </em>
            )}
            {!trumpSuit &&
              chosenGameType?.startsWith("P") &&
              ["playing", "discard", "round_end"].includes(gamePhase) && (
                <em className="k-trump-label">უკოზირო</em>
              )}
          </b>
        </div>
      </div>
      <div className="k-round-progress" aria-label={`რაუნდი ${round} / 27`}>
        {Array.from({ length: 27 }, (_, i) => (
          <span
            key={i}
            className={
              i + 1 < round ? "is-done" : i + 1 === round ? "is-active" : ""
            }
          />
        ))}
      </div>
      <div className="k-game-tools">
        <span
          className="k-game-connection"
          title={connected ? "დაკავშირებულია" : "კავშირი წყდება"}
        >
          <i className={connected ? "on" : ""} />
        </span>
        <GameTimer />
        <button
          className="k-rounds-trigger"
          onClick={onToggleRounds}
          aria-label="დარჩენილი და ნათამაშები ხელები"
        >
          <Layers size={16} />
          <span>
            ხელები <b>{Math.max(0, 27 - round)}</b>
          </span>
        </button>
        <button
          className="k-game-icon"
          aria-label="ქულები"
          onClick={onToggleScores}
        >
          <ChartNoAxesColumnIncreasing size={19} />
        </button>
        <button
          className="k-game-icon"
          aria-label="ჩატი"
          onClick={onToggleChat}
        >
          <MessageCircle size={19} />
        </button>
      </div>
    </header>
  );
}
export default memo(TopBar);
