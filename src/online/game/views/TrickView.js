import Phaser from "../phaser.js";
import { createFaceUpCard } from "../objects/Card.js";
import { relSeat } from "../layout.js";
import { isPenaltyCard } from "../../../../server/game/gameTypes.js";

const cardId = ({ seat, card }) => `${seat}:${card.rank}${card.suit}`;

// The trick in the middle of the table, the card-play swoop, and the flight
// of a won trick to its winner. While that flight runs, the scene holds back
// repaints (the "gate"), so the flying cards aren't redrawn in place.
export class TrickView {
  constructor(scene) {
    this.scene = scene;
    this.cards = []; // containers, in trick order
    this.drawn = []; // ids of those cards
    this.layoutKey = null;
    this.seenKey = null; // last trick seen, to swoop only a newly played card
    this.animating = false;
    this.flight = 0;
    this.watchdog = null;
  }

  // ── Trick: 3 cards arranged as in the reference (overlap with rotation) ──
  render(state, L) {
    const trick = state.currentTrick || [];
    const mySeat = state.mySeat ?? 0;
    const ids = trick.map(cardId);
    const seenKey = ids.join("|");
    const isNew = seenKey !== this.seenKey;
    this.seenKey = seenKey;

    // Cards already on the table stay put (and keep any swoop in flight);
    // only cards after the part that still matches are redrawn.
    const layoutKey = `${L.id}|${mySeat}`;
    let keep = 0;
    if (layoutKey === this.layoutKey) {
      while (keep < this.drawn.length && keep < ids.length && this.drawn[keep] === ids[keep]) keep++;
    }
    if (keep === this.drawn.length && keep === ids.length) return;
    this.layoutKey = layoutKey;
    this.cards.splice(keep).forEach((c) => c.destroy());
    this.drawn = ids;

    trick.slice(keep).forEach(({ seat, card }, j) => {
      const i = keep + j;
      const rel = relSeat(seat, mySeat);
      const pos = L.TRICK_POS[rel];
      const container = createFaceUpCard(this.scene, pos.x, pos.y, card, false);
      container.setAngle(pos.angle);
      container.setDepth(50 + rel);
      this.cards.push(container);

      // Card-play swoop: enter from the seat's avatar position, rotate +
      // bounce into the trick spot. Only the most-recently-played card on a
      // *new* trick state animates; earlier cards in this trick (and re-
      // renders of an existing trick) snap to place silently.
      if (!isNew || i !== trick.length - 1) return;
      const from = L.AVATAR_POS[rel] || pos;
      container.setPosition(from.x, from.y);
      container.setAngle(0);
      container.setScale(0.7);
      container.setAlpha(0);
      this.scene.tweens.add({
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

  /**
   * Fly the trick to the winner's avatar, then call `release` (which opens
   * the gate and repaints). Returns false when there was nothing to fly.
   */
  flyTo(winnerSeat, state, L, release) {
    if (!this.cards.length) return false;
    const target = L.AVATAR_POS[relSeat(winnerSeat, state.mySeat)];
    const cards = this.cards;
    // The flying cards are no longer the drawn trick; they remove themselves.
    this.cards = [];
    this.drawn = [];
    this.animating = true;
    const flight = ++this.flight;

    cards.forEach((c, i) => {
      this.scene.tweens.killTweensOf(c);
      this.scene.tweens.add({
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
    // the gate up forever and all subsequent state-updates were silently
    // dropped from the canvas (chats still worked because they're
    // React-driven), which manifested as "I can't see the card they played
    // until I refresh". A timer from an older flight never opens a newer one.
    const done = () => {
      if (this.animating && flight === this.flight) release();
    };
    this.scene.time.delayedCall(750, done);
    // 1500ms ≈ 2× the animation duration. Long enough that the happy path
    // always wins under normal conditions, short enough that a stuck gate
    // self-heals before the next trick.
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      done();
    }, 1500);
    return true;
  }

  /** Open the gate (the flight finished, or a forced repaint cut it short). */
  endFlight() {
    this.animating = false;
    clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  /**
   * The winner's reaction, as the cards land: a ring pulses out of their
   * avatar, red when the trick hands them a penalty card (K♥ in King, a
   * queen, a jack or a heart in those rounds). Minus, Last two and the
   * pluses keep the gold ring.
   */
  react(winnerSeat, trick, state, L) {
    const tookPenalty = (trick || []).some((t) => isPenaltyCard(state.chosenGameType, t.card));
    this.scene.time.delayedCall(450, () => {
      if (!this.scene.sys?.isActive()) return;
      this._pulse(winnerSeat, tookPenalty ? 0xd4574d : 0xf0c75a, state, L);
    });
  }

  _pulse(seat, colour, state, L) {
    const pos = L.AVATAR_POS[relSeat(seat, state.mySeat)];
    if (!pos) return;
    // Drawn round its own origin so it grows from the avatar's centre; the
    // tall table shows avatars at 1.4x, so the ring starts at that size too.
    const s = L.portrait ? 1.4 : 1;
    const ring = this.scene.add.graphics({ x: pos.x, y: pos.y });
    ring.lineStyle(4, colour, 1);
    ring.strokeCircle(0, 0, 44);
    ring.setDepth(120).setScale(s);
    this.scene.tweens.add({
      targets: ring,
      alpha: { from: 1, to: 0 },
      scaleX: { from: s, to: 1.6 * s },
      scaleY: { from: s, to: 1.6 * s },
      duration: 700,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
  }
}
