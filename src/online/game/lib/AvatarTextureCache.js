// One request per seat/source. Stale requests must never repaint a newer photo.
export class AvatarTextureCache {
  constructor(textures, onReady, createImage = () => new Image()) {
    this.textures = textures;
    this.onReady = onReady;
    this.createImage = createImage;
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
      this.textures.addImage(entry.key, image);
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

export function avatarCoverSize(width, height, edge) {
  const scale = edge / Math.min(width, height);
  return { width: width * scale, height: height * scale };
}
