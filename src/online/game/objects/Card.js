export const CARD_W = 80;
export const CARD_H = 114;

export const SUIT_SYMBOLS = { H: "♥", D: "♦", S: "♠", C: "♣" };
export const SUIT_COLORS = {
  H: "#b44636",
  D: "#b44636",
  S: "#0a0a0a",
  C: "#0a0a0a",
};

/**
 * Create a face-up card Container at (x, y).
 * Designed to match the modern minimalist style of the reference picture.
 */
export function createFaceUpCard(scene, x, y, card, interactive = false) {
  const { rank, suit } = card;
  const color = SUIT_COLORS[suit];
  const suitSymbol = SUIT_SYMBOLS[suit];
  const W = CARD_W;
  const H = CARD_H;

  const container = scene.add.container(x, y);

  // Drop shadow
  const shadow = scene.add.graphics();
  shadow.fillStyle(0x000000, 0.45);
  shadow.fillRoundedRect(-W / 2 + 2, -H / 2 + 5, W, H, 3);
  container.add(shadow);

  // White card body
  const bg = scene.add.graphics();
  bg.fillStyle(0xf8f9ee, 1);
  bg.fillRoundedRect(-W / 2, -H / 2, W, H, 3);
  bg.lineStyle(1, 0xc6c9bb, 1);
  bg.strokeRoundedRect(-W / 2, -H / 2, W, H, 3);
  container.add(bg);

  // Top-left rank
  const rankTL = scene.add
    .text(-W / 2 + 7, -H / 2 + 5, rank, {
      fontSize: "20px",
      color,
      fontFamily: "Georgia, serif",
      fontStyle: "normal",
    })
    .setOrigin(0, 0);

  // Top-left suit
  const suitTL = scene.add
    .text(-W / 2 + 7, -H / 2 + 28, suitSymbol, {
      fontSize: "12px",
      color,
      fontFamily: "Georgia, serif",
      fontStyle: "normal",
    })
    .setOrigin(0, 0);

  // Bottom-right large suit
  const centerSuit = scene.add
    .text(0, 8, suitSymbol, {
      fontSize: "40px",
      color,
      fontFamily: "Georgia, serif",
      fontStyle: "normal",
    })
    .setOrigin(0.5);

  container.add([rankTL, suitTL, centerSuit]);
  container.add(
    scene.add
      .text(0, H / 2 - 12, "K I N G  /  01", {
        fontSize: "6px",
        color: "#808575",
        fontFamily: "Arial",
      })
      .setOrigin(0.5),
  );

  if (interactive) {
    container.setSize(W, H);
    container.setInteractive();
  }

  container.cardData = card;
  return container;
}

/**
 * Create a face-down card Container at (x, y).
 * Renders the royal SVG card-back texture loaded by PreloadScene.
 * Falls back to a procedural navy back if the texture isn't ready (e.g. HMR).
 */
export function createFaceDownCard(scene, x, y) {
  const W = CARD_W;
  const H = CARD_H;

  const container = scene.add.container(x, y);

  // Shadow
  const shadow = scene.add.graphics();
  shadow.fillStyle(0x000000, 0.45);
  shadow.fillRoundedRect(-W / 2 + 2, -H / 2 + 4, W, H, 3);
  container.add(shadow);

  if (scene.textures.exists("card-back")) {
    const img = scene.add.image(0, 0, "card-back").setDisplaySize(W, H);
    container.add(img);
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
