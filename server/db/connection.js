'use strict';

const postgres = require('postgres');

let sql = null;

/**
 * Returns the Postgres client (postgres.js), creating it lazily on first call.
 * If DATABASE_URL is missing or the client can't be created, returns null and
 * logs a warning — the store turns that into the same "DB not configured"
 * error (HTTP 503) the MySQL build used to give.
 *
 * DATABASE_URL is the Supabase connection string. Use the pooler URL
 * (Supavisor, IPv4): transaction mode (:6543) for Vercel functions, either
 * mode for the long-running game server.
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

module.exports = { getSql };
