import {
  Star, Gem, Shield, TrendingUp, Flame, Rocket, Wand2,
  Gamepad2, Joystick, Crown, Sparkle, Stars, Medal, Diamond,
  Trophy, Ghost, Swords, Zap, CloudLightning,
} from 'lucide-react'
import { GAME_TYPES } from '../constants/gameTypes'
import { isWinnerOf } from './winners'

// `Icon` is a lucide-react component; `color` tints it wherever it renders.
export const ACHIEVEMENT_DEFS = {
  PERFECT_PLUS:          { id: 'PERFECT_PLUS',          Icon: Star,           color: '#eab308', label: 'Perfect Plus',       desc: '10/10 tricks in a Plus round',                        repeatable: true  },
  PLUS_PERFECTIONIST:    { id: 'PLUS_PERFECTIONIST',    Icon: Gem,            color: '#06b6d4', label: 'Plus Perfectionist', desc: '10/10 in all 3 Plus rounds in one game',              repeatable: true  },
  UNTOUCHABLE:           { id: 'UNTOUCHABLE',           Icon: Shield,         color: '#2563eb', label: 'Untouchable',        desc: 'Led every negative round without taking any penalty', repeatable: true  },
  NEVER_BELOW_ZERO:      { id: 'NEVER_BELOW_ZERO',      Icon: TrendingUp,     color: '#059669', label: 'In the Green',       desc: 'Score never dropped below zero',                      repeatable: true  },
  UNDERDOG:              { id: 'UNDERDOG',              Icon: Flame,          color: '#ea580c', label: 'Underdog',            desc: 'Won despite being in last place the longest',         repeatable: true  },
  RUNAWAY_WIN:           { id: 'RUNAWAY_WIN',           Icon: Rocket,         color: '#7c3aed', label: 'Runaway',             desc: 'Won with 100+ point margin over 2nd place',           repeatable: true  },
  PERFECT_PLUS_HAT_TRICK:{ id: 'PERFECT_PLUS_HAT_TRICK',Icon: Wand2,          color: '#d946ef', label: 'Hat Trick Plus',    desc: '10/10 in a Plus round 3+ times (lifetime)',           repeatable: false },
  GAMES_50:              { id: 'GAMES_50',              Icon: Gamepad2,       color: '#64748b', label: 'Dedicated',           desc: 'Played 50 games',                                     repeatable: false },
  GAMES_100:             { id: 'GAMES_100',             Icon: Joystick,       color: '#0891b2', label: 'Century',            desc: 'Played 100 games',                                    repeatable: false },
  GAMES_150:             { id: 'GAMES_150',             Icon: Crown,          color: '#b45309', label: 'Legend',              desc: 'Played 150 games',                                    repeatable: false },
  GAMES_250:             { id: 'GAMES_250',             Icon: Sparkle,        color: '#0ea5e9', label: 'Veteran',             desc: 'Played 250 games',                                    repeatable: false },
  GAMES_500:             { id: 'GAMES_500',             Icon: Stars,          color: '#eab308', label: 'Elite',               desc: 'Played 500 games',                                    repeatable: false },
  GAMES_800:             { id: 'GAMES_800',             Icon: Medal,          color: '#b8860b', label: 'Master',              desc: 'Played 800 games',                                    repeatable: false },
  GAMES_1000:            { id: 'GAMES_1000',            Icon: Diamond,        color: '#7c3aed', label: 'Grandmaster',         desc: 'Played 1000 games',                                   repeatable: false },
  WINS_10:               { id: 'WINS_10',               Icon: Medal,          color: '#a0642d', label: '10 Wins',             desc: 'Won 10 games',                                        repeatable: false },
  WINS_25:               { id: 'WINS_25',               Icon: Medal,          color: '#8c8f96', label: '25 Wins',             desc: 'Won 25 games',                                        repeatable: false },
  WINS_50:               { id: 'WINS_50',               Icon: Medal,          color: '#d4a017', label: '50 Wins',             desc: 'Won 50 games',                                        repeatable: false },
  WINS_250:              { id: 'WINS_250',              Icon: Trophy,         color: '#d4a017', label: '250 Wins',             desc: 'Won 250 games',                                       repeatable: false },
  WINS_500:              { id: 'WINS_500',              Icon: Ghost,          color: '#dc2626', label: '500 Wins',             desc: 'Won 500 games',                                       repeatable: false },
  WINS_1000:             { id: 'WINS_1000',             Icon: Swords,         color: '#b91c1c', label: '1000 Wins',            desc: 'Won 1000 games',                                      repeatable: false },
  WIN_STREAK_3:          { id: 'WIN_STREAK_3',          Icon: Zap,            color: '#eab308', label: '3 in a Row',          desc: 'Won 3 consecutive games',                             repeatable: false },
  WIN_STREAK_5:          { id: 'WIN_STREAK_5',          Icon: CloudLightning, color: '#0ea5e9', label: '5 in a Row',         desc: 'Won 5 consecutive games',                             repeatable: false },
  WIN_STREAK_10:         { id: 'WIN_STREAK_10',         Icon: Flame,          color: '#dc2626', label: '10 in a Row',        desc: 'Won 10 consecutive games',                            repeatable: false },
}

