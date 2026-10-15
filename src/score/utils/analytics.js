import { GAME_TYPE_CODES, gameTypeRule } from '../../../server/game/gameTypes.js'
import { isWinnerOf } from './winners'
import { totalsByPlayer } from './rounds'

// { K: v, Q: v, …, P3: v } — one entry per game type.
const byType = (make) => Object.fromEntries(GAME_TYPE_CODES.map(code => [code, make()]))

// Icons for these rows come from utils/gameIcons.jsx (CardTypeIcon by code);
// chart labels use the plain `label` text.
export const TYPE_ROWS = [
  { code: 'K',  label: 'კინგი ♥',    group: 'penalty' },
  { code: 'Q',  label: 'დამები',     group: 'penalty' },
  { code: 'J',  label: 'ვალეტები',   group: 'penalty' },
  { code: 'H',  label: 'გულები',     group: 'penalty' },
  { code: 'L2', label: 'ბოლო ორი',   group: 'penalty' },
  { code: 'T',  label: 'მინუსი',     group: 'penalty' },
  { code: 'P1', label: 'პლიუსი 1',   group: 'bonus' },
  { code: 'P2', label: 'პლიუსი 2',   group: 'bonus' },
  { code: 'P3', label: 'პლიუსი 3',   group: 'bonus' },
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

  add('Q',  'დამების მკრეფავი',    p => stats[p.id]?.Q || 0,                           v => `${v} დამა`)
  add('H',  'გულების მონადირე',    p => stats[p.id]?.H || 0,                           v => `${v} გული`)
  add('J',  'ვალეტების მაგნიტი',   p => stats[p.id]?.J || 0,                           v => `${v} ვალეტი`)
  add('K',  'მეფის მაგნიტი',       p => stats[p.id]?.K || 0,                           v => `მეფე აიღო ${v}-ჯერ`)
  add('L2', 'ბოლო ორის მკრეფავი',  p => stats[p.id]?.L2 || 0,                          v => `${v} ბოლო მინუსი`)
  add('T',  'მინუსების ღრუბელი',   p => stats[p.id]?.T || 0,                           v => `${v} მინუსი`)
  add('P',  'პლიუსის ოსტატი',      p => (stats[p.id]?.P1||0)+(stats[p.id]?.P2||0)+(stats[p.id]?.P3||0), v => `${v} მინუსი პლიუსში`)

  if (participants?.length) {
    const winner = participants.reduce((b, p) => !b || p.score > b.score ? p : b, null)
    const loser  = participants.reduce((b, p) => !b || p.score < b.score ? p : b, null)
    if (winner) awards.push({ icon: 'winner', title: 'გამარჯვებული', player: winner.name, value: `${winner.score} ქულა` })
    if (loser && loser.name !== winner?.name) awards.push({ icon: 'loser', title: 'ბოლო ადგილი', player: loser.name, value: `${loser.score} ქულა` })
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

  add('champion', 'ყველა დროის ჩემპიონი', p => p.wins,                          p => `${p.wins} მოგება ${p.gamesPlayed} თამაშიდან`)
  add('Q',        'დამების მაგნიტი',     p => p.Q,                              p => `სულ ${p.Q} დამა`)
  add('H',        'ყველაზე უგულო',       p => p.H,                              p => `სულ ${p.H} გული`)
  add('J',        'ვალეტების კოლექციონერი', p => p.J,                            p => `სულ ${p.J} ვალეტი`)
  add('K',        'მეფის მონადირე',      p => p.K,                              p => `მეფე აიღო ${p.K}-ჯერ`)
  add('L2',       'ბოლო ორის მკრეფავი',  p => p.L2,                             p => `${p.L2} ბოლო მინუსი`)
  add('T',        'მინუსების გობლინი',   p => p.T,                              p => `${p.T} მინუსი აიღო`)
  add('P',        'პლიუსის ჯადოქარი',    p => p.P1 + p.P2 + p.P3,              p => `${p.P1 + p.P2 + p.P3} მინუსი პლიუსში`)
  add('avg',      'საუკეთესო საშუალო',   p => p.gamesPlayed > 0 ? p.totalScore / p.gamesPlayed : -Infinity, p => `საშუალოდ ${(p.totalScore / p.gamesPlayed).toFixed(1)} ქულა თამაშზე`)
  add('games',    'ყველაზე ერთგული',     p => p.gamesPlayed,                    p => `${p.gamesPlayed} თამაში ითამაშა`)

  return awards
}
