import * as THREE from "three";
export const COLORS = {
  felt: 0x2a7558,
  wood: 0x6b3f26,
  woodDark: 0x4a2a18,
  gold: 0xc8a050,
  cream: 0xf3ead6,
};
export const SUITS = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const RED = (suit) => suit === "H" || suit === "D";
export const SERIF = 'Georgia, "Times New Roman", "Noto Serif Georgian", serif';
export function box(parent, size, position, color, rotation) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
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
  map.anisotropy = 4;
  return map;
}
// A flat textured face drawn with a 2D canvas, lit like the rest of the room.
export function panel(parent, width, height, position, draw, px = 512) {
  const h = Math.max(64, Math.round((px * height) / width));
  const map = texture((ctx) => draw(ctx, px, h), px, h);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map, roughness: 0.8 }),
  );
  mesh.position.set(...position);
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
// Fit text to a width, returning the font size used.
export function fitText(ctx, text, x, y, maxWidth, size, weight = "600", family = SERIF) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 8 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  ctx.fillText(text, x, y);
  return s;
}
export function woodGrain(ctx, w, h, base = "#6b3f26", dark = "#45261a") {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = dark;
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 26; i++) {
    const y = (i / 26) * h + Math.sin(i * 7.3) * 4;
    ctx.lineWidth = 1 + (i % 3);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 24)
      ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
export function label(parent, text, width, height, position, options = {}) {
  return panel(
    parent,
    width,
    height,
    position,
    (ctx, w, h) => {
      ctx.fillStyle = options.bg || "#1d4a3c";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = options.border || "#c8a050";
      ctx.lineWidth = Math.max(3, h * 0.04);
      ctx.strokeRect(4, 4, w - 8, h - 8);
      ctx.fillStyle = options.color || "#f3ead6";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = String(text).split("\n");
      const size = Math.min((h / lines.length) * 0.62, options.font || 999);
      lines.forEach((line, i) =>
        fitText(
          ctx,
          line,
          w / 2,
          h / 2 + (i - (lines.length - 1) / 2) * size * 1.2,
          w * 0.9,
          size,
        ),
      );
    },
    options.px || 512,
  );
}
const faceCache = new Map();
function cardFace(value, back) {
  const id = back ? "back" : `${value.rank}${value.suit}`;
  if (faceCache.has(id)) return faceCache.get(id);
  const map = texture(
    (ctx, w, h) => {
      const r = 22;
      ctx.fillStyle = back ? "#163f32" : "#f6f1e4";
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, r);
      ctx.fill();
      if (back) {
        ctx.strokeStyle = "#c8a050";
        ctx.lineWidth = 6;
        ctx.strokeRect(18, 18, w - 36, h - 36);
        ctx.fillStyle = "#c8a050";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        drawCrown(ctx, w / 2, h / 2, 70);
        return;
      }
      const red = RED(value.suit);
      ctx.fillStyle = red ? "#b52a2e" : "#141414";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const corner = (flip) => {
        ctx.save();
        if (flip) {
          ctx.translate(w, h);
          ctx.rotate(Math.PI);
        }
        ctx.font = `bold 64px ${SERIF}`;
        ctx.fillText(value.rank, 40, 52);
        ctx.font = `48px ${SERIF}`;
        ctx.fillText(SUITS[value.suit], 40, 104);
        ctx.restore();
      };
      corner(false);
      corner(true);
      const court = ["K", "Q", "J"].includes(value.rank);
      if (court) {
        ctx.strokeStyle = red ? "#b52a2e" : "#141414";
        ctx.lineWidth = 4;
        ctx.strokeRect(70, 70, w - 140, h - 140);
        ctx.fillStyle = "#e9dcb8";
        ctx.fillRect(72, 72, w - 144, h - 144);
        ctx.fillStyle = red ? "#b52a2e" : "#141414";
        ctx.font = `bold 120px ${SERIF}`;
        ctx.fillText(value.rank, w / 2, h / 2 - 40);
        ctx.font = `90px ${SERIF}`;
        ctx.fillText(SUITS[value.suit], w / 2, h / 2 + 70);
      } else {
        ctx.font = `150px ${SERIF}`;
        ctx.fillText(SUITS[value.suit], w / 2, h / 2 + 8);
      }
    },
    256,
    372,
  );
  faceCache.set(id, map);
  return map;
}
export function drawCrown(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x - s, y + s * 0.45);
  ctx.lineTo(x - s * 1.1, y - s * 0.5);
  ctx.lineTo(x - s * 0.5, y);
  ctx.lineTo(x, y - s * 0.7);
  ctx.lineTo(x + s * 0.5, y);
  ctx.lineTo(x + s * 1.1, y - s * 0.5);
  ctx.lineTo(x + s, y + s * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - s, y + s * 0.52, s * 2, s * 0.18);
}
export const CARD_W = 0.235,
  CARD_H = 0.34;
const cardBody = new THREE.BoxGeometry(CARD_W, CARD_H, 0.006);
const cardPlane = new THREE.PlaneGeometry(CARD_W * 0.995, CARD_H * 0.995);
const edgeMaterial = new THREE.MeshStandardMaterial({
  color: 0xefe7d4,
  roughness: 0.8,
});
// Card faces are shared textures (one per card); materials are per card so a
// single card can be dimmed or highlighted.
export function card(parent, value, back = false) {
  const group = new THREE.Group();
  parent.add(group);
  const body = new THREE.Mesh(cardBody, edgeMaterial);
  body.castShadow = true;
  body.userData.shared = true;
  group.add(body);
  const face = new THREE.Mesh(
    cardPlane,
    new THREE.MeshStandardMaterial({
      map: cardFace(value, back || !value),
      roughness: 0.65,
      transparent: true,
      alphaTest: 0.5,
    }),
  );
  face.position.z = 0.0035;
  face.userData.sharedMap = true;
  group.add(face);
  const rear = new THREE.Mesh(
    cardPlane,
    new THREE.MeshStandardMaterial({
      map: cardFace(null, true),
      roughness: 0.65,
      transparent: true,
      alphaTest: 0.5,
    }),
  );
  rear.rotation.y = Math.PI;
  rear.position.z = -0.0035;
  rear.userData.sharedMap = true;
  group.add(rear);
  return group;
}
// Textures, materials and geometry belong to each scene/group; dispose on
// rebuild/unmount. Shared card geometry, card-face textures and anything
// cloned from a cached GLB are kept.
export function dispose(root) {
  const geometries = new Set(),
    materials = new Set(),
    maps = new Set();
  root.traverse((o) => {
    if (o.userData.shared || o.userData.cached) return;
    if (o.geometry && o.geometry !== cardPlane && o.geometry !== cardBody)
      geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (m && m !== edgeMaterial) {
        materials.add(m);
        if (!o.userData.sharedMap)
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
