'use strict';

// ─── rate limits ─────────────────────────────────────────────────────────────
// Fixed-window failure counters for PIN and passcode guesses, in the database
// because serverless instances share no memory.

const { db } = require('./connection');

async function isRateLimited(key, max, windowSeconds) {
  const rows = await db()`
    SELECT hits FROM rate_limits
     WHERE key = ${key} AND window_start > now() - make_interval(secs => ${windowSeconds})`;
  return rows.length > 0 && rows[0].hits >= max;
}

async function recordFailure(key, windowSeconds) {
  await db()`
    INSERT INTO rate_limits (key, window_start, hits) VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE WHEN rate_limits.window_start > now() - make_interval(secs => ${windowSeconds})
                  THEN rate_limits.hits + 1 ELSE 1 END,
      window_start = CASE WHEN rate_limits.window_start > now() - make_interval(secs => ${windowSeconds})
                          THEN rate_limits.window_start ELSE now() END`;
  // Keep the table small: forget windows older than a day now and then.
  if (Math.random() < 0.05) {
    await db()`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
  }
}

module.exports = { isRateLimited, recordFailure };
