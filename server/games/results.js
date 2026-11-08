'use strict';

// How a finished game's result is read — its winners (ties included), the
// stats one round adds to a player, and a season's table — in one place for
// the store (db/games.js, db/seasons.js), King Online and ჩაწერა. Plain
// CommonJS with no dependencies, so the Next.js client can import it too.

/**
 * Names of every winner of a game: a tie has several. Older games carry
 * only the single winner. Takes an API game ({ winners, winner }) or a
 * store row's parts ({ winners, winner_name }).
 */
function winnerNames(game) {
  if (Array.isArray(game?.winners) && game.winners.length) {
    return game.winners.map((w) => w?.name).filter(Boolean);
  }
  const one = game?.winner ? game.winner.name : game?.winner_name;
  return one ? [one] : [];
}

/** A zeroed per-player tally for addRoundStats. */
function emptyRoundStats() {
  return { roundsLed: 0, totalTricks: 0, queens: 0, jacks: 0, hearts: 0, kingsOfHearts: 0 };
}

/**
 * Add one round record's stats for `seat` to `tally`. The server records
 * queens, jacks, hearts and the K♥ taker for every trick of every round,
 * whatever the type; they only count in the round where they mattered
 * (queens in 'Q', jacks in 'J', hearts in 'H', K♥ in 'K'), so totals can
 * never exceed a game's real maximums (12 queens, 12 jacks, 24 hearts, 3 K♥).
 */
function addRoundStats(tally, d, seat) {
  if (d.leaderSeat === seat) tally.roundsLed += 1;
  tally.totalTricks += d.tricksTaken?.[seat] ?? 0;
  if (d.gameType === 'Q') tally.queens += d.queensTaken?.[seat] ?? 0;
  if (d.gameType === 'J') tally.jacks += d.jacksTaken?.[seat] ?? 0;
  if (d.gameType === 'H') tally.hearts += d.heartsTaken?.[seat] ?? 0;
  if (d.gameType === 'K' && d.kingOfHeartsTakenBy === seat) tally.kingsOfHearts += 1;
  return tally;
}

const timeOf = (t) => (t == null ? NaN : new Date(t).getTime());

// How many King Online league games of each player a season counts. A player
// may keep playing after that: the games still count everywhere else (their
// history, lifetime stats, the leaderboard), but the season table stays as
// it was after their 40th — no more wins, games or points there. Games
// recorded at a table in ჩაწერა are not capped.
const SEASON_GAME_LIMIT = 40;

// The cap started with the season that opened on 8 November 2026; seasons
// before it are left exactly as they were crowned.
const SEASON_LIMIT_SINCE = Date.parse('2026-11-08T00:00:00Z');

/** Does the season starting at `from` cap its players' online games? */
function seasonGameLimitApplies(from) {
  const fromMs = timeOf(from);
  return Number.isFinite(fromMs) && fromMs >= SEASON_LIMIT_SINCE;
}

/**
 * The season's games as the season counts them: each player's King Online
 * games after their SEASON_GAME_LIMIT-th (by when they were played) drop that
 * player — from the game's players and winners — so they add nothing to the
 * player's season row. The other players of that game still count it.
 */
function capSeasonGames(games, limit = SEASON_GAME_LIMIT) {
  const played = new Map();
  return [...games]
    .sort((a, b) => timeOf(a.playedAt) - timeOf(b.playedAt))
    .map((g) => {
      if (g.type !== 'online') return g;
      const names = (g.players || []).map((p) => p && p.name).filter(Boolean);
      const counted = new Set();
      for (const name of new Set(names)) {
        const n = (played.get(name) || 0) + 1;
        played.set(name, n);
        if (n <= limit) counted.add(name);
      }
      if (counted.size === new Set(names).size) return g;
      return {
        ...g,
        players: (g.players || []).filter((p) => p && counted.has(p.name)),
        // Names (season rows) or { name } (API games): either keeps its shape.
        winners: (g.winners || []).filter((w) => counted.has(typeof w === 'string' ? w : w && w.name)),
      };
    });
}

/** How many of the season's King Online games `name` has played (season-counted or not). */
function seasonOnlineGamesOf(games, name) {
  const lower = String(name || '').trim().toLowerCase();
  if (!lower) return 0;
  return games.filter((g) => g.type === 'online'
    && (g.players || []).some((p) => p && String(p.name || '').trim().toLowerCase() === lower)).length;
}

/**
 * Is a game played at `playedAt` part of the season from `from` to `to`?
 * A season holds the games after its start, up to and including its end
 * (no end while it runs): ending a season counts every game up to that
 * moment, and the next one starts there.
 */
function inSeason(playedAt, from, to = null) {
  const t = timeOf(playedAt);
  const fromMs = from ? timeOf(from) : -Infinity;
  const toMs = to ? timeOf(to) : Infinity;
  return t > fromMs && t <= toMs;
}

/**
 * A season's table, the rule its champion is crowned by: every league game
 * in the season (callers pass ჩაწერა's games and King Online's
 * championship games), each winner of a tie gets a win, and players are
 * counted by name, including ones since removed from the list. From the
 * season that opened on 8 November 2026, only each player's first
 * SEASON_GAME_LIMIT King Online games count (capSeasonGames).
 *
 * `games` are { playedAt, type: 'live' | 'online', players: [{ name, score }],
 * winners: [name] }. Rows { name, wins, liveWins, onlineWins, games,
 * totalScore }, most wins first, then by name.
 */
function seasonTable(games, from, to = null) {
  const inThis = games.filter((g) => inSeason(g.playedAt, from, to));
  return playerStandings(seasonGameLimitApplies(from) ? capSeasonGames(inThis) : inThis);
}

/** The same table over every game given (no season window). */
function playerStandings(games) {
  const rows = new Map();
  const rowOf = (name) => {
    if (!rows.has(name)) rows.set(name, { name, wins: 0, liveWins: 0, onlineWins: 0, games: 0, totalScore: 0 });
    return rows.get(name);
  };
  for (const g of games) {
    for (const p of g.players || []) {
      if (!p || !p.name) continue;
      const row = rowOf(p.name);
      row.games++;
      row.totalScore += Number(p.score) || 0;
    }
    for (const name of new Set((g.winners || []).filter(Boolean))) {
      const row = rowOf(name);
      row.wins++;
      if (g.type === 'online') row.onlineWins++;
      else row.liveWins++;
    }
  }
  return [...rows.values()].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
}

/** The champion(s) of a season table, sorted (several on a tie; empty with no wins). */
function championsOf(table) {
  const best = table.reduce((m, r) => Math.max(m, r.wins), 0);
  if (!best) return [];
  return table.filter((r) => r.wins === best).map((r) => r.name).sort();
}

/** The champion(s) as display text: "A & B" on a tie, null with no wins. */
function championOf(table) {
  return championsOf(table).join(' & ') || null;
}

module.exports = {
  winnerNames, emptyRoundStats, addRoundStats, inSeason, seasonTable, playerStandings, championOf, championsOf,
  SEASON_GAME_LIMIT, SEASON_LIMIT_SINCE, seasonGameLimitApplies, capSeasonGames, seasonOnlineGamesOf,
};
