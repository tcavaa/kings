'use strict';

// The 9-player bracket end to end: three tables, three winners, no wildcard
// slot. The 6-player path (and the wildcard) is covered by socket.smoke.js;
// the advancement maths for both sizes is covered by bracket.test.js.
//
// Run: PORT=3440 node tournament/nine.smoke.js

process.env.PORT = process.env.PORT || '3440';
require('../index.js');

const { io } = require('socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass=0, fail=0;
const check=(n,c,e='')=>{ if(c){pass++;console.log('  ok  '+n);} else {fail++;console.error('FAIL  '+n+' '+e);} };
const mk = n => new Promise(res => {
  const s=io(`http://localhost:${process.env.PORT}`,{transports:['websocket'],forceNew:true});
  s.n=n; s.on('tournament-joined',p=>s.t=p); s.on('tournament-final',p=>s.fin=p);
  s.on('tournament-complete',p=>s.done=p);
  s.on('room-joined',p=>s.roomCode=p.roomCode); s.on('hand-dealt',p=>s.hand=p.hand);
  s.on('connect',()=>res(s));
});

(async () => {
  const cs = [];
  for (let i=0;i<9;i++) cs.push(await mk(`ცხრა-${i}`));
  cs[0].emit('tournament-create', { playerName: cs[0].n, size: 9 });
  await sleep(400);
  const code = cs[0].t.code;
  check('9-player lobby opened', cs[0].t.size === 9);
  for (let i=1;i<9;i++){ cs[i].emit('tournament-join',{code,playerName:cs[i].n}); await sleep(110); }
  await sleep(1800);

  const tables=[...new Set(cs.map(c=>c.roomCode).filter(Boolean))];
  check('all nine seated', cs.filter(c=>c.roomCode).length === 9, `${cs.filter(c=>c.roomCode).length}`);
  check('split into 3 tables', tables.length === 3, `${tables.length}`);
  check('3 per table', tables.every(rc => cs.filter(c=>c.roomCode===rc).length === 3));
  check('everyone dealt in', cs.every(c => c.hand?.length > 0));

  for (const rc of tables) {
    const at = cs.filter(c=>c.roomCode===rc);
    at[0].emit('propose-quit',{kind:'game'}); await sleep(220);
    at[1].emit('vote-quit',{accept:true}); at[2].emit('vote-quit',{accept:true}); await sleep(700);
  }
  await sleep(1600);

  const withFinal = cs.filter(c=>c.fin);
  check('final announced', withFinal.length > 0);
  const finalists = withFinal[0]?.fin?.finalists || [];
  check('exactly 3 finalists', finalists.length === 3, JSON.stringify(finalists.map(f=>f.name)));
  check('standings cover all nine', (withFinal[0]?.fin?.standings || []).length === 9);
  const finalRoom = withFinal[0].fin.roomCode;
  check('3 players moved to the final', cs.filter(c=>c.roomCode===finalRoom).length === 3);
  check('final room is new', !tables.includes(finalRoom));

  console.log(`\n${pass} passed, ${fail} failed`);
  cs.forEach(c=>c.close());
  process.exit(fail?1:0);
})();
