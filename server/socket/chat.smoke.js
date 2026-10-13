'use strict';

// Chat message identity, tap-back reactions, voice clips and the per-socket
// rate limits.
//
// Reactions need a stable message id, which the server assigns because chat
// itself is relayed and never stored. Also checks that an emoji outside the
// fixed palette is refused rather than relayed — an open string there would
// be a second chat channel — and that a client flooding the table is cut off.
//
// Run: DATABASE_URL=postgres://localhost/kings_test PORT=3521 node socket/chat.smoke.js

const { startServer, connectClient, waitFor, sleep, check, summary, run } = require('../test/harness');

const URL = startServer(3521);

run(async () => {
  const [a, b, c] = [await connectClient(URL), await connectClient(URL), await connectClient(URL)];
  const msgs = (s) => s.all('chat-message');
  const reacts = (s) => s.all('chat-reaction');

  a.emit('create-room', { playerName: 'რეაქ-A', mode: 'public' });
  await waitFor(() => a.last('room-created'));
  const code = a.last('room-created').roomCode;
  b.emit('join-room', { roomCode: code, playerName: 'რეაქ-B' });
  c.emit('join-room', { roomCode: code, playerName: 'რეაქ-C' });
  await waitFor(() => a.last('player-joined')?.players.length === 3);

  a.emit('chat-message', { message: 'გამარჯობა' });
  await waitFor(() => msgs(a).length && msgs(b).length && msgs(c).length);
  const msg = msgs(b)[0];
  check('message delivered', !!msg);
  check('message carries an id', typeof msg?.id === 'string' && msg.id.length > 0, JSON.stringify(msg));
  check('all three see the same id', msgs(a)[0]?.id === msg?.id && msgs(c)[0]?.id === msg?.id);

  // React
  b.emit('chat-react', { messageId: msg.id, emoji: '❤️' });
  await waitFor(() => reacts(a).length && reacts(b).length && reacts(c).length);
  check('reaction fans out to the room', reacts(a).length === 1 && reacts(c).length === 1);
  check('reaction names the message', reacts(a)[0]?.messageId === msg.id);
  check('reaction carries the reactor', reacts(a)[0]?.seat === 1);
  check('reactor sees their own reaction', reacts(b).length === 1);

  // Rejections
  const before = reacts(a).length;
  b.emit('chat-react', { messageId: msg.id, emoji: '💀' });      // not in the palette
  b.emit('chat-react', { messageId: msg.id, emoji: '<script>' }); // injection attempt
  b.emit('chat-react', { messageId: 'x'.repeat(200), emoji: '❤️' }); // oversized id
  b.emit('chat-react', {});                                        // empty
  await sleep(300);
  check('off-palette emoji rejected', reacts(a).length === before, `got ${reacts(a).length - before} extra`);

  // Same person + same emoji again = a second event; clients toggle locally.
  b.emit('chat-react', { messageId: msg.id, emoji: '❤️' });
  check('repeat reaction relays again (client toggles)', await waitFor(() => reacts(a).length === before + 1));

  // Voice clips: real binary only, audio types only, and they get ids too.
  a.emit('voice-message', { audio: Buffer.alloc(64), mime: 'audio/webm;codecs=opus', duration: 1 });
  check('a voice clip reaches the table', await waitFor(() => b.all('voice-message').length === 1));
  check('voice message also gets an id', typeof b.last('voice-message')?.id === 'string');
  await sleep(900);   // one clip a second
  c.emit('voice-message', { audio: { length: 10, data: 'x'.repeat(5000) }, mime: 'audio/webm' });
  c.emit('voice-message', { audio: Buffer.alloc(64), mime: 'text/html' });
  await sleep(300);
  check('fake binary and non-audio types are dropped', b.all('voice-message').length === 1,
    `${b.all('voice-message').length} clips`);

  // ── rate limits ──
  for (let i = 0; i < 12; i++) c.emit('chat-message', { message: `სპამი ${i}` });
  await sleep(400);
  const spam = msgs(a).filter((m) => m.seat === 2).length;
  check('a chat flood is cut off after a few messages', spam > 0 && spam <= 5, `${spam} got through`);

  for (let i = 0; i < 8; i++) a.emit('play-sound', { soundId: 'yeehaw', targetSeat: 0 });
  await sleep(400);
  check('a sound flood is cut off', a.all('play-sound').length <= 3, `${a.all('play-sound').length} got through`);

  b.emit('play-sound', { soundId: 'yeehaw', targetSeat: 7 });
  b.emit('play-sound', { soundId: 'yeehaw', targetSeat: '1' });
  await waitFor(() => a.all('play-sound').filter((p) => p.bySeat === 1).length === 2);
  check('a seat out of range falls back to the sender',
    a.all('play-sound').filter((p) => p.bySeat === 1).every((p) => p.targetSeat === 1));

  a.emit('leave-room'); b.emit('leave-room'); c.emit('leave-room');
  await sleep(200);
  [a, b, c].forEach((s) => s.close());
  summary();
});
