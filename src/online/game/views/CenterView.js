import { addCardRing, createFaceUpCard, CARD_H } from "../objects/Card.js";
import { georgianFont } from "../lib/fonts.js";

// Show during type/trump selection and the discard window (so non-leaders
// still see what 2 cards came from the center after the leader picks).
const VISIBLE_PHASES = ["type_selection", "trump_selection", "discard"];

// The two centre cards (prikup), face up for everyone but the leader.
export class CenterView {
  constructor(scene) {
    this.scene = scene;
    this.objs = [];
    this.key = null;
  }

  render(state, L) {
    const { centerCards, gamePhase, mySeat, leaderSeat } = state;
    const shown =
      VISIBLE_PHASES.includes(gamePhase) && mySeat !== leaderSeat && centerCards?.length
        ? centerCards
        : [];
    const key = `${L.portrait}|${shown.map((c) => c.rank + c.suit).join(",")}`;
    if (key === this.key) return;
    this._clear();
    this.key = key;
    if (!shown.length) return;

    const { scene } = this;
    const { TABLE_CX, TABLE_CY, portrait } = L;
    // The tall table has room to show the prikup a size up.
    const pk = portrait ? 1.25 : 1;
    shown.forEach((card, i) => {
      const x = TABLE_CX + (i - 0.5) * 100 * pk;
      const container = createFaceUpCard(scene, x, TABLE_CY + 10, card, false);
      container.setScale(pk);
      addCardRing(scene, container, "prikup");
      this.objs.push(container);
    });

    const lbl = scene.add
      .text(TABLE_CX, TABLE_CY + (CARD_H * pk) / 2 + 28, "❖  პრიკუპი  ❖", {
        fontSize: "11px",
        color: "#d5b982",
        fontFamily: georgianFont(),
        stroke: "#000",
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    this.objs.push(lbl);
  }

  _clear() {
    this.objs.forEach((o) => o.destroy());
    this.objs = [];
    this.key = null;
  }
}
