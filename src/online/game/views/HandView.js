import { EventBus } from "../EventBus.js";
import { addCardRing, createFaceUpCard } from "../objects/Card.js";
import { handScale, handSlots } from "../layout.js";
import { isPlayableCard } from "../lib/playable.js";
import { dealRecord, isFreshDeal, loadLastDeal, saveLastDeal } from "../lib/dealMemory.js";
import { playShuffleSound } from "../lib/shuffleSound.js";

// ── Own hand: fanned at bottom, playable cards marked and lifted on hover ──
// Rebuilt only when something the hand shows changes (its cards, which of
// them can be played, the card size), so a chat bubble or an opponent's card
// count no longer snaps a hovered card back down or replays the deal.
export class HandView {
  constructor(scene) {
    this.scene = scene;
    this.cards = [];
    this.key = null;
    this.lastDeal = loadLastDeal();
    // Trump cards in hand pulse together on one shared tween (made on first
    // use), instead of each card owning a looping tween that outlives it.
    this.sparkles = [];
    this.sparkleTween = null;
  }

  render(state, L) {
    const { hand = [], mySeat, gamePhase, currentTurn, trumpSuit } = state;
    const { scene } = this;
    const k = handScale(L, (scene.scale.displaySize?.width || L.W) / L.W);
    // On narrow viewports the canvas is FIT-scaled down and individual
    // cards become finger-unfriendly — push spacing up a touch so adjacent
    // cards don't overlap into a single tap-target.
    const narrow = typeof window !== "undefined" && window.innerWidth < 720;
    const isMyTurn = gamePhase === "playing" && currentTurn === mySeat;
    const cards = hand.map((card) => {
      const playable = isPlayableCard(card, state);
      return {
        card,
        inter: isMyTurn && playable,
        dim: gamePhase === "playing" && !playable,
        trump: !!trumpSuit && card.suit === trumpSuit,
      };
    });
    const fresh = isFreshDeal(hand, state.round, this.lastDeal);
    const key = JSON.stringify([
      L.portrait,
      k,
      L.portrait ? 0 : narrow,
      cards.map((c) => [c.card.rank + c.card.suit, c.inter, c.dim, c.trump]),
    ]);
    if (key === this.key && !fresh) return;
    this.key = key;
    this._clear();
    if (!hand.length) return;

    if (fresh) {
      this.lastDeal = dealRecord(hand, state.round);
      saveLastDeal(this.lastDeal);
      playShuffleSound();
    }

    const { TABLE_CX, TABLE_CY } = L;
    const slots = handSlots(L, hand.length, k, narrow);
    cards.forEach(({ card, inter, dim, trump }, i) => {
      const { x, y, angle: fanAngle } = slots[i];
      const container = createFaceUpCard(scene, x, y, card, inter);
      container.setScale(k);
      container.setAngle(fanAngle);
      container.setDepth(20 + i);
      if (dim) container.setAlpha(0.82);

      // Subtle gold sparkle border on trump-suit cards in hand.
      if (trump) this._sparkle(addCardRing(scene, container, "trump"));

      // Card-deal entrance: cards fly in from a center "deck" stack at the
      // top of the table, staggered by index, into their fanned position.
      if (fresh) {
        container.setPosition(TABLE_CX + (Math.random() - 0.5) * 14, TABLE_CY - 10);
        container.setAngle(0);
        container.setScale(0.55 * k);
        container.setAlpha(0);
        scene.tweens.add({
          targets: container,
          x,
          y,
          angle: fanAngle,
          scaleX: k,
          scaleY: k,
          alpha: dim ? 0.82 : 1,
          duration: 380,
          delay: i * 55,
          ease: "Cubic.easeOut",
        });
      }

      if (inter) {
        // A precise corner accent identifies playable cards without continuous tweens.
        addCardRing(scene, container, "playable");
        container.on("pointerover", () => {
          scene.tweens.killTweensOf(container);
          scene.tweens.add({
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
          scene.tweens.killTweensOf(container);
          scene.tweens.add({
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

      this.cards.push(container);
    });
  }

  _sparkle(ring) {
    this.sparkles.push(ring);
    if (!this.sparkleTween) {
      const pulse = { alpha: 0.4 };
      this.sparkleTween = this.scene.tweens.add({
        targets: pulse,
        alpha: { from: 0.4, to: 0.95 },
        duration: 1100,
        yoyo: true,
        repeat: -1,
        onUpdate: () => this.sparkles.forEach((s) => s.setAlpha(pulse.alpha)),
      });
    }
    ring.setAlpha(this.sparkleTween.targets[0].alpha);
  }

  _clear() {
    this.cards.forEach((c) => {
      this.scene.tweens.killTweensOf(c);
      c.destroy();
    });
    this.cards = [];
    this.sparkles = [];
  }
}
