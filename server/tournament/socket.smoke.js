'use strict';

// End-to-end tournament test over real sockets: boots the server, fills a
// 6-player bracket, drives both semifinal tables to a finish via the surrender
// vote, and checks that exactly three finalists end up at one final table.
//
// Run: PORT=3402 node tournament/socket.smoke.js

process.env.PORT = process.env.PORT || '3402';
require('../index.js');

const path = require('path');
const { io } = require('socket.io-client');

const URL = `http://localhost:${process.env.PORT}`;
let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed += 1; console.log(`  ok  ${name}`); }
  else { failed += 1; console.error(`FAIL  ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A client that records everything it is told. */
function client(name) {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    s.playerName = name;
    s.events = [];
    s.rooms = [];
    s.tournament = null;
    s.overview = null;
    s.finalInfo = null;
    s.complete = null;
    s.gotHand = null;

    s.onAny((event, payload) => s.events.push({ event, payload }));
    s.on('room-joined', (p) => { s.rooms.push(p); s.seat = p.seat; s.roomCode = p.roomCode; });
    s.on('hand-dealt', (p) => { s.gotHand = p; });
    s.on('tournament-joined', (p) => { s.tournament = p; });
    s.on('tournament-state', (p) => { s.tournament = p; });
    s.on('tournament-overview', (p) => { s.overview = p; });
    s.on('tournament-final', (p) => { s.finalInfo = p; });
    s.on('tournament-complete', (p) => { s.complete = p; });
    s.on('connect', () => resolve(s));
  });
}

/** Surrender a table: proposer plus both opponents accept. */
async function surrender(clientsAtTable) {
  const [proposer, ...others] = clientsAtTable;
  proposer.emit('propose-quit', { kind: 'game' });
  await sleep(250);
  for (const o of others) o.emit('vote-quit', { accept: true });
  await sleep(700);
}

(async () => {
  const names = ['ტურ-1', 'ტურ-2', 'ტურ-3', 'ტურ-4', 'ტურ-5', 'ტურ-6'];
  const cs = [];
  for (const n of names) cs.push(await client(n));

  // ── lobby ───────────────────────────────────────────────────────────────
  cs[0].emit('tournament-create', { playerName: names[0], size: 6 });
  await sleep(400);
  const code = cs[0].tournament?.code;
  check('creating opens a lobby', !!code);
  check('lobby reports its size', cs[0].tournament?.size === 6);
  check('creator is seated', cs[0].tournament?.players?.length === 1);

  let badSize = null;
  const stray = await client('bad');
  stray.on('error', (e) => { badSize = e.message; });
  stray.emit('tournament-create', { playerName: 'bad', size: 7 });
  await sleep(300);
  check('a 7-player tournament is refused', !!badSize, `got ${badSize}`);
  stray.close();

  for (let i = 1; i < 5; i++) {
    cs[i].emit('tournament-join', { code, playerName: names[i] });
    await sleep(200);
  }
  check('five seats filled, not yet started', cs[0].tournament?.players?.length === 5);
  check('still in lobby', cs[0].tournament?.status === 'lobby');

  // The sixth entrant triggers the draw.
  cs[5].emit('tournament-join', { code, playerName: names[5] });
  await sleep(1200);

  // ── semifinal ───────────────────────────────────────────────────────────
  const seated = cs.filter((c) => c.roomCode);
  check('all six were seated at a table', seated.length === 6, `got ${seated.length}`);
  check('every player was dealt a hand', cs.every((c) => c.gotHand?.hand?.length > 0));

  const tableCodes = [...new Set(cs.map((c) => c.roomCode))];
  check('split into exactly 2 tables', tableCodes.length === 2, `got ${tableCodes.length}`);
  const sizes = tableCodes.map((rc) => cs.filter((c) => c.roomCode === rc).length);
  check('3 players per table', sizes.every((n) => n === 3), JSON.stringify(sizes));

  const ov = cs[0].overview;
  check('overview lists both tables', ov?.tables?.length === 2);
  check('overview reports a round', typeof ov?.tables?.[0]?.round === 'number');
  check('overview carries live scores',
    Array.isArray(ov?.tables?.[0]?.players) && ov.tables[0].players.length === 3);

  // Bracket seats must not be rematchable.
  let rematchErr = null;
  cs[0].on('error', (e) => { rematchErr = e.message; });

  // ── drive both tables to a finish ───────────────────────────────────────
  for (const rc of tableCodes) {
    await surrender(cs.filter((c) => c.roomCode === rc));
  }
  await sleep(1500);

  // ── final ───────────────────────────────────────────────────────────────
  const withFinal = cs.filter((c) => c.finalInfo);
  check('a final was announced', withFinal.length > 0);
  const finalists = withFinal[0]?.finalInfo?.finalists || [];
  check('exactly three finalists', finalists.length === 3, JSON.stringify(finalists.map((f) => f.name)));

  const standings = withFinal[0]?.finalInfo?.standings || [];
  check('standings rank all six entrants', standings.length === 6, `got ${standings.length}`);
  check('exactly three are marked advanced',
    standings.filter((s) => s.advanced).length === 3);
  check('at most one wildcard seat',
    standings.filter((s) => s.wildcard).length <= 1);

  // The three finalists must have been moved into one shared new room.
  const finalRoom = withFinal[0].finalInfo.roomCode;
  const atFinal = cs.filter((c) => c.roomCode === finalRoom);
  check('three players moved to the final table', atFinal.length === 3, `got ${atFinal.length}`);
  check('the final table is not a semifinal table', !tableCodes.includes(finalRoom));
  check('finalists match who was seated',
    atFinal.map((c) => c.playerName).sort().join(',') ===
    finalists.map((f) => f.name).sort().join(','));
  check('finalists were dealt fresh hands',
    atFinal.every((c) => c.gotHand?.hand?.length > 0));

  cs[0].emit('request-rematch', { playerName: names[0] });
  await sleep(400);
  check('rematch is refused inside a tournament', !!rematchErr, `got ${rematchErr}`);

  // ── finish the final ────────────────────────────────────────────────────
  await surrender(atFinal);
  await sleep(1200);
  const done = cs.find((c) => c.complete);
  check('tournament reports a winner', !!done?.complete?.winners?.length);

  console.log(`\n${passed} passed, ${failed} failed`);
  cs.forEach((c) => c.close());
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('smoke test threw:', err);
  process.exit(1);
});
