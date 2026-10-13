// Static shapes (card bodies, plates, badges, the felt) are drawn once into
// canvas textures and shown as Images. A live Graphics object is replayed and
// re-triangulated by the WebGL renderer on every frame, and every Text object
// owns its own texture, so drawing the table from Graphics + Text cost CPU on
// every frame and a pile of texture uploads on every repaint.
//
// Canvas textures (not RenderTextures) on purpose: Phaser keeps the source
// canvas, so the texture survives a lost WebGL context.

// Textures are drawn at twice the scene's size: hand cards are shown up to
// ~1.6x and the tall table's avatars at 1.4x, and they must stay crisp.
export const BAKE_SCALE = 2;

/** "#rrggbb" for a 0xrrggbb colour. */
export const css = (hex) => `#${hex.toString(16).padStart(6, "0")}`;

export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function fillRoundRect(ctx, x, y, w, h, r, color, alpha = 1) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = css(color);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function strokeRoundRect(ctx, x, y, w, h, r, width, color, alpha = 1) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.strokeStyle = css(color);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Draw a line of text the way a Phaser Text object at (x, y) with this origin
 * would place it, by letting Phaser lay it out and copying its canvas.
 */
export function drawText(ctx, scene, x, y, text, style, originX = 0, originY = 0, scale = BAKE_SCALE) {
  const t = scene.make.text({ x: 0, y: 0, text, style: { ...style, resolution: scale } }, false);
  ctx.drawImage(t.canvas, x - originX * t.width, y - originY * t.height, t.width, t.height);
  t.destroy();
}

/**
 * Bake a w x h (scene units) texture under `key`, once. `draw` gets a 2D
 * context whose origin is the texture's centre, in scene units. Show it with
 * `bakedImage`, which undoes the bake scale.
 */
export function bake(scene, key, w, h, draw, scale = BAKE_SCALE) {
  if (scene.textures.exists(key)) return key;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.translate(w / 2, h / 2);
  draw(ctx);
  scene.textures.addCanvas(key, canvas);
  return key;
}

/** An Image of a baked texture, centred on (x, y), at scene size. */
export function bakedImage(scene, x, y, key, scale = BAKE_SCALE) {
  return scene.add.image(x, y, key).setScale(1 / scale);
}
