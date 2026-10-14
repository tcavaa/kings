// Stable pseudo-random assignments: every client sees the same cast in a room.
export const CHARACTERS = [
  "female-a",
  "female-b",
  "female-c",
  "male-a",
  "male-b",
  "male-c",
].map((id) => ({
  id,
  url: `/models/characters/character-${id}.glb`,
}));
export function characterFor(room, seat) {
  let hash = 2166136261;
  for (const ch of String(room))
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  // Step coprime with six prevents duplicate characters at a three-seat table.
  return CHARACTERS[((hash >>> 0) + seat * 5) % CHARACTERS.length];
}
export function relativeSeat(seat, mySeat) {
  return (seat - (mySeat ?? 0) + 3) % 3;
}
export function validGLB(buffer) {
  if (
    !(buffer instanceof ArrayBuffer) ||
    buffer.byteLength < 20 ||
    buffer.byteLength > 25 * 1024 * 1024
  )
    return false;
  const view = new DataView(buffer);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== buffer.byteLength
  )
    return false;
  try {
    const length = view.getUint32(12, true);
    if (
      view.getUint32(16, true) !== 0x4e4f534a ||
      length > buffer.byteLength - 20
    )
      return false;
    const data = JSON.parse(
      new TextDecoder().decode(new Uint8Array(buffer, 20, length)),
    );
    // Uploaded files must carry their textures/buffers, not fetch remote resources.
    return (
      !!data.scenes?.length &&
      [...(data.images || []), ...(data.buffers || [])].every(
        (x) => !x.uri || x.uri.startsWith("data:"),
      )
    );
  } catch {
    return false;
  }
}
function db() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("king-3d-characters", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("models");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function customCharacter(key, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(
      "models",
      value === undefined ? "readonly" : "readwrite",
    );
    const store = tx.objectStore("models");
    const req =
      value === undefined
        ? store.get(key)
        : value === null
          ? store.delete(key)
          : store.put(value, key);
    tx.oncomplete = () => {
      database.close();
      resolve(req.result);
    };
    tx.onerror = () => {
      database.close();
      reject(tx.error);
    };
  });
}
