'use strict';

// Helpers every socket module uses: the roster view, who a socket plays as,
// the daily league quota, and the per-socket rate limits.

const store = require('../db/store');

const playerView = (p) => ({
  id: p.id, name: p.name, avatar: p.avatar || null, seat: p.seat, connected: p.connected !== false,
});
const playersView = (players = []) => players.map(playerView);

// ─── identity ───────────────────────────────────────────────────────────────
// Who a socket is playing as. With a profile session token (issued by the API
// when the lobby picks a profile, PIN checked) it is that profile: its current
// name and photo, and seats/entries are bound to its id. Without one, a typed
// name is accepted only if no PIN-protected profile uses it. `ownerKey` is the
// browser's own secret (handshake auth, see server/index.js), so a refresh can
// take its seat back but nobody else can.

const SESSION_CACHE_MS = 60 * 1000;
const sessionCache = new Map();   // token -> { profile, at }

function _identityError(message) {
  const err = new Error(message);
  err.code = 'AUTH';
  return err;
}

async function _profileForToken(token) {
  const hit = sessionCache.get(token);
  if (hit && Date.now() - hit.at < SESSION_CACHE_MS) return hit.profile;
  const profile = await store.profileForSession(token);
  if (sessionCache.size > 5000) sessionCache.clear();
  sessionCache.set(token, { profile, at: Date.now() });
  return profile;
}

async function identify(socket, { profileToken, playerName } = {}) {
  const ownerKey = socket.data.ownerKey || null;
  if (typeof profileToken === 'string' && profileToken) {
    const profile = await _profileForToken(profileToken);
    if (!profile) throw _identityError('Pick your profile again.');
    return { name: profile.name, avatar: profile.avatar, profileId: profile.id, ownerKey };
  }
  const name = typeof playerName === 'string' ? playerName.trim().slice(0, 64) : '';
  if (!name) throw new Error('playerName is required.');
  // A database outage shouldn't stop play — the name just isn't checked then.
  const profile = await store.getProfileByName(name).catch(() => null);
  if (profile?.has_pin) throw _identityError('That profile has a PIN — pick it in the lobby.');
  return { name: profile?.name || name, avatar: profile?.avatar || null, profileId: null, ownerKey };
}

// ─── the daily league quota ─────────────────────────────────────────────────

const CHAMPIONSHIP_LIMIT_MESSAGE =
  `Daily championship limit reached (${store.CHAMPIONSHIP_DAILY_LIMIT} games per day). Play a public game instead.`;

/**
 * True when `playerName` has exhausted today's championship quota, counting
 * league games still being played or not yet saved (the database can't see
 * those). Fails open (returns false) if the DB is unreachable — a broken
 * database should degrade to "can't record games", not "can't play at all".
 */
async function championshipBlocked(gameManager, playerName) {
  try {
    const quota = await store.getChampionshipQuota(playerName);
    return quota.remaining - gameManager.championshipGamesInFlight(playerName) <= 0;
  } catch (err) {
    console.warn(`[handlers] championship quota check failed for ${playerName}: ${err.message}`);
    return false;
  }
}

// ─── rate limits ────────────────────────────────────────────────────────────
// [events, per milliseconds] for each kind of event a socket may send. Every
// one of these fans out to a whole table or to every connected socket, so a
// client looping one would multiply traffic by the number of listeners.
// Events over the limit are dropped quietly.
const RATE_LIMITS = {
  sound:      [3, 5000],
  chat:       [5, 5000],
  react:      [10, 5000],
  typing:     [1, 2000],
  voice:      [1, 800],     // about one clip a second
  emoji:      [1, 750],
  presence:   [5, 10000],
  watch:      [6, 10000],
  tournament: [8, 10000],
  join:       [10, 10000],  // create-room, join-room, sit-public, rejoin-public
};

/** A token bucket per kind of event: `allow(kind)` is false when it's empty. */
function rateLimiter(limits = RATE_LIMITS) {
  const buckets = {};
  return function allow(kind) {
    const [capacity, perMs] = limits[kind];
    const now = Date.now();
    const b = buckets[kind] || (buckets[kind] = { tokens: capacity, at: now });
    b.tokens = Math.min(capacity, b.tokens + ((now - b.at) * capacity) / perMs);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

// Reaction emojis are client-chosen; the server just caps them to something
// emoji-sized so nothing longer sneaks into the broadcast.
function sanitizeEmoji(emoji) {
  if (typeof emoji !== 'string') return null;
  const trimmed = emoji.trim();
  if (!trimmed || trimmed.length > 8) return null;
  return trimmed;
}

module.exports = {
  playersView, identify, championshipBlocked, CHAMPIONSHIP_LIMIT_MESSAGE, rateLimiter, sanitizeEmoji,
};
