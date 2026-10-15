'use strict';

// What survives a game-server restart, without sockets: a tournament mid-
// bracket comes back with its recorded results and its running tables and can
// still draw and finish its final; an abandoned lobby expires; and players
// rejoining a restored room at the same moment all land in one copy of it.
//
// Needs a database:
//   DATABASE_URL=postgres://postgres@localhost:55432/kings_test node tournament/restore.smoke.js

process.env.TOURNAMENT_DROP_MS = '300';
const { useTestDatabase, check, summary, run, sleep } = require('../test/harness');

useTestDatabase();
const store = require('../db/store');
const GameManager = require('../game/GameManager');
const TournamentManager = require('./TournamentManager');

const RUN = Date.now().toString(36);
const ident = (i) => ({ name: `რესტ-${RUN}-${i}`, ownerKey: `key-${RUN}-${i}` });

/** What the socket layer reports for a finished table. */
function resultOf(room) {
  const finalScores = { 0: 10, 1: 0, 2: -10 };
  return {
    finalScores,
    players: room.players.map((p) => ({ name: p.name, seat: p.seat, avatar: null })),
    winners: [{ seat: 0, name: room.players.find((p) => p.seat === 0).name, score: 10 }],
    roundDetails: [],
  };
}

run(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('restore.smoke.js needs a database (DATABASE_URL).');
    process.exit(1);
  }
  const rooms = [];

  // ── a bracket survives a restart ──────────────────────────────────────────
  const gm1 = new GameManager();
  const tm1 = new TournamentManager(gm1);
  const t = tm1.create(`s0-${RUN}`, ident(0), 6);
  for (let i = 1; i < 6; i++) tm1.join(t.code, `s${i}-${RUN}`, ident(i));
  tm1.startSemifinal(t);
  const [tableA, tableB] = t.tables;
  rooms.push(tableA.roomCode, tableB.roomCode);
  tm1.reportResult(tableA.roomCode, resultOf(gm1.getRoom(tableA.roomCode)));
  gm1.flushPersists();   // room saves wait up to a second; a restart flushes them
  await store.flushLiveWrites();

  const gm2 = new GameManager();
  const tm2 = new TournamentManager(gm2);
  await gm2.hydrateAll();
  await tm2.hydrateAll();
  const t2 = tm2.findByCode(t.code);
  check('the tournament comes back', t2?.status === 'semifinal', JSON.stringify(t2 && t2.status));
  check('with its recorded table result',
    t2?.tables[0].status === 'finished' && t2.tables[0].result?.players.length === 3);
  check('its running table comes back with its tag', gm2.getRoom(tableB.roomCode)?.tournamentId === t.id);
  check('entrants start offline until they rejoin', t2?.players.every((p) => !p.connected));
  check('an entrant gets their entry back by rejoining',
    tm2.join(t.code, `back-${RUN}`, ident(3)).rejoined === true && t2.players.find((p) => p.id === `back-${RUN}`)?.connected);

  const outcome = tm2.reportResult(tableB.roomCode, resultOf(gm2.getRoom(tableB.roomCode)));
  const final = gm2.getRoom(t2.finalRoomCode);
  rooms.push(t2.finalRoomCode);
  check('the last semifinal result opens the final', outcome === 'final-started' && !!final, outcome);
  check('finalists who are away are seated as offline',
    final?.players.filter((p) => p.connected).length <= 1, JSON.stringify(final?.players.map((p) => p.connected)));
  check('the final is saved with the bracket',
    (await (store.flushLiveWrites().then(() => store.listLiveTournaments())))
      .find((row) => row.id === t.id)?.finalRoomCode === t2.finalRoomCode);

  tm2.reportResult(t2.finalRoomCode, resultOf(final));
  await store.flushLiveWrites();
  check('a finished tournament leaves the table',
    !(await store.listLiveTournaments()).some((row) => row.id === t.id));
  check('the overview keeps the final\'s result', tm2.overview(t2).final?.winners?.length === 1);

  // ── a room whose tournament didn't come back plays on as a league game ────
  const gm3 = new GameManager();
  const lone = gm3.createRoom(`l0-${RUN}`, ident('L0'), 'championship');
  gm3.joinRoom(lone.roomCode, `l1-${RUN}`, ident('L1'));
  gm3.joinRoom(lone.roomCode, `l2-${RUN}`, ident('L2'));
  Object.assign(gm3.getRoom(lone.roomCode), { tournamentId: `t_GONE${RUN}`, tournamentStage: 'semifinal', tournamentTable: 0 });
  gm3.startGame(lone.roomCode);
  rooms.push(lone.roomCode);
  gm3.flushPersists();
  await store.flushLiveWrites();
  const gm4 = new GameManager();
  await gm4.hydrateAll();
  await new TournamentManager(gm4).hydrateAll();
  check('an orphaned bracket table loses its tag', gm4.getRoom(lone.roomCode)?.tournamentId === null);

  // ── an abandoned lobby expires ────────────────────────────────────────────
  const tm5 = new TournamentManager(new GameManager());
  const lobby = tm5.create(`x0-${RUN}`, ident('X0'), 6);
  tm5.join(lobby.code, `x1-${RUN}`, ident('X1'));
  tm5.markDisconnected(`x1-${RUN}`);
  await sleep(500);
  check('an entrant who stays away loses their place', lobby.players.length === 1, `${lobby.players.length}`);
  tm5.markDisconnected(`x0-${RUN}`);
  await sleep(500);
  check('a lobby with nobody left is closed', !tm5.findByCode(lobby.code));

  // ── simultaneous rejoins load a room once ─────────────────────────────────
  const gm6 = new GameManager();
  const { roomCode } = gm6.createRoom(`r0-${RUN}`, ident('R0'));
  gm6.joinRoom(roomCode, `r1-${RUN}`, ident('R1'));
  gm6.joinRoom(roomCode, `r2-${RUN}`, ident('R2'));
  gm6.startGame(roomCode);
  rooms.push(roomCode);
  gm6.flushPersists();
  await store.flushLiveWrites();
  const gm7 = new GameManager();
  const [r1, r2] = await Promise.all([gm7.tryLoadFromDB(roomCode), gm7.tryLoadFromDB(roomCode)]);
  check('two loads at once give the same room', !!r1 && r1 === r2 && gm7.getRoom(roomCode) === r1);

  for (const code of rooms) await store.deleteLiveGame(code);
  summary();
});
