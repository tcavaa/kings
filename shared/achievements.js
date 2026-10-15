// Achievements — the rules, for King Online and ჩაწერა alike. Each app keeps
// only its own labels, icons and colours (src/online/utils/achievements.js,
// src/score/utils/achievements.js) and turns its round records into the
// plain shape below.
//
// Nothing is ever stored: every badge is worked out from the rounds of the
// finished games, so achievements apply to old games automatically. Which
// games count is each app's choice, on purpose: ჩაწერა passes league games
// only (src/score/lib/gameData.js), King Online every game its leaderboard
// shows, old casual ones included.
//
// A round, keyed by whatever identifies a player in the app (seat or id):
//   { code,                      game-type code ('K', 'Q', …, 'P3')
//     leader,                    key of the player who led the round
//     scores: { [key]: points },
//     counts: { [key]: units },  units of the round's own type, null if unknown
//     target }                   K only: who took the King of Hearts, null if unknown

import { PENALTY_CODES, PLUS_CODES, gameTypeRule } from '../server/game/gameTypes.js'

// Every achievement in display order. Per-game ones (`perGame`) are worked
// out from one game's rounds and repeat (shown ×N); the club ones repeat too
// but come from the run of games, the seasons and the tournaments; lifetime
// milestones are earned once.
export const ACHIEVEMENTS = [
  { code: 'PERFECT_PLUS',           repeatable: true, perGame: true },  // 10/10 in a Plus round
  { code: 'PLUS_PERFECTIONIST',     repeatable: true, perGame: true },  // 10/10 in all 3 Plus rounds of a game
  { code: 'UNTOUCHABLE',            repeatable: true, perGame: true },  // led every penalty round, took no penalty in them
  { code: 'NEVER_BELOW_ZERO',       repeatable: true, perGame: true },  // never under 0 during the game
  { code: 'UNDERDOG',               repeatable: true, perGame: true },  // won after the most rounds in last place
  { code: 'RUNAWAY_WIN',            repeatable: true, perGame: true },  // won by 100+ over 2nd place
  { code: 'SHARED_WIN',             repeatable: true, perGame: true },  // tied for the win
  { code: 'COMEBACK',               repeatable: true, perGame: true },  // won after trailing the leader by 175+
  { code: 'WIRE_TO_WIRE',           repeatable: true, perGame: true },  // alone in first after every round, and won
  { code: 'LAST_ROUND_STEAL',       repeatable: true, perGame: true },  // not leading before the last round, won
  { code: 'PHOTO_FINISH',           repeatable: true, perGame: true },  // won alone, by 8 or fewer
  { code: 'CLEAN_SHEET',            repeatable: true, perGame: true },  // a whole game without a penalty point
  { code: 'KING_MAGNET',            repeatable: true, perGame: true },  // took the K♥ in every King round
  { code: 'DISASTER',               repeatable: true, perGame: true },  // finished on −200 or lower
  { code: 'UGLY_WIN',               repeatable: true, perGame: true },  // won on a score below zero
  { code: 'STREAK_BREAKER',         repeatable: true },   // won the game that ended someone's 5+ win streak
  { code: 'TOURNAMENT_WINNER',      repeatable: true },   // won a tournament final
  { code: 'SEASON_CHAMPION',        repeatable: true },   // crowned at a season's end
  { code: 'PERFECT_PLUS_HAT_TRICK', repeatable: false },  // PERFECT_PLUS 3+ times in all
  { code: 'GAMES_50',               repeatable: false },
  { code: 'GAMES_100',              repeatable: false },
  { code: 'GAMES_150',              repeatable: false },
  { code: 'GAMES_250',              repeatable: false },
  { code: 'GAMES_500',              repeatable: false },
  { code: 'GAMES_800',              repeatable: false },
  { code: 'GAMES_1000',             repeatable: false },
  { code: 'WINS_10',                repeatable: false },
  { code: 'WINS_25',                repeatable: false },
  { code: 'WINS_50',                repeatable: false },
  { code: 'WINS_250',               repeatable: false },
  { code: 'WINS_500',               repeatable: false },
  { code: 'WINS_1000',              repeatable: false },
  { code: 'WIN_STREAK_3',           repeatable: false },
  { code: 'WIN_STREAK_5',           repeatable: false },
  { code: 'WIN_STREAK_10',          repeatable: false },
  { code: 'CLUB_REGULAR',           repeatable: false },  // played with 10 different people
]

