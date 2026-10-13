import Phaser from "../phaser.js";
import { AVATAR_PX, bakeAvatar } from "../lib/AvatarTextureCache.js";

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: "PreloadScene" });
  }

  preload() {
    this.load.image("card-back-raw", "/art/card-back.webp");
    this.load.svg("avatar-default-raw", "/art/player-mark.svg", {
      width: AVATAR_PX,
      height: AVATAR_PX,
    });
  }

  create() {
    // Bake the card-back PNG into a rounded-corner canvas texture so the rectangular
    // PNG silhouette doesn't poke out when cards rotate (fans, trick animation, etc.).
    const raw = this.textures.get("card-back-raw");
    const src = raw?.source?.[0]?.image;
    if (src && src.naturalWidth) {
      const W = 240;
      const H = 342;
      const r = 6;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arcTo(W, 0, W, H, r);
      ctx.arcTo(W, H, 0, H, r);
      ctx.arcTo(0, H, 0, 0, r);
      ctx.arcTo(0, 0, W, 0, r);
      ctx.closePath();
      ctx.clip();
      ctx.filter = "grayscale(1)";
      ctx.drawImage(src, 0, 0, W, H);
      if (this.textures.exists("card-back")) this.textures.remove("card-back");
      this.textures.addCanvas("card-back", canvas);
    }

    // The default player mark, cut to the same rounded square as photos.
    const mark = this.textures.get("avatar-default-raw")?.source?.[0]?.image;
    if (mark && (mark.naturalWidth || mark.width)) {
      if (this.textures.exists("avatar-default")) this.textures.remove("avatar-default");
      this.textures.addCanvas("avatar-default", bakeAvatar(mark));
    }

    // Only the baked copies are drawn; drop the downloaded originals.
    for (const key of ["card-back-raw", "avatar-default-raw"]) {
      if (this.textures.exists(key)) this.textures.remove(key);
    }

    this.scene.start("GameScene");
  }
}
