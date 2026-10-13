'use strict';

require('dotenv').config();

const crypto  = require('crypto');
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');

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

// Restore in-flight rooms from the database on boot so a deploy/restart (or
// the free instance waking up) doesn't kill active games. Failures here are
// logged but non-fatal — the DB might just not be configured yet.
gameManager.hydrateAll().catch((err) => {
  console.warn('[server] hydrateAll failed:', err.message);
});

server.listen(PORT, () => {
  console.log(`[server] King Card Game server listening on port ${PORT}`);
  console.log(`[server] CORS origin(s): ${RAW_CORS_ORIGIN}`);
});

