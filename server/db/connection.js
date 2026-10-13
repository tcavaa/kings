'use strict';

const postgres = require('postgres');

let sql = null;

/**
 * Returns the Postgres client (postgres.js), creating it lazily on first call.
 * If DATABASE_URL is missing or the client can't be created, returns null and
 * logs a warning — the store turns that into the same "DB not configured"
 * error (HTTP 503) the MySQL build used to give.
 *
 * DATABASE_URL is the Supabase connection string: the transaction pooler
 * (Supavisor, IPv4, port 6543), the same URL for the Vercel functions and the
 * game server. Transaction mode can't hold prepared statements, hence
 * `prepare: false`.
 * @returns {import('postgres').Sql | null}
 */
function getSql() {
  if (sql) return sql;

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('[db] DATABASE_URL not configured. DB features disabled.');
    return null;
  }

  try {
    const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    sql = postgres(url, {
      // Supavisor's transaction mode can't hold prepared statements.
      prepare: false,
      // Remote databases (Supabase) always go over TLS; local dev doesn't.
      ssl: isLocal ? false : 'require',
      max: Number(process.env.DB_POOL_MAX) || 5,
      idle_timeout: 20,
      connect_timeout: 15,
      // mysql2's query() bound `undefined` as NULL; keep that behaviour so a
      // missing optional field never turns into a thrown error.
      transform: { undefined: null },
      onnotice: () => {},
    });
    console.log('[db] Postgres client created.');
  } catch (err) {
    console.error('[db] Failed to create Postgres client:', err.message);
    sql = null;
  }

  return sql;
}

/** The client, or a 503-tagged error when the database isn't configured. */
function db() {
  const s = getSql();
  if (!s) {
    const err = new Error(
      'Database is not configured. Set DATABASE_URL in your environment, then apply supabase/migrations.'
    );
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  return s;
}

module.exports = { getSql, db };
