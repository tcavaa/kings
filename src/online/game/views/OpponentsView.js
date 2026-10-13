import { createFaceDownCard } from "../objects/Card.js";

// Opponents' face-down card fans, left and right. Each side is rebuilt only
// when its card count (or the layout) changes.
export class OpponentsView {
  constructor(scene) {
    this.scene = scene;
    this.sides = { 1: { key: null, cards: [] }, 2: { key: null, cards: [] } };
  }

  render(state, L) {
    const { gamePhase, round } = state;
    const cardCounts = state.cardCounts || {};
    // `?? 0`, not a destructuring default: a spectator's mySeat is null,
    // and `= 0` only fires on undefined. Left as null it poisons every
    // `(mySeat + n) % 3` below and one player silently stops being drawn.
    const mySeat = state.mySeat ?? 0;
    const round1Hidden = round === 1 && gamePhase === "type_selection";

    for (const rel of [1, 2]) {
      const seat = (mySeat + rel) % 3;
      const count = round1Hidden ? 0 : Math.min(cardCounts[seat] ?? 0, 10);
      const side = this.sides[rel];
      const key = `${L.portrait}|${count}`;
      if (side.key === key) continue;
      side.key = key;
      side.cards.forEach((c) => c.destroy());
      side.cards = [];

      const { baseX, y, dir } = L.OPP_FAN_POS[rel];
      // Fan: small spread, cards angle outward like in the reference
      const spread = 14;
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) - 0.5 : 0;
        const cx = baseX + dir * t * spread * 4;
        const cy = y + Math.abs(t) * 8;
        const card = createFaceDownCard(this.scene, cx, cy);
        card.setAngle(dir * t * 28);
        card.setDepth(i);
        side.cards.push(card);
      }
    }
  }
}
