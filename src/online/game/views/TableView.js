import { css, drawText, roundRectPath } from "../lib/bake.js";

// The table itself: a parchment room with a green felt and the "kıng"
// watermark, baked into one texture per layout. The backbuffer is the
// scene's own size, so this one is baked 1:1.
export class TableView {
  constructor(scene) {
    this.scene = scene;
    this.image = null;
    this.key = null;
  }

  /** Show the table for layout L (drops the other layout's texture). */
  draw(L) {
    const { scene } = this;
    const key = `table-${L.id}`;
    this.image?.destroy();
    if (this.key && this.key !== key && scene.textures.exists(this.key)) {
      scene.textures.remove(this.key);
    }
    if (!scene.textures.exists(key)) {
      const canvas = document.createElement("canvas");
      canvas.width = L.W;
      canvas.height = L.H;
      paintTable(canvas.getContext("2d"), scene, L);
      scene.textures.addCanvas(key, canvas);
    }
    this.key = key;
    // Below everything else, whatever order the other layers are rebuilt in.
    this.image = scene.add.image(0, 0, key).setOrigin(0, 0).setDepth(-100);
  }
}

function paintTable(ctx, scene, L) {
  const { W, H, felt, TABLE_CX, TABLE_CY } = L;
  const { left, right, top, bottom, cut } = felt;

  ctx.fillStyle = css(0xdceae1);
  ctx.fillRect(0, 0, W, H);

  // Felt: an octagon with a gold rim.
  const points = [
    [left + cut, top],
    [right - cut, top],
    [right, top + cut],
    [right, bottom - cut],
    [right - cut, bottom],
    [left + cut, bottom],
    [left, bottom - cut],
    [left, top + cut],
  ];
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = css(0x168665);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = css(0xd7bb75);
  ctx.stroke();

  // Faint outer line and the two centre ticks.
  ctx.globalAlpha = 0.7;
  roundRectPath(ctx, left - 20, top - 20, right - left + 40, bottom - top + 40, 12);
  ctx.lineWidth = 2;
  ctx.strokeStyle = css(0x89b69d);
  ctx.stroke();
  ctx.globalAlpha = 0.1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(0x889875);
  ctx.beginPath();
  ctx.moveTo(W * 0.5, top + 22);
  ctx.lineTo(W * 0.5, top + 45);
  ctx.moveTo(W * 0.5, bottom - 22);
  ctx.lineTo(W * 0.5, bottom - 45);
  ctx.stroke();

  // Watermark.
  const sans = "Arial, sans-serif";
  ctx.globalAlpha = 0.42;
  drawText(ctx, scene, TABLE_CX, TABLE_CY - 22, "kıng", {
    fontSize: "40px", color: "#b5e6ce", fontFamily: sans, fontStyle: "bold",
  }, 0.5, 0.5, 1);
  ctx.globalAlpha = 0.4;
  drawText(ctx, scene, TABLE_CX, TABLE_CY + 14, "P L A Y   W I T H   I N T E N T", {
    fontSize: "8px", color: "#82946d", fontFamily: sans,
  }, 0.5, 0.5, 1);
  ctx.globalAlpha = 1;
}
