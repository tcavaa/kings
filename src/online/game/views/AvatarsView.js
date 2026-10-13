import { AvatarTextureCache } from "../lib/AvatarTextureCache.js";
import { bake, bakedImage, fillRoundRect, strokeRoundRect } from "../lib/bake.js";
import { georgianFont, latinFont } from "../lib/fonts.js";

const GOLD = 0xf3ba45;
const TEAL = 0x71baa3;

// Player plate behind the photo. A solid edge marks the turn without a perpetual glow tween.
function plateTexture(scene, radius, active) {
  const half = radius + 6;
  return bake(scene, `avatar-plate-${radius}-${active ? 1 : 0}`, half * 2, half * 2, (ctx) => {
    const s = radius * 2 + 6;
    fillRoundRect(ctx, -radius - 3, -radius - 3, s, s, 5, 0xfffcf3);
    strokeRoundRect(ctx, -radius - 3, -radius - 3, s, s, 5, active ? 2 : 1, active ? GOLD : TEAL);
    if (active) {
      ctx.fillStyle = "#f3ba45";
      ctx.fillRect(-14, -radius - 5, 28, 3);
    }
  });
}

// Card-count badge, centred on its anchor point.
function badgeTexture(scene, active) {
  return bake(scene, `avatar-badge-${active ? 1 : 0}`, 28, 28, (ctx) => {
    fillRoundRect(ctx, -12, -12, 24, 22, 6, 0x0a0a0a);
    strokeRoundRect(ctx, -12, -12, 24, 22, 6, 2, active ? GOLD : TEAL);
  });
}

function coinTexture(scene) {
  return bake(scene, "avatar-coin", 12, 12, (ctx) => {
    for (const [r, color] of [[5, "#d7fa52"], [3, "#fde68a"]]) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  });
}

// Leader / "Dealer" pill (Kakhetian wine).
function pillTexture(scene) {
  return bake(scene, "avatar-pill", 68, 22, (ctx) => {
    fillRoundRect(ctx, -32, -9, 64, 18, 2, 0x303b28);
    strokeRoundRect(ctx, -32, -9, 64, 18, 2, 1, 0xc7e88b, 0.75);
  });
}

// The three player plates: photo, name, score, card count, leader pill.
// Each seat is rebuilt only when something it shows changes.
export class AvatarsView {
  constructor(scene, onPhotoReady) {
    this.scene = scene;
    this.photos = new AvatarTextureCache(scene.textures, onPhotoReady);
    this.slots = [0, 1, 2].map(() => ({ key: null, container: null }));
  }

  render(state, L) {
    const {
      players = [],
      cumulativeScores = {},
      currentTurn,
      gamePhase,
      cardCounts = {},
      leaderSeat,
      round,
    } = state;
    // See the note in the opponents' fans: null must be coerced here,
    // otherwise the seat-0 slot resolves to `seat: null`, matches no
    // player, and that player's avatar never appears for a watcher.
    const mySeat = state.mySeat ?? 0;

    this.slots.forEach((slot, rel) => {
      const seat = (mySeat + rel) % 3;
      const player = players.find((p) => p.seat === seat);
      if (!player) {
        this._clear(slot);
        return;
      }
      // A watcher occupies no seat: rel 0 is simply the player the table is
      // being viewed from, not the person looking. Treating them as "own"
      // would label a stranger "შენ" and hand the watcher their sound buttons.
      const isOwn = rel === 0 && !state.spectator;
      const isLeader = seat === leaderSeat;
      const view = {
        portrait: L.portrait,
        name: player.name,
        isOwn,
        isActive: gamePhase === "playing" && currentTurn === seat,
        isLeader,
        score: cumulativeScores[seat] ?? 0,
        cardCount: (cardCounts || {})[seat] ?? 0,
        round1Hide: round === 1 && gamePhase === "type_selection" && !isLeader && !isOwn,
        // Profile picture (data URL → texture) → avatar-default → initial letter
        photo:
          this.photos.resolve(player) ||
          (this.scene.textures.exists("avatar-default") ? "avatar-default" : null),
      };
      const key = JSON.stringify(view);
      if (slot.key === key) return;
      this._clear(slot);
      slot.key = key;
      slot.container = this._draw(view, rel, L);
    });
  }

  _draw(v, rel, L) {
    const { scene } = this;
    const pos = L.AVATAR_POS[rel];
    const radius = v.isOwn ? 38 : 36;
    const container = scene.add.container(pos.x, pos.y);
    // The tall table is shown smaller per scene unit; keep names readable.
    // (The photo is a pre-cut texture, not a mask, so it scales with the rest.)
    if (v.portrait) container.setScale(1.4);

    container.add(bakedImage(scene, 0, 0, plateTexture(scene, radius, v.isActive)));

    if (v.photo) {
      const edge = radius * 2 - 6;
      container.add(scene.add.image(0, 0, v.photo).setDisplaySize(edge, edge));
    } else {
      container.add(
        scene.add
          .text(0, 0, v.name[0].toUpperCase(), {
            fontSize: v.isOwn ? "28px" : "26px",
            color: "#ffffff",
            fontFamily: "Georgia, serif",
            fontStyle: "bold",
          })
          .setOrigin(0.5),
      );
    }

    // Card-count badge top-right corner
    if (v.cardCount > 0 && !v.round1Hide) {
      const bx = radius - 4,
        by = -radius + 4;
      container.add(bakedImage(scene, bx, by, badgeTexture(scene, v.isActive)));
      container.add(
        scene.add
          .text(bx, by - 1, String(v.cardCount), {
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
    const nameOffY = beside ? -16 : v.isOwn ? radius + 16 : radius + 18;
    const nameLabel = v.isOwn ? "შენ" : v.name;
    container.add(
      scene.add
        .text(textX, nameOffY, nameLabel, {
          fontSize: "14px",
          color: v.isOwn ? "#163d31" : "#ffffff",
          fontFamily: georgianFont(),
          fontStyle: "bold",
        })
        .setOrigin(beside ? 1 : 0.5, 0.5),
    );

    const { score } = v;
    const scoreOffY = nameOffY + 18;
    const scoreStr = score > 0 ? `+${score}` : `${score}`;
    const scoreCol = !v.isOwn
      ? score < 0
        ? "#ffe0d3"
        : "#fff3ba"
      : score > 0
        ? "#066b48"
        : score < 0
          ? "#ae3447"
          : "#4f6c5d";
    const scoreTxt = scene.add
      .text(beside ? textX : -12, scoreOffY, scoreStr, {
        fontSize: "13px",
        color: scoreCol,
        fontFamily: latinFont(),
        fontStyle: "bold",
      })
      .setOrigin(beside ? 1 : 0, 0.5);
    // small coin icon, just before the score
    const coinX = beside ? textX - scoreTxt.width - 10 : -22;
    container.add(bakedImage(scene, coinX, scoreOffY, coinTexture(scene)));
    container.add(scoreTxt);

    if (v.isLeader) {
      const pillY = scoreOffY + 18;
      const pillX = beside ? textX - 32 : 0;
      container.add(bakedImage(scene, pillX, pillY, pillTexture(scene)));
      container.add(
        scene.add
          .text(pillX, pillY, "წამყვანი", {
            fontSize: "10px",
            color: "#f5f2e9",
            fontFamily: georgianFont(),
            fontStyle: "bold",
          })
          .setOrigin(0.5),
      );
    }

    return container;
  }

  _clear(slot) {
    slot.container?.destroy();
    slot.container = null;
    slot.key = null;
  }
}
