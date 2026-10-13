'use strict';

// The 9-player bracket end to end: three tables, three winners, no wildcard
// slot. The 6-player path (and the wildcard) is covered by socket.smoke.js;
// the advancement maths for both sizes is covered by bracket.test.js.
//
// Run: DATABASE_URL=postgres://localhost/kings_test PORT=3440 node tournament/nine.smoke.js

const { startServer, connectClient, waitFor, check, summary, run } = require('../test/harness');

const URL = startServer(3440);

run(async () => {
  const cs = [];
  for (let i = 0; i < 9; i++) {
    const s = await connectClient(URL, { name: `ცხრა-${i}` });
    s.on('room-joined', (p) => { s.roomCode = p.roomCode; });
    cs.push(s);
  }
  cs[0].emit('tournament-create', { playerName: cs[0].playerName, size: 9 });
  await waitFor(() => cs[0].last('tournament-joined'));
  const code = cs[0].last('tournament-joined').code;
  check('9-player lobby opened', cs[0].last('tournament-joined').size === 9);
  for (let i = 1; i < 9; i++) {
    cs[i].emit('tournament-join', { code, playerName: cs[i].playerName });
    await waitFor(() => cs[i].last('tournament-joined'));
  }
  await waitFor(() => cs.every((c) => c.last('hand-dealt')));

  const tables = [...new Set(cs.map((c) => c.roomCode).filter(Boolean))];
  check('all nine seated', cs.filter((c) => c.roomCode).length === 9, `${cs.filter((c) => c.roomCode).length}`);
  check('split into 3 tables', tables.length === 3, `${tables.length}`);
  check('3 per table', tables.every((rc) => cs.filter((c) => c.roomCode === rc).length === 3));
  check('everyone dealt in', cs.every((c) => c.last('hand-dealt')?.hand?.length > 0));

  for (const rc of tables) {
    const at = cs.filter((c) => c.roomCode === rc);
    at[0].emit('propose-quit', { kind: 'game' });
    await waitFor(() => at[1].last('quit-proposal') && at[2].last('quit-proposal'));
    at[1].emit('vote-quit', { accept: true });
    at[2].emit('vote-quit', { accept: true });
    await waitFor(() => at.every((c) => c.last('game-over')));
  }
  await waitFor(() => cs.some((c) => c.last('tournament-final')));

  const withFinal = cs.filter((c) => c.last('tournament-final'));
  check('final announced', withFinal.length > 0);
  const fin = withFinal[0]?.last('tournament-final') || {};
  const finalists = fin.finalists || [];
  check('exactly 3 finalists', finalists.length === 3, JSON.stringify(finalists.map((f) => f.name)));
  check('standings cover all nine', (fin.standings || []).length === 9);
  await waitFor(() => cs.filter((c) => c.roomCode === fin.roomCode).length === 3);
  check('3 players moved to the final', cs.filter((c) => c.roomCode === fin.roomCode).length === 3);
  check('final room is new', !tables.includes(fin.roomCode));

  cs.forEach((c) => c.close());
  summary();
});
