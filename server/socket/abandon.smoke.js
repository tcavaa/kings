'use strict';

// A player who leaves for good mustn't freeze the table: once they've been
// gone a while, the two still there can quit a round or end the game by
// agreeing (highest score wins), and the lowest seat still at the table can
// start the next round when seat 0 is the one who left.
//
// Needs a database for the final save, e.g.
//   DATABASE_URL=postgres://postgres@localhost:55432/kings_test PORT=3407 node socket/abandon.smoke.js

process.env.PORT = process.env.PORT || '3407';
process.env.QUIT_GONE_MS = '1000';
require('../index.js');

const { io } = require('socket.io-client');

const URL = `http://localhost:${process.env.PORT}`;
let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed += 1; console.log(`  ok  ${name}`); }
  else { failed += 1; console.error(`FAIL  ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (n) => `abandon-key-${n}-${'x'.repeat(16)}`;

function client(name) {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, auth: { clientKey: key(name) } });
    s.events = [];
    s.errors = [];
    s.onAny((event, payload) => s.events.push({ event, payload }));
    s.on('error', (e) => s.errors.push(e));
    s.on('room-created', (p) => { s.joined = p; });
    s.on('room-joined', (p) => { s.joined = p; });
    s.on('connect', () => resolve(s));
  });
}
const last = (s, event) => [...s.events].reverse().find((e) => e.event === event)?.payload;

(async () => {
  const [a, b, c] = [await client('a'), await client('b'), await client('c')];
  a.emit('create-room', { playerName: 'წასული', mode: 'public' });
  await sleep(300);
  const room = a.joined.roomCode;
  b.emit('join-room', { roomCode: room, playerName: 'დარჩენილი-1' });
  c.emit('join-room', { roomCode: room, playerName: 'დარჩენილი-2' });
  await sleep(300);
  a.emit('start-game');
  await sleep(400);
  a.emit('select-game-type', { typeCode: 'K' });
  await sleep(300);

  // Seat 0 (the leader) leaves for good.
  a.close();
  await sleep(500);
  const roster = last(b, 'player-disconnected')?.players;
  check('the others are told who is offline', roster?.find((p) => p.seat === 0)?.connected === false, JSON.stringify(roster));

  // Too soon: they might just be reconnecting, so all three still have to agree.
  b.emit('propose-quit', { kind: 'round' });
  await sleep(200);
  check('right after a drop the absent player still counts', last(c, 'quit-proposal')?.voters?.length === 3);
  c.emit('vote-quit', { accept: false });
  await sleep(1200);

  b.emit('propose-quit', { kind: 'round' });
  await sleep(200);
  check('once they are gone, only the two present vote',
    JSON.stringify(last(c, 'quit-proposal')?.voters) === '[1,2]', JSON.stringify(last(c, 'quit-proposal')));
  c.emit('vote-quit', { accept: true });
  await sleep(400);
  check('the two present can quit the round', !!last(c, 'round-complete'));

  c.emit('next-round');
  await sleep(300);
  check('only the lowest seat still there may start the next round',
    c.errors.some((e) => /advance the round/.test(e.message)));
  b.emit('next-round');
  await sleep(400);
  check('seat 1 starts the next round while seat 0 is away', !!last(c, 'round-started'));

  b.emit('propose-quit', { kind: 'game' });
  await sleep(200);
  c.emit('vote-quit', { accept: true });
  await sleep(600);
  const over = last(b, 'game-over');
  check('the two present can end the game', !!over);
  check('it records who left', JSON.stringify(over?.abandonedSeats) === '[0]', JSON.stringify(over?.abandonedSeats));
  const best = Math.max(...Object.values(over?.finalScores || { 0: 0 }));
  check('the highest score wins', over?.winners?.every((w) => w.score === best));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
