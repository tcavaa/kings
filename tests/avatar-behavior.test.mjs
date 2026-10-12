import test from "node:test";
import assert from "node:assert/strict";
import {
  AvatarTextureCache,
  avatarCoverSize,
} from "../src/online/game/lib/AvatarTextureCache.js";
import { withCurrentAvatars } from "../src/online/lib/playerAvatars.js";
function setup() {
  const images = [],
    textures = new Map();
  let paints = 0;
  const cache = new AvatarTextureCache(
    {
      addImage: (key, img) => textures.set(key, img.src),
      exists: (key) => textures.has(key),
      remove: (key) => textures.delete(key),
    },
    () => paints++,
    () => {
      const img = {};
      images.push(img);
      return img;
    },
  );
  const player = { seat: 0, name: "Player", avatar: "first" };
  return { cache, player, images, textures, paints: () => paints };
}
test("repeated state updates share one photo request and one texture", () => {
  const t = setup();
  t.cache.resolve(t.player);
  t.cache.resolve(t.player);
  assert.equal(t.images.length, 1);
  t.images[0].onload();
  const key = t.cache.resolve(t.player);
  assert.equal(t.textures.get(key), "first");
  assert.equal(t.paints(), 1);
});
test("a changed photo replaces the texture even when seat and name are unchanged", () => {
  const t = setup();
  t.cache.resolve(t.player);
  t.images[0].onload();
  const old = t.cache.resolve(t.player);
  t.cache.resolve({ ...t.player, avatar: "second" });
  assert.equal(t.textures.has(old), false);
  t.images[1].onload();
  assert.equal(
    t.textures.get(t.cache.resolve({ ...t.player, avatar: "second" })),
    "second",
  );
  assert.equal(t.textures.size, 1);
});
test("out-of-order loads cannot restore an older photo", () => {
  const t = setup();
  t.cache.resolve(t.player);
  const late = t.images[0].onload;
  t.cache.resolve({ ...t.player, avatar: "new" });
  t.images[1].onload();
  late();
  assert.deepEqual([...t.textures.values()], ["new"]);
  assert.equal(t.paints(), 1);
});
test("removal and scene shutdown release photos and invalidate pending loads", () => {
  const t = setup();
  t.cache.resolve(t.player);
  t.images[0].onload();
  assert.equal(t.cache.resolve({ ...t.player, avatar: null }), null);
  assert.equal(t.textures.size, 0);
  t.cache.resolve(t.player);
  const late = t.images[1].onload;
  t.cache.dispose();
  late();
  assert.equal(t.textures.size, 0);
  assert.equal(t.images[1].onload, null);
});
test("a broken photo is not requested on every game update; a new source retries", () => {
  const t = setup();
  t.cache.resolve(t.player);
  t.images[0].onerror();
  for (let i = 0; i < 10; i++) assert.equal(t.cache.resolve(t.player), null);
  assert.equal(t.images.length, 1);
  t.cache.resolve({ ...t.player, avatar: "new" });
  assert.equal(t.images.length, 2);
});
test("portrait and landscape images cover a square without stretching", () => {
  assert.deepEqual(avatarCoverSize(100, 200, 60), { width: 60, height: 120 });
  assert.deepEqual(avatarCoverSize(200, 100, 60), { width: 120, height: 60 });
});
test("rankings use current photos and explicit removals without changing saved scores", () => {
  const games = [
    {
      players: [
        { name: "A", avatar: "old", score: 20 },
        { name: "B", avatar: "old", score: 10 },
        { name: "Deleted", avatar: "historic", score: 0 },
      ],
    },
  ];
  const result = withCurrentAvatars(games, [
    { name: "A", avatar: "new" },
    { name: "B", avatar: null },
  ]);
  assert.deepEqual(
    result[0].players.map((p) => p.avatar),
    ["new", null, "historic"],
  );
  assert.deepEqual(
    result[0].players.map((p) => p.score),
    [20, 10, 0],
  );
  assert.equal(games[0].players[0].avatar, "old");
});
