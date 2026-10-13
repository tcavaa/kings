import { relSeat } from "../layout.js";

const TEXT_STYLE = {
  fontSize: "13px",
  color: "#1a1a1a",
  fontFamily: "Inter, system-ui, Arial, sans-serif",
  fontStyle: "bold",
  wordWrap: { width: 240, useAdvancedWrap: true },
  align: "center",
};

// ── Chat bubbles above each speaking player's avatar ─────────────────────
// Kept per seat: a bubble already on screen stays as it is (no second pop-in)
// until that seat says something else or the bubble expires.
export class ChatBubblesView {
  constructor(scene) {
    this.scene = scene;
    this.bubbles = new Map(); // seat -> { key, obj }
  }

  render(state, L) {
    const chatBubbles = state.chatBubbles || {};
    const players = state.players || [];
    const mySeat = state.mySeat ?? 0;

    const wanted = new Map();
    for (const [seatStr, msg] of Object.entries(chatBubbles)) {
      const seat = Number(seatStr);
      // Watchers' messages (no seat) and empty seats have no avatar to sit on.
      if (!players.find((p) => p.seat === seat)) continue;
      const rel = relSeat(seat, mySeat);
      wanted.set(seat, { rel, msg, key: `${L.portrait}|${rel}|${msg.message || ""}|${msg.at ?? ""}` });
    }

    for (const [seat, bubble] of this.bubbles) {
      if (wanted.get(seat)?.key === bubble.key) continue;
      bubble.obj.destroy();
      this.bubbles.delete(seat);
    }
    for (const [seat, { rel, msg, key }] of wanted) {
      if (this.bubbles.has(seat)) continue;
      this.bubbles.set(seat, { key, obj: this._draw(L.AVATAR_POS[rel], msg.message || "") });
    }
  }

  _draw(pos, message) {
    const { scene } = this;
    const text = scene.add.text(0, 0, message, TEXT_STYLE).setOrigin(0.5);
    const tw = Math.max(40, Math.min(260, text.width + 24));
    const th = text.height + 14;

    // Anchor the bubble above the avatar (own at bottom: place above; opps at top: also place above)
    const bubble = scene.add.container(pos.x, pos.y - 78);
    const bg = scene.add.graphics();
    bg.fillStyle(0xffffff, 1);
    bg.fillRoundedRect(-tw / 2, -th / 2, tw, th, 10);
    bg.lineStyle(2, 0xd7fa52, 1);
    bg.strokeRoundedRect(-tw / 2, -th / 2, tw, th, 10);
    // Tail pointing toward avatar
    bg.fillTriangle(-6, th / 2 - 1, 6, th / 2 - 1, 0, th / 2 + 7);
    bg.strokeTriangle(-6, th / 2 - 1, 6, th / 2 - 1, 0, th / 2 + 7);
    bubble.add([bg, text]);
    bubble.setDepth(100);

    // Subtle entrance
    bubble.setScale(0.7).setAlpha(0);
    scene.tweens.add({
      targets: bubble,
      scale: 1,
      alpha: 1,
      duration: 180,
      ease: "Back.easeOut",
    });
    return bubble;
  }
}
