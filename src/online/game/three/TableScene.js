import * as THREE from "three";
import { buildRoom } from "./room";
import { Actor, createHands } from "./actors";
import {
  box,
  label,
  card,
  texture,
  dispose,
  COLORS,
  SUITS,
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
const atSeat = (rel) =>
  rel === 0
    ? [0, 1.18, 1.7]
    : rel === 1
      ? [-1.35, 1.15, -0.8]
      : [1.35, 1.15, -0.8];
export class TableScene {
  constructor(host, callbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.actors = [];
    this.targets = [];
    this.tweens = [];
    this.time = 0;
    this.lastDeal = loadLastDeal();
    this.selection = null;
    this.book = false;
    this.page = 0;
    this.last = false;
    this.look = { x: 0, y: 0 };
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.08, 60);
    this.camera.position.set(0, 2.35, 3.65);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "კინგი — 3D სათამაშო ოთახი",
    );
    this.renderer.domElement.tabIndex = 0;
    buildRoom(this.scene);
    this.hands = createHands(this.scene);
    this.dynamic = new THREE.Group();
    this.scene.add(this.dynamic);
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
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
        } else if (e.button === 0) this.pick(e)?.userData.action?.();
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
        if (this.drag) {
          this.look.x = THREE.MathUtils.clamp(
            this.look.x + (e.clientX - this.drag.x) * 0.002,
            -0.38,
            0.38,
          );
          this.look.y = THREE.MathUtils.clamp(
            this.look.y + (e.clientY - this.drag.y) * 0.0015,
            -0.16,
            0.2,
          );
          this.drag = { x: e.clientX, y: e.clientY };
        } else {
          const hit = this.pick(e);
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
          this.look.x = Math.max(-0.38, this.look.x - 0.08);
        if (e.key === "ArrowRight")
          this.look.x = Math.min(0.38, this.look.x + 0.08);
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
    this.renderer.setAnimationLoop((now) => {
      const dt = Math.min((now - before) / 1000, 0.05);
      before = now;
      if (document.hidden) return;
      this.time += dt;
      this.camera.lookAt(this.look.x * 3, 1.03 + this.look.y * 3, -0.2);
      for (const t of this.tweens) {
        const p = THREE.MathUtils.clamp(
          (this.time - t.start) / t.duration,
          0,
          1,
        );
        t.mesh.position.lerpVectors(t.from, t.to, 1 - Math.pow(1 - p, 3));
        if (p > 0 && p < 1) t.mesh.position.y += Math.sin(p * Math.PI) * 0.16;
      }
      this.tweens = this.tweens.filter((t) => this.time < t.start + t.duration);
      if (!this.reducedMotion) {
        for (const actor of this.actors)
          actor.update(
            this.time,
            dt,
            actor.player.seat === this.state?.currentTurn,
            this.state?.cardCounts?.[actor.player.seat] || 0,
            this.state?.gamePhase === "round_end"
              ? this.state.cumulativeScores[actor.player.seat] ===
                Math.max(...Object.values(this.state.cumulativeScores))
                ? 1
                : -1
              : 0,
          );
        this.hands.position.y = Math.sin(this.time * 1.4) * 0.006;
        const reach = Math.max(0, (this.reachUntil || 0) - this.time);
        this.hands.children[1].position.z =
          1.65 - Math.sin((Math.min(reach, 0.6) / 0.6) * Math.PI) * 0.5;
      }
      if (this.bookGroup && !this.reducedMotion && this.pageTurnAt != null) {
        const progress = Math.min(1, (this.time - this.pageTurnAt) / 0.35);
        this.bookGroup.rotation.y = Math.sin(progress * Math.PI) * 0.12;
      }
      this.renderer.render(this.scene, this.camera);
    });
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.camera.aspect = width / Math.max(height, 1);
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
    return this.ray.intersectObjects(this.targets, false)[0]?.object;
  }
  clickable(mesh, title, action, enabled = true) {
    if (!enabled) return;
    const interact = () => {
      this.reachUntil = this.time + 0.6;
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
            [rel === 1 ? -1.43 : 1.43, 0, -1.4],
            state.roomCode,
            p,
            (msg) => this.callbacks.onNotice(msg),
          );
        });
    }
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
  async replaceCharacter(name, custom) {
    const actor = this.actors.find((a) => a.player.name === name);
    if (actor) {
      if (custom) return actor.replace(custom);
      else {
        this.roster = null;
        this.update(this.state);
      }
    }
  }
  refresh() {
    if (!this.state || this.disposed) return;
    const s = this.state,
      old = this.previous;
    this.targets = [];
    this.controls = [];
    this.tweens = [];
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
    // In-world nameplates and score displays.
    s.players.forEach((p) => {
      const rel = relativeSeat(p.seat, s.mySeat),
        x = rel === 0 ? -1.35 : rel === 1 ? -1.25 : 1.25,
        z = rel === 0 ? 0.9 : -0.68;
      const g = new THREE.Group();
      g.position.set(x, 1.13, z);
      g.rotation.x = -0.35;
      this.dynamic.add(g);
      box(g, [0.69, 0.22, 0.055], [0, 0, 0], COLORS.wood);
      const plate = label(
        g,
        `${p.name}${p.connected === false ? " · offline" : ""}\n${s.cumulativeScores?.[p.seat] ?? 0}`,
        0.66,
        0.2,
        [0, 0, 0.03],
        { font: 50, border: s.currentTurn === p.seat ? "#f0cf76" : "#927a4a" },
      );
      this.clickable(plate, `${p.name} — ქულები`, () => this.showScores());
      const message = s.chatBubbles?.[p.seat]?.message;
      if (message && rel)
        label(
          this.dynamic,
          String(message).slice(0, 70),
          0.95,
          0.25,
          [x, 2.06, -1],
          { bg: "#e8ddc0", color: "#233e33", font: 48 },
        );
    });
    const status = this.status();
    const sign = label(
      this.dynamic,
      `KING · ${s.round} / 27\n${status}`,
      0.9,
      0.28,
      [0, 1.28, -0.95],
      { font: 43 },
    );
    sign.rotation.x = -0.22;
    // Deck and the two center cards before the leader takes them.
    const deck = card(this.dynamic, null, true);
    deck.rotation.x = -Math.PI / 2;
    deck.position.set(-0.72, 1.064, -0.12);
    if (s.gamePhase === "type_selection" || s.gamePhase === "trump_selection")
      (s.centerCards || []).forEach((c, i) => {
        const mesh = card(this.dynamic, c);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(0.18 + i * 0.27, 1.062, -0.25);
      });
    const trick = this.last
      ? s.lastTrickResult?.trick || []
      : s.currentTrick || [];
    trick.forEach((entry, i) => {
      const c = entry.card || entry;
      if (!c.rank) return;
      const mesh = card(this.dynamic, c);
      mesh.rotation.set(-Math.PI / 2, 0, (i - 1) * 0.2);
      const to = new THREE.Vector3(
        (i - 1) * 0.3,
        1.065 + i * 0.005,
        0.05 + (i % 2) * 0.18,
      );
      const previous = old?.currentTrick?.some(
        (t) => key(t.card || t) === key(c),
      );
      const rel = relativeSeat(entry.seat ?? i, s.mySeat);
      if (!previous && !this.last) {
        this.tween(mesh, new THREE.Vector3(...atSeat(rel)), to);
        const actor = this.actors.find((a) => a.player.seat === entry.seat);
        if (actor) actor.reachUntil = this.time + 0.8;
      } else mesh.position.copy(to);
      if (this.collecting != null || s.trickAnimation?.status === "animating")
        this.tween(
          mesh,
          to,
          new THREE.Vector3(
            ...atSeat(
              relativeSeat(
                this.collecting ?? s.trickAnimation.winnerSeat,
                s.mySeat,
              ),
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
        [0, 1.12, 0.55],
        0.65,
        0.14,
        () => this.showLast(),
      );
    // A real fan held above the near table edge. Faces stay private to the local player.
    if (mine)
      (s.hand || []).forEach((c, i, hand) => {
        const mesh = card(this.dynamic, c),
          offset = i - (hand.length - 1) / 2;
        const selected = (s.selectedDiscards || []).some(
          (d) => key(d) === key(c),
        );
        const to = new THREE.Vector3(
          -0.43 + offset * 0.105,
          1.28 - Math.abs(offset) * 0.018 + (selected ? 0.09 : 0),
          2 + i * 0.009,
        );
        mesh.rotation.set(-0.17, 0, -offset * 0.07);
        const allowed =
          deciding && s.gamePhase === "discard"
            ? canDiscard(s.chosenGameType, c) &&
              (selected || s.selectedDiscards.length < 2)
            : isPlayableCard(c, s) && mine;
        if (s.gamePhase === "playing" && !allowed)
          mesh.children[1].material.color.set(0x999d92);
        if (selected) mesh.children[1].material.color.set(0xffdf8c);
        if (this.animateDeal)
          this.tween(
            mesh,
            new THREE.Vector3(-0.72, 1.06, -0.12),
            to,
            i * 0.055,
            0.45,
          );
        else mesh.position.copy(to);
        const action = () => {
          if (s.gamePhase === "discard")
            this.callbacks.onAction("toggleDiscard", c);
          else if (!this.playLocked) {
            this.playLocked = true;
            this.callbacks.onAction("playCard", c);
            clearTimeout(this.playTimer);
            this.playTimer = setTimeout(() => {
              this.playLocked = false;
            }, 1200);
          }
        };
        this.clickable(
          mesh.children[1],
          `${c.rank}${SUITS[c.suit]}${selected ? " ✓" : ""}`,
          action,
          allowed && !open && !s.reconnecting && !this.sent,
        );
      });
    // Clicking a book opens the actual score ledger, not a flat HUD.
    const book = new THREE.Group();
    book.position.set(1.18, 1.09, 0.74);
    book.rotation.set(-1.05, 0, -0.13);
    this.dynamic.add(book);
    box(book, [0.5, 0.66, 0.07], [0, 0, 0], 0x472d21);
    const cover = label(book, "♛\nქულები", 0.47, 0.63, [0, 0, 0.04], {
      bg: "#473326",
      font: 110,
    });
    this.clickable(cover, "ქულების წიგნი", () => this.showScores());
    if (open) this.scorebook();
    else if (deciding) this.selectionTray();
    this.callbacks.onControls(this.controls);
    this.previous = s;
    this.animateDeal = false;
  }
  status() {
    const s = this.state;
    if (s.reconnecting) return "კავშირი აღდგება…";
    if (s.gamePhase === "round_end") return "ხელი დასრულდა";
    if (s.gamePhase === "playing")
      return `${GAME_TYPES.find((t) => t.code === s.chosenGameType)?.name || ""} ${SUITS[s.trumpSuit] || ""} · ${s.currentTurn === s.mySeat && !s.spectator ? "შენი სვლა" : s.players.find((p) => p.seat === s.currentTurn)?.name || ""}`;
    const phase =
      {
        type_selection: "ირჩევს თამაშს",
        trump_selection: "ირჩევს კოზირს",
        discard: "გადადებს 2 კარტს",
      }[s.gamePhase] || "";
    return `${s.players.find((p) => p.seat === s.leaderSeat)?.name || ""} · ${phase}`;
  }
  makeButton(
    parent,
    text,
    position,
    width,
    height,
    action,
    enabled = true,
    selected = false,
  ) {
    const g = new THREE.Group();
    g.position.set(...position);
    parent.add(g);
    box(
      g,
      [width, height, 0.035],
      [0, 0, 0],
      selected ? COLORS.gold : COLORS.wood,
    );
    const face = label(g, text, width * 0.96, height * 0.9, [0, 0, 0.022], {
      bg: selected ? "#b99a58" : enabled ? "#224b3e" : "#55564b",
      color: selected ? "#172d26" : "#f0e3c5",
      font: 60,
    });
    this.clickable(face, text.replaceAll("\n", " "), action, enabled);
    return g;
  }
  selectionTray() {
    const s = this.state,
      tray = new THREE.Group();
    tray.position.set(0.32, 1.53, 0.4);
    tray.rotation.x = -0.62;
    this.dynamic.add(tray);
    box(tray, [1.38, 1.05, 0.09], [0, 0, 0], COLORS.wood);
    const available = !(this.sent || s.reconnecting);
    if (s.gamePhase === "type_selection") {
      label(tray, "აირჩიე თამაში", 1.23, 0.14, [0, 0.43, 0.06]);
      GAME_TYPES.forEach((type, i) => {
        const used = s.usedTypes?.[s.leaderSeat]?.includes(type.code);
        this.makeButton(
          tray,
          `${type.code} ${used ? "✓" : ""}\n${type.name}`,
          [((i % 3) - 1) * 0.43, 0.21 - Math.floor(i / 3) * 0.21, 0.06],
          0.4,
          0.19,
          () => {
            this.selection = type.code;
            this.refresh();
          },
          available && !used,
          this.selection === type.code,
        );
      });
      this.makeButton(
        tray,
        this.sent ? "იგზავნება…" : "დავიწყოთ",
        [0, -0.41, 0.06],
        1.2,
        0.15,
        () => this.send("selectGameType", this.selection),
        available && !!this.selection,
      );
    } else if (s.gamePhase === "trump_selection") {
      label(tray, "აირჩიე კოზირი", 1.23, 0.2, [0, 0.36, 0.06]);
      ["S", "H", "C", "D"].forEach((suit, i) =>
        this.makeButton(
          tray,
          SUITS[suit],
          [(i - 1.5) * 0.3, 0.03, 0.06],
          0.27,
          0.32,
          () => {
            this.selection = suit;
            this.refresh();
          },
          available,
          this.selection === suit,
        ),
      );
      this.makeButton(
        tray,
        "დადასტურება",
        [0, -0.32, 0.06],
        1.2,
        0.2,
        () => this.send("selectTrump", this.selection),
        available && !!this.selection,
      );
    } else {
      label(
        tray,
        `გადადე 2 კარტი\nარჩეულია ${s.selectedDiscards.length} / 2`,
        1.23,
        0.36,
        [0, 0.2, 0.06],
        { font: 64 },
      );
      label(
        tray,
        "პრიკუპიდან ერთი მაინც დაიტოვე",
        1.23,
        0.18,
        [0, -0.08, 0.06],
        { font: 45 },
      );
      const center = new Set((s.lastCenterCards || []).map(key));
      const legal =
        s.selectedDiscards.length === 2 &&
        !s.selectedDiscards.every((c) => center.has(key(c))) &&
        s.selectedDiscards.every((c) => canDiscard(s.chosenGameType, c));
      this.makeButton(
        tray,
        "გადადება",
        [0, -0.34, 0.06],
        1.2,
        0.2,
        () => this.send("discardCards", s.selectedDiscards),
        available && legal,
      );
    }
  }
  scorebook() {
    const s = this.state;
    const g = new THREE.Group();
    this.bookGroup = g;
    g.position.set(0.52, 1.76, 0.65);
    g.rotation.x = -0.65;
    this.dynamic.add(g);
    box(g, [1.85, 1.28, 0.09], [0, 0, 0], 0x493325);
    box(g, [1.77, 1.2, 0.06], [0, 0, 0.06], COLORS.cream);
    const rows = s.roundScores || [],
      pages = Math.max(1, Math.ceil(rows.length / 9));
    this.page = Math.min(this.page, pages - 1);
    const map = texture(
      (ctx, w, h) => {
        ctx.fillStyle = "#ede1bf";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#2d352b";
        ctx.textAlign = "center";
        ctx.font = "bold 48px Georgia";
        ctx.fillText("KING · ქულები", w / 2, 62);
        const xs = [110, 430, 660, 900];
        ctx.font = "bold 27px sans-serif";
        ["ხელი", ...s.players.map((p) => p.name)].forEach((v, i) =>
          ctx.fillText(v, xs[i], 120, i ? 200 : 180),
        );
        const slice = rows.slice(this.page * 9, this.page * 9 + 9);
        slice.forEach((r, i) => {
          const y = 168 + i * 43;
          ctx.strokeStyle = "#baae8b";
          ctx.beginPath();
          ctx.moveTo(32, y + 13);
          ctx.lineTo(w - 32, y + 13);
          ctx.stroke();
          [
            String(r.round || this.page * 9 + i + 1) + " " + r.gameType,
            ...s.players.map((p) => r.scores?.[p.seat] ?? 0),
          ].forEach((v, j) => {
            ctx.fillStyle =
              typeof v === "number" && v < 0 ? "#9a3d31" : "#284739";
            ctx.fillText(v, xs[j], y);
          });
        });
        ctx.font = "bold 31px sans-serif";
        ctx.fillStyle = "#203e31";
        [
          "ჯამი",
          ...s.players.map((p) => s.cumulativeScores?.[p.seat] ?? 0),
        ].forEach((v, i) => ctx.fillText(v, xs[i], h - 55));
      },
      1024,
      650,
    );
    const page = new THREE.Mesh(
      new THREE.PlaneGeometry(1.72, 1.09),
      new THREE.MeshBasicMaterial({ map }),
    );
    page.position.z = 0.095;
    g.add(page);
    this.targets.push(page);
    this.makeButton(
      g,
      "‹",
      [-0.65, -0.69, 0.08],
      0.22,
      0.15,
      () => {
        this.pageTurnAt = this.time;
        this.page = Math.max(0, this.page - 1);
        this.refresh();
      },
      this.page > 0,
    );
    this.makeButton(
      g,
      "›",
      [0.65, -0.69, 0.08],
      0.22,
      0.15,
      () => {
        this.pageTurnAt = this.time;
        this.page = Math.min(pages - 1, this.page + 1);
        this.refresh();
      },
      this.page < pages - 1,
    );
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
        [0, -0.69, 0.08],
        0.9,
        0.15,
        () => this.send("nextRound"),
        !s.spectator && s.mySeat === starter && !s.reconnecting && !this.sent,
      );
    } else
      this.makeButton(g, "დახურვა", [0, -0.69, 0.08], 0.9, 0.15, () => {
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
