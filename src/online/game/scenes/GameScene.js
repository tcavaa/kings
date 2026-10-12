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
const hexToInt = (hex) => parseInt(hex.slice(1), 16);

const W = 1100;
const H = 700;

// ── Table geometry ────────────────────────────────────────────────────────────
const TABLE_CX = W / 2;
const TABLE_CY = H / 2 - 30;
const TABLE_RX = 470;
const TABLE_RY = 240;

// ── Player slot positions, by relative seat (0 = self at bottom) ──────────────
// We place own avatar at the very bottom of the canvas (under the cards),
// and the two opponents on the left/right sides where their card-fans sit.
const AVATAR_POS = [
  { x: TABLE_CX, y: H - 88 }, // self (bottom)
  { x: 100, y: H / 2 - 40 }, // left opponent
  { x: W - 100, y: H / 2 - 40 }, // right opponent
];

// Position of the opponent card fans
const OPP_FAN_POS = [
  null,
  { baseX: 230, y: H / 2 - 40, dir: 1 }, // left
  { baseX: W - 230, y: H / 2 - 40, dir: -1 }, // right
];

// Centre trick drop zones (3 cards in a slight overlap stack)
const TRICK_POS = [
  { x: TABLE_CX, y: TABLE_CY + 50, angle: -4 }, // self
  { x: TABLE_CX - 60, y: TABLE_CY, angle: -10 }, // left
  { x: TABLE_CX + 60, y: TABLE_CY, angle: 10 }, // right
];

