// One request per seat/source. Stale requests must never repaint a newer photo.
// A loaded photo is stored as a ready-cut rounded square (see bakeAvatar), so
// the table needs no per-frame mask to crop it.
export class AvatarTextureCache {
  constructor(
    textures,
    onReady,
    createImage = () => new Image(),
    bakeImage = (image) => bakeAvatar(image),
  ) {
    this.textures = textures;
    this.onReady = onReady;
    this.createImage = createImage;
    this.bakeImage = bakeImage;
    this.entries = new Map();
    this.sequence = 0;
  }

  resolve(player) {
    const previous = this.entries.get(player.seat);
    const source = player.avatar || null;
    if (previous?.source === source && previous.name === player.name) {
      return previous.ready ? previous.key : null;
    }
    if (previous) this.release(previous);
    this.entries.delete(player.seat);
    if (!source) return null;

    const image = this.createImage();
    const entry = {
      source,
      name: player.name,
      image,
      key: `player-photo-${++this.sequence}`,
      ready: false,
    };
    this.entries.set(player.seat, entry);
    image.onload = () => {
      if (this.entries.get(player.seat) !== entry) return;
      image.onload = image.onerror = null;
      this.textures.addCanvas(entry.key, this.bakeImage(image));
      entry.ready = true;
      this.onReady();
    };
    image.onerror = () => {
      if (this.entries.get(player.seat) !== entry) return;
      image.onload = image.onerror = null;
      // Retain the failed entry so each state update doesn't retry a broken URL.
    };
    image.crossOrigin = "anonymous";
    image.src = source;
    return null;
  }

  release(entry) {
    entry.image.onload = entry.image.onerror = null;
    if (entry.ready && this.textures.exists(entry.key))
      this.textures.remove(entry.key);
  }

  dispose() {
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
  }
}

// Avatar textures are this many pixels square: the biggest photo on the table
// is 70 scene units, shown at up to 1.4x on the tall table.
export const AVATAR_PX = 140;

/** The centred square of a width x height picture (what "cover" shows). */
export function coverSquare(width, height) {
  const size = Math.min(width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

/** Cut `image` to a rounded square canvas, cropped from its centre. */
export function bakeAvatar(image, px = AVATAR_PX) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d");
  // Corner radius 3 on a 70-unit photo, as the table always drew it.
  const r = (3 / 70) * px;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(px, 0, px, px, r);
  ctx.arcTo(px, px, 0, px, r);
  ctx.arcTo(0, px, 0, 0, r);
  ctx.arcTo(0, 0, px, 0, r);
  ctx.closePath();
  ctx.clip();
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  const { x, y, size } = coverSquare(w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, x, y, size, size, 0, 0, px, px);
  return canvas;
}
