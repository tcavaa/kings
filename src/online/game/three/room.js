import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// The Blender-built club room (blender/room.py) is modelled in real metres;
// the table scene works in units 1.4x larger (felt top at y ≈ 1.043).
export const WORLD_SCALE = 1.4;
export const ASSETS = "/models/king3d";
// Opponent armchairs, in scene units (blender/room.py SEATS × WORLD_SCALE).
export const SEATS = {
  1: { position: [-0.972, 0, -1.158], rotation: 0.698 },
  2: { position: [0.972, 0, -1.158], rotation: -0.698 },
};

const loader = new GLTFLoader();
const cache = new Map();
// Each GLB is fetched and parsed once per page; scenes clone from it.
export function loadGLB(url) {
  if (!cache.has(url))
    cache.set(
      url,
      loader
        .loadAsync(url)
        .then((gltf) => {
          // Shared by every clone for the life of the page: dispose() skips
          // these (closing their ImageBitmaps would break later scenes).
          gltf.scene.traverse((o) => {
            o.userData.cached = true;
          });
          return gltf;
        })
        .catch((e) => {
        cache.delete(url);
        throw e;
      }),
    );
  return cache.get(url);
}

export function buildRoom(scene, onReady) {
  scene.background = new THREE.Color("#2b2740");
  scene.fog = new THREE.Fog("#2b2740", 26, 60);

  // Bright, warm club lighting: a strong sky/ground fill so nothing reads as
  // murky, a key from the chandelier, warm lamps and a cool window light.
  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x8a6a50, 1.9));
  scene.add(new THREE.AmbientLight(0xffe8cc, 0.55));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
  key.position.set(-2.5, 7, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {
    left: -5,
    right: 5,
    top: 5,
    bottom: -5,
    near: 1,
    far: 20,
  });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const windowLight = new THREE.DirectionalLight(0xb8c4ff, 0.9);
  windowLight.position.set(8, 4, -6);
  scene.add(windowLight);
  const chandelier = new THREE.PointLight(0xffd9a8, 22, 9, 1.6);
  chandelier.position.set(0, 3.4, 0.1);
  scene.add(chandelier);
  // The cabinet lamp and the floor lamp (Blender coordinates × 1.4).
  const lamps = [
    [-0.84, 1.8, -5.74],
    [-5.46, 2.38, -5.18],
  ].map(([x, y, z]) => {
    const light = new THREE.PointLight(0xffc27a, 9, 7, 1.8);
    light.position.set(x, y, z);
    scene.add(light);
    return light;
  });

  const room = new THREE.Group();
  room.scale.setScalar(WORLD_SCALE);
  scene.add(room);
  loadGLB(`${ASSETS}/room.glb`)
    .then((gltf) => {
      const model = gltf.scene.clone(true);
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = !/ceiling|beam|floor|rug|wain|paper|crown$/.test(o.name);
        o.receiveShadow = true;
        const m = o.material;
        // Chunky PS2-era texels, like the reference shots.
        if (m?.map) m.map.magFilter = THREE.NearestFilter;
        if (/shade|bulb/.test(m?.name || "")) m.toneMapped = false;
        // Keep the baize a deep billiard green under the bright fill.
        if (m?.name === "felt") m.color.setHex(0x93ab9e);
      });
      room.add(model);
      onReady?.();
    })
    .catch((e) => console.error("KING room failed to load", e));

  // Tbilisi at dusk, Mtatsminda and the TV tower, on a curved wall outside
  // the windows (back-right of the room).
  const pano = new THREE.TextureLoader().load(`${ASSETS}/tbilisi.jpg`);
  pano.colorSpace = THREE.SRGBColorSpace;
  pano.anisotropy = 4;
  const backdrop = new THREE.Mesh(
    new THREE.CylinderGeometry(15, 15, 12, 48, 1, true, 1.35, 2.8),
    new THREE.MeshBasicMaterial({
      map: pano,
      side: THREE.BackSide,
      fog: false,
      toneMapped: false,
    }),
  );
  pano.wrapS = THREE.RepeatWrapping;
  pano.repeat.x = -1;
  // The ridge and tower fill the window tops; the city sits below the sills.
  backdrop.position.set(0, -0.5, -0.5);
  scene.add(backdrop);

  return { lamps, chandelier };
}
