import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { box, card, dispose } from "./primitives";
import { characterFor, customCharacter } from "./characters";

export class Actor {
  constructor(parent, position, room, player, onError) {
    this.root = new THREE.Group();
    this.root.position.set(...position);
    parent.add(this.root);
    this.root.rotation.y = position[0] < 0 ? 0.32 : -0.32;
    this.player = player;
    this.onError = onError;
    this.disposed = false;
    this.version = 0;
    this.load(characterFor(room, player.seat).url);
    customCharacter(player.name)
      .then((saved) => {
        if (saved && !this.disposed) this.replace(saved);
      })
      .catch(() => {});
  }
  async load(url, custom) {
    const version = ++this.version;
    try {
      const loader = new GLTFLoader();
      const gltf = custom
        ? await loader.parseAsync(custom.buffer, "")
        : await loader.loadAsync(url);
      if (this.disposed || version !== this.version) {
        dispose(gltf.scene);
        return;
      }
      const importedBounds = new THREE.Box3().setFromObject(gltf.scene);
      if (
        !Number.isFinite(importedBounds.min.y) ||
        importedBounds.getSize(new THREE.Vector3()).y <= 0
      ) {
        dispose(gltf.scene);
        throw new Error("Model has no visible geometry");
      }
      if (this.model) {
        this.root.remove(this.model);
        this.mixer?.stopAllAction();
        dispose(this.model);
      }
      this.model = gltf.scene;
      this.root.add(this.model);
      const bounds = new THREE.Box3().setFromObject(this.model),
        height = bounds.getSize(new THREE.Vector3()).y;
      this.model.scale.setScalar(1.7 / Math.max(height, 0.01));
      this.model.position.y = -bounds.min.y * this.model.scale.x;
      this.model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = o.receiveShadow = true;
        }
      });
      this.head = this.model.getObjectByName("head");
      this.arm = this.model.getObjectByName("arm-right");
      this.leftArm = this.model.getObjectByName("arm-left");
      if (!custom && this.head) {
        this.head.scale.setScalar(0.65);
      }
      this.mixer = new THREE.AnimationMixer(this.model);
      const sit =
        gltf.animations.find((a) => /^sit$/i.test(a.name)) ||
        gltf.animations.find((a) => /sit|seated/i.test(a.name));
      if (sit) {
        this.mixer.clipAction(sit).play();
        this.mixer.update(0.1);
      }
      // Keep the seated animation on legs; procedurally hold cards and reach with arms.
      this.headRest = this.head?.quaternion.clone();
      this.armRest = this.arm?.quaternion.clone();
      this.leftRest = this.leftArm?.quaternion.clone();
      this.model.position.y += 0.75;
      if (this.cards) {
        this.root.remove(this.cards);
        dispose(this.cards);
      }
      this.cards = new THREE.Group();
      this.cards.position.set(0, 1.3, 0.47);
      this.cards.rotation.y = 0;
      this.root.add(this.cards);
      for (let i = 0; i < 5; i++) {
        const c = card(this.cards, null, true);
        c.scale.setScalar(0.65);
        c.position.set((i - 2) * 0.065, Math.abs(i - 2) * -0.008, i * 0.004);
        c.rotation.z = (i - 2) * -0.12;
      }
      if (this.pendingHead) await this.attachHead(this.pendingHead);
      return true;
    } catch {
      if (!this.disposed)
        this.onError?.("მოდელი ვერ ჩაიტვირთა. სცადე სხვა GLB ფაილი.");
      return false;
    }
  }
  async replace(custom) {
    if (custom.kind === "head") {
      this.pendingHead = custom;
      if (this.model) return this.attachHead(custom);
      return false;
    } else {
      this.pendingHead = null;
      return this.load(null, custom);
    }
  }
  async attachHead(custom) {
    const version = this.version;
    try {
      const gltf = await new GLTFLoader().parseAsync(custom.buffer, "");
      if (this.disposed || version !== this.version) {
        dispose(gltf.scene);
        return;
      }
      const importedBounds = new THREE.Box3().setFromObject(gltf.scene);
      if (
        !Number.isFinite(importedBounds.min.y) ||
        importedBounds.getSize(new THREE.Vector3()).y <= 0
      ) {
        dispose(gltf.scene);
        this.onError?.("მოდელს ხილული გეომეტრია არ აქვს.");
        return false;
      }
      const anchor = this.head || this.model.getObjectByName("Head");
      if (!anchor) {
        dispose(gltf.scene);
        this.onError?.(
          "ამ სხეულს head/Head კვანძი არ აქვს. ატვირთე სრული პერსონაჟი.",
        );
        return false;
      }
      if (this.customHead) {
        this.customHead.removeFromParent();
        dispose(this.customHead);
      }
      const old = this.model.getObjectByName("head-mesh");
      if (old) old.visible = false;
      const features = this.model.getObjectByName("king-face");
      if (features) features.visible = false;
      const head = gltf.scene,
        bounds = new THREE.Box3().setFromObject(head),
        center = bounds.getCenter(new THREE.Vector3()),
        size = bounds.getSize(new THREE.Vector3());
      const worldScale = anchor.getWorldScale(new THREE.Vector3()).y;
      const scale = 0.34 / Math.max(size.y, 0.01) / worldScale;
      head.scale.setScalar(scale);
      head.position.set(
        -center.x * scale,
        -bounds.min.y * scale,
        -center.z * scale,
      );
      anchor.add(head);
      this.customHead = head;
      return true;
    } catch {
      this.onError?.("თავის მოდელი ვერ ჩაიტვირთა.");
      return false;
    }
  }
  update(time, dt, active, count, reaction) {
    if (!this.model) return;
    this.mixer?.update(dt);
    this.root.position.y = Math.sin(time * 1.3 + this.player.seat) * 0.008;
    if (this.head) {
      this.head.quaternion.copy(this.headRest);
      this.head.rotation.y += Math.sin(time * 0.65 + this.player.seat) * 0.08;
      this.head.rotation.x += active ? -0.06 : 0.02;
      if (reaction)
        this.head.rotation.x += reaction > 0 ? Math.sin(time * 3) * 0.1 : 0.12;
    }
    if (this.arm) {
      this.arm.quaternion.copy(this.armRest);
      this.arm.rotation.x -=
        0.55 +
        (this.reachUntil > time
          ? Math.sin((this.reachUntil - time) * Math.PI) * 0.5
          : 0);
    }
    if (this.leftArm) {
      this.leftArm.quaternion.copy(this.leftRest);
      this.leftArm.rotation.x -= 0.45;
    }
    if (this.cards) this.cards.visible = count > 0;
  }
  destroy() {
    this.disposed = true;
    this.mixer?.stopAllAction();
    dispose(this.root);
    this.root.removeFromParent();
  }
}

export function createHands(parent) {
  const hands = new THREE.Group();
  parent.add(hands);
  for (const side of [-1, 1]) {
    const hand = new THREE.Group();
    hands.add(hand);
    hand.position.set(side * 0.7, 1.06, 1.65);
    hand.rotation.set(-0.15, side * -0.32, side * -0.13);
    box(hand, [0.2, 0.16, 0.55], [0, -0.06, 0.3], 0x303c38);
    box(hand, [0.2, 0.105, 0.22], [0, 0, -0.05], 0xb88864);
    for (let i = 0; i < 4; i++)
      box(
        hand,
        [0.037, 0.065, 0.16 - i * 0.014],
        [-0.075 + i * 0.05, 0.014, -0.2],
        0xb88864,
      );
    box(hand, [0.075, 0.06, 0.14], [side * -0.11, 0.01, -0.04], 0xb88864, [
      0,
      side * 0.5,
      0,
    ]);
  }
  return hands;
}
