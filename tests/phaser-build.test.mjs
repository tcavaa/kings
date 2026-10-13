// The table imports a custom Phaser build (src/online/game/phaser.js) that
// registers only the game objects, loaders and plugins it uses. A scene.add.*
// or this.load.* call for anything else is undefined at runtime, so check
// every one the table code makes against what the build registers.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const GAME_DIR = new URL("../src/online/game/", import.meta.url).pathname;

// Phaser's modules probe the browser when they load; just enough of one.
const ctx2d = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === "getImageData" ? () => ({ data: new Uint8ClampedArray(16) }) : () => {}),
  set: (t, k, v) => ((t[k] = v), true),
});
globalThis.window = globalThis;
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "node" }, configurable: true });
globalThis.document = {
  createElement: () => ({ getContext: () => ctx2d, style: {} }),
  documentElement: { style: {} },
  addEventListener() {},
};
globalThis.Image = class {};
globalThis.HTMLCanvasElement = class {};
globalThis.screen = {};

const { default: Phaser } = await import("../src/online/game/phaser.js");
const GameObjectFactory = require("phaser/src/gameobjects/GameObjectFactory.js");
const GameObjectCreator = require("phaser/src/gameobjects/GameObjectCreator.js");
const FileTypesManager = require("phaser/src/loader/FileTypesManager.js");
const PluginCache = require("phaser/src/plugins/PluginCache.js");
const DefaultPlugins = require("phaser/src/plugins/DefaultPlugins.js");

const gameSource = () => {
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.jsx?$/.test(f) ? [p] : [];
  });
  return walk(GAME_DIR).map((p) => readFileSync(p, "utf8")).join("\n");
};
const used = (re) => [...new Set([...gameSource().matchAll(re)].map((m) => m[1]))];

test("every scene.add.* / scene.make.* the table calls is registered", () => {
  const adds = used(/\.add\.([a-zA-Z]+)\(/g);
  const makes = used(/\.make\.([a-zA-Z]+)\(/g);
  assert.ok(adds.length >= 5);
  for (const m of adds) assert.equal(typeof GameObjectFactory.prototype[m], "function", `add.${m}`);
  for (const m of makes) assert.equal(typeof GameObjectCreator.prototype[m], "function", `make.${m}`);
});

test("every this.load.* the table calls is registered", () => {
  const loader = {};
  FileTypesManager.install(loader);
  for (const m of used(/\.load\.([a-zA-Z]+)\(/g)) assert.equal(typeof loader[m], "function", `load.${m}`);
});

test("the scene plugins the table uses are registered", () => {
  for (const key of [...DefaultPlugins.CoreScene, "Clock", "InputPlugin", "Loader", "TweenManager"]) {
    assert.ok(PluginCache.hasCore(key), key);
  }
});

test("every Phaser.* name the table uses exists", () => {
  for (const path of used(/\bPhaser\.([A-Za-z_.]*[A-Za-z_])/g)) {
    const value = path.split(".").reduce((o, k) => o?.[k], Phaser);
    // EventBus.js only names Phaser.Events in a comment.
    if (path.startsWith("Events.")) continue;
    assert.notEqual(value, undefined, `Phaser.${path}`);
  }
});

test("the Turbopack flags loader replaces Phaser's typeof flags", () => {
  const loader = require("../scripts/phaser-flags-loader.cjs");
  const out = loader.call(
    { getOptions: () => ({ WEBGL_DEBUG: false, CANVAS_RENDERER: true }) },
    "if (typeof WEBGL_DEBUG) {}\nif (typeof CANVAS_RENDERER) {}\nif (typeof WEBGL_DEBUGGER) {}",
  );
  assert.equal(out, "if (false) {}\nif (true) {}\nif (typeof WEBGL_DEBUGGER) {}");
});
