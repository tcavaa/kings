import * as THREE from "three";
export const COLORS = {
  felt: 0x164c40,
  wood: 0x513425,
  gold: 0xb99a58,
  cream: 0xf0e3c5,
};
export const SUITS = { S: "♠", H: "♥", D: "♦", C: "♣" };
export function box(parent, size, position, color, rotation) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.88,
      flatShading: true,
    }),
  );
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function cylinder(parent, radius, height, position, color, sides = 12) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, sides),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      flatShading: true,
    }),
  );
  mesh.position.set(...position);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function texture(draw, width = 1024, height = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d"), width, height);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}
export function label(parent, text, width, height, position, options = {}) {
  const map = texture(
    (ctx, w, h) => {
      ctx.fillStyle = options.bg || "#163d34";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = options.border || "#b99a58";
      ctx.lineWidth = 9;
      ctx.strokeRect(5, 5, w - 10, h - 10);
      ctx.fillStyle = options.color || "#f0e3c5";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = String(text).split("\n");
      const font = Math.min(
        (options.font || 54) * 2,
        h / (lines.length * 1.4),
        w / (Math.max(5, ...lines.map((l) => l.length)) * 0.65),
      );
      ctx.font = `600 ${font}px sans-serif`;
      lines.forEach((line, i) =>
        ctx.fillText(
          line,
          w / 2,
          h / 2 + (i - (lines.length - 1) / 2) * font * 1.2,
          w - 50,
        ),
      );
    },
    1024,
    Math.max(180, Math.round((1024 * height) / width)),
  );
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide }),
  );
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}
export function card(parent, value, back = false) {
  const group = new THREE.Group();
  parent.add(group);
  box(group, [0.235, 0.34, 0.012], [0, 0, 0], COLORS.cream);
  const face = texture(
    (ctx, w, h) => {
      ctx.fillStyle = back ? "#123e35" : "#f5ecd8";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#b99a58";
      ctx.lineWidth = 5;
      ctx.strokeRect(9, 9, w - 18, h - 18);
      ctx.fillStyle = back
        ? "#c7a65e"
        : ["H", "D"].includes(value?.suit)
          ? "#a12e32"
          : "#17241f";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (back) {
        ctx.font = "95px serif";
        ctx.fillText("♛", w / 2, h / 2);
      } else {
        ctx.textAlign = "left";
        ctx.font = "bold 48px Georgia";
        ctx.fillText(value.rank, 22, 43);
        ctx.font = "42px serif";
        ctx.fillText(SUITS[value.suit], 24, 91);
        ctx.textAlign = "center";
        ctx.font = "100px serif";
        ctx.fillText(SUITS[value.suit], w / 2, h / 2 + 15);
        ctx.save();
        ctx.translate(w, h);
        ctx.rotate(Math.PI);
        ctx.textAlign = "left";
        ctx.font = "bold 42px Georgia";
        ctx.fillText(value.rank + SUITS[value.suit], 18, 35);
        ctx.restore();
      }
    },
    256,
    384,
  );
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.229, 0.334),
    new THREE.MeshBasicMaterial({ map: face }),
  );
  mesh.position.z = 0.007;
  group.add(mesh);
  return group;
}
// Textures, materials and geometry belong to each scene/group; dispose on rebuild/unmount.
export function dispose(root) {
  const geometries = new Set(),
    materials = new Set(),
    maps = new Set();
  root.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (m) {
        materials.add(m);
        for (const v of Object.values(m)) if (v?.isTexture) maps.add(v);
      }
    if (o.isSkinnedMesh) o.skeleton?.dispose();
  });
  maps.forEach((t) => {
    t.source?.data?.close?.();
    t.dispose();
  });
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
  root.clear();
}
