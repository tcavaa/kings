'use strict';

// Talking at a table: chat, tap-back reactions, typing pings, voice clips and
// the sound buttons — for its players and its watchers.

const store = require('../db/store');

// ─── allowed reaction-sound ids ─────────────────────────────────────────────
// The catalogue lives in the `sounds` table (managed from /admin) and only
// changes when an admin adds or removes a clip, so it's cached rather than
// queried on every button press. `play-sound` fires several times a minute
// at a busy table; a DB round-trip per press would be silly.
//
// The seed list below is a frozen fallback — the pre-database catalogue, the
// same clips as supabase/seed.sql and src/online/constants/sounds.js. It is
// never updated: the `sounds` table is the source of truth. It only covers
// two cases: the cache hasn't warmed yet (first press after boot), and the
// DB is unreachable — a database blip should mute nothing.
const SEED_SOUND_IDS = [
  'yeehaw', 'gunshot', 'whistle',
  'giv', 'janmrteloba', 'sheilage', 'shemetxara', 'tsava',
  'Dedofali', 'Male!', 'Revia', 'Tazik',
  '10-10', 'achexet', 'bedi', 'cxado', 'ketika',
];

const SOUND_CACHE_TTL_MS = 60 * 1000;
let soundIdCache = null;
let soundCacheAt = 0;
let soundCacheInFlight = null;

/** Cached set of valid ids. Refreshes in the background; never blocks. */
function allowedSoundIds() {
  const stale = Date.now() - soundCacheAt > SOUND_CACHE_TTL_MS;
  if (stale && !soundCacheInFlight) {
    soundCacheInFlight = store.listSoundIds()
      .then((ids) => {
        // An empty table means the seed migration hasn't run — keep the
        // fallback rather than silencing every button.
        if (ids.length) soundIdCache = new Set(ids);
        soundCacheAt = Date.now();
      })
      .catch((err) => {
        console.warn(`[handlers] sound catalogue refresh failed: ${err.message}`);
        // Back off for a full TTL instead of hammering a downed DB.
        soundCacheAt = Date.now();
      })
      .finally(() => { soundCacheInFlight = null; });
  }
  return soundIdCache || new Set(SEED_SOUND_IDS);
}

/**
 * Who is talking, and where.
 *
 * Chat, voice and sound all used to resolve the sender purely through
 * `socketRoomMap` → `room.players`. A tournament spectator is deliberately in
 * neither, so every one of those handlers silently dropped their messages.
 * Falling back to the spectator registry lets watchers join the conversation
 * without ever becoming a seat in the game.
 *
 * Returns null for a socket that is neither playing nor watching.
 */
function resolveSpeaker(gameManager, socketId) {
  // Watching is checked FIRST, and the order matters. A spectator is almost
  // always someone whose own table has already finished, and that finished
  // seat is still in socketRoomMap — so resolving the player mapping first
  // sent their messages to the dead table they came from instead of the one
  // they are actually watching. Spectating is the deliberate, current action;
  // the old seat is residue.
  const watcher = gameManager.getSpectator(socketId);
  if (watcher) {
    return {
      roomCode: watcher.roomCode,
      seat: null,               // no seat: the UI must not draw a table bubble
      name: watcher.name,
      avatar: watcher.avatar || null,
      spectator: true,
      // Voice clips and sound buttons are held back from strangers who
      // wandered in off the homepage — that is an audio channel into a game
      // they aren't playing, and there's no accountability behind it. Inside
      // a tournament every watcher is a fellow entrant, so they keep the full
      // set. Text and reactions are open to both.
      canSpeak: !!watcher.tournamentId,
    };
  }

  const mapping = gameManager.getMappingBySocketId(socketId);
  if (mapping) {
    const room = gameManager.getRoom(mapping.roomCode);
    const player = room?.players.find((p) => p.seat === mapping.seat);
    if (player) {
      return {
        roomCode: mapping.roomCode,
        seat: player.seat,
        name: player.name,
        avatar: player.avatar || null,
        spectator: false,
        canSpeak: true,
      };
    }
  }
  return null;
}

// Chat is relayed, never stored, so the server has no message table to point
// a reaction at. A monotonic counter paired with the timestamp gives every
// message a stable id that both ends agree on, which is all a reaction needs.
let chatSeq = 0;
const nextMessageId = () => `m${Date.now().toString(36)}${(chatSeq++).toString(36)}`;

// The tap-back palette. Deliberately a small closed set — clients render
// exactly these, and anything else is dropped on arrival.
const REACTION_EMOJIS = new Set(['😂', '❤️', '😮', '👏', '🔥']);

// Hard cap on a relayed voice clip (≈15s of Opus fits well under this).
const MAX_VOICE_BYTES = 400 * 1024;
const VOICE_MIME_RE = /^audio\/[\w.+-]+(;[\w=.+ -]*)?$/;

