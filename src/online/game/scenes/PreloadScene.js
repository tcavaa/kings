import Phaser from "phaser";

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: "PreloadScene" });
  }

  preload() {
    this.load.image("card-back-raw", "/art/card-back.webp");
    this.load.image("table-felt", "/art/table-felt.webp");
    this.load.svg("avatar-default", "/art/player-mark.svg", {
      width: 128,
      height: 128,
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

    this.scene.start("GameScene");
  }
}
