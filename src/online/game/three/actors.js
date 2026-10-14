import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { card, dispose } from "./primitives";
import { ASSETS, WORLD_SCALE, loadGLB } from "./room";

// Default looks per seat so the two opponents never match (the reference
// shots: one in a charcoal shirt with black hair, one in white with brown).
const OUTFITS = {
  male: [
    { shirt: 0x3a3d42, pants: 0x24262b, hair: 0x15110e },
    { shirt: 0xe9e4d8, pants: 0x3b3a36, hair: 0x4a2c18 },
  ],
  female: [
    { shirt: 0x7a2e3a, pants: 0x1e2026, hair: 0x2b1a12 },
    { shirt: 0x284a6a, pants: 0x23252c, hair: 0x6a4024 },
  ],
};
const tmp = new THREE.Vector3(),
  tmp2 = new THREE.Vector3(),
  look = new THREE.Vector3(),
  q = new THREE.Quaternion();

export class Actor {
  constructor(parent, seat, player, look, onError) {
    this.root = new THREE.Group();
    this.root.position.set(...seat.position);
    this.root.rotation.y = seat.rotation;
    this.root.scale.setScalar(WORLD_SCALE);
    parent.add(this.root);
    this.player = player;
    this.onError = onError;
    this.slot = seat.slot ?? 0;
    this.disposed = false;
    this.version = 0;
    this.nextBlink = 1 + Math.random() * 3;
    this.lookTarget = new THREE.Vector3(0, 1.1, 0);
    this.headYaw = 0;
    this.headPitch = 0;
    this.setLook(look);
  }
  // look: { gender: "male" | "female", head: url | null }
  async setLook(look = {}) {
    const gender = look.gender === "female" ? "female" : "male";
    if (
      this.model &&
      this.gender === gender &&
      (this.headUrl || null) === (look.head || null)
    )
      return;
    const version = ++this.version;
    try {
      const gltf = await loadGLB(`${ASSETS}/${gender}.glb`);
      if (this.disposed || version !== this.version) return;
      this.clear();
      this.gender = gender;
      this.headUrl = look.head || null;
      const model = cloneSkinned(gltf.scene);
      this.model = model;
      this.root.add(model);
      const outfit = OUTFITS[gender][this.slot % 2];
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        o.frustumCulled = false;
        // Materials are shared by every clone of the GLB; recolour copies.
        o.material = o.material.clone();
        const name = o.material.name;
        if (outfit[name] != null) o.material.color.setHex(outfit[name]);
        // Faces read better a touch darker under the bright club lights.
        if (name === "face" || name === "skin" || name === "eyelid")
          o.material.color.multiplyScalar(0.82);
        if (name === "hair" || name === "face") {
          // The face texture carries painted hair; tint only the shell.
          if (name === "hair") o.material.color.setHex(0xffffff);
        }
      });
      this.bones = {};
      model.traverse((o) => {
        if (o.isBone) this.bones[o.name] = o;
      });
      // GTA-style proportions: a slightly oversized head reads across the table.
      this.bones.head?.scale.setScalar(1.14);
      this.lidsRest = null;
      this.rest = {};
      for (const name of ["head", "neck", "lids"])
        if (this.bones[name])
          this.rest[name] = this.bones[name].quaternion.clone();
      this.mixer = new THREE.AnimationMixer(model);
      this.clips = Object.fromEntries(
        gltf.animations.map((c) => [c.name, this.mixer.clipAction(c)]),
      );
      for (const name of ["play", "win", "lose"]) {
        const action = this.clips[name];
        if (!action) continue;
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = false;
      }
      this.mixer.addEventListener("finished", (e) => {
        if (e.action === this.oneShot) {
          this.oneShot = null;
          this.base?.fadeIn(0.25);
        }
      });
      this.base = this.clips.idle;
      this.base?.play();
      // Each opponent breathes on its own beat.
      if (this.base) this.base.time = Math.random() * 3;
      this.cards = new THREE.Group();
      this.root.add(this.cards);
      for (let i = 0; i < 6; i++) {
        const c = card(this.cards, null, true);
        c.scale.setScalar(0.42);
        c.position.set((i - 2.5) * 0.026, Math.abs(i - 2.5) * -0.004, i * 0.002);
        c.rotation.z = (i - 2.5) * -0.16;
      }
      if (this.headUrl) await this.attachHead(this.headUrl, version);
    } catch (e) {
      console.error("KING character failed to load", e);
      if (!this.disposed) this.onError?.("პერსონაჟი ვერ ჩაიტვირთა.");
    }
  }
  async attachHead(url, version) {
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      if (this.disposed || version !== this.version) {
        dispose(gltf.scene);
        return;
      }
      const anchor = this.bones.head;
      const head = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(head);
      const size = bounds.getSize(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0) throw new Error("empty");
      // Fit the uploaded head to the default head's height (≈ 29 cm with
      // hair), standing on the neck, facing forward.
      this.model.updateMatrixWorld(true);
      const boneScale = anchor.getWorldScale(new THREE.Vector3()).y;
      const scale = (0.29 * WORLD_SCALE) / size.y / boneScale;
      const center = bounds.getCenter(new THREE.Vector3());
      const holder = new THREE.Group();
      // Undo the bone's rest orientation so the head stays upright.
      anchor.getWorldQuaternion(q).invert();
      holder.quaternion.copy(q).multiply(
        this.root.getWorldQuaternion(new THREE.Quaternion()),
      );
      head.scale.setScalar(scale);
      head.position.set(
        -center.x * scale,
        -bounds.min.y * scale - 0.02 / boneScale,
        -center.z * scale,
      );
      head.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      holder.add(head);
      anchor.add(holder);
      this.customHead = holder;
      for (const name of ["head_mesh", "hair"]) {
        const mesh = this.model.getObjectByName(name);
        if (mesh) mesh.visible = false;
      }
    } catch (e) {
      console.error("KING custom head failed", e);
      this.onError?.("სახის მოდელი ვერ ჩაიტვირთა — ნაჩვენებია საწყისი.");
    }
  }
  clear() {
    this.mixer?.stopAllAction();
    if (this.model) {
      this.root.remove(this.model);
      // Geometry and textures belong to the cached GLB; free only the copies.
      this.model.traverse((o) => {
        if (o.isMesh) o.material.dispose();
      });
      if (this.customHead) dispose(this.customHead);
    }
    if (this.cards) {
      this.root.remove(this.cards);
      dispose(this.cards);
    }
    this.model = this.cards = this.customHead = this.mixer = null;
  }
  // One-shot gestures layered over the idle loop.
  gesture(name) {
    const action = this.clips?.[name];
    if (!action || this.oneShot === action) return;
    this.oneShot?.fadeOut(0.15);
    action.reset().setEffectiveWeight(1).fadeIn(0.15).play();
    this.base?.fadeOut(0.2);
    this.oneShot = action;
  }
  setThinking(on) {
    const next = on ? this.clips?.think : this.clips?.idle;
    if (!next || next === this.base) return;
    const prev = this.base;
    this.base = next;
    next.reset().play();
    if (this.oneShot) next.setEffectiveWeight(0);
    else prev?.crossFadeTo(next, 0.6, false);
    if (this.oneShot) prev?.fadeOut(0.3);
  }
  update(time, dt, { active, count, lookAt }) {
    if (!this.model) return;
    this.setThinking(active);
    this.mixer.update(dt);
    // Glance at whoever is acting; settle back toward the table otherwise.
    const head = this.bones.head;
    if (head && this.rest.head) {
      if (lookAt) this.lookTarget.lerp(lookAt, Math.min(1, dt * 3));
      head.getWorldPosition(tmp);
      look.copy(this.lookTarget).sub(tmp);
      this.root.getWorldQuaternion(q).invert();
      look.applyQuaternion(q);
      const yaw = THREE.MathUtils.clamp(Math.atan2(look.x, look.z), -0.7, 0.7);
      const pitch = THREE.MathUtils.clamp(
        -Math.atan2(look.y, Math.hypot(look.x, look.z)),
        -0.3,
        0.35,
      );
      this.headYaw += (yaw - this.headYaw) * Math.min(1, dt * 4);
      this.headPitch += (pitch - this.headPitch) * Math.min(1, dt * 4);
      // Layered on top of the clip's own head motion, in root space.
      const parentQ = head.parent.getWorldQuaternion(new THREE.Quaternion());
      const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
      const turn = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(this.headPitch * 0.6, this.headYaw * 0.75, 0, "YXZ"),
      );
      // world-space turn = root * turn * root⁻¹, expressed in the parent's frame.
      const worldTurn = rootQ.clone().multiply(turn).multiply(rootQ.invert());
      head.quaternion.premultiply(
        parentQ.clone().invert().multiply(worldTurn).multiply(parentQ),
      );
    }
    // Blink every few seconds: the lids slide out from inside the face.
    const lids = this.bones.lids;
    if (lids) {
      if (time > this.nextBlink) {
        this.blinkAt = time;
        this.nextBlink = time + 2 + Math.random() * 4;
      }
      const t = (time - (this.blinkAt ?? -1)) / 0.16;
      const closed = t >= 0 && t <= 1 ? Math.sin(t * Math.PI) : 0;
      this.lidsRest ??= lids.position.clone();
      lids.position.copy(this.lidsRest);
      if (closed) {
        // The character's forward (+Z of the root) in the head's frame.
        lids.parent.getWorldQuaternion(q).invert();
        tmp
          .set(0, 0, 1)
          .applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()))
          .applyQuaternion(q);
        const s = lids.parent.getWorldScale(tmp2).x / WORLD_SCALE;
        lids.position.addScaledVector(tmp, (0.026 * closed) / s);
      }
    }
    // The fan follows the hands, held upright facing the actor.
    if (this.cards) {
      const l = this.bones.hand_L,
        r = this.bones.hand_R;
      this.cards.visible = count > 0 && this.oneShot !== this.clips?.play;
      if (l && r) {
        l.getWorldPosition(tmp);
        r.getWorldPosition(tmp2);
        tmp.lerp(tmp2, 0.5);
        this.root.worldToLocal(tmp);
        this.cards.position.copy(tmp).add(new THREE.Vector3(0, 0.07, -0.03));
        this.cards.rotation.set(-0.25, Math.PI, 0);
      }
      this.cards.children.forEach((c, i) => {
        c.visible = i < Math.max(1, Math.min(6, Math.ceil(count / 2)));
      });
    }
  }
  destroy() {
    this.disposed = true;
    this.clear();
    this.root.removeFromParent();
  }
}

