export function relativeSeat(seat, mySeat) {
  return (seat - (mySeat ?? 0) + 3) % 3;
}

// Checks an upload is a self-contained GLB 2.0 before it is sent (the server
// repeats the check). Textures and buffers must be embedded.
export const MAX_HEAD_BYTES = 2 * 1024 * 1024;
export function validGLB(buffer, max = MAX_HEAD_BYTES) {
  if (
    !(buffer instanceof ArrayBuffer) ||
    buffer.byteLength < 20 ||
    buffer.byteLength > max
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

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

