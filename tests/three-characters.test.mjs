import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHARACTERS,
  characterFor,
  relativeSeat,
  validGLB,
} from "../src/online/game/three/characters.js";

test("three seats receive stable distinct characters across reconnects and perspectives", () => {
  for (const room of ["ABC123", "DESIGN-ROOM", "ROOM42"]) {
    const ids = [0, 1, 2].map((seat) => characterFor(room, seat).id);
    assert.equal(new Set(ids).size, 3);
    assert.deepEqual(
      ids,
      [0, 1, 2].map((seat) => characterFor(room, seat).id),
    );
    for (const seat of [0, 1, 2])
      assert.deepEqual(
        [0, 1, 2].map((s) => relativeSeat(s, seat)).sort(),
        [0, 1, 2],
      );
  }
  assert.equal(CHARACTERS.filter((c) => c.id.startsWith("female")).length, 3);
  assert.equal(CHARACTERS.filter((c) => c.id.startsWith("male")).length, 3);
});
test("bundled characters contain real meshes, skeletons and sitting animations", () => {
  for (const character of CHARACTERS) {
    const bytes = readFileSync(
      new URL(`../public${character.url}`, import.meta.url),
    );
    assert.equal(bytes.toString("utf8", 0, 4), "glTF");
    const data = JSON.parse(
      bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
    );
    assert.ok(data.meshes.length > 0);
    assert.ok(data.skins.length > 0);
    assert.ok(data.animations.some((a) => a.name === "sit"));
    for (const image of data.images || [])
      if (image.uri)
        assert.ok(
          readFileSync(
            new URL(
              `../public/models/characters/${image.uri}`,
              import.meta.url,
            ),
          ).length,
        );
  }
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
