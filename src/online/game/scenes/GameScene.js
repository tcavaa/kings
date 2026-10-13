import { AvatarTextureCache, avatarCoverSize } from "../lib/AvatarTextureCache.js";
import Phaser from "phaser";
import { EventBus } from "../EventBus.js";
import {
  createFaceUpCard,
  createFaceDownCard,
  CARD_W,
  CARD_H,
} from "../objects/Card.js";

// CSS hex string ("#daa520") → Phaser color int (0xdaa520).

// ── Table layouts ─────────────────────────────────────────────────────────────
// The scene is drawn in its own coordinates and FIT-scaled into the screen.
// A wide screen gets the classic table: opponents left and right, own hand in
// one fanned row. A tall (portrait) screen gets a tall table — opponents at the
// top, own hand in two rows of big cards — so a phone held upright isn't
// limited to a sliver of the width. The scene switches when the screen turns.
//   VIEW_TOP  the camera skips this empty band above the felt (the top bar
//             overlays it), so the table fills more of the screen.
export function layoutFor(portrait) {
  if (!portrait) {
    const W = 1100, H = 700, TABLE_CX = W / 2, TABLE_CY = H / 2 - 20;
    return {
      portrait: false, W, H, VIEW_TOP: 55, TABLE_CX, TABLE_CY,
      felt: { left: 55, right: W - 55, top: H * 0.23, bottom: H * 0.845, cut: 92 },
      // relative seat: 0 = self (bottom, under the cards — its name and score
      // sit to the right of the photo, so it can sit low), 1 = left, 2 = right
      AVATAR_POS: [
        { x: TABLE_CX, y: H - 60 },
        { x: 100, y: H / 2 - 40 },
        { x: W - 100, y: H / 2 - 40 },
      ],
      OPP_FAN_POS: [
        null,
        { baseX: 230, y: H / 2 - 40, dir: 1 },
        { baseX: W - 230, y: H / 2 - 40, dir: -1 },
      ],
      // Centre trick drop zones (3 cards in a slight overlap stack)
      TRICK_POS: [
        { x: TABLE_CX, y: TABLE_CY + 50, angle: -4 },
        { x: TABLE_CX - 60, y: TABLE_CY, angle: -10 },
        { x: TABLE_CX + 60, y: TABLE_CY, angle: 10 },
      ],
    };
  }
  const W = 720, H = 1240, TABLE_CX = W / 2, TABLE_CY = 545;
  return {
    portrait: true, W, H, VIEW_TOP: 0, TABLE_CX, TABLE_CY,
    felt: { left: 26, right: W - 26, top: 280, bottom: 810, cut: 70 },
    // Opponents sit above the table (clear of the top bar and the
    // "waiting for…" pill); own avatar at the very bottom under the hand.
    AVATAR_POS: [
      { x: TABLE_CX, y: H - 70 },
      { x: 135, y: 170 },
      { x: W - 135, y: 170 },
    ],
    OPP_FAN_POS: [
      null,
      { baseX: 190, y: 372, dir: 1 },
      { baseX: W - 190, y: 372, dir: -1 },
    ],
    TRICK_POS: [
      { x: TABLE_CX, y: TABLE_CY + 70, angle: -4 },
      { x: TABLE_CX - 72, y: TABLE_CY - 5, angle: -10 },
      { x: TABLE_CX + 72, y: TABLE_CY - 5, angle: 10 },
    ],
  };
}

/** A box taller than wide gets the tall table. */
export const isPortraitBox = (w, h) => h > w * 1.1;

/** The scene size for a layout (what the Phaser game is created with). */
export const sceneSize = (L) => ({ width: L.W, height: L.H - L.VIEW_TOP });

// Avatar accent colours

// Mirror of server-side validatePlay() so the UI greys out cards that the
// server would reject. Source of truth lives in server/game/GameState.js —
// keep the rules here in sync with that file.
const TRUMP_TYPES = new Set(["P1", "P2", "P3"]);

