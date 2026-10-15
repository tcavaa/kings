import { GAME_TYPE_CODES, gameTypeRule } from '../../../server/game/gameTypes.js'
import { isWinnerOf } from './winners'
import { totalsByPlayer } from './rounds'

// { K: v, Q: v, …, P3: v } — one entry per game type.
const byType = (make) => Object.fromEntries(GAME_TYPE_CODES.map(code => [code, make()]))

// Icons for these rows come from utils/gameIcons.jsx (CardTypeIcon by code);
// chart labels use the plain `label` text.
export const TYPE_ROWS = [
  { code: 'K',  label: 'King ♥',     group: 'penalty' },
  { code: 'Q',  label: 'Queens',     group: 'penalty' },
  { code: 'J',  label: 'Jacks',      group: 'penalty' },
  { code: 'H',  label: 'Hearts',     group: 'penalty' },
  { code: 'L2', label: 'Last 2',     group: 'penalty' },
  { code: 'T',  label: 'Bad Tricks', group: 'penalty' },
  { code: 'P1', label: 'Plus (1)',   group: 'bonus' },
  { code: 'P2', label: 'Plus (2)',   group: 'bonus' },
  { code: 'P3', label: 'Plus (3)',   group: 'bonus' },
]

// Returns { [playerId]: { K, Q, J, H, L2, T, P1, P2, P3 } } — units collected per player
export function computeGameStats(players, rounds) {
  const stats = {}
  players.forEach(p => {
    stats[p.id] = byType(() => 0)
  })
  rounds.forEach(round => {
    const { gameTypeCode: code, countsByPlayerId, singleTargetPlayerId } = round
    const type = gameTypeRule(code)
    if (!type) return
    if (type.kind === 'count' && countsByPlayerId) {
      players.forEach(p => {
        if (stats[p.id]) stats[p.id][code] += countsByPlayerId[p.id] || 0
      })
    } else if (type.kind === 'single' && singleTargetPlayerId) {
      if (stats[singleTargetPlayerId]) stats[singleTargetPlayerId][code] += 1
    }
  })
  return stats
}

export function getGameAwards(players, stats, participants) {
  if (!players?.length) return []
  const awards = []
  const topPlayer = fn => players.reduce((b, p) => !b || fn(p) > fn(b) ? p : b, null)

  const add = (icon, title, fn, fmt) => {
    const p = topPlayer(fn)
    const val = p ? fn(p) : 0
    if (p && val >= 1) awards.push({ icon, title, player: p.name, value: fmt(val) })
  }

  add('Q',  'Queen Hoarder',       p => stats[p.id]?.Q || 0,                           v => `${v} queen${v !== 1 ? 's' : ''}`)
  add('H',  'Heartbreaker',        p => stats[p.id]?.H || 0,                           v => `${v} heart${v !== 1 ? 's' : ''}`)
  add('J',  'Jack Magnet',         p => stats[p.id]?.J || 0,                           v => `${v} jack${v !== 1 ? 's' : ''}`)
  add('K',  'King Taker',          p => stats[p.id]?.K || 0,                           v => `got king ${v}x`)
  add('L2', 'Last-Card Hoarder',   p => stats[p.id]?.L2 || 0,                          v => `${v} last-2 card${v !== 1 ? 's' : ''}`)
  add('T',  'Trick Sponge',        p => stats[p.id]?.T || 0,                           v => `${v} bad trick${v !== 1 ? 's' : ''}`)
  add('P',  'Plus Master',         p => (stats[p.id]?.P1||0)+(stats[p.id]?.P2||0)+(stats[p.id]?.P3||0), v => `${v} plus trick${v !== 1 ? 's' : ''}`)

  if (participants?.length) {
    const winner = participants.reduce((b, p) => !b || p.score > b.score ? p : b, null)
    const loser  = participants.reduce((b, p) => !b || p.score < b.score ? p : b, null)
    if (winner) awards.push({ icon: 'winner', title: 'Game Winner', player: winner.name, value: `${winner.score} pts` })
    if (loser && loser.name !== winner?.name) awards.push({ icon: 'loser', title: 'Biggest Loser', player: loser.name, value: `${loser.score} pts` })
  }

  return awards
}

