import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  relativeSeat,
  validGLB,
} from "../src/online/game/three/characters.js";

test("relative seats put me at 0 and the others at 1 and 2 from every perspective", () => {
  for (const seat of [0, 1, 2])
    assert.deepEqual(
      [0, 1, 2].map((s) => relativeSeat(s, seat)).sort(),
      [0, 1, 2],
    );
});
const glb = (name) => {
  const bytes = readFileSync(
    new URL(`../public/models/king3d/${name}`, import.meta.url),
  );
  assert.equal(bytes.toString("utf8", 0, 4), "glTF");
  return JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
};
test("the Blender-built cast is rigged and carries every clip the table plays", () => {
  for (const gender of ["male", "female"]) {
    const data = glb(`${gender}.glb`);
    assert.ok(data.skins.length > 0);
    const nodes = data.nodes.map((n) => n.name);
    for (const name of ["head", "lids", "hand_L", "hand_R", "head_mesh", "hair", "hair_b", "body"])
      assert.ok(nodes.includes(name), `${gender}: ${name}`);
    const clips = data.animations.map((a) => a.name);
    for (const clip of ["idle", "think", "play", "win", "lose"])
      assert.ok(clips.includes(clip), `${gender}: ${clip}`);
    // Textures are embedded, nothing is fetched from elsewhere.
    for (const image of data.images || []) assert.equal(image.uri, undefined);
  }
});
test("the room and first-person hands ship as self-contained GLBs", () => {
  const room = glb("room.glb");
  const names = room.nodes.map((n) => n.name);
  for (const name of ["table_felt", "chair_left", "chair_right", "bookcase", "crown_inlay"])
    assert.ok(names.includes(name), name);
  assert.ok(
    readFileSync(new URL("../public/models/king3d/face-male-b.png", import.meta.url)).length > 10000,
  );
  const hands = glb("hands.glb").nodes.map((n) => n.name);
  assert.ok(hands.includes("hand_left") && hands.includes("hand_right"));
  assert.ok(
    readFileSync(new URL("../public/models/king3d/tbilisi.jpg", import.meta.url)).length > 100000,
  );
});
function binary(json) {
  let text = JSON.stringify(json);
  text += " ".repeat((4 - (text.length % 4)) % 4);
  const data = Buffer.alloc(20 + text.length);
  data.write("glTF");
  data.writeUInt32LE(2, 4);
  data.writeUInt32LE(data.length, 8);
  data.writeUInt32LE(text.length, 12);
  data.writeUInt32LE(0x4e4f534a, 16);
  data.write(text, 20);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
test("custom GLB validation rejects corrupt files and external asset references", () => {
  assert.equal(validGLB(new ArrayBuffer(8)), false);
  assert.equal(validGLB(new ArrayBuffer(3 * 1024 * 1024)), false);
  assert.equal(
    validGLB(binary({ scenes: [{}], buffers: [{ byteLength: 0 }] })),
    true,
  );
  assert.equal(
    validGLB(
      binary({
        scenes: [{}],
        images: [{ uri: "https://example.com/texture.png" }],
      }),
    ),
    false,
  );
  assert.equal(
    validGLB(binary({ scenes: [{}], buffers: [{ uri: "../../secret.bin" }] })),
    false,
  );
  assert.equal(
    validGLB(
      binary({ scenes: [{}], images: [{ uri: "data:image/png;base64,AA==" }] }),
    ),
    true,
  );
});