// First-person hands from blender/hands.py: the left holds the fan, the
// right rests on the felt and reaches toward whatever is clicked.
export function createHands(parent, onReady) {
  const hands = new THREE.Group();
  parent.add(hands);
  const left = new THREE.Group(),
    right = new THREE.Group();
  hands.add(left, right);
  hands.userData = { left, right };
  loadGLB(`${ASSETS}/hands.glb`)
    .then((gltf) => {
      for (const [name, group] of [
        ["hand_left", left],
        ["hand_right", right],
      ]) {
        const mesh = gltf.scene.getObjectByName(name)?.clone(true);
        if (!mesh) continue;
        mesh.position.set(0, 0, 0);
        mesh.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.material = o.material.clone();
          }
        });
        mesh.scale.setScalar(WORLD_SCALE);
        group.add(mesh);
      }
      onReady?.();
    })
    .catch((e) => console.error("KING hands failed to load", e));
  return hands;
}

// Skin and sleeve follow the player's chosen gender.
export function dressHands(hands, gender) {
  const female = gender === "female";
  hands.traverse((o) => {
    if (!o.isMesh) return;
    o.material.color.setHex(
      o.material.name === "skin"
        ? female
          ? 0xd9a07c
          : 0xc08a64
        : o.material.name === "sleeve"
          ? female
            ? 0x6e2a36
            : 0x2e3436
          : o.material.color.getHex(),
    );
  });
  for (const side of [hands.userData.left, hands.userData.right])
    side?.scale.setScalar(female ? 0.9 : 1);
}
