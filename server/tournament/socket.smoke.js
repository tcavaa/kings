'use strict';

// End-to-end tournament test over real sockets: boots the server, fills a
// 6-player bracket, drives both semifinal tables to a finish via the surrender
// vote, and checks that exactly three finalists end up at one final table.
//
// Run: DATABASE_URL=postgres://localhost/kings_test PORT=3402 node tournament/socket.smoke.js

const { startServer, connectClient, waitFor, check, summary, run } = require('../test/harness');

const URL = startServer(3402);

/** A client that records everything it is told. */
function client(name) {
  return connectClient(URL, { name }).then((s) => {
    s.on('room-joined', (p) => { s.seat = p.seat; s.roomCode = p.roomCode; });
    return s;
  });
}
const tournamentOf = (s) => s.last('tournament-state') || s.last('tournament-joined');

/** Surrender a table: proposer plus both opponents accept. */
async function surrender(clientsAtTable) {
  const [proposer, ...others] = clientsAtTable;
  proposer.emit('propose-quit', { kind: 'game' });
  await waitFor(() => others.every((o) => o.last('quit-proposal')?.kind === 'game'));
  for (const o of others) o.emit('vote-quit', { accept: true });
  await waitFor(() => clientsAtTable.every((c) => c.last('game-over')));
}

run(async () => {
  const names = ['ტურ-1', 'ტურ-2', 'ტურ-3', 'ტურ-4', 'ტურ-5', 'ტურ-6'];
  const cs = [];
  for (const n of names) cs.push(await client(n));

  // ── lobby ───────────────────────────────────────────────────────────────
  cs[0].emit('tournament-create', { playerName: names[0], size: 6 });
  await waitFor(() => tournamentOf(cs[0]));
  const code = tournamentOf(cs[0])?.code;
  check('creating opens a lobby', !!code);
  check('lobby reports its size', tournamentOf(cs[0])?.size === 6);
  check('creator is seated', tournamentOf(cs[0])?.players?.length === 1);

  const stray = await client('bad');
  stray.emit('tournament-create', { playerName: 'bad', size: 7 });
  check('a 7-player tournament is refused', await waitFor(() => stray.errors.length), JSON.stringify(stray.errors));
  stray.close();

  for (let i = 1; i < 5; i++) {
    cs[i].emit('tournament-join', { code, playerName: names[i] });
    await waitFor(() => tournamentOf(cs[0])?.players?.length === i + 1);
  }
  check('five seats filled, not yet started', tournamentOf(cs[0])?.players?.length === 5);
  check('still in lobby', tournamentOf(cs[0])?.status === 'lobby');

  // The sixth entrant triggers the draw.
  cs[5].emit('tournament-join', { code, playerName: names[5] });
  await waitFor(() => cs.every((c) => c.last('hand-dealt')));

  // ── semifinal ───────────────────────────────────────────────────────────
  const seated = cs.filter((c) => c.roomCode);
  check('all six were seated at a table', seated.length === 6, `got ${seated.length}`);
  check('every player was dealt a hand', cs.every((c) => c.last('hand-dealt')?.hand?.length > 0));

  const tableCodes = [...new Set(cs.map((c) => c.roomCode))];
  check('split into exactly 2 tables', tableCodes.length === 2, `got ${tableCodes.length}`);
  const sizes = tableCodes.map((rc) => cs.filter((c) => c.roomCode === rc).length);
  check('3 players per table', sizes.every((n) => n === 3), JSON.stringify(sizes));

  await waitFor(() => cs[0].last('tournament-overview')?.tables?.every((t) => t.roomCode));
  const ov = cs[0].last('tournament-overview');
  check('overview lists both tables', ov?.tables?.length === 2);
  check('overview reports a round', typeof ov?.tables?.[0]?.round === 'number');
  check('overview carries live scores',
    Array.isArray(ov?.tables?.[0]?.players) && ov.tables[0].players.length === 3);

  // ── drive both tables to a finish ───────────────────────────────────────
  for (const rc of tableCodes) {
    await surrender(cs.filter((c) => c.roomCode === rc));
  }
  await waitFor(() => cs.some((c) => c.last('tournament-final')));

  // ── final ───────────────────────────────────────────────────────────────
  const withFinal = cs.filter((c) => c.last('tournament-final'));
  check('a final was announced', withFinal.length > 0);
  const finalInfo = withFinal[0]?.last('tournament-final') || {};
  const finalists = finalInfo.finalists || [];
  check('exactly three finalists', finalists.length === 3, JSON.stringify(finalists.map((f) => f.name)));

  const standings = finalInfo.standings || [];
  check('standings rank all six entrants', standings.length === 6, `got ${standings.length}`);
  check('exactly three are marked advanced',
    standings.filter((s) => s.advanced).length === 3);
  check('at most one wildcard seat',
    standings.filter((s) => s.wildcard).length <= 1);

  // The three finalists must have been moved into one shared new room.
  const finalRoom = finalInfo.roomCode;
  await waitFor(() => cs.filter((c) => c.roomCode === finalRoom).length === 3);
  const atFinal = cs.filter((c) => c.roomCode === finalRoom);
  check('three players moved to the final table', atFinal.length === 3, `got ${atFinal.length}`);
  check('the final table is not a semifinal table', !tableCodes.includes(finalRoom));
  check('finalists match who was seated',
    atFinal.map((c) => c.playerName).sort().join(',') ===
    finalists.map((f) => f.name).sort().join(','));
  check('finalists were dealt fresh hands',
    atFinal.every((c) => c.last('hand-dealt')?.hand?.length > 0));

  // The overview of a finished semifinal keeps its result.
  const semi = cs[0].last('tournament-overview')?.tables?.[0];
  check('a finished semifinal keeps its players and scores in the overview',
    semi?.players?.length === 3 && semi.players.every((p) => p.seat !== null), JSON.stringify(semi?.players));

  // Bracket seats must not be rematchable.
  const errorsBefore = cs[0].errors.length;
  cs[0].emit('request-rematch', { playerName: names[0] });
  check('rematch is refused inside a tournament', await waitFor(() => cs[0].errors.length > errorsBefore),
    JSON.stringify(cs[0].errors));

  // ── finish the final ────────────────────────────────────────────────────
  await surrender(atFinal);
  await waitFor(() => cs.some((c) => c.last('tournament-complete')));
  const done = cs.find((c) => c.last('tournament-complete'));
  check('tournament reports a winner', !!done?.last('tournament-complete')?.winners?.length);
  check('every entrant sees the tournament as finished',
    await waitFor(() => cs.every((c) => tournamentOf(c)?.status === 'done')),
    JSON.stringify(cs.map((c) => tournamentOf(c)?.status)));
  const final = cs[0].last('tournament-overview')?.final;
  check('the overview keeps the final\'s result', final?.players?.length === 3 && final.winners?.length > 0,
    JSON.stringify(final));
  const joins = cs[0].all('tournament-joined').length;
  cs[0].emit('tournament-create', { playerName: names[0], size: 6 });
  check('an entrant can start a new tournament afterwards',
    await waitFor(() => cs[0].all('tournament-joined').length > joins));

  cs.forEach((c) => c.close());
  summary();
});
