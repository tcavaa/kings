import { useEffect, useRef, useState } from "react";
import { useGame } from "../../context/GameContext";
import { TableScene } from "./TableScene";
import { looksFor } from "./looks";
import "./three.css";
import { EventBus } from "../EventBus";
import { armShuffleSound } from "../lib/shuffleSound";

export default function ThreeGame({
  gameState,
  chatBubbles,
  onExit,
  onMenu,
  onChat,
  onSounds,
  previewActions,
}) {
  const context = useGame();
  const game = previewActions || context;
  const host = useRef(null),
    scene = useRef(null),
    latest = useRef(game);
  latest.current = game;
  const [error, setError] = useState(""),
    [hint, setHint] = useState(""),
    [notice, setNotice] = useState("");
  const [controls, setControls] = useState([]),
    [accessible, setAccessible] = useState(false);
  useEffect(() => armShuffleSound(), []);
  useEffect(() => {
    try {
      scene.current = new TableScene(host.current, {
        onHint: setHint,
        onControls: setControls,
        onError: setError,
        onNotice: setNotice,
        onAction: (action, value) => latest.current?.[action]?.(value),
      });
    } catch (e) {
      console.error("KING 3D initialization failed", e);
      setError("3D ვერ ჩაიტვირთა. დაბრუნდი 2D რეჟიმში.");
    }
    const collect = ({ winnerSeat }) => scene.current?.collect(winnerSeat);
    EventBus.on("animate-trick-winner", collect);
    return () => {
      EventBus.off("animate-trick-winner", collect);
      scene.current?.destroy();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    scene.current?.update({
      ...gameState,
      roomCode: game.roomCode,
      usedTypes: game.usedTypes,
      selectedDiscards: game.selectedDiscards || [],
      lastCenterCards: game.lastCenterCards || [],
      roundScores: game.roundScores || [],
      lastTrickResult: game.lastTrickResult,
      reconnecting: game.reconnecting,
      chatBubbles,
    });
  }, [
    gameState,
    chatBubbles,
    game.roomCode,
    game.usedTypes,
    game.selectedDiscards,
    game.lastCenterCards,
    game.roundScores,
    game.lastTrickResult,
    game.reconnecting,
  ]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  // Each player's look (gender, uploaded head) comes from their profile;
  // it is edited on the profile screen, not here.
  const rosterKey = gameState.players
    .map((p) => `${p.seat}:${p.profileId || ""}`)
    .join("|");
  useEffect(() => {
    let live = true;
    const players = gameState.players;
    looksFor(players).then((looks) => {
      if (live) scene.current?.setLooks(looks, looks[gameState.mySeat]);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey, gameState.mySeat]);
  return (
    <div className="king-three">
      <div ref={host} className="king-three-canvas" />
      <header className="king-three-toolbar">
        <div className="king-three-brand">
          <span>♛</span> KING <small>3D ROOM</small>
        </div>
        <nav aria-label="3D თამაშის მენიუ">
          <button onClick={() => scene.current?.showScores()}>
            ქულები <kbd>S</kbd>
          </button>
          <button onClick={() => scene.current?.showLast()}>ბოლო ხელი</button>
          <button
            onClick={() => setAccessible((v) => !v)}
            aria-expanded={accessible}
          >
            კონტროლები
          </button>
          <button onClick={onChat}>ჩატი</button>
          <button onClick={onSounds}>ხმები</button>
          <button onClick={onMenu}>მენიუ</button>
          <button onClick={onExit} className="king-three-exit">
            2D რეჟიმი
          </button>
        </nav>
      </header>
      <footer className="king-three-help">
        <span>{hint || "კარტზე დაჭერა — სვლა"}</span>
        <span>მარჯვენა ღილაკით მოძრაობა — გახედვა · R — კამერის დაბრუნება</span>
      </footer>
      {notice && (
        <div className="king-three-notice" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="king-three-error" role="alert">
          <p>{error}</p>
          <button onClick={onExit}>2D რეჟიმში დაბრუნება</button>
        </div>
      )}
      {accessible && (
        <aside className="king-three-panel" aria-label="თამაშის კონტროლები">
          <h2>თამაშის კონტროლები</h2>
          <p>იგივე მოქმედებები კლავიატურით ან ღილაკებით.</p>
          {controls.map((c, i) => (
            <button key={`${c.label}-${i}`} onClick={c.action}>
              {c.label}
            </button>
          ))}
          <button onClick={() => setAccessible(false)}>დახურვა</button>
        </aside>
      )}
    </div>
  );
}
