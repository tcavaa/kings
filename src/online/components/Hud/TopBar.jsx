import { useEffect, useRef, useState, memo } from "react";
import {
  Menu,
  Layers,
  Copy,
  Check,
  MessageCircle,
  ChartNoAxesColumnIncreasing,
  Eye,
  Swords,
} from "lucide-react";
import { useGame } from "../../context/GameContext";
import { getGameType } from "../../constants/gameTypes";
import { SUIT_SYMBOLS, SUIT_NAMES } from "../../constants/suits";
import GameTimer from "./GameTimer";
// Shown in the contract chip before a contract exists — neutral wording,
// since it's usually someone else who's choosing.
const PHASES = {
  type_selection: "თამაში ირჩევა",
  trump_selection: "კოზირი ირჩევა",
  discard: "კარტები იდება",
  playing: "თამაში მიმდინარეობს",
  round_end: "რაუნდი დასრულდა",
};
function TopBar({
  onToggleMenu,
  onToggleScores,
  onToggleChat,
  onToggleRounds,
  onToggleBracket,
  waiting,
}) {
  const {
    round,
    chosenGameType,
    trumpSuit,
    roomCode,
    gamePhase,
    connected,
    spectating,
    stopSpectating,
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
        <span>kıng</span>
        {/* The room code is what friends type to join, so it's the most
            visible thing up here; tapping it copies it. A watcher can't
            join, so they get the way out in its place. */}
        {spectating ? (
          <div className="k-watch-chip" role="status">
            <Eye size={14} aria-hidden="true" />
            <span>უყურებ</span>
            <button onClick={stopSpectating}>გასვლა</button>
          </div>
        ) : (
          <button
            className="k-room-code"
            aria-label={`ოთახის კოდი ${roomCode} — კოპირება`}
            title="კოდის კოპირება"
            onClick={copy}
          >
            <small>მაგიდა</small>
            <b>{roomCode}</b>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        )}
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
          {/* What's being played is always on screen, at every width: the
              contract, and for the plus games the trump suit (or none). */}
          <div
            className="k-contract"
            title={
              trumpSuit
                ? `${type?.name} · კოზირი: ${SUIT_SYMBOLS[trumpSuit]} ${SUIT_NAMES[trumpSuit]}`
                : type?.name || PHASES[gamePhase]
            }
          >
            {type?.Icon && <type.Icon size={14} aria-hidden="true" />}
            <span>{type?.name || PHASES[gamePhase] || "კინგი"}</span>
            {trumpSuit ? (
              <em className={`k-trump-chip suit-${trumpSuit}`}>
                {SUIT_SYMBOLS[trumpSuit]}
                <small>{SUIT_NAMES[trumpSuit]}</small>
              </em>
            ) : chosenGameType?.startsWith("P") &&
              ["playing", "discard", "round_end"].includes(gamePhase) ? (
              <em className="k-trump-chip is-none">უკოზირო</em>
            ) : chosenGameType?.startsWith("P") && gamePhase === "trump_selection" ? (
              <em className="k-trump-chip is-none">კოზირი…</em>
            ) : null}
          </div>
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
        {onToggleBracket && (
          <button
            className="k-game-icon k-bracket-trigger"
            aria-label="ტურნირის მიმოხილვა"
            title="ტურნირის მიმოხილვა"
            onClick={onToggleBracket}
          >
            <Swords size={17} />
          </button>
        )}
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
