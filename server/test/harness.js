'use strict';

// Shared plumbing for the socket smoke tests (server/**/*.smoke.js): boot the
// real server on a test port, connect clients that record what they're told,
// wait for conditions instead of sleeping a fixed time, and count checks.

const path = require('path');

/**
 * The smoke tests write real games, profiles and sessions. They may only run
 * against a local database: a remote DATABASE_URL (server/.env can point at
 * production) is refused unless the run names its own TEST_DATABASE_URL.
 */
function useTestDatabase() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) return;
  let host = '';
  try { host = new URL(url).hostname; } catch { /* unparseable: refused below */ }
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error(`Refusing to run against the database at "${host || url}": smoke tests write data.`
      + '\nPoint DATABASE_URL at a local database, or set TEST_DATABASE_URL.');
    process.exit(1);
  }
}

/** Boot the game server (once) on PORT, or `defaultPort`. Returns its URL. */
function startServer(defaultPort) {
  process.env.PORT = process.env.PORT || String(defaultPort);
  useTestDatabase();
  require('../index.js');
  return `http://localhost:${process.env.PORT}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves true as soon as `cond()` holds, false after `timeoutMs`. */
async function waitFor(cond, timeoutMs = 3000, everyMs = 20) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { if (cond()) return true; } catch { /* not there yet */ }
    if (Date.now() >= until) return false;
    await sleep(everyMs);
  }
}

/**
 * A connected client. Every event it receives is kept in `events`
 * ({ event, payload }), errors also in `errors`; `last(event)` is the latest
 * payload of one kind and `all(event)` every one. `options.clientKey` is the
 * browser key sent at handshake.
 */
function connectClient(url, { clientKey, name } = {}) {
  const { io } = require('socket.io-client');
  return new Promise((resolve) => {
    const s = io(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnectionDelay: 100,
      ...(clientKey && { auth: { clientKey } }),
    });
    s.playerName = name;
    s.events = [];
    s.errors = [];
    s.onAny((event, payload) => s.events.push({ event, payload }));
    s.on('error', (e) => s.errors.push(e));
    s.last = (event) => {
      for (let i = s.events.length - 1; i >= 0; i--) if (s.events[i].event === event) return s.events[i].payload;
      return undefined;
    };
    s.all = (event) => s.events.filter((e) => e.event === event).map((e) => e.payload);
    s.once('connect', () => resolve(s));
  });
}

let passed = 0;
let failed = 0;

function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ok  ${name}`); }
  else { failed += 1; console.error(`FAIL  ${name} ${extra}`); }
}

/** Print the tally and exit (non-zero on any failure). */
function summary(label = '') {
  console.log(`\n${label ? `${label}: ` : ''}${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

/** Run a test body, turning a throw into a failed run. */
function run(body) {
  body().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { startServer, useTestDatabase, connectClient, waitFor, sleep, check, summary, run };
