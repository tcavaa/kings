'use strict';

// The game server's socket events, wired up per connection. Each module owns
// one area and exports `register(io, socket, ctx, conn)`:
//
//   lobby.js       the lobby channel and its lists, presence, homepage watching
//   rooms.js       taking and leaving seats, quick-match tables, Play Again,
//                  disconnects
//   play.js        game actions, quit/surrender votes, resyncs
//   social.js      chat, reactions, voice clips, sound buttons
//   tournament.js  tournaments, and the broadcaster their manager emits through
//
// gameFlow.js has the game start / round end / game over broadcasts they
// share, connection.js one socket's helpers (`conn`), shared.js the rest.
// `ctx` is built once per server: { io, gameManager, tournamentManager,
// lobby, tournamentSync }.

const { playersView } = require('./shared');
const { createConnection } = require('./connection');
const lobbyModule = require('./lobby');
const rooms = require('./rooms');
const play = require('./play');
const social = require('./social');
const tournament = require('./tournament');

const contexts = new WeakMap();

function contextFor(io, gameManager, tournamentManager) {
  let ctx = contexts.get(io);
  if (ctx) return ctx;
  ctx = { io, gameManager, tournamentManager, lobby: lobbyModule.createLobby(io, gameManager, tournamentManager) };
  ctx.tournamentSync = (t) => tournament.tournamentSync(ctx, t);
  contexts.set(io, ctx);

  // The tournament manager owns bracket logic but does no emitting of its own,
  // so hand it a broadcaster built from the helpers that live here.
  if (tournamentManager) tournamentManager.attach(tournament.createBroadcaster(ctx));

  // A socket took a seat somewhere else: it stops hearing its old room, and
  // the old room hears that it left (or, mid-game, went offline).
  gameManager.on('socket-detached', ({ socketId, roomCode, room, playerName, removed, watchedRoomCode }) => {
    if (watchedRoomCode) io.in(socketId).socketsLeave(watchedRoomCode);
    if (!roomCode) return;
    io.in(socketId).socketsLeave(roomCode);
    if (room && removed) {
      io.to(roomCode).emit('player-left', { roomCode, playerName, players: playersView(room.players) });
    } else if (room && room.status === 'playing') {
      io.to(roomCode).emit('player-disconnected', { roomCode, playerName, players: playersView(room.players) });
    }
    if (!room || room.isPublic) ctx.lobby.publicRoom();
    ctx.lobby.refresh();
  });

  // A room was dropped from memory while people were still watching it.
  gameManager.on('room-expired', ({ roomCode, watchers }) => {
    for (const watcherId of watchers) {
      io.in(watcherId).socketsLeave(roomCode);
      io.to(watcherId).emit('spectate-stopped', { reason: 'closed' });
    }
    ctx.lobby.refresh();
  });

  return ctx;
}

function registerHandlers(io, socket, gameManager, tournamentManager) {
  const ctx = contextFor(io, gameManager, tournamentManager);
  const conn = createConnection(io, socket, ctx);
  for (const area of [lobbyModule, rooms, play, social, tournament]) {
    area.register(io, socket, ctx, conn);
  }
}

module.exports = registerHandlers;
