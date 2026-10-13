import { memo, useEffect, useRef } from "react";
import Phaser from "./phaser";
import { PreloadScene } from "./scenes/PreloadScene";
import { GameScene } from "./scenes/GameScene";
import { layoutFor, isPortraitBox, sceneSize } from "./layout";
import { EventBus } from "./EventBus";
import { armShuffleSound } from "./lib/shuffleSound";

// Frame rate while nothing on the table moves (GameScene lifts the limit
// during animations). Phaser's limiter waits until a full 1000/limit ms has
// passed, so 32 (31.25 ms) lands on every 2nd frame at 60 Hz, every 3rd at
// 90 Hz and every 4th at 120 Hz: a steady 30 fps. Exactly 30 would miss by a
// hair now and then and stutter down to 20.
const IDLE_FPS = 32;

function PhaserGame({ gameState, onCardPlay }) {
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  // Latest snapshot we tried to push into Phaser. The scene re-broadcasts
  // `scene-ready` once it finishes mounting, at which point we replay this
  // ref so the table renders immediately on a refresh/rejoin instead of
  // staying blank until the next state-update arrives.
  const lastStateRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    // Start with the table that suits the screen (tall table on an upright
    // phone); the scene switches by itself when the screen turns.
    const box = containerRef.current.getBoundingClientRect();
    const { width, height } = sceneSize(
      layoutFor(isPortraitBox(box.width || window.innerWidth, box.height || window.innerHeight)),
    );
    const config = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width,
      height,
      // Parchment, matching the table — shows only for the frame or two
      // before the scene draws, so it must not flash dark.
      backgroundColor: "#dceae1",
      scene: [PreloadScene, GameScene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      disableContextMenu: true,
      fps: { limit: IDLE_FPS },
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

  // Re-fit the FIT-scaled canvas as soon as the *visible* viewport changes.
  // Phaser listens to window resize and orientation itself, and otherwise
  // re-reads the container's size every 500 ms. On mobile, browser chrome
  // showing/hiding moves only the visual viewport, so flag the scale manager
  // to re-read on the next frame instead of waiting for that poll. (It only
  // refits, and the table only repaints, if the container size changed.)
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const recheck = () => {
      const scale = gameRef.current?.scale;
      if (scale) scale.dirty = true;
    };
    vv.addEventListener("resize", recheck);
    return () => vv.removeEventListener("resize", recheck);
  }, []);

  // The deal's shuffle sound has to be unlocked by a tap before a deal can
  // play it (iOS); listen for the player's taps while the table is up.
  useEffect(() => armShuffleSound(), []);

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
  // is alive — whichever push lands first after it becomes active wins; the
  // scene skips the rest, since they carry the snapshot it already drew.
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