function register(io, socket, ctx, conn) {
  const { gameManager } = ctx;
  const { socketId, allow } = conn;

  // Warm the catalogue on connect. Without this the first `play-sound` of a
  // server's life is checked against the seed fallback (the refresh it
  // kicks off only lands afterwards), so a freshly-uploaded clip would be
  // silently dropped once. A connect always precedes a button press.
  allowedSoundIds();

  // ─── play-sound ───────────────────────────────────────────────────────────
  // The player who emits this is "playing a sound at" `targetSeat` (which is
  // typically themselves). All players in the room receive the broadcast and
  // play the clip matching `soundId`. Server only validates the id against
  // the `sounds` catalogue (see allowedSoundIds).
  socket.on('play-sound', ({ soundId, targetSeat } = {}) => {
    try {
      if (!allowedSoundIds().has(soundId)) return;
      const who = resolveSpeaker(gameManager, socketId);
      if (!who || !who.canSpeak) return;
      // A spectator has no avatar on the felt, so a sound they fire has to
      // name the seat it pops over explicitly; without one there's nowhere to
      // draw the bubble and it's dropped.
      const target = Number.isInteger(targetSeat) && targetSeat >= 0 && targetSeat <= 2
        ? targetSeat
        : who.seat;
      if (target === null || target === undefined) return;
      if (!allow('sound')) return;
      io.to(who.roomCode).emit('play-sound', {
        soundId,
        bySeat: who.seat,
        spectator: who.spectator,
        targetSeat: target,
        at: Date.now(),
      });
    } catch (err) { /* no-op */ }
  });

  // ─── chat-typing ──────────────────────────────────────────────────────────
  // Lightweight presence ping: relayed to everyone else in the room so their
  // chat drawer / table avatars can show a "typing…" indicator. The client
  // throttles emission and expires the indicator on its own timer, so the
  // server just forwards.
  socket.on('chat-typing', () => {
    try {
      const who = resolveSpeaker(gameManager, socketId);
      if (!who || !allow('typing')) return;
      socket.to(who.roomCode).emit('chat-typing', {
        seat: who.seat, spectator: who.spectator, at: Date.now(),
      });
    } catch (err) { /* no-op */ }
  });

  // ─── voice-message ────────────────────────────────────────────────────────
  // Ephemeral voice clips: the binary payload is relayed as-is to everyone
  // in the sender's room and never stored — only players connected at that
  // moment hear it (a refresh loses history, same as chat bubbles).
  // Size-capped and rate-limited so the pipe can't be flooded. Only real
  // binary counts: anything else could claim a small `length` and carry more.
  socket.on('voice-message', ({ audio, mime, duration } = {}) => {
    try {
      const who = resolveSpeaker(gameManager, socketId);
      if (!who || !who.canSpeak) return;
      const binary = Buffer.isBuffer(audio) || audio instanceof ArrayBuffer || ArrayBuffer.isView(audio);
      if (!binary || !audio.byteLength || audio.byteLength > MAX_VOICE_BYTES) return;
      if (mime !== undefined && !(typeof mime === 'string' && VOICE_MIME_RE.test(mime))) return;
      if (!allow('voice')) return;
      const now = Date.now();
      io.to(who.roomCode).emit('voice-message', {
        id: nextMessageId(),
        seat: who.seat,
        spectator: who.spectator,
        name: who.name,
        avatar: who.avatar,
        audio,
        mime: mime || 'audio/webm',
        duration: Math.min(Math.max(Number(duration) || 0, 0), 30),
        at: now,
      });
    } catch (err) { /* no-op */ }
  });

  // ─── chat-message ─────────────────────────────────────────────────────────
  socket.on('chat-message', ({ message } = {}) => {
    try {
      const who = resolveSpeaker(gameManager, socketId);
      if (!who) return;
      if (typeof message !== 'string') return;
      const trimmed = message.trim().slice(0, 240);
      if (!trimmed || !allow('chat')) return;
      io.to(who.roomCode).emit('chat-message', {
        id: nextMessageId(),
        seat: who.seat,
        spectator: who.spectator,
        name: who.name,
        avatar: who.avatar,
        message: trimmed,
        at: Date.now(),
      });
    } catch (err) { /* no-op */ }
  });

  // ─── chat-react ───────────────────────────────────────────────────────────
  // Tap-back on a chat message. Relayed, not stored: chat history itself is a
  // 50-message in-memory window that a refresh clears, so persisting the
  // reactions would outlive the messages they belong to. The server doesn't
  // know which ids are real either — it just fans out to the room and lets
  // each client match the id against what it is holding.
  //
  // `emoji` is checked against a fixed set rather than sanitised: an open
  // string here would be a second chat channel.
  socket.on('chat-react', ({ messageId, emoji } = {}) => {
    try {
      const who = resolveSpeaker(gameManager, socketId);
      if (!who) return;
      if (typeof messageId !== 'string' || !messageId || messageId.length > 40) return;
      if (!REACTION_EMOJIS.has(emoji) || !allow('react')) return;
      io.to(who.roomCode).emit('chat-reaction', {
        messageId,
        emoji,
        seat: who.seat,
        name: who.name,
        spectator: who.spectator,
        at: Date.now(),
      });
    } catch (err) { /* no-op */ }
  });
}

module.exports = { register };