const NEGATIVE_CODES = new Set(['K', 'Q', 'J', 'H', 'L2', 'T'])
const PLUS_CODES = ['P1', 'P2', 'P3']

/**
 * Compute per-game achievements for all players in a single game.
 * Returns { [playerId]: string[] } — PERFECT_PLUS appears once per 10/10 round earned.
 */
export function computePerGameAchievements(players, rounds) {
  if (!players?.length || !rounds?.length) return {}

  const result = {}
  const running = {}
  const lastPlaceCount = {}
  const neverBelow = {}
  const plusPerfect = {}
  const negLed = {}

  players.forEach(p => {
    result[p.id] = []
    running[p.id] = 0
    lastPlaceCount[p.id] = 0
    neverBelow[p.id] = true
    plusPerfect[p.id] = { P1: false, P2: false, P3: false }
    negLed[p.id] = { led: 0, clean: 0 }
  })

  rounds.forEach(round => {
    const { gameTypeCode: code, leaderPlayerId, countsByPlayerId, singleTargetPlayerId, scores } = round

    if (scores) {
      players.forEach(p => {
        running[p.id] += scores[p.id] || 0
        if (running[p.id] < 0) neverBelow[p.id] = false
      })
    }

    const minScore = Math.min(...players.map(p => running[p.id]))
    players.forEach(p => { if (running[p.id] === minScore) lastPlaceCount[p.id]++ })

    if (PLUS_CODES.includes(code) && countsByPlayerId) {
      players.forEach(p => {
        if ((countsByPlayerId[p.id] || 0) === 10) {
          plusPerfect[p.id][code] = true
          result[p.id].push('PERFECT_PLUS')
        }
      })
    }

    if (NEGATIVE_CODES.has(code) && leaderPlayerId && negLed[leaderPlayerId]) {
      const type = GAME_TYPES.find(t => t.code === code)
      if (!type) return

      if (type.kind === 'single') {
        if (singleTargetPlayerId == null) return  // skip rounds with no recorded target
        negLed[leaderPlayerId].led++
        if (singleTargetPlayerId !== leaderPlayerId) negLed[leaderPlayerId].clean++
      } else {
        if (countsByPlayerId == null) return  // skip rounds with no recorded counts
        negLed[leaderPlayerId].led++
        if ((countsByPlayerId[leaderPlayerId] || 0) === 0) negLed[leaderPlayerId].clean++
      }
    }
  })

  const finalScores = {}
  players.forEach(p => { finalScores[p.id] = running[p.id] })
  const maxScore = Math.max(...players.map(p => finalScores[p.id]))
  // Ties crown everyone on the top score.
  const winners = players.filter(p => finalScores[p.id] === maxScore)

  players.forEach(p => {
    const pp = plusPerfect[p.id]
    if (pp.P1 && pp.P2 && pp.P3) result[p.id].push('PLUS_PERFECTIONIST')

    const nl = negLed[p.id]
    if (nl.led === NEGATIVE_CODES.size && nl.clean === NEGATIVE_CODES.size) result[p.id].push('UNTOUCHABLE')

    if (neverBelow[p.id]) result[p.id].push('NEVER_BELOW_ZERO')
  })

  if (winners.length && players.length >= 2) {
    // UNDERDOG per tied winner: spent strictly more rounds in last place
    // than every non-winner.
    const others = players.filter(p => !winners.some(w => w.id === p.id))
    const maxOtherLast = others.length > 0 ? Math.max(...others.map(p => lastPlaceCount[p.id])) : -1
    winners.forEach(w => {
      if (others.length && lastPlaceCount[w.id] > maxOtherLast) result[w.id].push('UNDERDOG')
    })
  }

  // RUNAWAY_WIN needs a 100+ margin over 2nd place — impossible on a tie
  // (tied winners are 0 apart), so only a sole winner can earn it.
  if (winners.length === 1 && players.length >= 2) {
    const sorted = [...players].sort((a, b) => finalScores[b.id] - finalScores[a.id])
    const margin = finalScores[sorted[0].id] - finalScores[sorted[1].id]
    if (margin >= 100) result[sorted[0].id].push('RUNAWAY_WIN')
  }

  return result
}

