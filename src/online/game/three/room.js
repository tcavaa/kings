import * as THREE from "three";
import { box, cylinder, label, COLORS } from "./primitives";
export function buildRoom(scene) {
  scene.background = new THREE.Color("#293b50");
  scene.fog = new THREE.Fog("#293b50", 13, 38);
  scene.add(new THREE.HemisphereLight(0xc3d6e6, 0x6b432a, 2.1));
  const sun = new THREE.DirectionalLight(0xffd3a0, 2.5);
  sun.position.set(-3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
  sun.shadow.bias = -0.001;
  scene.add(sun);
  box(scene, [15, 0.12, 15], [0, -0.12, 0], 0x302d27);
  box(scene, [8, 0.02, 7], [0, -0.045, 0], 0x22433b);
  for (let x = -4; x <= 4; x++)
    box(scene, [0.025, 0.025, 7], [x, -0.025, 0], 0x74644a);
  box(scene, [0.2, 6, 13], [-6, 2.8, 0], COLORS.wood);
  box(scene, [0.2, 6, 13], [6, 2.8, 0], COLORS.wood);
  box(scene, [12, 1, 0.2], [0, 0.45, -5], COLORS.wood);
  box(scene, [12, 0.35, 0.3], [0, 4.6, -5], COLORS.wood);
  for (let x = -6; x <= 6; x += 3) {
    box(scene, [0.22, 4.6, 0.3], [x, 2.25, -5], COLORS.wood);
    box(scene, [0.27, 0.06, 0.36], [x, 1.05, -5], COLORS.gold);
  }
  // Actual skyline geometry outside the windows; deterministic dimensions.
  for (let i = 0; i < 25; i++) {
    const x = (i - 12) * 1.05,
      h = 1.4 + ((i * 17) % 11) * 0.29,
      z = -8 - (i % 3);
    box(
      scene,
      [0.85, h, 0.9],
      [x, h / 2 - 0.5, z],
      i % 2 ? 0x404959 : 0x535669,
    );
    for (let row = 0; row < Math.floor(h * 2); row++)
      for (let col = 0; col < 3; col++) {
        if ((row + col + i) % 3 === 0) continue;
        box(
          scene,
          [0.09, 0.14, 0.012],
          [x - 0.25 + col * 0.25, row * 0.4, z + 0.46],
          0xd3ae69,
        );
      }
  }
  cylinder(scene, 0.055, 4, [3.9, 3.6, -10], 0x625958, 6);
  cylinder(scene, 0.28, 0.15, [3.9, 4.2, -10], 0xdcb683, 8);
  // Bookcase and lamps frame the table.
  for (const side of [-1, 1]) {
    const shelf = new THREE.Group();
    shelf.position.set(side * 4.5, 0, -3.7);
    scene.add(shelf);
    box(shelf, [1.7, 3.7, 0.45], [0, 1.8, 0], 0x36271e);
    for (let row = 0; row < 4; row++) {
      box(shelf, [1.7, 0.09, 0.7], [0, 0.3 + row * 0.86, 0.1], 0x755139);
      for (let j = 0; j < 6; j++)
        box(
          shelf,
          [0.14, 0.38 + (j % 3) * 0.08, 0.25],
          [-0.65 + j * 0.23, 0.54 + row * 0.86, 0.27],
          [0x8a6950, 0x273f39, 0x8b4434][j % 3],
        );
    }
    cylinder(scene, 0.24, 0.06, [side * 3.1, 0.05, -2.5], COLORS.gold);
    cylinder(scene, 0.035, 2.6, [side * 3.1, 1.35, -2.5], COLORS.gold);
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.52, 0.5, 8),
      new THREE.MeshStandardMaterial({
        color: 0xe7c58a,
        emissive: 0x8b602b,
        emissiveIntensity: 0.45,
      }),
    );
    shade.position.set(side * 3.1, 2.6, -2.5);
    scene.add(shade);
    const light = new THREE.PointLight(0xffc279, 10, 7, 2);
    light.position.set(side * 3.1, 2.4, -2.5);
    scene.add(light);
  }
  const tabletop = cylinder(scene, 2.2, 0.18, [0, 0.91, 0.1], COLORS.wood, 48);
  tabletop.scale.z = 0.78;
  const trim = cylinder(scene, 2.08, 0.025, [0, 1.012, 0.1], COLORS.gold, 48);
  trim.scale.z = 0.78;
  const felt = cylinder(scene, 2.04, 0.022, [0, 1.033, 0.1], COLORS.felt, 48);
  felt.scale.z = 0.78;
  for (const x of [-1.1, 1.1])
    box(scene, [0.18, 0.85, 0.18], [x, 0.45, 0.1], COLORS.wood);
  const mark = label(scene, "♛  KING", 0.58, 0.22, [0, 1.047, -0.15], {
    bg: "#164c40",
    border: "#164c40",
    color: "#aa985d",
  });
  mark.rotation.x = -Math.PI / 2;
  for (const [x, z] of [
    [-1.43, -1.4],
    [1.43, -1.4],
  ]) {
    box(scene, [0.72, 0.15, 0.7], [x, 0.48, z], 0x17483c);
    box(scene, [0.78, 1.2, 0.15], [x, 1.1, z - 0.29], 0x184436);
    for (const dx of [-0.29, 0.29])
      for (const dz of [-0.24, 0.24])
        box(scene, [0.07, 0.5, 0.07], [x + dx, 0.22, z + dz], COLORS.wood);
    box(scene, [0.83, 0.06, 0.19], [x, 1.7, z - 0.29], COLORS.gold);
  }
  const art = label(scene, "♛\nKING CLUB", 1.15, 1.3, [0, 2.8, -4.72], {
    bg: "#243d37",
    color: "#be9d60",
    font: 96,
  });
  // Center window panel doubles as a framed club sign.
  box(scene, [1.25, 1.4, 0.12], [0, 2.8, -4.82], COLORS.gold);
  return art;
}