const GAMES_MILESTONES  = [[50, 'GAMES_50'], [100, 'GAMES_100'], [150, 'GAMES_150'], [250, 'GAMES_250'], [500, 'GAMES_500'], [800, 'GAMES_800'], [1000, 'GAMES_1000']]
const WINS_MILESTONES   = [[10, 'WINS_10'], [25, 'WINS_25'], [50, 'WINS_50'], [250, 'WINS_250'], [500, 'WINS_500'], [1000, 'WINS_1000']]
const STREAK_MILESTONES = [[3, 'WIN_STREAK_3'], [5, 'WIN_STREAK_5'], [10, 'WIN_STREAK_10']]
const HAT_TRICK = 3
const RUNAWAY_MARGIN = 100
const COMEBACK_DEFICIT = 175
const PHOTO_FINISH_MARGIN = 8
const DISASTER_SCORE = -200
const STREAK_TO_BREAK = 5
const CLUB_REGULAR_PEOPLE = 10

const PENALTY = new Set(PENALTY_CODES)
// A whole game: every player leads every game type once.
const ROUNDS_PER_LEADER = PENALTY_CODES.length + PLUS_CODES.length

/**
 * An app's achievement definitions: its own { [code]: label/icon/… } merged
 * with `code` and `repeatable`, in display order. Throws if the app misses
 * one, so a new achievement can't silently go without a label.
 */
export function defineAchievements(labels) {
  const defs = {}
  for (const { code, repeatable, perGame = false } of ACHIEVEMENTS) {
    if (!labels[code]) throw new Error(`No label for achievement ${code}`)
    defs[code] = { ...labels[code], id: code, repeatable, perGame }
  }
  return defs
}

/** Turn a flat codes array into a { [code]: count } map. */
export function countCodes(codes = []) {
  const out = {}
  codes.forEach(c => { out[c] = (out[c] || 0) + 1 })
  return out
}

/**
 * Per-game achievements for ONE game.
 * @param {(string|number)[]} keys  the players, by the key the rounds use
 * @param {object[]} rounds         rounds in the shape described above
 * @returns {{ [key]: string[] }}   codes per player; PERFECT_PLUS appears
 *   once per 10/10 Plus round (up to 3 times).
 */
