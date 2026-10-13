import Phaser from "../phaser.js";
import { EventBus } from "../EventBus.js";
import { layoutFor, isPortraitBox, sceneSize } from "../layout.js";
import { TableView } from "../views/TableView.js";
import { OpponentsView } from "../views/OpponentsView.js";
import { AvatarsView } from "../views/AvatarsView.js";
import { HandView } from "../views/HandView.js";
import { TrickView } from "../views/TrickView.js";
import { CenterView } from "../views/CenterView.js";
import { ChatBubblesView } from "../views/ChatBubblesView.js";

// The live table. This class owns the lifecycle — EventBus, resize and
// visibility wiring, the trick-flight gate — and hands each part of the table
// to its view (views/). Every view remembers what it last drew and redraws
// only when its own part of the state changed.
export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: "GameScene" });
    this.gameState = null;
    this._lastRendered = null;
  }

  create() {
    // A restarted scene (HMR) starts empty, so the next snapshot must draw.
    this._lastRendered = null;
    const size = this.scale.gameSize;
    this.L = layoutFor(size.height > size.width);
    this.cameras.main.setScroll(0, this.L.VIEW_TOP);

    this.table = new TableView(this);
    this.table.draw(this.L);
    this.trick = new TrickView(this);
    this.avatars = new AvatarsView(this, () => this._repaint());
    // Drawing order between layers doesn't matter: each sets its own depth.
    this.views = [
      new OpponentsView(this),
      this.avatars,
      new HandView(this),
      this.trick,
      new CenterView(this),
      new ChatBubblesView(this),
    ];

    // Idle frame rate. PhaserGame starts the loop with an fps limit; while
    // anything moves the limit is lifted (see update()).
    const idleFps = this.game.config.fps?.limit;
    this._idleFrameMs = idleFps > 0 ? 1000 / idleFps : 0;

    // When the screen turns, switch layouts; either way the hand's card size
    // depends on how big the canvas is on screen, so repaint (the views
    // redraw only what that changed).
    this._onResize = () => {
      if (!this._isLive()) return;
      const parent = this.scale.parentSize;
      const portrait = isPortraitBox(parent.width, parent.height);
      if (parent.width > 0 && portrait !== this.L.portrait) {
        this.L = layoutFor(portrait);
        const { width, height } = sceneSize(this.L);
        this.cameras.main.setScroll(0, this.L.VIEW_TOP);
        this.table.draw(this.L);
        this.scale.setGameSize(width, height); // fires resize again → repaint below
        return;
      }
      this._repaint();
    };
    this.scale.on("resize", this._onResize);

    // Bind handlers so we can detach the exact same references on shutdown
    this._onStateUpdate = (state) => {
      // ALWAYS cache the freshest snapshot, even if we can't draw it right
      // now (scene still booting, or mid trick-animation). The gate-release,
      // force-render and visibility paths all repaint from `this.gameState`,
      // so it must never lag the server — otherwise a render that was skipped
      // during an animation replays stale data (the "I can't see the card
      // they just played" desync).
      this.gameState = state;
      // Guard against late events arriving after the scene has been torn down
      // or before it's active: store-but-don't-draw, the re-push / scene-ready
      // / force-render paths will paint it once we're live.
      if (!this._isLive()) return;
      // The boot re-pushes and scene-ready replay resend the same snapshot.
      if (state === this._lastRendered) return;
      this._renderAll(state);
    };
    this._onAnimateTrickWinner = ({ winnerSeat, trick }) => {
      if (!this._isLive() || !this.gameState) return;
      const state = this.gameState;
      if (this.trick.flyTo(winnerSeat, state, this.L, () => this._releaseGateAndRepaint())) {
        this.trick.react(winnerSeat, trick, state, this.L);
      }
    };
    // Hard resync hook: force the canvas to drop any stuck animation gate and
    // repaint from the freshest cached state. Fired by the client when it
    // becomes our turn (defeats a Phaser-side stale render) and after a
    // game-state rehydrate (defeats the blank-table-on-rejoin race).
    this._onForceRender = () => {
      if (this._isLive()) this._releaseGateAndRepaint();
    };

    EventBus.on("state-update", this._onStateUpdate);
    EventBus.on("animate-trick-winner", this._onAnimateTrickWinner);
    EventBus.on("force-render", this._onForceRender);

    // ── Visibility-change recovery ────────────────────────────────────────
    // When a tab is backgrounded mid-animation, Phaser pauses the scene
    // clock and the `delayedCall(750)` inside the trick flight never fires
    // — leaving the gate up and silently dropping every render until the
    // next refresh. On `visibilitychange → visible`, force the gate open
    // and re-render with the latest server state we have cached. The
    // wall-clock watchdog covers the case where the user never backgrounds
    // but the scene clock still stalls; this covers the explicit-background
    // case for free.
    this._onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      if (this.sys?.isActive()) this._releaseGateAndRepaint();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this._onVisibility);
    }

    // Detach listeners as soon as the scene shuts down or gets destroyed,
    // so dev-mode double-mounts (React strict mode + HMR) don't fire
    // callbacks against a dead displayList.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this._cleanupBus, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this._cleanupBus, this);

    // Tell React the listener is now wired. PhaserGame re-emits its latest
    // cached state-update on this signal — fixes the "table is blank after
    // refresh until I open a drawer" race where the first state-update was
    // emitted before this listener existed and got dropped on the floor.
    // CREATE fires after Phaser changes the scene from CREATING to RUNNING.
    // Replaying synchronously inside create() only caches state and can leave
    // the table blank when asset loading outlasts React's startup timers.
    this.events.once(Phaser.Scenes.Events.CREATE, () =>
      EventBus.emit("scene-ready"),
    );
  }

  /**
   * Run at full frame rate only while something moves. A still table (the
   * usual state: someone is thinking) drops to the idle rate PhaserGame set,
   * which saves phones a lot of battery over a 27-round game. Phaser has no
   * public setter for the limit; `_limitRate` is the one its fps-limited
   * step reads (phaser is pinned to 3.90.0).
   */
  update() {
    const loop = this.game.loop;
    if (!this._idleFrameMs || !loop.hasFpsLimit) return;
    let busy =
      this.trick.animating || this.cameras.main.shakeEffect.isRunning;
    // Looping tweens (the trump sparkle) don't count: they'd keep it busy forever.
    for (const tween of this.tweens.tweens) {
      if (busy) break;
      busy = !tween.isInfinite;
    }
    loop._limitRate = busy ? 0 : this._idleFrameMs;
  }

  /** The scene is running and can draw. */
  _isLive() {
    return !!(this.sys && this.sys.displayList && this.sys.isActive());
  }

  /** Redraw from the cached state (views skip what hasn't changed). */
  _repaint() {
    if (this._isLive() && this.gameState) this._renderAll(this.gameState);
  }

  /** Open the trick-flight gate and draw the freshest state. */
  _releaseGateAndRepaint() {
    this.trick.endFlight();
    this._repaint();
  }

  _renderAll(state) {
    if (!state || this.trick.animating) return;
    this._lastRendered = state;
    for (const view of this.views) view.render(state, this.L);
  }

  _cleanupBus() {
    this.avatars?.photos.dispose();
    this.trick?.endFlight();
    if (this._onResize) this.scale?.off("resize", this._onResize);
    this._onResize = null;
    if (this._onStateUpdate) EventBus.off("state-update", this._onStateUpdate);
    if (this._onAnimateTrickWinner)
      EventBus.off("animate-trick-winner", this._onAnimateTrickWinner);
    if (this._onForceRender) EventBus.off("force-render", this._onForceRender);
    if (this._onVisibility && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this._onVisibility);
    }
    this._onStateUpdate = null;
    this._onAnimateTrickWinner = null;
    this._onForceRender = null;
    this._onVisibility = null;
  }
}
