'use strict';

// Watchers must be released when the table they are watching ends — at game
// over, and when every player has left and the room's grace window runs out.
//
// Left attached, they show as permanently 'watching' a room that no longer
// exists, with no way back to the lobby and their chat relayed into a dead
// socket room.
//
// Run: DATABASE_URL=postgres://localhost/kings_test PORT=3522 node socket/spectator-evict.smoke.js

process.env.ROOM_GRACE_MS = '1000';
const { startServer, connectClient, waitFor, check, summary, run } = require('../test/harness');

const URL = startServer(3522);

run(async () => {
  const mk = (name) => connectClient(URL, { name });
  const online = (s) => s.last('online-players') || [];

  /** Three players at a running table, and a watcher on it. */
  async function watchedTable(tag) {
    const [a, b, c, w] = [await mk(`${tag}-A`), await mk(`${tag}-B`), await mk(`${tag}-C`), await mk(`${tag}-მაყურ`)];
    for (const s of [a, b, c, w]) s.emit('announce-presence', { playerName: s.playerName });
    a.emit('create-room', { playerName: a.playerName, mode: 'public' });
    await waitFor(() => a.last('room-created'));
    const room = a.last('room-created').roomCode;
    b.emit('join-room', { roomCode: room, playerName: b.playerName });
    c.emit('join-room', { roomCode: room, playerName: c.playerName });
    await waitFor(() => a.last('player-joined')?.players.length === 3);
    a.emit('start-game');
    await waitFor(() => a.last('hand-dealt'));
    w.emit('watch-game', { roomCode: room, playerName: w.playerName });
    await waitFor(() => w.last('spectate-started'));
    return { a, b, c, w, room };
  }

  // ── game over ──
  const t1 = await watchedTable('ევ');
  const lobby = await mk('ევ-ლობი');
  lobby.emit('announce-presence', { playerName: lobby.playerName });
  check('watching started', !!t1.w.last('spectate-started'));
  check('presence says watching',
    await waitFor(() => online(lobby).find((p) => p.name === 'ევ-მაყურ')?.status === 'watching'));

  t1.a.emit('propose-quit', { kind: 'game' });
  await waitFor(() => t1.b.last('quit-proposal'));
  t1.b.emit('vote-quit', { accept: true });
  t1.c.emit('vote-quit', { accept: true });

  check('watcher was sent home when the game ended', await waitFor(() => t1.w.last('spectate-stopped')),
    JSON.stringify(t1.w.last('spectate-stopped')));
  check('and told why', t1.w.last('spectate-stopped')?.reason === 'game-over');
  t1.w.emit('lobby-info');
  await waitFor(() => online(t1.w).length);
  const me = online(t1.w).find((p) => p.name === 'ევ-მაყურ');
  check('presence no longer says watching', me?.status !== 'watching', JSON.stringify(me));
  check('presence points at no room', !me?.roomCode, JSON.stringify(me));
  check('the finished game is off the live list', (t1.w.last('live-games') || []).length === 0,
    JSON.stringify(t1.w.last('live-games')));

  // ── everyone leaves, the room expires ──
  const t2 = await watchedTable('გრ');
  t2.a.close(); t2.b.close(); t2.c.close();
  check('a watcher is told when an abandoned room is dropped',
    await waitFor(() => t2.w.last('spectate-stopped'), 5000), JSON.stringify(t2.w.last('spectate-stopped')));
  check('and why', t2.w.last('spectate-stopped')?.reason === 'closed');

  summary();
});