export function perGameAchievements(keys, rounds) {
  const result = {}
  if (!keys?.length || !rounds?.length) return result

  const running = {}
  const lastPlaceCount = {}
  const neverBelow = {}
  const plusPerfect = {}
  const penaltyLed = {}
  const penaltyPoints = {}
  const maxDeficit = {}
  const alwaysAhead = {}
  const kingsTaken = {}
  let kingRounds = 0
  let leadingBeforeLast = null
  keys.forEach(k => {
    result[k] = []
    running[k] = 0
    lastPlaceCount[k] = 0
    neverBelow[k] = true
    plusPerfect[k] = new Set()
    penaltyLed[k] = { led: 0, clean: 0 }
    penaltyPoints[k] = 0
    maxDeficit[k] = 0
    alwaysAhead[k] = true
    kingsTaken[k] = 0
  })

  rounds.forEach((r, i) => {
    // Who led going into the last round (for LAST_ROUND_STEAL).
    if (i === rounds.length - 1 && i > 0) {
      const top = Math.max(...keys.map(k => running[k]))
      leadingBeforeLast = new Set(keys.filter(k => running[k] === top))
    }

    // 1. Running totals, and whether anyone dipped below zero.
    keys.forEach(k => {
      running[k] += r.scores?.[k] || 0
      if (running[k] < 0) neverBelow[k] = false
      if (PENALTY.has(r.code)) penaltyPoints[k] += r.scores?.[k] || 0
    })

    // 2. Rounds spent in (tied) last place; how far behind the leader each
    // player fell; who has been alone in first after every round.
    const min = Math.min(...keys.map(k => running[k]))
    const top = Math.max(...keys.map(k => running[k]))
    const leaders = keys.filter(k => running[k] === top)
    keys.forEach(k => {
      if (running[k] === min) lastPlaceCount[k]++
      maxDeficit[k] = Math.max(maxDeficit[k], top - running[k])
      if (leaders.length > 1 || leaders[0] !== k) alwaysAhead[k] = false
    })

    // King of Hearts, when the round says who took it.
    if (r.code === 'K' && r.target != null && r.target in kingsTaken) {
      kingRounds++
      kingsTaken[r.target]++
    }

    // 3. Plus-round perfection.
    if (PLUS_CODES.includes(r.code) && r.counts) {
      keys.forEach(k => {
        if ((r.counts[k] || 0) === 10) {
          plusPerfect[k].add(r.code)
          result[k].push('PERFECT_PLUS')
        }
      })
    }

    // 4. Penalty rounds the leader came through clean (for UNTOUCHABLE). A
    // round without its target / counts is bad data and is skipped.
    const led = r.leader != null ? penaltyLed[r.leader] : undefined
    if (PENALTY.has(r.code) && led) {
      if (gameTypeRule(r.code).kind === 'single') {
        if (r.target != null) {
          led.led++
          if (r.target !== r.leader) led.clean++
        }
      } else if (r.counts != null) {
        led.led++
        if ((r.counts[r.leader] || 0) === 0) led.clean++
      }
    }
  })

  // Final scores & winners (a tie on the top score crowns several players).
  const best = Math.max(...keys.map(k => running[k]))
  const winners = keys.filter(k => running[k] === best)

  const wholeGame = rounds.length === keys.length * ROUNDS_PER_LEADER
  keys.forEach(k => {
    if (PLUS_CODES.every(c => plusPerfect[k].has(c))) result[k].push('PLUS_PERFECTIONIST')
    // Every penalty type was led, and every one of them was clean.
    const { led, clean } = penaltyLed[k]
    if (led === PENALTY.size && clean === PENALTY.size) result[k].push('UNTOUCHABLE')
    if (neverBelow[k]) result[k].push('NEVER_BELOW_ZERO')
  })

  // Winners: tied ones, comebacks, leaders from start to finish, last-round
  // steals, and wins on a negative score.
  winners.forEach(w => {
    if (winners.length > 1) result[w].push('SHARED_WIN')
    if (maxDeficit[w] >= COMEBACK_DEFICIT) result[w].push('COMEBACK')
    if (alwaysAhead[w] && keys.length > 1) result[w].push('WIRE_TO_WIRE')
    if (leadingBeforeLast && !leadingBeforeLast.has(w)) result[w].push('LAST_ROUND_STEAL')
    if (best < 0) result[w].push('UGLY_WIN')
  })

  // Everyone: a whole game without a penalty point, every King of Hearts of
  // the game (each player leads one King round), a −200 finish.
  keys.forEach(k => {
    if (wholeGame && penaltyPoints[k] === 0) result[k].push('CLEAN_SHEET')
    if (kingRounds === keys.length && kingsTaken[k] === kingRounds) result[k].push('KING_MAGNET')
    if (running[k] <= DISASTER_SCORE) result[k].push('DISASTER')
  })

  // UNDERDOG — a winner who spent strictly more rounds in last place than
  // every non-winner. Checked per tied winner.
  const others = keys.filter(k => !winners.includes(k))
  if (others.length) {
    const maxOtherLast = Math.max(...others.map(k => lastPlaceCount[k]))
    winners.forEach(w => { if (lastPlaceCount[w] > maxOtherLast) result[w].push('UNDERDOG') })
  }

  // RUNAWAY_WIN — a 100+ margin over 2nd place. Impossible on a tie (tied
  // winners are 0 apart), so only a sole winner earns it.
  if (winners.length === 1 && others.length) {
    const second = Math.max(...others.map(k => running[k]))
    if (best - second >= RUNAWAY_MARGIN) result[winners[0]].push('RUNAWAY_WIN')
    if (best - second <= PHOTO_FINISH_MARGIN) result[winners[0]].push('PHOTO_FINISH')
  }

  return result
}

/**
 * Every player's achievements across every game, with when each was won.
 * @param {object[]} games  { playedAt, players: [{ key, name }],
 *   winners: [name] (every winner of a tie), rounds: [round],
 *   tournamentFinal: true for a tournament's final }
 * @param {{ seasons?: object[] }} options  the API's season rows; each
 *   ended one crowns its champion(s) (SEASON_CHAMPION)
 * @returns {{ [name]: { games, wins, plusRounds,
 *   earned: { [code]: { count, first, last } } } }} every player who played;
 *   `first` / `last` are the playedAt of the game it was first / last won in
 *   (a milestone is won once). `plusRounds` counts the Plus rounds played
 *   with their counts known, the chances at a PERFECT_PLUS.
 */
