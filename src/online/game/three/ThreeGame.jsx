import { useEffect, useRef, useState } from "react";
import { useGame } from "../../context/GameContext";
import { TableScene } from "./TableScene";
import { customCharacter, validGLB } from "./characters";
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
    [accessible, setAccessible] = useState(false),
    [customize, setCustomize] = useState(false);
  const [seatName, setSeatName] = useState(""),
    [kind, setKind] = useState("head"),
    [busy, setBusy] = useState(false);
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
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 25 * 1024 * 1024)
        throw new Error("მაქსიმალური ზომაა 25 MB.");
      const buffer = await file.arrayBuffer();
      if (!validGLB(buffer))
        throw new Error(
          "აირჩიე GLB 2.0 ფაილი ჩაშენებული ტექსტურებით (მაქს. 25 MB).",
        );
      const value = { kind, buffer, filename: file.name };
      const loaded = await scene.current.replaceCharacter(seatName, value);
      if (!loaded)
        throw new Error("მოდელი ვერ გამოიყენება. სცადე სხვა GLB ფაილი.");
      await customCharacter(seatName, value);
      setNotice("მოდელი შენახულია ამ ბრაუზერში.");
    } catch (e) {
      setNotice(e.message || "მოდელი ვერ შეინახა.");
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    setBusy(true);
    try {
      await customCharacter(seatName, null);
      await scene.current.replaceCharacter(seatName, null);
      setNotice("საწყისი პერსონაჟი აღდგა.");
    } catch {
      setNotice("პერსონაჟი ვერ აღდგა.");
    } finally {
      setBusy(false);
    }
  }
  const others = gameState.players.filter(
    (p) => p.seat !== (gameState.mySeat ?? 0),
  );
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
            onClick={() => {
              setSeatName(others[0]?.name || "");
              setCustomize((v) => !v);
            }}
          >
            პერსონაჟები
          </button>
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
      {customize && (
        <aside className="king-three-panel" aria-label="პერსონაჟის შეცვლა">
          <h2>პერსონაჟის შეცვლა</h2>
          <p>
            შეცვლა ინახება მხოლოდ ამ ბრაუზერში. GLB ფაილი უნდა შეიცავდეს
            ტექსტურებს. სრული სხეულისთვის სასურველია sitting ან seated ანიმაცია.
          </p>
          <label>
            მოთამაშე
            <select
              value={seatName}
              onChange={(e) => setSeatName(e.target.value)}
            >
              {others.map((p) => (
                <option key={p.seat}>{p.name}</option>
              ))}
            </select>
          </label>
          <label>
            მოდელის ტიპი
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="head">თავი / სახე</option>
              <option value="body">სრული პერსონაჟი</option>
            </select>
          </label>
          <label className="king-three-upload">
            {busy ? "იტვირთება…" : "GLB ფაილის არჩევა"}
            <input
              type="file"
              accept=".glb"
              disabled={busy || !seatName}
              onChange={upload}
            />
          </label>
          <button disabled={busy || !seatName} onClick={reset}>
            საწყისი მოდელის აღდგენა
          </button>
          <button onClick={() => setCustomize(false)}>დახურვა</button>
        </aside>
      )}
    </div>
  );
}