/**
 * Compute lifetime achievement counts for all players across all games.
 * Returns { [playerName]: { [code]: count } }
 * Milestone achievements (repeatable: false) have count 1 when earned.
 */
export function computeAllLifetimeAchievements(allGameDetails, allResults) {
  const perNameCounts = {}

  ;(allGameDetails || []).forEach(detail => {
    const { players, rounds } = detail
    if (!players || !rounds) return

    const gameAchievements = computePerGameAchievements(players, rounds)
    players.forEach(p => {
      const earned = gameAchievements[p.id] || []
      if (!perNameCounts[p.name]) perNameCounts[p.name] = {}
      earned.forEach(code => {
        perNameCounts[p.name][code] = (perNameCounts[p.name][code] || 0) + 1
      })
    })
  })

  const allNames = new Set()
  ;(allGameDetails || []).forEach(d => d.players?.forEach(p => allNames.add(p.name)))
  ;(allResults || []).forEach(r => r.participants?.forEach(p => allNames.add(p.name)))

  const result = {}
  allNames.forEach(name => {
    const counts = perNameCounts[name] || {}
    const r = { ...counts }

    if ((counts['PERFECT_PLUS'] || 0) >= 3) r['PERFECT_PLUS_HAT_TRICK'] = 1

    const playerResults = (allResults || [])
      .filter(res => res.participants?.some(p => p.name === name))
      .sort((a, b) => new Date(a.played_at) - new Date(b.played_at))

    const gamesPlayed = playerResults.length
    // Tie-aware: shared top scores count as wins for everyone involved.
    const wins = playerResults.filter(res => isWinnerOf(res, name)).length

    if (gamesPlayed >= 50)   r['GAMES_50'] = 1
    if (gamesPlayed >= 100)  r['GAMES_100'] = 1
    if (gamesPlayed >= 150)  r['GAMES_150'] = 1
    if (gamesPlayed >= 250)  r['GAMES_250'] = 1
    if (gamesPlayed >= 500)  r['GAMES_500'] = 1
    if (gamesPlayed >= 800)  r['GAMES_800'] = 1
    if (gamesPlayed >= 1000) r['GAMES_1000'] = 1
    if (wins >= 10)   r['WINS_10'] = 1
    if (wins >= 25)   r['WINS_25'] = 1
    if (wins >= 50)   r['WINS_50'] = 1
    if (wins >= 250)  r['WINS_250'] = 1
    if (wins >= 500)  r['WINS_500'] = 1
    if (wins >= 1000) r['WINS_1000'] = 1

    let maxStreak = 0
    let current = 0
    playerResults.forEach(res => {
      if (isWinnerOf(res, name)) { current++; maxStreak = Math.max(maxStreak, current) }
      else current = 0
    })
    if (maxStreak >= 3)  r['WIN_STREAK_3'] = 1
    if (maxStreak >= 5)  r['WIN_STREAK_5'] = 1
    if (maxStreak >= 10) r['WIN_STREAK_10'] = 1

    if (Object.keys(r).length > 0) result[name] = r
  })

  return result
}