export function achievementTimeline(games = [], { seasons = [] } = {}) {
  const perName = new Map()
  const tallyOf = (name) => {
    if (!perName.has(name)) {
      perName.set(name, { games: 0, wins: 0, plusRounds: 0, streak: 0, maxStreak: 0, people: new Set(), earned: {} })
    }
    return perName.get(name)
  }
  const earn = (t, code, at) => {
    const e = t.earned[code]
    if (e) { e.count++; e.last = at }
    else t.earned[code] = { count: 1, first: at, last: at }
  }
  const milestone = (t, code, at) => { if (!t.earned[code]) earn(t, code, at) }

  // Oldest first, for the win streaks and the dates.
  const ordered = games.slice().sort((a, b) => new Date(a.playedAt) - new Date(b.playedAt))
  for (const g of ordered) {
    const players = g.players || []
    const at = g.playedAt ?? null
    const plusRounds = (g.rounds || []).filter((r) => PLUS_CODES.includes(r.code) && r.counts).length

    // 1. Repeatable per-game achievements.
    const perKey = perGameAchievements(players.map(p => p.key), g.rounds || [])
    for (const p of players) {
      if (!p.name) continue
      const t = tallyOf(p.name)
      t.plusRounds += plusRounds
      for (const code of perKey[p.key] || []) earn(t, code, at)
      if ((t.earned.PERFECT_PLUS?.count || 0) >= HAT_TRICK) milestone(t, 'PERFECT_PLUS_HAT_TRICK', at)
    }

    // 2. Games, wins and streaks. Tie-aware: a shared top score is a win for
    // everyone on it.
    const winners = new Set(g.winners || [])
    const names = [...new Set(players.map(p => p.name))].filter(Boolean)
    // A loser on a 5+ win streak: every winner here broke it.
    const streakEnded = names.some(n => !winners.has(n) && tallyOf(n).streak >= STREAK_TO_BREAK)
    for (const name of names) {
      const t = tallyOf(name)
      if (winners.has(name)) {
        if (streakEnded) earn(t, 'STREAK_BREAKER', at)
        if (g.tournamentFinal) earn(t, 'TOURNAMENT_WINNER', at)
      }
    }
    for (const name of names) {
      const t = tallyOf(name)
      for (const other of names) if (other !== name) t.people.add(other)
      if (t.people.size >= CLUB_REGULAR_PEOPLE) milestone(t, 'CLUB_REGULAR', at)
      t.games++
      if (winners.has(name)) {
        t.wins++
        t.streak++
        if (t.streak > t.maxStreak) t.maxStreak = t.streak
      } else {
        t.streak = 0
      }
      GAMES_MILESTONES.forEach(([n, code]) => { if (t.games >= n) milestone(t, code, at) })
      WINS_MILESTONES.forEach(([n, code]) => { if (t.wins >= n) milestone(t, code, at) })
      STREAK_MILESTONES.forEach(([n, code]) => { if (t.maxStreak >= n) milestone(t, code, at) })
    }
  }

  // 3. Season champions, in the order the seasons ended. A tie crowns each.
  const ended = seasons.filter(s => s?.ended_at).sort((a, b) => new Date(a.ended_at) - new Date(b.ended_at))
  for (const season of ended) {
    const champions = season.champion_names || String(season.champion_name || '').split(' & ').filter(Boolean)
    for (const name of champions) earn(tallyOf(name), 'SEASON_CHAMPION', season.ended_at)
  }

  const result = {}
  for (const [name, { games, wins, plusRounds, earned }] of perName) {
    result[name] = { games, wins, plusRounds, earned }
  }
  return result
}

/**
 * Lifetime achievements across every game.
 * @param {object[]} games  as achievementTimeline takes them, and its options
 * @returns {{ [name]: { [code]: count } }} only players with ≥1 achievement.
 *   Milestones count 1 when earned.
 */
export function lifetimeAchievements(games = [], options = {}) {
  const result = {}
  for (const [name, { earned }] of Object.entries(achievementTimeline(games, options))) {
    const codes = Object.keys(earned)
    if (!codes.length) continue
    result[name] = Object.fromEntries(codes.map((code) => [code, earned[code].count]))
  }
  return result
}
