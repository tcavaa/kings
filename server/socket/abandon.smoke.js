'use strict';

// A player who leaves for good mustn't freeze the table: once they've been
// gone a while, the two still there can quit a round or end the game by
// agreeing (highest score wins), and the lowest seat still at the table can
// start the next round when seat 0 is the one who left.
//
// Needs a database for the final save, e.g.
//   DATABASE_URL=postgres://postgres@localhost:55432/kings_test PORT=3407 node socket/abandon.smoke.js

process.env.QUIT_GONE_MS = '1000';
const { startServer, connectClient, waitFor, sleep, check, summary, run } = require('../test/harness');

const URL = startServer(3407);
const RUN = Date.now().toString(36);   // unique per run: earlier runs' rooms are restored
const key = (n) => `abandon-key-${n}-${RUN}-${'x'.repeat(16)}`;

run(async () => {
  const mk = (n) => connectClient(URL, { clientKey: key(n) });
  const [a, b, c] = [await mk('a'), await mk('b'), await mk('c')];
  a.emit('create-room', { playerName: 'წასული', mode: 'public' });
  await waitFor(() => a.last('room-created'));
  const room = a.last('room-created').roomCode;
  b.emit('join-room', { roomCode: room, playerName: 'დარჩენილი-1' });
  c.emit('join-room', { roomCode: room, playerName: 'დარჩენილი-2' });
  await waitFor(() => a.last('player-joined')?.players.length === 3);
  a.emit('start-game');
  await waitFor(() => a.last('hand-dealt'));
  a.emit('select-game-type', { typeCode: 'K' });
  await waitFor(() => c.last('game-type-selected'));

  // Seat 0 (the leader) leaves for good.
  a.close();
  await waitFor(() => b.last('player-disconnected'));
  const roster = b.last('player-disconnected')?.players;
  check('the others are told who is offline', roster?.find((p) => p.seat === 0)?.connected === false, JSON.stringify(roster));

  // Too soon: they might just be reconnecting, so all three still have to agree.
  b.emit('propose-quit', { kind: 'round' });
  await waitFor(() => c.last('quit-proposal'));
  check('right after a drop the absent player still counts', c.last('quit-proposal')?.voters?.length === 3);
  c.emit('vote-quit', { accept: false });
  await waitFor(() => c.last('quit-rejected'));
  await sleep(1100);   // past QUIT_GONE_MS

  const proposals = c.all('quit-proposal').length;
  b.emit('propose-quit', { kind: 'round' });
  await waitFor(() => c.all('quit-proposal').length > proposals);
  check('once they are gone, only the two present vote',
    JSON.stringify(c.last('quit-proposal')?.voters) === '[1,2]', JSON.stringify(c.last('quit-proposal')));
  c.emit('vote-quit', { accept: true });
  check('the two present can quit the round', await waitFor(() => c.last('round-complete')));
  check('a quit round records no half-played cards',
    c.last('round-complete')?.roundDetail?.tricksTaken === null
    && c.last('round-complete')?.roundDetail?.kingOfHeartsTakenBy === null);

  c.emit('next-round');
  check('only the lowest seat still there may start the next round',
    await waitFor(() => c.errors.some((e) => /advance the round/.test(e.message))), JSON.stringify(c.errors));
  b.emit('next-round');
  check('seat 1 starts the next round while seat 0 is away', await waitFor(() => c.last('round-started')));
  check('the next round carries fresh card counts for watchers',
    JSON.stringify(c.last('round-started')?.cardCounts) === '{"0":10,"1":10,"2":10}');
  b.emit('next-round');
  await sleep(200);
  check('a repeated next-round tap is ignored quietly', b.errors.length === 0, JSON.stringify(b.errors));

  b.emit('propose-quit', { kind: 'game' });
  await waitFor(() => c.all('quit-proposal').some((p) => p.kind === 'game'));
  c.emit('vote-quit', { accept: true });
  check('the two present can end the game', await waitFor(() => b.last('game-over')));
  const over = b.last('game-over');
  check('it records who left', JSON.stringify(over?.abandonedSeats) === '[0]', JSON.stringify(over?.abandonedSeats));
  const best = Math.max(...Object.values(over?.finalScores || { 0: 0 }));
  check('the highest score wins', over?.winners?.every((w) => w.score === best));

  summary();
});
