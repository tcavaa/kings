import * as THREE from "three";
import { buildRoom, SEATS } from "./room";
import { Actor, createHands, dressHands } from "./actors";
import {
  box,
  card,
  dispose,
  drawCrown,
  fitText,
  panel,
  woodGrain,
  COLORS,
  RED,
  SERIF,
  SUITS,
  CARD_H,
  CARD_W,
} from "./primitives";
import { relativeSeat } from "./characters";
import { isPlayableCard } from "../lib/playable";
import { canDiscard } from "../../../../server/game/rules.js";
import { playShuffleSound } from "../lib/shuffleSound";
import {
  isFreshDeal,
  loadLastDeal,
  saveLastDeal,
  dealRecord,
} from "../lib/dealMemory";
import { GAME_TYPES } from "../../constants/gameTypes";

const key = (c) => `${c.rank}-${c.suit}`;
const FELT_Y = 1.05;
// Seated at the near edge, eyes ~45 cm above the baize, looking across at
// the two opponents (blender/room.py: table apothem 0.84 m, × 1.4).
const EYE = new THREE.Vector3(0, 1.64, 1.46);
const AIM = new THREE.Vector3(0, 1.12, -0.6);
// The hand fan: held low left, upright, faces to the camera.
const FAN = { position: [-0.15, 1.26, 0.92], rotation: [-0.36, 0.3, -0.06], scale: 0.52 };
// Suit shown on each round tile, as on the reference board.
const TILE_SUIT = { K: "S", Q: "H", J: "C", H: "D", L2: "S", T: "H", P1: "C", P2: "D", P3: "S" };
// Where a seat's cards come from / go to (scene units).
const atSeat = (rel) =>
  rel === 0
    ? new THREE.Vector3(-0.2, 1.4, 1.1)
    : rel === 1
      ? new THREE.Vector3(-0.72, 1.45, -0.85)
      : new THREE.Vector3(0.72, 1.45, -0.85);
// Each seat's played card lands on its own side of the trick.
const trickSpot = (rel) =>
  rel === 0
    ? new THREE.Vector3(0.02, FELT_Y + 0.012, 0.16)
    : rel === 1
      ? new THREE.Vector3(-0.2, FELT_Y + 0.006, -0.14)
      : new THREE.Vector3(0.22, FELT_Y + 0.009, -0.16);
const pad = (n) => String(n).padStart(2, "0");