function isPlayableCard(card, state) {
  const {
    currentTurn,
    mySeat,
    gamePhase,
    currentTrick,
    ledSuit,
    chosenGameType,
    trumpSuit,
    hand,
    trickAnimation,
    playPending,
  } = state;
  if (gamePhase !== "playing") return false;
  if (currentTurn !== mySeat) return false;
  // Lock interaction while the just-completed trick is being revealed/animated.
  if (trickAnimation) return false;
  // Lock the entire hand the moment the user has clicked a card and the
  // server hasn't yet acked. Stops rapid-fire clicks from optimistically
  // removing additional cards before the first round-trip completes.
  if (playPending) return false;

  // Leading a new trick (or a fresh one after a 3-card-clear).
  if (!currentTrick || currentTrick.length === 0 || currentTrick.length === 3) {
    if (chosenGameType === "K" || chosenGameType === "H") {
      const nonHearts = (hand || []).filter((c) => c.suit !== "H");
      if (nonHearts.length > 0) return card.suit !== "H";
    }
    return true;
  }

  // Following a trick.
  if (ledSuit) {
    const hasSuit = (hand || []).some((c) => c.suit === ledSuit);
    if (hasSuit) return card.suit === ledSuit;

    // Cannot follow suit — apply the same forced-play rules as the server.
    // 'K' game: if the player still holds K♥, they must play it.
    if (chosenGameType === "K") {
      const hasKingOfHearts = (hand || []).some(
        (c) => c.rank === "K" && c.suit === "H",
      );
      if (hasKingOfHearts) return card.rank === "K" && card.suit === "H";
    }
    // Pluses with trump: must play a trump card if any.
    if (trumpSuit && TRUMP_TYPES.has(chosenGameType)) {
      const hasTrump = (hand || []).some((c) => c.suit === trumpSuit);
      if (hasTrump) return card.suit === trumpSuit;
    }
  }
  return true;
}

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: "GameScene" });
    this.gameState = null;
    this.handCards = [];
    this.trickCards = [];
    this.opponentCards = { 1: [], 2: [] };
    this.avatarObjs = [];
    this.centerObjs = [];
    this.chatObjs = [];
    this._avatarCache = null;
    this._animatingTrick = false;
    // Track when a fresh deal happens so we play the deal animation only on
    // the moment hands materialise (round start), not on every re-render.
    this._lastDealRound = null;
  }

  _ensureAvatarTexture(player) {
    return this._avatarCache.resolve(player);
  }

  create() {
    this._avatarCache = new AvatarTextureCache(this.textures, () => {
      if (this.sys?.isActive() && this.gameState) this._renderAll(this.gameState);
    });
    const size = this.scale.gameSize;
    this.L = layoutFor(size.height > size.width);
    this.staticObjs = [];
    this._drawBackground();
    this._drawWatermark();

    this.cameras.main.setScroll(0, this.L.VIEW_TOP);

    // When the screen turns, switch layouts; either way the hand's card size
    // depends on how big the canvas is on screen, so repaint.
    this._onResize = () => {
      if (!this.sys || !this.sys.isActive()) return;
      const parent = this.scale.parentSize;
      const portrait = isPortraitBox(parent.width, parent.height);
      if (parent.width > 0 && portrait !== this.L.portrait) {
        this.L = layoutFor(portrait);
        const { width, height } = sceneSize(this.L);
        this.cameras.main.setScroll(0, this.L.VIEW_TOP);
        this.staticObjs.forEach((o) => o.destroy());
        this.staticObjs = [];
        this._drawBackground();
        this._drawWatermark();
        this.scale.setGameSize(width, height); // fires resize again → repaint below
        return;
      }
      if (this.gameState && !this._animatingTrick) this._renderAll(this.gameState);
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
      if (!this.sys || !this.sys.displayList || !this.sys.isActive()) return;
      this._renderAll(state);
    };
    this._onAnimateTrickWinner = ({ winnerSeat }) => {
      if (!this.sys || !this.sys.displayList || !this.sys.isActive()) return;
      this._animateTrickToWinner(winnerSeat);
    };
    // Hard resync hook: force the canvas to drop any stuck animation gate and
    // repaint from the freshest cached state. Fired by the client when it
    // becomes our turn (defeats a Phaser-side stale render) and after a
    // game-state rehydrate (defeats the blank-table-on-rejoin race).
    this._onForceRender = () => {
      if (!this.sys || !this.sys.displayList || !this.sys.isActive()) return;
      this._animatingTrick = false;
      if (this._trickWatchdog) {
        clearTimeout(this._trickWatchdog);
        this._trickWatchdog = null;
      }
      if (this.gameState) this._renderAll(this.gameState);
    };


    EventBus.on("state-update", this._onStateUpdate);
    EventBus.on("animate-trick-winner", this._onAnimateTrickWinner);
    EventBus.on("force-render", this._onForceRender);

    // ── Visibility-change recovery ────────────────────────────────────────
    // When a tab is backgrounded mid-animation, Phaser pauses the scene
    // clock and the `delayedCall(750)` inside `_animateTrickToWinner`
    // never fires — leaving `_animatingTrick = true` and silently
    // dropping every render until the next refresh. On `visibilitychange
    // → visible`, force the gate open and re-render with the latest
    // server state we have cached. The wall-clock watchdog covers the
    // case where the user never backgrounds but the scene clock still
    // stalls; this covers the explicit-background case for free.
    this._onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      if (!this.sys || !this.sys.isActive()) return;
      this._animatingTrick = false;
      if (this._trickWatchdog) {
        clearTimeout(this._trickWatchdog);
        this._trickWatchdog = null;
      }
      if (this.gameState) this._renderAll(this.gameState);
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

  _cleanupBus() {
    this._avatarCache?.dispose();
    if (this._onResize) this.scale?.off("resize", this._onResize);
    this._onResize = null;
    if (this._onStateUpdate) EventBus.off("state-update", this._onStateUpdate);
    if (this._onAnimateTrickWinner)
      EventBus.off("animate-trick-winner", this._onAnimateTrickWinner);
    if (this._onForceRender) EventBus.off("force-render", this._onForceRender);
    if (this._onVisibility && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this._onVisibility);
    }
    if (this._trickWatchdog) {
      clearTimeout(this._trickWatchdog);
      this._trickWatchdog = null;
    }
    this._onStateUpdate = null;
    this._onAnimateTrickWinner = null;
    this._onForceRender = null;
    this._onVisibility = null;
  }

  // ── The table: a parchment room with a green felt, drawn in code ─────────
  _drawBackground() {
    const { W, H, felt } = this.L;
    const g = this.add.graphics();
    this.staticObjs.push(g);
    g.fillStyle(0xdceae1, 1);
    g.fillRect(0, 0, W, H);
    const { left, right, top, bottom, cut } = felt;
    const points = [
      { x: left + cut, y: top },
      { x: right - cut, y: top },
      { x: right, y: top + cut },
      { x: right, y: bottom - cut },
      { x: right - cut, y: bottom },
      { x: left + cut, y: bottom },
      { x: left, y: bottom - cut },
      { x: left, y: top + cut },
    ];
    g.fillStyle(0x168665, 1);
    g.fillPoints(points, true);
    g.lineStyle(5, 0xd7bb75, 1);
    g.strokePoints(points, true);
    g.lineStyle(2, 0x89b69d, 0.7);
    g.strokeRoundedRect(left - 20, top - 20, right - left + 40, bottom - top + 40, 12);
    g.lineStyle(1, 0x889875, 0.1);
    g.lineBetween(W * 0.5, top + 22, W * 0.5, top + 45);
    g.lineBetween(W * 0.5, bottom - 22, W * 0.5, bottom - 45);
  }

  _drawWatermark() {
    const { TABLE_CX, TABLE_CY } = this.L;
    const logo = this.add
      .text(TABLE_CX, TABLE_CY - 22, "kıng", {
        fontSize: "40px",
        color: "#b5e6ce",
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0.42);
    const motto = this.add
      .text(TABLE_CX, TABLE_CY + 14, "P L A Y   W I T H   I N T E N T", {
        fontSize: "8px",
        color: "#82946d",
        fontFamily: "Arial, sans-serif",
      })
      .setOrigin(0.5)
      .setAlpha(0.4);
    this.staticObjs.push(logo, motto);
  }

  _renderAll(state) {
    if (!state) return;
    if (this._animatingTrick) return;
    this._clearDynamic();
    this._renderOpponentCards(state);
    this._renderAvatars(state);
    this._renderHand(state);
    this._renderTrickArea(state);
    this._renderCenterCards(state);
    this._renderChatBubbles(state);
    this._maybeReactToTrickWinner(state);
  }

  /**
   * If a brand-new lastTrick has appeared since the last render, run the
   * "winner reaction" effects: avatar pulse on the winner + camera shake +
   * red flash if the K♥ was in the trick.
   */
  _maybeReactToTrickWinner(state) {
    const lt = state.lastTrickResult;
    if (!lt || !Array.isArray(lt.trick)) return;
    // Use the trick's first-card identity as a cheap "is this a new event?"
    // probe — round changes and trick number both reset elsewhere, this is
    // robust enough for visual fanfare.
    const probe = `${state.round}:${lt.trick.map((t) => t.card.rank + t.card.suit).join("")}`;
    if (this._lastTrickProbe === probe) return;
    this._lastTrickProbe = probe;

    const tookKingHearts = lt.trick.some(
      (t) => t.card.rank === "K" && t.card.suit === "H",
    );
    this._pulseAvatarFor(lt.winnerSeat, tookKingHearts ? 0xd4574d : 0xf0c75a);
    if (tookKingHearts) this._shakeOnKingOfHearts();
  }

  _pulseAvatarFor(seat, colour) {
    const state = this.gameState;
    if (!state) return;
    const mySeat = state.mySeat ?? 0;
    const rel = (seat - mySeat + 3) % 3;
    const pos = this.L.AVATAR_POS[rel];
    if (!pos) return;
    const ring = this.add.graphics();
    ring.lineStyle(4, colour, 1);
    ring.strokeCircle(pos.x, pos.y, 44);
    ring.setDepth(120);
    this.tweens.add({
      targets: ring,
      alpha: { from: 1, to: 0 },
      scaleX: { from: 1, to: 1.6 },
      scaleY: { from: 1, to: 1.6 },
      duration: 700,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  _shakeOnKingOfHearts() {
    if (!this.cameras?.main) return;
    this.cameras.main.shake(220, 0.014);
    // Brief red vignette — overlay rectangle that fades out
    const { W, H } = this.L;
    const flash = this.add.rectangle(W / 2, H / 2, W, H, 0xc92020, 0);
    flash.setDepth(999);
    this.tweens.add({
      targets: flash,
      alpha: { from: 0.32, to: 0 },
      duration: 360,
      ease: "Cubic.easeOut",
      onComplete: () => flash.destroy(),
    });
  }

  _clearDynamic() {
    this.handCards.forEach((c) => c.destroy());
    this.handCards = [];
    this.trickCards.forEach((c) => c.destroy());
    this.trickCards = [];
    [1, 2].forEach((side) => {
      this.opponentCards[side].forEach((c) => c.destroy());
      this.opponentCards[side] = [];
    });
    this.centerObjs.forEach((c) => c.destroy());
    this.centerObjs = [];
    this.avatarObjs.forEach((c) => c.destroy());
    this.avatarObjs = [];
    if (this.chatObjs) this.chatObjs.forEach((c) => c.destroy());
    this.chatObjs = [];
  }

  // ── Opponent face-down card fans on left/right ───────────────────────────
  _renderOpponentCards(state) {
    const { cardCounts = {}, gamePhase, round } = state;
    // `?? 0`, not a destructuring default: a spectator's mySeat is null,
    // and `= 0` only fires on undefined. Left as null it poisons every
    // `(mySeat + n) % 3` below and one player silently stops being drawn.
    const mySeat = state.mySeat ?? 0;

    const round1Hidden = round === 1 && gamePhase === "type_selection";

    const specs = [
      { rel: 1, seat: (mySeat + 1) % 3, ...this.L.OPP_FAN_POS[1] },
      { rel: 2, seat: (mySeat + 2) % 3, ...this.L.OPP_FAN_POS[2] },
    ];

    specs.forEach(({ rel, seat, baseX, y, dir }) => {
      if (round1Hidden) return;
      const count = Math.min(cardCounts[seat] ?? 0, 10);
      // Fan: small spread, cards angle outward like in the reference
      const spread = 14;
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) - 0.5 : 0;
        const cx = baseX + dir * t * spread * 4;
        const cy = y + Math.abs(t) * 8;
        const card = createFaceDownCard(this, cx, cy);
        card.setAngle(dir * t * 28);
        card.setDepth(i);
        this.opponentCards[rel].push(card);
      }
    });
  }

  _renderAvatars(state) {
    const {
      players = [],
      cumulativeScores = {},
      currentTurn,
      gamePhase,
      cardCounts = {},
      leaderSeat,
      round,
    } = state;
    // See the note in the hand-count renderer: null must be coerced here,
    // otherwise the seat-0 slot resolves to `seat: null`, matches no
    // player, and that player's avatar never appears for a watcher.
    const mySeat = state.mySeat ?? 0;

    const slots = [
      { rel: 0, seat: mySeat },
      { rel: 1, seat: (mySeat + 1) % 3 },
      { rel: 2, seat: (mySeat + 2) % 3 },
    ];

    slots.forEach(({ rel, seat }) => {
      const player = players.find((p) => p.seat === seat);
      if (!player) return;

      const pos = this.L.AVATAR_POS[rel];
      // A watcher occupies no seat: rel 0 is simply the player the table is
      // being viewed from, not the person looking. Treating them as "own"
      // would label a stranger "შენ" and hand the watcher their sound buttons.
      const isOwn = rel === 0 && !state.spectator;
      const isActive = gamePhase === "playing" && currentTurn === seat;
      const isLeader = seat === leaderSeat;
      const score = cumulativeScores[seat] ?? 0;
      const cardCount = cardCounts[seat] ?? 0;
      const round1Hide =
        round === 1 && gamePhase === "type_selection" && !isLeader && !isOwn;

      const radius = isOwn ? 38 : 36;
      const container = this.add.container(pos.x, pos.y);
      // The tall table is shown smaller per scene unit; keep names readable.
      if (this.L.portrait) container.setScale(1.4);

      // Crisp player plate. A solid edge marks the turn without a perpetual glow tween.
      const ringCol = isActive ? 0xf3ba45 : 0x71baa3;
      const plate = this.add.graphics();
      plate.fillStyle(0xfffcf3, 1);
      plate.fillRoundedRect(
        -radius - 3,
        -radius - 3,
        radius * 2 + 6,
        radius * 2 + 6,
        5,
      );
      plate.lineStyle(isActive ? 2 : 1, ringCol, 1);
      plate.strokeRoundedRect(
        -radius - 3,
        -radius - 3,
        radius * 2 + 6,
        radius * 2 + 6,
        5,
      );
      if (isActive) {
        plate.fillStyle(0xf3ba45);
        plate.fillRect(-14, -radius - 5, 28, 3);
      }
      container.add(plate);

      // Profile picture (data URL → texture) → avatar-default → initial letter
      const avatarKey = this._ensureAvatarTexture(player);
      const pickedKey =
        avatarKey ||
        (this.textures.exists("avatar-default") ? "avatar-default" : null);

      if (pickedKey) {
        const pic = this.add.image(0, 0, pickedKey);
        const cover = avatarCoverSize(pic.width, pic.height, radius * 2 - 6);
        pic.setDisplaySize(cover.width, cover.height);
        const maskShape = this.make.graphics({ x: 0, y: 0, add: false });
        maskShape.fillRoundedRect(
          pos.x - radius + 3,
          pos.y - radius + 3,
          radius * 2 - 6,
          radius * 2 - 6,
          3,
        );
        const avatarMask = maskShape.createGeometryMask();
        pic.setMask(avatarMask);
        pic.once("destroy", () => {
          avatarMask.destroy();
          maskShape.destroy();
        });
        container.add(pic);
      } else {
        const initText = this.add
          .text(0, 0, player.name[0].toUpperCase(), {
            fontSize: isOwn ? "28px" : "26px",
            color: "#ffffff",
            fontFamily: "Georgia, serif",
            fontStyle: "bold",
          })
          .setOrigin(0.5);
        container.add(initText);
      }

      // Card-count badge top-right corner
      if (cardCount > 0 && !round1Hide) {
        const bx = radius - 4,
          by = -radius + 4;
        const badgeBg = this.add.graphics();
        badgeBg.fillStyle(0x0a0a0a, 1);
        badgeBg.fillRoundedRect(bx - 12, by - 12, 24, 22, 6);
        badgeBg.lineStyle(2, ringCol, 1);
        badgeBg.strokeRoundedRect(bx - 12, by - 12, 24, 22, 6);
        container.add(badgeBg);
        container.add(
          this.add
            .text(bx, by - 1, String(cardCount), {
              fontSize: "13px",
              color: "#ffffff",
              fontFamily: "Arial",
              fontStyle: "bold",
            })
            .setOrigin(0.5),
        );
      }

      // Name + score chip (mimics 'Frank / 1,860' style). The bottom seat
      // keeps them beside the photo — on its left, right-aligned, clear of the
      // voice button on its right — so nothing hangs below it.
      const beside = rel === 0;
      const textX = beside ? -(radius + 14) : 0;
      const nameOffY = beside ? -16 : isOwn ? radius + 16 : radius + 18;
      const nameLabel = isOwn ? "შენ" : player.name;
      const nameTxt = this.add
        .text(textX, nameOffY, nameLabel, {
          fontSize: "14px",
          color: isOwn ? "#163d31" : "#ffffff",
          fontFamily: "Noto Sans Georgian, Inter, system-ui, Arial, sans-serif",
          fontStyle: "bold",
        })
        .setOrigin(beside ? 1 : 0.5, 0.5);
      container.add(nameTxt);

      const scoreOffY = nameOffY + 18;
      const scoreStr = score > 0 ? `+${score}` : `${score}`;
      const scoreCol = !isOwn
        ? score < 0
          ? "#ffe0d3"
          : "#fff3ba"
        : score > 0
          ? "#066b48"
          : score < 0
            ? "#ae3447"
            : "#4f6c5d";
      const scoreTxt = this.add
        .text(beside ? textX : -12, scoreOffY, scoreStr, {
          fontSize: "13px",
          color: scoreCol,
          fontFamily: "Inter, system-ui, Arial, sans-serif",
          fontStyle: "bold",
        })
        .setOrigin(beside ? 1 : 0, 0.5);
      // small coin icon, just before the score
      const coinX = beside ? textX - scoreTxt.width - 10 : -22;
      const coin = this.add.graphics();
      coin.fillStyle(0xd7fa52, 1);
      coin.fillCircle(coinX, scoreOffY, 5);
      coin.fillStyle(0xfde68a, 1);
      coin.fillCircle(coinX, scoreOffY, 3);
      container.add(coin);
      container.add(scoreTxt);

      // Leader / "Dealer" pill
      if (isLeader) {
        const pillY = scoreOffY + 18;
        const pillX = beside ? textX - 32 : 0;
        const pillBg = this.add.graphics();
        pillBg.fillStyle(0x303b28, 1); // Kakhetian wine
        pillBg.fillRoundedRect(pillX - 32, pillY - 9, 64, 18, 2);
        pillBg.lineStyle(1, 0xc7e88b, 0.75);
        pillBg.strokeRoundedRect(pillX - 32, pillY - 9, 64, 18, 2);
        container.add(pillBg);
        container.add(
          this.add
            .text(pillX, pillY, "წამყვანი", {
              fontSize: "10px",
              color: "#f5f2e9",
              fontFamily: "Noto Sans Georgian, Arial, sans-serif",
              fontStyle: "bold",
            })
            .setOrigin(0.5),
        );
      }

      this.avatarObjs.push(container);
    });
  }

  /**
   * Small clickable circles to the side of the local player's avatar, each
   * playing one of the saloon reactions for everyone in the room. Opponents
   * (left/right) intentionally get no buttons — three full grids on screen
   * was visually noisy and the broadcast still reaches both opponents when
   * we play a sound from our own avatar.
   */
  // ── Own hand: fanned at bottom, selected/playable cards lift with golden glow ──
  _renderHand(state) {
    const { hand = [], mySeat, gamePhase, currentTurn } = state;
    if (!hand.length) return;

    const { W, H, TABLE_CX, TABLE_CY, portrait, felt } = this.L;
    const total = hand.length;
    // On a phone the whole scene is scaled down, so the hand is drawn larger
    // to keep cards readable: in one row aim for ~50 px wide on screen (at
    // most 1.3×); the tall table's two rows have room for ~62 px (at most 1.5×).
    const shown = (this.scale.displaySize?.width || W) / W;
    const k = portrait
      ? Phaser.Math.Clamp(62 / (CARD_W * shown), 1, 1.5)
      : Phaser.Math.Clamp(50 / (CARD_W * shown), 1, 1.3);
    const slots = [];
    if (portrait) {
      // Two rows under the table: the first half on top, the rest below.
      const cw = CARD_W * k;
      const ch = CARD_H * k;
      const rows = total > 5 ? [Math.ceil(total / 2), Math.floor(total / 2)] : [total];
      let i = 0;
      rows.forEach((count, r) => {
        const spacing = count > 1 ? Math.min(cw + 10, (W - 40 - cw) / (count - 1)) : 0;
        const startX = W / 2 - ((count - 1) * spacing) / 2;
        const rowY = felt.bottom + 20 + r * ch * 0.78;
        const mid = (count - 1) / 2;
        for (let j = 0; j < count; j++, i++) {
          slots.push({ x: startX + j * spacing, y: rowY + Math.abs(j - mid) * 2, angle: (j - mid) * 1.2 });
        }
      });
    } else {
      // On narrow viewports the canvas is FIT-scaled down and individual
      // cards become finger-unfriendly — push spacing up a touch so adjacent
      // cards don't overlap into a single tap-target.
      const isNarrow = typeof window !== "undefined" && window.innerWidth < 720;
      const maxSpacing = isNarrow ? 78 : 64;
      const minSpacing = isNarrow ? 46 : 36;
      const spacing = Math.max(
        minSpacing,
        Math.min(maxSpacing, (W - 200) / Math.max(1, total)),
      );
      const startX = W / 2 - ((total - 1) * spacing) / 2;
      // Lifted so the fan clears the own avatar + sound button underneath
      // (bigger cards are lifted by their extra half-height).
      const baseY = H - 167 - ((k - 1) * CARD_H) / 2;
      const midIdx = (total - 1) / 2;
      for (let i = 0; i < total; i++) {
        // slight curve: ends drop a bit
        slots.push({ x: startX + i * spacing, y: baseY + Math.abs(i - midIdx) * 1.2, angle: (i - midIdx) * 1.6 });
      }
    }
    const isMyTurn = gamePhase === "playing" && currentTurn === mySeat;

    // Detect a fresh deal: round changed AND we now have a full(ish) hand.
    const isFreshDeal = state.round !== this._lastDealRound && hand.length >= 9;
    if (isFreshDeal) {
      this._lastDealRound = state.round;
      // Try to play a shuffle SFX if it exists. No-op if the file isn't
      // present (browser will silently fail and our catch swallows it).
      try {
        const shuffle = new window.Audio("/sounds/shuffle.mp3");
        shuffle.volume = 0.5;
        shuffle.play().catch(() => {});
      } catch {
        /* ignore */
      }
    }

    hand.forEach((card, i) => {
      const { x, y, angle: fanAngle } = slots[i];
      const playable = isPlayableCard(card, state);
      const inter = isMyTurn && playable;
      const isTrump = state.trumpSuit && card.suit === state.trumpSuit;

      const container = createFaceUpCard(this, x, y, card, inter);
      container.setScale(k);
      container.setAngle(fanAngle);
      container.setDepth(20 + i);

      if (gamePhase === "playing" && !playable) {
        container.setAlpha(0.82);
      }

      // Subtle gold sparkle border on trump-suit cards in hand.
      if (isTrump) {
        const sparkle = this.add.graphics();
        sparkle.lineStyle(2, 0xf0c75a, 0.85);
        sparkle.strokeRoundedRect(
          -CARD_W / 2 - 2,
          -CARD_H / 2 - 2,
          CARD_W + 4,
          CARD_H + 4,
          8,
        );
        container.add(sparkle);
        this.tweens.add({
          targets: sparkle,
          alpha: { from: 0.4, to: 0.95 },
          duration: 1100,
          yoyo: true,
          repeat: -1,
        });
      }

      // Card-deal entrance: cards fly in from a center "deck" stack at the
      // top of the table, staggered by index, into their fanned position.
      if (isFreshDeal) {
        const fromX = TABLE_CX + (Math.random() - 0.5) * 14;
        const fromY = TABLE_CY - 10;
        container.setPosition(fromX, fromY);
        container.setAngle(0);
        container.setScale(0.55 * k);
        container.setAlpha(0);
        this.tweens.add({
          targets: container,
          x,
          y,
          angle: fanAngle,
          scaleX: k,
          scaleY: k,
          alpha: 1,
          duration: 380,
          delay: i * 55,
          ease: "Cubic.easeOut",
        });
      }

      if (inter) {
        // A precise corner accent identifies playable cards without continuous tweens.
        const accent = this.add.graphics();
        accent.lineStyle(1.5, 0xd7fa52, 0.9);
        accent.strokeRoundedRect(
          -CARD_W / 2 - 2,
          -CARD_H / 2 - 2,
          CARD_W + 4,
          CARD_H + 4,
          4,
        );
        container.add(accent);

        container.on("pointerover", () => {
          this.tweens.killTweensOf(container);
          this.tweens.add({
            targets: container,
            y: y - 24,
            angle: 0,
            scaleX: 1.06 * k,
            scaleY: 1.06 * k,
            duration: 160,
            ease: "Quad.easeOut",
          });
        });
        container.on("pointerout", () => {
          this.tweens.killTweensOf(container);
          this.tweens.add({
            targets: container,
            y,
            angle: fanAngle,
            scaleX: k,
            scaleY: k,
            duration: 160,
            ease: "Quad.easeIn",
          });
        });
        container.on("pointerdown", () => EventBus.emit("card-clicked", card));
      }

      this.handCards.push(container);
    });
  }

  // ── Trick: 3 cards arranged as in the reference (overlap with rotation) ──
  _renderTrickArea(state) {
    const { currentTrick = [] } = state;
    const mySeat = state.mySeat ?? 0;
    if (!currentTrick.length) return;

    // Track which card identities we've already animated this trick — so a
    // re-render in the middle of an existing trick doesn't replay the swoop.
    const seenKey = currentTrick
      .map((t) => t.card.rank + t.card.suit)
      .join("|");
    const wasNew = seenKey !== this._lastTrickCardsKey;
    this._lastTrickCardsKey = seenKey;

    currentTrick.forEach(({ seat, card }, i) => {
      const rel = (seat - mySeat + 3) % 3;
      const pos = this.L.TRICK_POS[rel];
      const container = createFaceUpCard(this, pos.x, pos.y, card, false);
      container.setAngle(pos.angle);
      container.setDepth(50 + rel);
      this.trickCards.push(container);

      // Card-play swoop: enter from the seat's avatar position, rotate +
      // bounce into the trick spot. Only the most-recently-played card on a
      // *new* trick state animates; earlier cards in this trick (and re-
      // renders of an existing trick) snap to place silently.
      if (!wasNew) return;
      const isNewest = i === currentTrick.length - 1;
      if (!isNewest) return;
      const from = this.L.AVATAR_POS[rel] || pos;
      container.setPosition(from.x, from.y);
      container.setAngle(0);
      container.setScale(0.7);
      container.setAlpha(0);
      this.tweens.add({
        targets: container,
        x: pos.x,
        y: pos.y,
        angle: pos.angle,
        scaleX: 1,
        scaleY: 1,
        alpha: 1,
        duration: 320,
        ease: "Back.easeOut",
      });
    });
  }

  _animateTrickToWinner(winnerSeat) {
    const state = this.gameState;
    if (!state || !this.trickCards.length) return;
    const mySeat = state.mySeat ?? 0;
    const rel = (winnerSeat - mySeat + 3) % 3;
    const target = this.L.AVATAR_POS[rel];

    this._animatingTrick = true;

    const cards = this.trickCards.slice();
    cards.forEach((c, i) => {
      this.tweens.add({
        targets: c,
        x: target.x,
        y: target.y,
        scaleX: 0.3,
        scaleY: 0.3,
        alpha: 0,
        angle: Phaser.Math.Between(-25, 25),
        duration: 550,
        ease: "Cubic.easeIn",
        delay: i * 50,
        onComplete: () => c.destroy(),
      });
    });

    // Clear the gate in two ways: Phaser's scene-clock timer (normal happy
    // path, fires exactly when the animation finishes), and a wall-clock
    // watchdog (covers the case where the scene clock stalls — mobile
    // background tab on iOS, visibility transitions, WebGL context loss).
    // The first one to fire wins; the second is a no-op because the flag
    // is already false. Without the watchdog, a stalled scene clock left
    // `_animatingTrick = true` forever and all subsequent state-updates
    // were silently dropped from the canvas (chats still worked because
    // they're React-driven), which manifested as "I can't see the card
    // they played until I refresh".
    const releaseGate = () => {
      if (!this._animatingTrick) return;
      this._animatingTrick = false;
      this.trickCards = [];
      if (this.gameState && this.sys?.isActive?.()) {
        this._renderAll(this.gameState);
      }
    };
    this.time.delayedCall(750, releaseGate);
    // 1500ms ≈ 2× the animation duration. Long enough that the happy path
    // always wins under normal conditions, short enough that a stuck gate
    // self-heals before the next trick.
    if (this._trickWatchdog) clearTimeout(this._trickWatchdog);
    this._trickWatchdog = setTimeout(() => {
      this._trickWatchdog = null;
      releaseGate();
    }, 1500);
  }

  _renderCenterCards(state) {
    const { centerCards = [], gamePhase, mySeat, leaderSeat } = state;
    // Show during type/trump selection and the discard window (so non-leaders
    // still see what 2 cards came from the center after the leader picks).
    const visiblePhases = ["type_selection", "trump_selection", "discard"];
    if (!visiblePhases.includes(gamePhase)) return;
    if (mySeat === leaderSeat) return;
    if (!centerCards?.length) return;

    const { TABLE_CX, TABLE_CY, portrait } = this.L;
    // The tall table has room to show the prikup a size up.
    const pk = portrait ? 1.25 : 1;
    centerCards.forEach((card, i) => {
      const x = TABLE_CX + (i - 0.5) * 100 * pk;
      const container = createFaceUpCard(this, x, TABLE_CY + 10, card, false);
      container.setScale(pk);

      const border = this.add.graphics();
      border.lineStyle(3, 0xc7e88b, 1);
      border.strokeRoundedRect(
        -CARD_W / 2 - 3,
        -CARD_H / 2 - 3,
        CARD_W + 6,
        CARD_H + 6,
        11,
      );
      container.add(border);

      this.centerObjs.push(container);
    });

    const lbl = this.add
      .text(TABLE_CX, TABLE_CY + (CARD_H * pk) / 2 + 28, "❖  პრიკუპი  ❖", {
        fontSize: "11px",
        color: "#d5b982",
        fontFamily: "Noto Sans Georgian, Inter, Arial",
        stroke: "#000",
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    this.centerObjs.push(lbl);
  }

  // ── Chat bubbles above each speaking player's avatar ─────────────────────
  _renderChatBubbles(state) {
    const { chatBubbles = {}, players = [] } = state;
    const mySeat = state.mySeat ?? 0;
    if (!chatBubbles || !Object.keys(chatBubbles).length) return;

    Object.entries(chatBubbles).forEach(([seatStr, msg]) => {
      const seat = Number(seatStr);
      if (!players.find((p) => p.seat === seat)) return;
      const rel = (seat - mySeat + 3) % 3;
      const pos = this.L.AVATAR_POS[rel];

      // Anchor the bubble above the avatar (own at bottom: place above; opps at top: also place above)
      const bubbleY = pos.y - 78;

      // Measure text first by creating a hidden text obj
      const textStyle = {
        fontSize: "13px",
        color: "#1a1a1a",
        fontFamily: "Inter, system-ui, Arial, sans-serif",
        fontStyle: "bold",
        wordWrap: { width: 240, useAdvancedWrap: true },
        align: "center",
      };
      const tmpText = this.add
        .text(0, 0, msg.message || "", textStyle)
        .setVisible(false);
      const tw = Math.max(40, Math.min(260, tmpText.width + 24));
      const th = tmpText.height + 14;
      tmpText.destroy();

      // Bubble container
      const bubble = this.add.container(pos.x, bubbleY);
      const bg = this.add.graphics();
      bg.fillStyle(0xffffff, 1);
      bg.fillRoundedRect(-tw / 2, -th / 2, tw, th, 10);
      bg.lineStyle(2, 0xd7fa52, 1);
      bg.strokeRoundedRect(-tw / 2, -th / 2, tw, th, 10);
      // Tail pointing toward avatar
      bg.fillTriangle(-6, th / 2 - 1, 6, th / 2 - 1, 0, th / 2 + 7);
      bg.lineStyle(2, 0xd7fa52, 1);
      bg.strokeTriangle(-6, th / 2 - 1, 6, th / 2 - 1, 0, th / 2 + 7);
      bubble.add(bg);
      const text = this.add
        .text(0, 0, msg.message || "", textStyle)
        .setOrigin(0.5);
      bubble.add(text);
      bubble.setDepth(100);

      // Subtle entrance
      bubble.setScale(0.7).setAlpha(0);
      this.tweens.add({
        targets: bubble,
        scale: 1,
        alpha: 1,
        duration: 180,
        ease: "Back.easeOut",
      });

      this.chatObjs.push(bubble);
    });
  }

}

// Re-export for PhaserGame to know the canvas size

