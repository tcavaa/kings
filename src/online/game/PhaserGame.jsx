import { memo, useEffect, useRef } from "react";
import Phaser from "phaser";
import { useChat } from "../context/GameContext";
import { PreloadScene } from "./scenes/PreloadScene";
import { GameScene, SCENE_W, SCENE_H } from "./scenes/GameScene";
import { EventBus } from "./EventBus";

function PhaserGame({ gameState, onCardPlay }) {
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  // Latest snapshot we tried to push into Phaser. The scene re-broadcasts
  // `scene-ready` once it finishes mounting, at which point we replay this
  // ref so the table renders immediately on a refresh/rejoin instead of
  // staying blank until the next state-update arrives.
  const lastStateRef = useRef(null);
  const { playSound } = useChat();

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const config = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: SCENE_W,
      height: SCENE_H,
      // Parchment, matching the table art — shows only for the frame or two
      // before the felt image paints, so it must not flash dark.
      backgroundColor: "#dceae1",
      scene: [PreloadScene, GameScene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      disableContextMenu: true,
    };

    gameRef.current = new Phaser.Game(config);

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!gameState) return;
    lastStateRef.current = gameState;
    EventBus.emit("state-update", gameState);
  }, [gameState]);

  // Re-fit the FIT-scaled canvas whenever the *visible* viewport changes.
  // Phaser's built-in 'resize' listener tracks the layout viewport, which on
  // mobile doesn't update when browser chrome shows/hides or on some
  // orientation flips — leaving the canvas sized to the old (taller) box and
  // clipping the bottom of the table. visualViewport fires on exactly those
  // changes, so refreshing the scale manager here keeps the table at 100%.
  useEffect(() => {
    const refresh = () => gameRef.current?.scale?.refresh();
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    window.addEventListener("resize", refresh);
    window.addEventListener("orientationchange", refresh);
    vv?.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("orientationchange", refresh);
      vv?.removeEventListener("resize", refresh);
    };
  }, []);

  // Whenever the GameScene finishes mounting (initial create, scene
  // restart, HMR), replay the most recent state we have. Without this
  // replay the very first state-update — emitted while the scene was
  // still in PreloadScene — gets dropped, and the felt stays empty until
  // some other React-side change forces a fresh state-update.
  useEffect(() => {
    const replay = () => {
      if (lastStateRef.current) {
        EventBus.emit("state-update", lastStateRef.current);
      }
    };
    EventBus.on("scene-ready", replay);
    return () => EventBus.off("scene-ready", replay);
  }, []);

  // Belt-and-suspenders for the "blank table until I tap something" rejoin
  // bug. On rejoin the GameScene boots asynchronously: the game-state snapshot
  // often lands *before* the scene's listener is live (or before the scene is
  // active, which makes _onStateUpdate cache-but-not-draw). The single
  // scene-ready replay can lose that race when assets are cached and the scene
  // boots almost instantly. Re-pushing the freshest snapshot a few times
  // across the boot window guarantees the table paints the moment the scene
  // is alive — whichever push lands first after it becomes active wins, the
  // rest are cheap no-op repaints of identical state.
  useEffect(() => {
    const push = () => {
      if (lastStateRef.current)
        EventBus.emit("state-update", lastStateRef.current);
    };
    const timers = [
      setTimeout(push, 60),
      setTimeout(push, 200),
      setTimeout(push, 500),
      setTimeout(push, 1000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const handler = (card) => onCardPlay && onCardPlay(card);
    EventBus.on("card-clicked", handler);
    return () => EventBus.off("card-clicked", handler);
  }, [onCardPlay]);

  // Player clicked a sound button next to an avatar → broadcast through socket.
  useEffect(() => {
    const handler = ({ soundId, targetSeat }) => {
      if (!playSound) return;
      playSound(soundId, targetSeat);
    };
    EventBus.on("request-play-sound", handler);
    return () => EventBus.off("request-play-sound", handler);
  }, [playSound]);

  return (
    // Keep the canvas letterbox the same tone as the play surface.
    <div
      className="k-game-stage absolute inset-0 overflow-hidden"
      style={{ background: "#dceae1" }}
    >
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}

// gameState is memoized upstream (GameLayout) and onCardPlay is
// useCallback-stable, so memo() makes unrelated GameLayout renders
// (drawer/menu/chat toggles) skip this component entirely.
export default memo(PhaserGame);
