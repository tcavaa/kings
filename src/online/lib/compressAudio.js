// An admin's sound upload, made small before it leaves the browser: decoded,
// mixed down to mono, re-encoded as 64 kbps MP3. Reaction clips are a few
// seconds of speech, so that sounds the same as the 128-320 kbps stereo files
// people upload, at a quarter of the size or less — and every player downloads
// every clip when they sit down at a table.
//
// The server has no audio tools (it runs on Vercel), so this is the one place
// it happens. The MP3 encoder (lamejs) loads only when an admin uploads.

const RATE = 44100;
const KBPS = 64;
const FRAME = 1152; // samples per MP3 frame

const readAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** The clip as mono samples at RATE (Web Audio's own downmix: (L + R) / 2). */
async function monoSamples(file) {
  const bytes = await file.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } finally {
    ctx.close?.();
  }
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RATE)), RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

/**
 * `file` → `data:audio/mpeg;base64,...`. Falls back to the file as it is when
 * the browser can't decode it, or when re-encoding wouldn't make it smaller.
 * Resolves to { dataUrl, bytes, optimized }.
 */
export async function compressAudio(file) {
  const original = async () => ({ dataUrl: await readAsDataUrl(file), bytes: file.size, optimized: false });
  let samples;
  try {
    samples = await monoSamples(file);
  } catch {
    return original();
  }
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const encoder = new Mp3Encoder(1, RATE, KBPS);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const chunks = [];
  for (let i = 0; i < pcm.length; i += FRAME) {
    const out = encoder.encodeBuffer(pcm.subarray(i, i + FRAME));
    if (out.length) chunks.push(out);
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(tail);
  const mp3 = new Blob(chunks, { type: "audio/mpeg" });
  if (mp3.size >= file.size) return original();
  return { dataUrl: await readAsDataUrl(mp3), bytes: mp3.size, optimized: true };
}