export class TableScene {
  constructor(host, callbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.actors = [];
    this.targets = [];
    this.tweens = [];
    this.handCards = [];
    this.time = 0;
    this.lastDeal = loadLastDeal();
    this.selection = null;
    this.book = false;
    this.page = 0;
    this.last = false;
    this.look = { x: 0, y: 0 };
    this.looks = {};
    this.myLook = { gender: "male" };
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(56, 1, 0.05, 80);
    this.camera.position.copy(EYE);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    // Phones report 3x pixels; 1.5x looks the same at arm's length and draws
    // about a quarter fewer pixels than 1.75x.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The room is still; only the players and the cards move. The shadow map
    // is redrawn by the render loop (see below), not on every frame.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "კინგი — 3D სათამაშო ოთახი",
    );
    this.renderer.domElement.tabIndex = 0;
    this.lights = buildRoom(this.scene);
    this.hands = createHands(this.scene, () => {
      dressHands(this.hands, this.myLook.gender);
    });
    this.dynamic = new THREE.Group();
    this.scene.add(this.dynamic);
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.reachPoint = new THREE.Vector3();
    this.abort = new AbortController();
    const options = { signal: this.abort.signal };
    const canvas = this.renderer.domElement;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault(), options);
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button === 2) {
          this.drag = { x: e.clientX, y: e.clientY };
          canvas.setPointerCapture(e.pointerId);
        } else if (e.button === 0) {
          const hit = this.pick(e);
          if (hit?.point) this.reachPoint.copy(hit.point);
          hit?.object.userData.action?.();
        }
      },
      options,
    );
    canvas.addEventListener(
      "pointerup",
      () => {
        this.drag = null;
      },
      options,
    );
    canvas.addEventListener(
      "pointercancel",
      () => {
        this.drag = null;
      },
      options,
    );
    canvas.addEventListener(
      "pointermove",
      (e) => {
        this.lastInputAt = performance.now();
        if (this.drag) {
          this.look.x = THREE.MathUtils.clamp(
            this.look.x + (e.clientX - this.drag.x) * 0.002,
            -0.45,
            0.45,
          );
          this.look.y = THREE.MathUtils.clamp(
            this.look.y + (e.clientY - this.drag.y) * 0.0015,
            -0.18,
            0.3,
          );
          this.drag = { x: e.clientX, y: e.clientY };
        } else {
          const hit = this.pick(e)?.object || null;
          canvas.style.cursor = hit ? "pointer" : "grab";
          if (this.hover !== hit) {
            this.hover = hit;
            this.callbacks.onHint(hit?.userData.label || "");
          }
        }
      },
      options,
    );
    canvas.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" || e.key.toLowerCase() === "r") {
          this.look = { x: 0, y: 0 };
          this.book = false;
          this.last = false;
          this.refresh();
        }
        if (e.key.toLowerCase() === "s") this.showScores();
        if (e.key === "ArrowLeft")
          this.look.x = Math.max(-0.45, this.look.x - 0.08);
        if (e.key === "ArrowRight")
          this.look.x = Math.min(0.45, this.look.x + 0.08);
      },
      options,
    );
    canvas.addEventListener(
      "webglcontextlost",
      (e) => {
        e.preventDefault();
        this.callbacks.onError(
          "3D გრაფიკა შეჩერდა. შეგიძლია 2D რეჟიმში დაბრუნდე.",
        );
      },
      options,
    );
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let before = performance.now();
    let frame = 0;
    const aim = new THREE.Vector3();
    // Frame pacing: 60 fps while something moves (a card in flight, the
    // pointer over the table), 30 when the table is just breathing. A 120 Hz
    // screen would otherwise draw the ~200-mesh room twice as often for
    // nothing, and a phone pays for it in heat and battery.
    this.lastInputAt = 0;
    this.renderer.setAnimationLoop((now) => {
      if (document.hidden) return;
      const busy = this.tweens.length > 0 || now - this.lastInputAt < 1500;
      if (now - before < (busy ? 1000 / 60 : 1000 / 30) - 2) return;
      const dt = Math.min((now - before) / 1000, 0.05);
      before = now;
      frame++;
      // Shadows follow moving cards every frame, the players' small
      // movements about 15 times a second.
      if (this.tweens.length > 0 || frame % (busy ? 4 : 2) === 0) {
        this.renderer.shadowMap.needsUpdate = true;
      }
      this.time += dt;
      const t = this.time,
        still = this.reducedMotion;
      // Seated breathing: the camera drifts a few millimetres.
      this.camera.position.set(
        EYE.x + (still ? 0 : Math.sin(t * 0.5) * 0.012),
        EYE.y + (still ? 0 : Math.sin(t * 1.1) * 0.008),
        EYE.z,
      );
      aim.set(AIM.x + this.look.x * 3, AIM.y + this.look.y * 3, AIM.z);
      this.camera.lookAt(aim);
      for (const tw of this.tweens) {
        const p = THREE.MathUtils.clamp((t - tw.start) / tw.duration, 0, 1);
        tw.mesh.position.lerpVectors(tw.from, tw.to, 1 - Math.pow(1 - p, 3));
        if (p > 0 && p < 1) tw.mesh.position.y += Math.sin(p * Math.PI) * 0.18;
      }
      this.tweens = this.tweens.filter((tw) => t < tw.start + tw.duration);
      // Hovered card in hand rises out of the fan.
      for (const h of this.handCards) {
        const want = (this.hover === h.face ? 0.06 : 0) + (h.selected ? 0.08 : 0);
        h.lift += (want - h.lift) * Math.min(1, dt * 12);
        h.arm.position.y = h.lift;
      }
      this.updateActors(t, dt);
      this.updateHands(t, dt);
      if (this.bookGroup && !still && this.pageTurnAt != null) {
        const progress = Math.min(1, (t - this.pageTurnAt) / 0.35);
        this.bookGroup.rotation.z = -0.08 + Math.sin(progress * Math.PI) * 0.06;
      }
      if (this.lights?.lamps && !still)
        this.lights.lamps.forEach((l, i) => {
          l.intensity = 9 + Math.sin(t * 7 + i * 3) * 0.15;
        });
      this.renderer.render(this.scene, this.camera);
    });
  }
  updateActors(t, dt) {
    const s = this.state;
    if (!s) return;
    const scores = s.cumulativeScores || {};
    const best = Math.max(...Object.values(scores), -Infinity);
    for (const actor of this.actors) {
      const seat = actor.player.seat;
      // Look at whoever's turn it is: the camera for me, a head for others.
      const turnRel =
        s.currentTurn == null ? null : relativeSeat(s.currentTurn, s.mySeat);
      let lookAt;
      if (s.currentTurn === seat) lookAt = new THREE.Vector3(0, FELT_Y, 0.4);
      else if (turnRel === 0) lookAt = this.camera.position;
      else if (turnRel != null) {
        const other = this.actors.find((a) => a.player.seat === s.currentTurn);
        lookAt = other?.root.position.clone().setY(1.95);
      }
      if (!this.reducedMotion)
        actor.update(t, dt, {
          active: s.gamePhase === "playing" && s.currentTurn === seat,
          count: s.cardCounts?.[seat] || 0,
          lookAt,
        });
      if (s.gamePhase === "round_end" && actor.reactedRound !== s.round) {
        actor.reactedRound = s.round;
        actor.gesture(scores[seat] === best ? "win" : "lose");
      }
    }
  }
  updateHands(t, dt) {
    const { left, right } = this.hands.userData;
    if (!left || !right) return;
    const still = this.reducedMotion;
    // Left hand grips the fan's lower left, thumb over the faces.
    const fan = this.fanGroup;
    if (fan) {
      fan.updateMatrixWorld();
      // The card bottoms sit in the palm: the grip point is ~7 cm (real) up.
      left.position.copy(fan.localToWorld(new THREE.Vector3(-0.14, 0.06, 0.01)));
      // hands.glb shares the fan's frame: up the cards +Y, faces +Z.
      fan.getWorldQuaternion(left.quaternion);
    }
    left.visible = !!fan;
    if (!still) left.position.y += Math.sin(t * 1.4) * 0.003;
    // Right hand rests on the felt edge and reaches toward what was clicked.
    const rest = this.bookGroup
      ? new THREE.Vector3(0.62, FELT_Y + 0.08, 0.86)
      : new THREE.Vector3(0.26, FELT_Y + 0.045, 0.66);
    const reach = Math.max(0, (this.reachUntil || 0) - t);
    const k = Math.sin((Math.min(reach, 0.55) / 0.55) * Math.PI);
    const target = rest.clone().lerp(this.reachPoint, k * 0.55);
    if (!this.reachPoint.lengthSq()) target.copy(rest);
    right.position.lerp(target, still ? 1 : Math.min(1, dt * 14));
    if (!still) right.position.y += Math.sin(t * 1.2 + 1) * 0.003;
    right.rotation.set(-0.05, 0.35, -0.25);
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    const aspect = width / Math.max(height, 1);
    this.camera.aspect = aspect;
    // Narrow screens widen the lens so both opponents stay in view.
    this.camera.fov = aspect < 1.2 ? 70 : aspect < 1.5 ? 60 : 53;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
    return this.ray.intersectObjects(this.targets, false)[0];
  }
  clickable(mesh, title, action, enabled = true) {
    if (!enabled) return;
    const interact = () => {
      this.reachUntil = this.time + 0.55;
      if (!this.reachPoint.lengthSq() || this.reachPoint.distanceTo(mesh.getWorldPosition(new THREE.Vector3())) > 0.5)
        mesh.getWorldPosition(this.reachPoint);
      action();
    };
    mesh.userData.action = interact;
    mesh.userData.label = title;
    this.targets.push(mesh);
    this.controls.push({ label: title, action: interact });
  }
  tween(mesh, from, to, delay = 0, duration = 0.42) {
    if (this.reducedMotion) {
      mesh.position.copy(to);
      return;
    }
    mesh.position.copy(from);
    this.tweens.push({
      mesh,
      from: from.clone(),
      to: to.clone(),
      start: this.time + delay,
      duration,
    });
  }
  // Per-player 3D looks from profiles: { [seat]: { gender, head } }.
  setLooks(looks, mine) {
    this.looks = looks || {};
    if (mine) {
      this.myLook = mine;
      dressHands(this.hands, mine.gender);
    }
    for (const actor of this.actors)
      actor.setLook(this.looks[actor.player.seat]);
  }
  update(state) {
    const old = this.state;
    if (old?.gamePhase !== state.gamePhase || old?.round !== state.round) {
      this.selection = null;
      this.sent = false;
    }
    if (old?.round !== state.round) {
      this.book = false;
      this.last = false;
    }
    this.previous = old;
    this.state = state;
    this.animateDeal =
      !state.spectator && isFreshDeal(state.hand, state.round, this.lastDeal);
    if (this.animateDeal) {
      this.lastDeal = dealRecord(state.hand, state.round);
      saveLastDeal(this.lastDeal);
      playShuffleSound();
    }
    if ((state.currentTrick || []).length < 3) this.collecting = null;
    const roster = `${state.roomCode}:${state.mySeat}:${state.players.map((p) => `${p.seat}:${p.name}`).join("|")}`;
    if (this.roster !== roster) {
      this.roster = roster;
      this.actors.forEach((a) => a.destroy());
      this.actors = state.players
        .filter((p) => relativeSeat(p.seat, state.mySeat) !== 0)
        .map((p) => {
          const rel = relativeSeat(p.seat, state.mySeat);
          return new Actor(
            this.scene,
            { ...SEATS[rel], slot: rel - 1 },
            p,
            this.looks[p.seat],
            (msg) => this.callbacks.onNotice(msg),
          );
        });
    }
    for (const a of this.actors) a.setCrowned((state.champions || []).includes(a.player.name));
    this.refresh();
  }
  send(type, value) {
    if (this.sent || this.state.reconnecting || this.state.spectator) return;
    this.sent = true;
    this.callbacks.onAction(type, value);
    this.refresh();
    clearTimeout(this.sendTimer);
    // Server remains authoritative. A rejected selection must be retryable.
    this.sendTimer = setTimeout(() => {
      this.sent = false;
      if (!this.disposed) this.refresh();
    }, 1600);
  }
  collect(winner) {
    this.collecting = winner;
    this.refresh();
  }
  showScores() {
    this.book = !this.book;
    this.pageTurnAt = this.time;
    this.last = false;
    this.refresh();
  }
  showLast() {
    this.last = !this.last;
    this.book = false;
    this.refresh();
  }
  name(p) {
    if (!p) return "";
    return p.seat === this.state.mySeat && !this.state.spectator ? "შენ" : p.name;
  }
  refresh() {
    if (!this.state || this.disposed) return;
    this.renderer.shadowMap.needsUpdate = true; // the table's objects change
    const s = this.state,
      old = this.previous;
    this.targets = [];
    this.controls = [];
    this.tweens = [];
    this.handCards = [];
    this.fanGroup = null;
    this.hover = null;
    this.bookGroup = null;
    dispose(this.dynamic);
    const mine = !s.spectator && s.mySeat !== null;
    const deciding =
      mine &&
      s.mySeat === s.leaderSeat &&
      ["type_selection", "trump_selection", "discard"].includes(s.gamePhase);
    const open = this.book || s.gamePhase === "round_end";
    this.hands.visible = mine;
    this.kingSign();
    this.scoreStand();
    // Chat bubbles float above the speaker.
    s.players.forEach((p) => {
      const rel = relativeSeat(p.seat, s.mySeat);
      const message = s.chatBubbles?.[p.seat]?.message;
      if (!message || !rel) return;
      const seat = SEATS[rel].position;
      const bubble = panel(
        this.dynamic,
        0.95,
        0.26,
        [seat[0] * 0.92, 2.55, seat[2] + 0.2],
        (ctx, w, h) => {
          ctx.fillStyle = "#f6f1e4";
          ctx.beginPath();
          ctx.roundRect(4, 4, w - 8, h - 8, 24);
          ctx.fill();
          ctx.fillStyle = "#1d3a30";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          fitText(ctx, String(message).slice(0, 70), w / 2, h / 2, w - 40, 44, "500", "sans-serif");
        },
      );
      bubble.lookAt(this.camera.position);
      const lit = bubble.material;
      bubble.material = new THREE.MeshBasicMaterial({ map: lit.map, toneMapped: false });
      lit.dispose(); // the texture stays: the new material uses it
    });
    // The deck: a stack of backs at the leader's left.
    const deck = new THREE.Group();
    deck.position.set(-0.6, FELT_Y, 0.12);
    deck.rotation.y = 0.25;
    this.dynamic.add(deck);
    const stack = s.gamePhase === "playing" ? 3 : 8;
    for (let i = 0; i < stack; i++) {
      const c = card(deck, null, true);
      c.rotation.x = -Math.PI / 2;
      c.position.set(Math.sin(i) * 0.004, 0.004 + i * 0.006, Math.cos(i * 1.7) * 0.003);
    }
    // The two talon cards face-up before the leader takes them.
    if (s.gamePhase === "type_selection" || s.gamePhase === "trump_selection")
      (s.centerCards || []).forEach((c, i) => {
        const mesh = card(this.dynamic, c);
        mesh.rotation.set(-Math.PI / 2, 0, (i - 0.5) * 0.08);
        mesh.position.set(-0.1 + i * 0.2, FELT_Y + 0.006, -0.12);
      });
    const trick = this.last
      ? s.lastTrickResult?.trick || []
      : s.currentTrick || [];
    trick.forEach((entry, i) => {
      const c = entry.card || entry;
      if (!c.rank) return;
      const rel = relativeSeat(entry.seat ?? i, s.mySeat);
      const mesh = card(this.dynamic, c);
      mesh.rotation.set(-Math.PI / 2, 0, [0.04, 0.35, -0.3][rel] + i * 0.03);
      const to = trickSpot(rel);
      to.y += i * 0.004;
      const previous = old?.currentTrick?.some(
        (tc) => key(tc.card || tc) === key(c),
      );
      if (!previous && !this.last) {
        this.tween(mesh, atSeat(rel), to, rel ? 0.18 : 0);
        this.actors.find((a) => a.player.seat === entry.seat)?.gesture("play");
      } else mesh.position.copy(to);
      if (this.collecting != null || s.trickAnimation?.status === "animating")
        this.tween(
          mesh,
          to,
          atSeat(
            relativeSeat(
              this.collecting ?? s.trickAnimation.winnerSeat,
              s.mySeat,
            ),
          ),
          0,
          0.55,
        );
    });
    if (this.last)
      this.makeButton(
        this.dynamic,
        "დახურვა",
        [0, FELT_Y + 0.15, 0.75],
        0.6,
        0.13,
        () => this.showLast(),
      );
    if (mine) this.handFan(deciding, open);
    if (open) this.scorebook();
    else if (deciding) this.selectionTray();
    this.callbacks.onControls(this.controls);
    this.previous = s;
    this.animateDeal = false;
  }
  // My cards, fanned upright in the left hand, faces toward the camera.
  handFan(deciding, open) {
    const s = this.state;
    const hand = s.hand || [];
    const pivot = new THREE.Group();
    pivot.position.set(...FAN.position);
    pivot.rotation.set(...FAN.rotation);
    pivot.scale.setScalar(FAN.scale);
    this.dynamic.add(pivot);
    this.fanGroup = pivot;
    // Spread sideways like a real hand: every card shows its corner index,
    // a slight turn and a shallow arc, rather than a tight radial fan.
    const step = CARD_W * Math.min(0.36, 3.4 / Math.max(hand.length - 1, 1) / 1);
    hand.forEach((c, i) => {
      const offset = i - (hand.length - 1) / 2;
      const arm = new THREE.Group();
      arm.rotation.z = -offset * 0.045;
      arm.position.set(offset * step, -offset * offset * 0.0018, i * 0.0022);
      pivot.add(arm);
      const mesh = card(arm, c);
      mesh.position.y = CARD_H * 0.5;
      const selected = (s.selectedDiscards || []).some(
        (d) => key(d) === key(c),
      );
      const allowed =
        deciding && s.gamePhase === "discard"
          ? canDiscard(s.chosenGameType, c) &&
            (selected || s.selectedDiscards.length < 2)
          : isPlayableCard(c, s);
      const face = mesh.children[1];
      if (s.gamePhase === "playing" && !allowed)
        face.material.color.set(0x9a9c94);
      if (selected) face.material.color.set(0xffe29a);
      // Freshly dealt cards rise into the fan one after another.
      if (this.animateDeal)
        this.tween(mesh, new THREE.Vector3(0, -0.6, -1.2), mesh.position.clone(), i * 0.055, 0.45);
      this.handCards.push({ arm, face, lift: 0, selected });
      const action = () => {
        if (s.gamePhase === "discard")
          this.callbacks.onAction("toggleDiscard", c);
        else if (!this.playLocked) {
          this.playLocked = true;
          this.reachPoint.copy(trickSpot(0));
          this.callbacks.onAction("playCard", c);
          clearTimeout(this.playTimer);
          this.playTimer = setTimeout(() => {
            this.playLocked = false;
          }, 1200);
        }
      };
      this.clickable(
        face,
        `${c.rank}${SUITS[c.suit]}${selected ? " ✓" : ""}`,
        action,
        allowed && !open && !s.reconnecting && !this.sent,
      );
    });
  }
  status() {
    const s = this.state;
    if (s.reconnecting) return "კავშირი აღდგება…";
    if (s.gamePhase === "round_end") return "ხელი დასრულდა";
    if (s.gamePhase === "playing")
      return s.currentTurn === s.mySeat && !s.spectator
        ? "შენი სვლა"
        : `სვლა: ${s.players.find((p) => p.seat === s.currentTurn)?.name || ""}`;
    const phase =
      {
        type_selection: "ირჩევს თამაშს",
        trump_selection: "ირჩევს კოზირს",
        discard: "გადადებს 2 კარტს",
      }[s.gamePhase] || "";
    return `${this.name(s.players.find((p) => p.seat === s.leaderSeat))} · ${phase}`;
  }
  // Wooden tent card on the left: KING, the game's suit and round count.
  kingSign() {
    const s = this.state;
    const g = new THREE.Group();
    g.position.set(-0.74, FELT_Y, -0.02);
    g.rotation.y = 0.55;
    g.scale.setScalar(0.62);
    this.dynamic.add(g);
    const tilt = 0.32,
      w = 0.62,
      h = 0.36;
    for (const side of [1, -1]) {
      const face = new THREE.Group();
      face.position.set(0, h / 2 - 0.01, side * Math.sin(tilt) * h * 0.5);
      face.rotation.x = -side * tilt;
      if (side < 0) face.rotation.y = Math.PI;
      g.add(face);
      box(face, [w, h, 0.025], [0, 0, 0], COLORS.woodDark);
      if (side < 0) continue;
      const type = GAME_TYPES.find((t) => t.code === s.chosenGameType);
      const suit = s.trumpSuit || TILE_SUIT[s.chosenGameType];
      const plate = panel(face, w * 0.94, h * 0.9, [0, 0, 0.014], (ctx, cw, ch) => {
        woodGrain(ctx, cw, ch, "#5a331f", "#3a2012");
        ctx.strokeStyle = "#c8a050";
        ctx.lineWidth = 4;
        ctx.strokeRect(10, 10, cw - 20, ch - 20);
        ctx.fillStyle = "#d9b45e";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        drawCrown(ctx, cw / 2, ch * 0.13, 22);
        ctx.font = `bold ${ch * 0.27}px ${SERIF}`;
        ctx.fillText("KING", cw / 2, ch * 0.37);
        if (suit && s.gamePhase === "playing") {
          ctx.fillStyle = RED(suit) ? "#c33a34" : "#16130f";
          ctx.font = `${ch * 0.2}px ${SERIF}`;
          ctx.fillText(SUITS[suit], cw * 0.27, ch * 0.63);
        }
        ctx.fillStyle = "#f0e3c5";
        ctx.font = `600 ${ch * 0.17}px ${SERIF}`;
        ctx.fillText(`${pad(s.round || 1)} / 27`, cw * 0.6, ch * 0.63);
        ctx.font = `500 ${ch * 0.1}px ${SERIF}`;
        ctx.fillStyle = "#e8d6a8";
        fitText(
          ctx,
          `${type && s.gamePhase === "playing" ? type.name + " · " : ""}${this.status()}`,
          cw / 2,
          ch * 0.84,
          cw * 0.86,
          ch * 0.1,
          "500",
        );
      }, 640);
      this.clickable(plate, "ბოლო ხელი", () => this.showLast(), !!s.lastTrickResult?.trick?.length);
    }
  }
  // Flip-score stand on the right: names and running totals.
  scoreStand() {
    const s = this.state;
    const g = new THREE.Group();
    g.position.set(0.78, FELT_Y, -0.06);
    g.rotation.y = -0.55;
    g.scale.setScalar(0.6);
    this.dynamic.add(g);
    const w = 0.66,
      h = 0.44;
    box(g, [w + 0.06, 0.05, 0.22], [0, 0.025, 0], COLORS.woodDark);
    const board = new THREE.Group();
    board.position.set(0, 0.05 + h / 2, -0.02);
    board.rotation.x = -0.28;
    g.add(board);
    box(board, [w + 0.04, h + 0.04, 0.04], [0, 0, -0.02], COLORS.wood);
    // Rings along the top, like a desk flip chart.
    for (let i = 0; i < 4; i++)
      box(board, [0.025, 0.05, 0.05], [-w / 2 + 0.12 + i * 0.14, h / 2 + 0.02, 0], COLORS.gold);
    const rows = [...s.players].sort(
      (a, b) =>
        relativeSeat(a.seat, s.mySeat) - relativeSeat(b.seat, s.mySeat),
    );
    const face = panel(board, w, h, [0, 0, 0.002], (ctx, cw, ch) => {
      woodGrain(ctx, cw, ch, "#4a2a18", "#2e180c");
      const rh = (ch - 24) / 3;
      rows.forEach((p, i) => {
        const y = 12 + i * rh;
        ctx.fillStyle = "#efe6d0";
        ctx.fillRect(12, y + 4, cw - 24, rh - 8);
        ctx.fillStyle = "#c9bea2";
        ctx.fillRect(12, y + rh / 2 - 1, cw - 24, 2);
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillStyle = "#1e1a14";
        const off = p.connected === false ? " ·" : "";
        // The last season's champion: a gold crown before the name.
        const champion = (s.champions || []).includes(p.name);
        if (champion) {
          ctx.fillStyle = "#b8860b";
          drawCrown(ctx, 26 + rh * 0.24, y + rh / 2 + rh * 0.02, rh * 0.2);
          ctx.fillStyle = "#1e1a14";
        }
        const nameX = champion ? 26 + rh * 0.56 : 26;
        fitText(ctx, `${this.name(p).toUpperCase()}${off}`, nameX, y + rh / 2, cw * 0.55 - (nameX - 26), rh * 0.42, "700");
        const v = s.cumulativeScores?.[p.seat] ?? 0;
        ctx.textAlign = "right";
        ctx.fillStyle = v < 0 ? "#b12c25" : v > 0 ? "#1f6a3a" : "#1e1a14";
        ctx.font = `700 ${rh * 0.5}px ${SERIF}`;
        ctx.fillText(`${v > 0 ? "+" : ""}${v}`, cw - 26, y + rh / 2);
        if (s.currentTurn === p.seat && s.gamePhase === "playing") {
          ctx.fillStyle = "#c8a050";
          ctx.fillRect(12, y + 4, 8, rh - 8);
        }
      });
    }, 512);
    this.clickable(face, "ქულები", () => this.showScores());
  }
  makeButton(parent, text, position, width, height, action, enabled = true, selected = false) {
    const g = new THREE.Group();
    g.position.set(...position);
    parent.add(g);
    box(g, [width, height, 0.03], [0, 0, 0], COLORS.woodDark);
    const face = panel(g, width * 0.94, height * 0.82, [0, 0, 0.016], (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, enabled ? (selected ? "#d8b464" : "#2f6a52") : "#5d5f56");
      grad.addColorStop(1, enabled ? (selected ? "#a8843c" : "#1d4a39") : "#46483f");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#c8a050";
      ctx.lineWidth = 5;
      ctx.strokeRect(5, 5, w - 10, h - 10);
      ctx.fillStyle = selected ? "#1d2a22" : "#e8cf8a";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      fitText(ctx, text, w / 2, h / 2 + 2, w * 0.86, h * 0.5, "700");
    });
    this.clickable(face, text.replaceAll("\n", " "), action, enabled);
    return g;
  }
  // A cream tile with a code and suit, as on the round board.
  tile(parent, { code, suit, sub, position, w, h, enabled, selected, used }, action, title) {
    const g = new THREE.Group();
    g.position.set(...position);
    parent.add(g);
    box(g, [w, h, 0.035], [0, 0, 0], selected ? 0xe8c460 : 0xd9ccb0);
    const face = panel(g, w * 0.92, h * 0.88, [0, 0, 0.0185], (ctx, cw, ch) => {
      ctx.fillStyle = enabled || selected ? "#f3ead6" : "#c9c2b0";
      ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = selected ? "#e0b030" : "#b9a982";
      ctx.lineWidth = selected ? 14 : 4;
      ctx.strokeRect(4, 4, cw - 8, ch - 8);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const red = suit && RED(suit);
      if (code) {
        ctx.fillStyle = red && code.length === 1 && "HT".includes(code) ? "#b52a2e" : "#16130f";
        fitText(ctx, code, cw / 2, ch * (suit ? 0.36 : 0.5), cw * 0.8, ch * 0.38, "700");
      }
      if (suit) {
        ctx.fillStyle = red ? "#b52a2e" : "#16130f";
        ctx.font = `${ch * (code ? 0.3 : 0.62)}px ${SERIF}`;
        ctx.fillText(SUITS[suit], cw / 2, ch * (code ? 0.72 : 0.54));
      }
      if (sub) {
        ctx.fillStyle = "#6a5a3a";
        fitText(ctx, sub, cw / 2, ch * 0.9, cw * 0.9, ch * 0.13, "500", "sans-serif");
      }
      if (used) {
        ctx.fillStyle = "#2f6a52";
        ctx.font = `700 ${ch * 0.22}px sans-serif`;
        ctx.fillText("✓", cw * 0.82, ch * 0.2);
      }
    }, 256);
    this.clickable(face, title, action, enabled);
    return g;
  }
  // The leader's wooden board for choosing the game, trump or discards.
  selectionTray() {
    const s = this.state,
      tray = new THREE.Group();
    tray.position.set(0.3, FELT_Y + 0.07, 0.36);
    tray.rotation.set(-1.12, -0.1, 0);
    tray.scale.setScalar(0.56);
    this.dynamic.add(tray);
    const W = 1.0,
      H = 0.86;
    box(tray, [W, H, 0.05], [0, 0, 0], COLORS.wood);
    box(tray, [W - 0.06, H - 0.06, 0.02], [0, 0, 0.03], COLORS.woodDark);
    const header = (text, badge) => {
      panel(tray, W * 0.6, 0.1, [-W * 0.15, H / 2 - 0.1, 0.045], (ctx, w, h) => {
        ctx.fillStyle = "#2a1a10";
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "#a88445";
        ctx.lineWidth = 4;
        ctx.strokeRect(3, 3, w - 6, h - 6);
        ctx.fillStyle = "#e8cf8a";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        fitText(ctx, text, w / 2, h / 2 + 2, w * 0.86, h * 0.55, "700");
      });
      panel(tray, W * 0.25, 0.1, [W * 0.31, H / 2 - 0.1, 0.045], (ctx, w, h) => {
        ctx.fillStyle = "#16100a";
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "#a88445";
        ctx.lineWidth = 4;
        ctx.strokeRect(3, 3, w - 6, h - 6);
        ctx.fillStyle = "#efe6d0";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        fitText(ctx, badge, w / 2, h / 2 + 2, w * 0.86, h * 0.55, "700");
      }, 256);
    };
    const available = !(this.sent || s.reconnecting);
    if (s.gamePhase === "type_selection") {
      header("აირჩიე თამაში", `${pad(s.round || 1)} / 27`);
      GAME_TYPES.forEach((type, i) => {
        const used = s.usedTypes?.[s.leaderSeat]?.includes(type.code);
        this.tile(
          tray,
          {
            code: type.code,
            suit: TILE_SUIT[type.code],
            sub: type.name,
            position: [((i % 3) - 1) * 0.27, 0.17 - Math.floor(i / 3) * 0.17, 0.05],
            w: 0.24,
            h: 0.15,
            enabled: available && !used,
            selected: this.selection === type.code,
            used,
          },
          () => {
            this.selection = type.code;
            this.refresh();
          },
          `${type.code} · ${type.name}${used ? " ✓" : ""}`,
        );
      });
      this.makeButton(
        tray,
        this.sent ? "იგზავნება…" : "თამაში",
        [0, -H / 2 + 0.1, 0.05],
        0.5,
        0.11,
        () => this.send("selectGameType", this.selection),
        available && !!this.selection,
      );
    } else if (s.gamePhase === "trump_selection") {
      const type = GAME_TYPES.find((t) => t.code === s.chosenGameType);
      header("აირჩიე კოზირი", `${s.chosenGameType || ""} ${type?.kind === "plus" || /^P/.test(s.chosenGameType || "") ? "+8" : ""}`);
      ["S", "H", "C", "D"].forEach((suit, i) =>
        this.tile(
          tray,
          {
            suit,
            position: [(i - 1.5) * 0.22, 0.04, 0.05],
            w: 0.19,
            h: 0.24,
            enabled: available,
            selected: this.selection === suit,
          },
          () => {
            this.selection = suit;
            this.refresh();
          },
          SUITS[suit],
        ),
      );
      this.makeButton(
        tray,
        this.sent ? "იგზავნება…" : "დადასტურება",
        [0, -H / 2 + 0.14, 0.05],
        0.56,
        0.13,
        () => this.send("selectTrump", this.selection),
        available && !!this.selection,
      );
    } else {
      header("გადადე 2 კარტი", `${s.selectedDiscards.length} / 2`);
      panel(tray, W * 0.86, 0.32, [0, 0.05, 0.045], (ctx, w, h) => {
        ctx.fillStyle = "#efe6d0";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#2a2418";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        fitText(ctx, "აირჩიე ორი კარტი ხელში.", w / 2, h * 0.35, w * 0.9, h * 0.2, "600");
        fitText(ctx, "პრიკუპიდან ერთი მაინც დაიტოვე.", w / 2, h * 0.68, w * 0.9, h * 0.16, "500");
      });
      const center = new Set((s.lastCenterCards || []).map(key));
      const legal =
        s.selectedDiscards.length === 2 &&
        !s.selectedDiscards.every((c) => center.has(key(c))) &&
        s.selectedDiscards.every((c) => canDiscard(s.chosenGameType, c));
      this.makeButton(
        tray,
        this.sent ? "იგზავნება…" : "გადადება",
        [0, -H / 2 + 0.14, 0.05],
        0.56,
        0.13,
        () => this.send("discardCards", s.selectedDiscards),
        available && legal,
      );
    }
  }
  // The score ledger, held open in the right hand.
  scorebook() {
    const s = this.state;
    const g = new THREE.Group();
    this.bookGroup = g;
    g.position.set(0.36, FELT_Y + 0.2, 0.86);
    g.rotation.set(-0.95, -0.2, -0.06);
    g.scale.setScalar(0.5);
    this.dynamic.add(g);
    const W = 0.92,
      H = 1.0;
    box(g, [W + 0.06, H + 0.06, 0.04], [0, 0, -0.02], 0x3a2216);
    // Page edges on the right, as in a thick ledger.
    for (let i = 0; i < 4; i++)
      box(g, [0.012, H - 0.02, 0.02], [W / 2 + 0.008 + i * 0.008, 0, 0.004 - i * 0.004], 0xe6dcc4);
    const rows = s.roundScores || [],
      perPage = 9,
      pages = Math.max(1, Math.ceil(rows.length / perPage));
    this.page = Math.min(this.page, pages - 1);
    const players = [...s.players].sort(
      (a, b) =>
        relativeSeat(a.seat, s.mySeat) - relativeSeat(b.seat, s.mySeat),
    );
    const page = panel(g, W, H, [0, 0, 0.002], (ctx, w, h) => {
      ctx.fillStyle = "#f2ead6";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#1c1a16";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${h * 0.05}px ${SERIF}`;
      ctx.fillText("KING · ქულები", w / 2, h * 0.07);
      const xs = [w * 0.15, w * 0.42, w * 0.64, w * 0.86];
      ctx.strokeStyle = "#7d7360";
      ctx.lineWidth = 2;
      for (const x of [w * 0.29, w * 0.53, w * 0.75]) {
        ctx.beginPath();
        ctx.moveTo(x, h * 0.12);
        ctx.lineTo(x, h * 0.86);
        ctx.stroke();
      }
      ["ხელი", ...players.map((p) => this.name(p).toUpperCase())].forEach((v, i) =>
        fitText(ctx, v, xs[i], h * 0.155, w * 0.2, h * 0.034, "700"),
      );
      const top = h * 0.2,
        rh = (h * 0.62) / perPage;
      rows.slice(this.page * perPage, this.page * perPage + perPage).forEach((r, i) => {
        const y = top + i * rh + rh / 2;
        ctx.strokeStyle = "#c9bc98";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(w * 0.04, y + rh / 2);
        ctx.lineTo(w * 0.96, y + rh / 2);
        ctx.stroke();
        ctx.fillStyle = "#1c1a16";
        ctx.font = `600 ${rh * 0.5}px ${SERIF}`;
        ctx.fillText(`${pad(r.round || this.page * perPage + i + 1)}  ${r.gameType || ""}`, xs[0], y);
        players.forEach((p, j) => {
          const v = r.scores?.[p.seat] ?? 0;
          ctx.fillStyle = v < 0 ? "#9a2f27" : v > 0 ? "#1f6a3a" : "#1c1a16";
          ctx.fillText(String(v), xs[j + 1], y);
        });
      });
      ctx.strokeStyle = "#1c1a16";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(w * 0.04, h * 0.86);
      ctx.lineTo(w * 0.96, h * 0.86);
      ctx.stroke();
      ctx.fillStyle = "#1c1a16";
      ctx.font = `700 ${h * 0.042}px ${SERIF}`;
      ctx.fillText("ჯამი", xs[0], h * 0.91);
      players.forEach((p, j) =>
        ctx.fillText(String(s.cumulativeScores?.[p.seat] ?? 0), xs[j + 1], h * 0.91),
      );
    }, 768);
    this.targets.push(page);
    this.makeButton(g, "‹", [-W / 2 + 0.1, -H / 2 - 0.08, 0.02], 0.14, 0.1, () => {
      this.pageTurnAt = this.time;
      this.page = Math.max(0, this.page - 1);
      this.refresh();
    }, this.page > 0);
    this.makeButton(g, "›", [W / 2 - 0.1, -H / 2 - 0.08, 0.02], 0.14, 0.1, () => {
      this.pageTurnAt = this.time;
      this.page = Math.min(pages - 1, this.page + 1);
      this.refresh();
    }, this.page < pages - 1);
    if (s.gamePhase === "round_end") {
      const zero = s.players.find((p) => p.seat === 0),
        starter =
          zero?.connected !== false
            ? 0
            : Math.min(
                ...s.players
                  .filter((p) => p.connected !== false)
                  .map((p) => p.seat),
              );
      this.makeButton(
        g,
        this.sent ? "იგზავნება…" : "შემდეგი ხელი",
        [0, -H / 2 - 0.08, 0.02],
        0.5,
        0.1,
        () => this.send("nextRound"),
        !s.spectator && s.mySeat === starter && !s.reconnecting && !this.sent,
      );
    } else
      this.makeButton(g, "დახურვა", [0, -H / 2 - 0.08, 0.02], 0.5, 0.1, () => {
        this.book = false;
        this.refresh();
      });
  }
  destroy() {
    this.disposed = true;
    clearTimeout(this.sendTimer);
    clearTimeout(this.playTimer);
    this.renderer.setAnimationLoop(null);
    this.abort.abort();
    this.observer.disconnect();
    this.actors.forEach((a) => a.destroy());
    dispose(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
