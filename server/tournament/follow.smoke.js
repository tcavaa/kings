'use strict';

// Following a tournament from outside the tables: anyone sees the bracket on
// the homepage and may watch its tables, an entrant whose table is done may
// watch the others from the homepage, and a reloaded page is pointed back at
// its entry.
//
// Run: DATABASE_URL=postgres://localhost/kings_test PORT=3405 node tournament/follow.smoke.js

const { startServer, connectClient, waitFor, check, summary, run } = require('../test/harness');

const URL = startServer(3405);
const RUN = Date.now().toString(36).slice(-4);

function client(name, clientKey = `key-${RUN}-${name}`) {
  return connectClient(URL, { name, clientKey }).then((s) => {
    s.on('room-joined', (p) => { s.seat = p.seat; s.roomCode = p.roomCode; });
    return s;
  });
}

async function surrender(clientsAtTable) {
  const [proposer, ...others] = clientsAtTable;
  proposer.emit('propose-quit', { kind: 'game' });
  await waitFor(() => others.every((o) => o.last('quit-proposal')?.kind === 'game'));
  for (const o of others) o.emit('vote-quit', { accept: true });
  await waitFor(() => clientsAtTable.every((c) => c.last('game-over')));
}

run(async () => {
  const names = Array.from({ length: 6 }, (_, i) => `ფოლ-${RUN}-${i}`);
  const cs = [];
  for (const n of names) cs.push(await client(n));
  const outsider = await client(`გარე-${RUN}`);
  outsider.emit('announce-presence', { playerName: outsider.playerName });

  cs[0].emit('tournament-create', { playerName: names[0], size: 6 });
  await waitFor(() => cs[0].last('tournament-joined'));
  const code = cs[0].last('tournament-joined').code;
  for (let i = 1; i < 6; i++) cs[i].emit('tournament-join', { code, playerName: names[i] });
  await waitFor(() => cs.every((c) => c.last('hand-dealt')));

  // ── the homepage sees the running bracket ─────────────────────────────────
  outsider.emit('lobby-info');
  const listed = await waitFor(() =>
    outsider.last('tournament-list')?.some((t) => t.code === code && t.status === 'semifinal'));
  check('the homepage list carries the running tournament', listed,
    JSON.stringify(outsider.last('tournament-list')));

  outsider.emit('tournament-overview', { code });
  const ov = await waitFor(() => outsider.last('tournament-overview')?.code === code);
  check('an outsider gets the bracket by code', ov && outsider.last('tournament-overview').tables.length === 2);

  const live = outsider.last('live-games') || [];
  check('live tables say which tournament they belong to',
    live.some((g) => g.tournament?.code === code), JSON.stringify(live.map((g) => g.tournament)));

  const tableCodes = [...new Set(cs.map((c) => c.roomCode))];
  outsider.emit('watch-game', { roomCode: tableCodes[1], playerName: outsider.playerName });
  const started = await waitFor(() => outsider.last('spectate-started'));
  check('an outsider can watch a tournament table', started, JSON.stringify(outsider.errors));
  check('and the watch knows its tournament', outsider.last('spectate-started')?.tournamentCode === code);

  outsider.emit('tournament-overview', {});
  await waitFor(() => outsider.all('tournament-overview').length >= 2);
  check('a watcher gets the bracket of the table they watch',
    outsider.all('tournament-overview').length >= 2);

  // ── an entrant whose table is done watches from the homepage ─────────────
  const tableA = cs.filter((c) => c.roomCode === tableCodes[0]);
  await surrender(tableA);
  const done = tableA[0];
  done.emit('leave-room');
  done.emit('watch-game', { roomCode: tableCodes[1], playerName: done.playerName });
  const watching = await waitFor(() => done.last('spectate-started')?.roomCode === tableCodes[1]);
  check('a finished entrant can watch another table from the homepage', watching, JSON.stringify(done.errors));

  const busy = cs.find((c) => c.roomCode === tableCodes[1]);
  const errs = busy.errors.length;
  busy.emit('watch-game', { roomCode: tableCodes[0], playerName: busy.playerName });
  check('a player whose table is running still cannot watch',
    await waitFor(() => busy.errors.length > errs));

  // ── a reloaded page is pointed back at its entry ─────────────────────────
  const reloaded = tableA[1];
  const key = `key-${RUN}-${reloaded.playerName}`;
  reloaded.close();
  const fresh = await client(reloaded.playerName, key);
  fresh.emit('announce-presence', { playerName: fresh.playerName });
  check('a reloaded entrant is told about their tournament',
    await waitFor(() => fresh.last('tournament-resume')?.code === code));
  fresh.emit('tournament-join', { code, playerName: fresh.playerName });
  check('and gets the entry back', await waitFor(() => fresh.last('tournament-joined')?.code === code));

  // ── the final: the list names the finalists ──────────────────────────────
  await surrender(cs.filter((c) => c.roomCode === tableCodes[1]));
  await waitFor(() => cs.some((c) => c.last('tournament-final')));
  outsider.emit('lobby-info');
  const inFinal = await waitFor(() =>
    outsider.last('tournament-list')?.find((t) => t.code === code)?.finalists?.length === 3);
  check('once drawn, the list names the three finalists', inFinal,
    JSON.stringify(outsider.last('tournament-list')?.find((t) => t.code === code)));

  [...cs, fresh, outsider].forEach((c) => c.close());
  summary();
  process.exit(0);
});
