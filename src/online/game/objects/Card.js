import {
  bake,
  bakedImage,
  css,
  drawText,
  fillRoundRect,
  strokeRoundRect,
} from "../lib/bake.js";
import { CARD_W, CARD_H } from "../layout.js";

export { CARD_W, CARD_H };

const SUIT_SYMBOLS = { H: "♥", D: "♦", S: "♠", C: "♣" };
const SUIT_COLORS = {
  H: "#b44636",
  D: "#b44636",
  S: "#0a0a0a",
  C: "#0a0a0a",
};

const W = CARD_W;
const H = CARD_H;

// Drop shadow, shared by face-up and face-down cards.
function shadowTexture(scene) {
  return bake(scene, "card-shadow", W + 4, H + 4, (ctx) => {
    fillRoundRect(ctx, -W / 2, -H / 2, W, H, 3, 0x000000, 0.45);
  });
}

// One texture per card face, made the first time that card is shown.
function faceTexture(scene, { rank, suit }) {
  return bake(scene, `card-face-${rank}${suit}`, W + 4, H + 4, (ctx) => {
    const color = SUIT_COLORS[suit];
    const symbol = SUIT_SYMBOLS[suit];
    const serif = { color, fontFamily: "Georgia, serif", fontStyle: "normal" };
    fillRoundRect(ctx, -W / 2, -H / 2, W, H, 3, 0xf8f9ee);
    strokeRoundRect(ctx, -W / 2, -H / 2, W, H, 3, 1, 0xc6c9bb);
    // Top-left rank and suit, big centre suit, maker's line at the foot.
    drawText(ctx, scene, -W / 2 + 7, -H / 2 + 5, rank, { ...serif, fontSize: "20px" });
    drawText(ctx, scene, -W / 2 + 7, -H / 2 + 28, symbol, { ...serif, fontSize: "12px" });
    drawText(ctx, scene, 0, 8, symbol, { ...serif, fontSize: "40px" }, 0.5, 0.5);
    drawText(
      ctx,
      scene,
      0,
      H / 2 - 12,
      "K I N G  /  01",
      { fontSize: "6px", color: css(0x808575), fontFamily: "Arial" },
      0.5,
      0.5,
    );
  });
}

// Outline rings drawn around a card: gold for trumps in hand, lime for a
// card you can play now, green around the centre (prikup) cards.
const RINGS = {
  trump: { pad: 2, r: 8, width: 2, color: 0xf0c75a, alpha: 0.85 },
  playable: { pad: 2, r: 4, width: 1.5, color: 0xd7fa52, alpha: 0.9 },
  prikup: { pad: 3, r: 11, width: 3, color: 0xc7e88b, alpha: 1 },
};

/** Add one of the RINGS around a card container; returns the ring Image. */
export function addCardRing(scene, container, kind) {
  const { pad, r, width, color, alpha } = RINGS[kind];
  const key = bake(scene, `card-ring-${kind}`, W + 2 * pad + 4, H + 2 * pad + 4, (ctx) => {
    strokeRoundRect(ctx, -W / 2 - pad, -H / 2 - pad, W + 2 * pad, H + 2 * pad, r, width, color, alpha);
  });
  const ring = bakedImage(scene, 0, 0, key);
  container.add(ring);
  return ring;
}

/**
 * Create a face-up card Container at (x, y).
 * Designed to match the modern minimalist style of the reference picture.
 */
export function createFaceUpCard(scene, x, y, card, interactive = false) {
  const container = scene.add.container(x, y);
  container.add([
    bakedImage(scene, 2, 5, shadowTexture(scene)),
    bakedImage(scene, 0, 0, faceTexture(scene, card)),
  ]);

  if (interactive) {
    container.setSize(W, H);
    container.setInteractive();
  }

  return container;
}

/**
 * Create a face-down card Container at (x, y).
 * Shows the card-back texture baked by PreloadScene.
 * Falls back to a procedural navy back if the texture isn't ready (e.g. HMR).
 */
export function createFaceDownCard(scene, x, y) {
  const container = scene.add.container(x, y);
  container.add(bakedImage(scene, 2, 4, shadowTexture(scene)));

  if (scene.textures.exists("card-back")) {
    container.add(scene.add.image(0, 0, "card-back").setDisplaySize(W, H));
  } else {
    const back = scene.add.graphics();
    back.fillStyle(0x20251f, 1);
    back.fillRoundedRect(-W / 2, -H / 2, W, H, 3);
    back.lineStyle(2, 0xbec4ad, 1);
    back.strokeRoundedRect(-W / 2 + 4, -H / 2 + 4, W - 8, H - 8, 6);
    container.add(back);
  }

  return container;
}