// Aggregates stats across all game_details records.
// Returns { [playerId]: { name, gamesPlayed, wins, totalScore, K, Q, J, H, L2, T, P1, P2, P3 } }
export function computeGlobalStats(allDetails, allResults) {
  const map = {}
  const resultById = new Map((allResults || []).map(r => [r.id, r]))

  allDetails.forEach(detail => {
    const { players, rounds, game_result_id } = detail
    if (!players || !rounds) return
    const result = resultById.get(game_result_id)
    const gameStats = computeGameStats(players, rounds)

    const totals = totalsByPlayer(players, rounds)

    players.forEach(p => {
      if (!map[p.id]) {
        map[p.id] = { name: p.name, gamesPlayed: 0, wins: 0, seconds: 0, totalScore: 0, ...byType(() => 0) }
      }
      const m = map[p.id]
      m.gamesPlayed++
      m.totalScore += totals[p.id] || 0
      if (result && isWinnerOf(result, p.name)) m.wins++
      const gs = gameStats[p.id] || {}
      GAME_TYPE_CODES.forEach(k => { m[k] += gs[k] || 0 })
    })

    // Second place = the player with the 2nd-highest total score in this game
    const ranking = players
      .map(p => ({ id: p.id, score: totals[p.id] || 0 }))
      .sort((a, b) => b.score - a.score)
    if (ranking.length >= 2 && map[ranking[1].id]) map[ranking[1].id].seconds++
  })

  return map
}

// Head-to-head comparison restricted to games every selected player took part in.
// `selected` = [{ id, name }]. allDetails/allResults hold King Online's games
// and the ones recorded here alike (detail.type says which).
// Returns per-player wins/games/win% over shared games plus a pairwise matrix
// of who outscored whom.
export function computeComparison(selected, allDetails, allResults = []) {
  const ids = selected.map(s => s.id)
  const resultById = new Map(allResults.map(r => [r.id, r]))

  const stats = {}
  selected.forEach(s => { stats[s.id] = { id: s.id, name: s.name, wins: 0, games: 0 } })

  // h2h[a][b] = number of shared games where a outscored b
  const h2h = {}
  ids.forEach(a => { h2h[a] = {}; ids.forEach(b => { if (a !== b) h2h[a][b] = 0 }) })

  const addPairwise = scoreById => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue
        if ((scoreById[ids[i]] ?? 0) > (scoreById[ids[j]] ?? 0)) h2h[ids[i]][ids[j]]++
      }
    }
  }

  let localShared = 0
  let onlineShared = 0

  allDetails.forEach(detail => {
    const { players, rounds, game_result_id } = detail
    if (!players || !rounds) return
    const inGame = new Set(players.map(p => p.id))
    if (!ids.every(id => inGame.has(id))) return
    if (detail.type === 'online') onlineShared++
    else localShared++

    const totals = totalsByPlayer(players, rounds)

    const result = resultById.get(game_result_id)
    selected.forEach(s => {
      stats[s.id].games++
      if (result && isWinnerOf(result, s.name)) stats[s.id].wins++
    })
    addPairwise(totals)
  })

  const rows = selected
    .map(s => {
      const st = stats[s.id]
      return { ...st, winPct: st.games > 0 ? (st.wins / st.games) * 100 : null }
    })
    .sort((a, b) => b.wins - a.wins)

  return { rows, h2h, localShared, onlineShared, totalShared: localShared + onlineShared }
}

export function getGlobalAwards(playerMap) {
  const players = Object.values(playerMap)
  if (!players.length) return []
  const awards = []
  const top = fn => players.reduce((b, p) => fn(p) > fn(b) ? p : b, players[0])

  const add = (icon, title, fn, fmt) => {
    const p = top(fn)
    if (p) awards.push({ icon, title, player: p.name, value: fmt(p) })
  }

  add('champion', 'All-time Champion',   p => p.wins,                           p => `${p.wins} win${p.wins !== 1 ? 's' : ''} in ${p.gamesPlayed} game${p.gamesPlayed !== 1 ? 's' : ''}`)
  add('Q',        'Queen Magnet',        p => p.Q,                              p => `${p.Q} queens total`)
  add('H',        'Most Heartless',      p => p.H,                              p => `${p.H} hearts total`)
  add('J',        'Jack Collector',      p => p.J,                              p => `${p.J} jacks total`)
  add('K',        'King Slayer',         p => p.K,                              p => `grabbed king ${p.K}x`)
  add('L2',       'Last-Card Hoarder',   p => p.L2,                             p => `${p.L2} last-2 cards`)
  add('T',        'Trick Goblin',        p => p.T,                              p => `${p.T} bad tricks taken`)
  add('P',        'Plus Wizard',         p => p.P1 + p.P2 + p.P3,              p => `${p.P1 + p.P2 + p.P3} plus tricks`)
  add('avg',      'Highest Avg Score',   p => p.gamesPlayed > 0 ? p.totalScore / p.gamesPlayed : -Infinity, p => `avg ${(p.totalScore / p.gamesPlayed).toFixed(1)} pts/game`)
  add('games',    'Most Dedicated',      p => p.gamesPlayed,                    p => `${p.gamesPlayed} game${p.gamesPlayed !== 1 ? 's' : ''} played`)

  return awards
}
