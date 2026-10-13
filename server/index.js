'use strict';

require('dotenv').config();

const crypto  = require('crypto');
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');

const store            = require('./db/store');
const GameManager      = require('./game/GameManager');
const registerHandlers = require('./socket/handlers');
const TournamentManager = require('./tournament/TournamentManager');

// The live game server: Socket.IO only. Everything over plain HTTP (profiles,
// leaderboard, sounds, /admin) is served by the Next.js app on Vercel; both
// talk to the same Supabase database through DATABASE_URL.

const PORT = Number(process.env.PORT) || 3001;

// CORS_ORIGIN can be a single origin or a comma-separated list — the Next.js
// app's origin(s) in production. In dev we default to "*" so the Next dev
// server and a phone on the same network both work.
const RAW_CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const CORS_ORIGINS = RAW_CORS_ORIGIN === '*'
  ? '*'
  : RAW_CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);

// ─── Express ────────────────────────────────────────────────────────────────
const app = express();

// ─── Health ─────────────────────────────────────────────────────────────────
// Also what the hosting platform's health check (and anything that wants to
// wake a sleeping free instance) hits.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── HTTP + socket.io ───────────────────────────────────────────────────────
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: CORS_ORIGINS, methods: ['GET', 'POST'] },
});

const gameManager = new GameManager();
// King-only bracket play. Drives ordinary GameManager rooms — it just tags
// them and reacts to their game-over.
const tournamentManager = new TournamentManager(gameManager);

// Each browser sends its own random secret when it connects. Seats are bound
// to (a hash of) it, so a refresh can take its seat back but nobody else can.
// Only the hash is kept — it also ends up in live_games snapshots.
io.use((socket, next) => {
  const key = socket.handshake.auth?.clientKey;
  socket.data.ownerKey = typeof key === 'string' && key.length >= 16 && key.length <= 128
    ? crypto.createHash('sha256').update(key).digest('hex')
    : null;
  next();
});

io.on('connection', (socket) => {
  registerHandlers(io, socket, gameManager, tournamentManager);
});

// Restore in-flight rooms, then the tournaments that own some of them, from
// the database before taking connections: after a deploy all three players of
// a table rejoin within a second, and they must find their room already
// there. Failures are logged but non-fatal — the DB might just not be
// configured yet.
async function restore() {
  try { await gameManager.hydrateAll(); }
  catch (err) { console.warn('[server] hydrateAll failed:', err.message); }
  try { await tournamentManager.hydrateAll(); }
  catch (err) { console.warn('[server] tournament hydrateAll failed:', err.message); }
}

restore().finally(() => {
  server.listen(PORT, () => {
    console.log(`[server] King Card Game server listening on port ${PORT}`);
    console.log(`[server] CORS origin(s): ${RAW_CORS_ORIGIN}`);
  });
});

// A redeploy sends SIGTERM. Stop taking events, let the room and tournament
// snapshots still queued reach the database (they are what the next boot
// restores), then exit.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal}: saving live games before exit…`);
  io.close();
  const flushed = await store.flushLiveWrites(8000).catch(() => false);
  if (!flushed) console.warn('[server] some live-game snapshots were not saved in time.');
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
