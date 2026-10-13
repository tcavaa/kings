'use strict';

// ─── seasons (King Score's, read by both apps) ───────────────────────────────
// The current season is the one row with ended_at NULL. Setups older than that
// row have none; their current season simply starts when the last one ended.
// Seasons count every ჩაწერა game and King Online's championship games.

const { db } = require('./connection');
const { iso } = require('./mirror');
const { gameEntries, barePayload } = require('./games');
const { winnerNames, inSeason, seasonTable, championOf } = require('../games/results');
const { badRequest } = require('../lib/httpError');

const SEASON_THEMES = ['casual', 'summer', 'mountain', 'christmas'];

async function listSeasons() {
  const rows = await db()`
    SELECT id, name, theme, started_at, ended_at, champion_name FROM seasons ORDER BY started_at DESC`;
  return rows.map((r) => ({ ...r, started_at: iso(r.started_at), ended_at: iso(r.ended_at) }));
}

async function currentSeason(sql = db()) {
  const rows = await sql`SELECT id, name, theme, started_at, ended_at FROM seasons`;
  const open = rows.find((r) => !r.ended_at) || null;
  const lastEnded = rows.filter((r) => r.ended_at).sort((a, b) => b.ended_at - a.ended_at)[0];
  const start = open?.started_at || lastEnded?.ended_at || new Date(0);
  return { open, start: new Date(start) };
}

/**
 * Wins per player since `start`, and the champion(s) ("A & B" on a tie), by
 * the season rule both apps show their season tables with
 * (games/results.js).
 */
async function seasonStandings(start) {
  const games = [];
  let firstGameMs = null;
  for (const e of await gameEntries('all', 'all')) {
    if (e.type !== 'live' && e.is_championship !== 1) continue;
    if (!inSeason(e.playedAtMs, start)) continue;
    firstGameMs = firstGameMs === null ? e.playedAtMs : Math.min(firstGameMs, e.playedAtMs);
    const parsed = barePayload(e);
    games.push({
      playedAt: e.playedAtMs,
      type: e.type,
      winners: winnerNames({ winners: parsed.ok ? parsed.value.winners : null, winner_name: e.winner_name }),
    });
  }
  // Only the winners are listed: /admin shows who is ahead.
  const table = seasonTable(games, start).map(({ name, wins }) => ({ name, wins }));
  return { table, champion: championOf(table), firstGameAt: firstGameMs === null ? null : new Date(firstGameMs) };
}

/** /admin: what ending the season now would record. */
async function previewSeasonEnd() {
  const { open, start } = await currentSeason();
  const { table, champion } = await seasonStandings(start);
  return { season: open, startedAt: start.toISOString(), champion, table };
}

function seasonFields({ name, theme }) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName || cleanName.length > 40) throw badRequest('Season name must be 1-40 characters.');
  if (!SEASON_THEMES.includes(theme)) throw badRequest('Unknown season theme.');
  return { name: cleanName, theme };
}

/** /admin: close the current season with its champion and open the next one. */
async function endSeason({ name, theme }) {
  const next = seasonFields({ name, theme });
  return db().begin(async (tx) => {
    // One season end at a time; a second click waits and then finds no games.
    await tx`LOCK TABLE seasons IN SHARE ROW EXCLUSIVE MODE`;
    const { open, start } = await currentSeason(tx);
    const { champion, firstGameAt } = await seasonStandings(start);
    if (!champion) throw badRequest('No games in the current season yet.');
    if (open) {
      await tx`UPDATE seasons SET champion_name = ${champion}, ended_at = now() WHERE id = ${open.id}`;
    } else {
      // Seasons count games played *after* their start, so the closed row
      // starts where this season really began — or, for the very first
      // season, just before its first game, which then still counts.
      const startedAt = start.getTime() > 0 ? start : new Date(firstGameAt.getTime() - 1000);
      await tx`
        INSERT INTO seasons (champion_name, started_at, ended_at)
        VALUES (${champion}, ${startedAt}, now())`;
    }
    await tx`INSERT INTO seasons (name, theme, started_at) VALUES (${next.name}, ${next.theme}, now())`;
    return { champion };
  });
}

/** /admin: rename or re-theme the current season. */
async function updateCurrentSeason({ name, theme }) {
  const fields = seasonFields({ name, theme });
  const { open, start } = await currentSeason();
  if (open) {
    await db()`UPDATE seasons SET name = ${fields.name}, theme = ${fields.theme} WHERE id = ${open.id}`;
  } else {
    await db()`INSERT INTO seasons (name, theme, started_at) VALUES (${fields.name}, ${fields.theme}, ${start})`;
  }
}

module.exports = { listSeasons, previewSeasonEnd, endSeason, updateCurrentSeason };