// Avatar accent colours
const AVATAR_COLOR = [0xd7fa52, 0x91a578, 0x91a578]; // self gold, opps green
const AVATAR_COLOR_HEX = ["#d7fa52", "#91a578", "#91a578"];

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
    this._lastTrickWinner = null;
    this._lastTrickKingHearts = false;
  }

  _ensureAvatarTexture(player) {
    return this._avatarCache.resolve(player);
  }

  create() {
    this._avatarCache = new AvatarTextureCache(this.textures, () => {
      if (this.sys?.isActive() && this.gameState) this._renderAll(this.gameState);
    });
    this._drawBackground();
    this._drawTable();
    this._drawWatermark();

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

  // ── Saloon-felt background (PNG) with a procedural fallback ──────────────
  _drawBackground() {
    const g = this.add.graphics();
    g.fillStyle(0xdceae1, 1);
    g.fillRect(0, 0, W, H);
    const left = 55,
      right = W - 55,
      top = H * 0.23,
      bottom = H * 0.81,
      cut = 92;
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
    g.strokeRoundedRect(35, top - 20, W - 70, bottom - top + 40, 12);
    g.lineStyle(1, 0x889875, 0.1);
    g.lineBetween(W * 0.5, top + 22, W * 0.5, top + 45);
    g.lineBetween(W * 0.5, bottom - 22, W * 0.5, bottom - 45);
  }

  _drawTable() {}

  _drawWatermark() {
    this.add
      .text(TABLE_CX, TABLE_CY - 22, "kıng", {
        fontSize: "40px",
        color: "#b5e6ce",
        fontFamily: "Arial, sans-serif",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0.42);
    this.add
      .text(TABLE_CX, TABLE_CY + 14, "P L A Y   W I T H   I N T E N T", {
        fontSize: "8px",
        color: "#82946d",
        fontFamily: "Arial, sans-serif",
      })
      .setOrigin(0.5)
      .setAlpha(0.4);
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
    const pos = AVATAR_POS[rel];
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
      { rel: 1, seat: (mySeat + 1) % 3, ...OPP_FAN_POS[1] },
      { rel: 2, seat: (mySeat + 2) % 3, ...OPP_FAN_POS[2] },
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

      const pos = AVATAR_POS[rel];
      const accentHex = AVATAR_COLOR_HEX[rel];
      const accentInt = AVATAR_COLOR[rel];
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

      // Name + score chip (mimics 'Frank / 1,860' style)
      const nameOffY = isOwn ? radius + 16 : radius + 18;
      const nameLabel = isOwn ? "შენ" : player.name;
      const nameTxt = this.add
        .text(0, nameOffY, nameLabel, {
          fontSize: "14px",
          color: isOwn ? "#163d31" : "#ffffff",
          fontFamily: "Noto Sans Georgian, Inter, system-ui, Arial, sans-serif",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
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
      // small coin icon
      const coin = this.add.graphics();
      coin.fillStyle(0xd7fa52, 1);
      coin.fillCircle(-22, scoreOffY, 5);
      coin.fillStyle(0xfde68a, 1);
      coin.fillCircle(-22, scoreOffY, 3);
      container.add(coin);
      const scoreTxt = this.add
        .text(-12, scoreOffY, scoreStr, {
          fontSize: "13px",
          color: scoreCol,
          fontFamily: "Inter, system-ui, Arial, sans-serif",
          fontStyle: "bold",
        })
        .setOrigin(0, 0.5);
      container.add(scoreTxt);

      // Leader / "Dealer" pill
      if (isLeader) {
        const pillY = scoreOffY + 18;
        const pillBg = this.add.graphics();
        pillBg.fillStyle(0x303b28, 1); // Kakhetian wine
        pillBg.fillRoundedRect(-32, pillY - 9, 64, 18, 2);
        pillBg.lineStyle(1, 0xc7e88b, 0.75);
        pillBg.strokeRoundedRect(-32, pillY - 9, 64, 18, 2);
        container.add(pillBg);
        container.add(
          this.add
            .text(0, pillY, "წამყვანი", {
              fontSize: "10px",
              color: "#f5f2e9",
              fontFamily: "Noto Sans Georgian, Arial, sans-serif",
              fontStyle: "bold",
            })
            .setOrigin(0.5),
        );
      }

      // Sound buttons (3 different reactions) next to the avatar

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

    // On narrow viewports the canvas is FIT-scaled down and individual cards
    // become finger-unfriendly — push spacing up a touch so adjacent cards
    // don't overlap into a single tap-target.
    const isNarrow = typeof window !== "undefined" && window.innerWidth < 720;
    const total = hand.length;
    const maxSpacing = isNarrow ? 78 : 64;
    const minSpacing = isNarrow ? 46 : 36;
    const spacing = Math.max(
      minSpacing,
      Math.min(maxSpacing, (W - 200) / Math.max(1, total)),
    );
    const startX = W / 2 - ((total - 1) * spacing) / 2;
    // Lifted so the fan clears the own avatar + sound button underneath.
    const baseY = H - 192;
    const isMyTurn = gamePhase === "playing" && currentTurn === mySeat;
    const midIdx = (total - 1) / 2;

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
      const x = startX + i * spacing;
      const fanAngle = (i - midIdx) * 1.6;
      // slight curve: ends drop a bit
      const yCurve = Math.abs(i - midIdx) * 1.2;
      const y = baseY + yCurve;
      const playable = isPlayableCard(card, state);
      const inter = isMyTurn && playable;
      const isTrump = state.trumpSuit && card.suit === state.trumpSuit;

      const container = createFaceUpCard(this, x, y, card, inter);
      container.setAngle(fanAngle);
      container.setDepth(20 + i);
      container.origY = y;
      container.fanAngle = fanAngle;

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
        container.setScale(0.55);
        container.setAlpha(0);
        this.tweens.add({
          targets: container,
          x,
          y,
          angle: fanAngle,
          scaleX: 1,
          scaleY: 1,
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
            scaleX: 1.06,
            scaleY: 1.06,
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
            scaleX: 1,
            scaleY: 1,
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
      const pos = TRICK_POS[rel];
      const container = createFaceUpCard(this, pos.x, pos.y, card, false);
      container.setAngle(pos.angle);
      container.setDepth(50 + rel);
      container.trickRel = rel;
      this.trickCards.push(container);

      // Card-play swoop: enter from the seat's avatar position, rotate +
      // bounce into the trick spot. Only the most-recently-played card on a
      // *new* trick state animates; earlier cards in this trick (and re-
      // renders of an existing trick) snap to place silently.
      if (!wasNew) return;
      const isNewest = i === currentTrick.length - 1;
      if (!isNewest) return;
      const from = AVATAR_POS[rel] || pos;
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
    const target = AVATAR_POS[rel];

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

    centerCards.forEach((card, i) => {
      const x = TABLE_CX - 50 + i * 100;
      const container = createFaceUpCard(this, x, TABLE_CY + 10, card, false);

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
      .text(TABLE_CX, TABLE_CY + CARD_H / 2 + 28, "❖  პრიკუპი  ❖", {
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
      const pos = AVATAR_POS[rel];

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

  shutdown() {
    this._cleanupBus();
  }
}

// Re-export for PhaserGame to know the canvas size
export const SCENE_W = W;
export const SCENE_H = H;
