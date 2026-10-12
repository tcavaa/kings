// Achievements — computed on-the-fly from existing players + roundDetails data.
//
// Nothing here is ever persisted: every badge is derived from the same
// `roundDetails` we already store per finished game, so achievements work
// retroactively for all historical games automatically.
//
// This online version of King keys everything by SEAT (0,1,2) rather than by
// a player id, and round records use different field names than the offline
// score-keeper app. The mapping used below:
//   gameType            ← round game-type code ('K','Q',…,'P3')
//   scores[seat]        ← that round's points per seat
//   leaderSeat          ← the seat that led the round
//   kingOfHeartsTakenBy ← seat that took K♥  (the 'single' target for 'K')
//   queens/jacks/heartsTaken[seat], tricksTaken[seat] ← per-seat unit counts
//   trickWinners[]      ← ordered winning seats (used to derive 'L2' counts)

import {
  Star, Gem, Shield, TrendingUp, Flame, Rocket,
  Sparkles, Gamepad2, Joystick, Crown, Sparkle, Sun, Medal,
  Trophy, Skull, Swords, Zap, CloudLightning, Award,
} from 'lucide-react-online'

// Each def carries a real Lucide `Icon` component (the project's icon system —
// no emoji) and a theme color, plus the label/desc/repeatable metadata.
export const ACHIEVEMENT_DEFS = {
  // ── Per-game (repeatable — show ×N if earned multiple times) ──────────────
  PERFECT_PLUS:           { Icon: Star,          color: '#8e6a1e', label: 'უნაკლო პლიუსი',      desc: 'პლიუს რაუნდში 10/10 აღება — ყველა შენ წაიღე',          repeatable: true  },
  PLUS_PERFECTIONIST:     { Icon: Gem,           color: '#0369a1', label: 'პლიუსის ოსტატი',     desc: '10/10 სამივე პლიუს რაუნდში ერთ თამაშში',               repeatable: true  },
  UNTOUCHABLE:            { Icon: Shield,        color: '#4c7a2f', label: 'ხელშეუხებელი',       desc: 'ყველა მინუს რაუნდი შენ დაიწყე და ერთი ჯარიმაც არ აიღე', repeatable: true  },
  NEVER_BELOW_ZERO:       { Icon: TrendingUp,    color: '#16803c', label: 'მუდამ პლიუსში',      desc: 'ანგარიში ნულს ქვემოთ არასდროს ჩავარდნილა',              repeatable: true  },
  UNDERDOG:               { Icon: Flame,         color: '#9c5a24', label: 'აუტსაიდერი',         desc: 'ყველაზე დიდხანს ბოლო ადგილზე იჯექი და მაინც მოიგე',    repeatable: true  },
  RUNAWAY_WIN:            { Icon: Rocket,        color: '#6b3151', label: 'გაქცეული',           desc: 'მეორე ადგილს 100+ ქულით გაუსწარი',                     repeatable: true  },

  // ── Lifetime milestones (earned once) ─────────────────────────────────────
  PERFECT_PLUS_HAT_TRICK: { Icon: Sparkles,      color: '#b45309', label: 'ჰეთ-ტრიკი პლიუსში',  desc: '10/10 პლიუს რაუნდში 3-ჯერ ან მეტჯერ (სულ)',            repeatable: false },
  GAMES_50:               { Icon: Gamepad2,      color: '#4a5568', label: 'ერთგული',            desc: 'ითამაშე 50 თამაში',                                    repeatable: false },
  GAMES_100:              { Icon: Joystick,      color: '#4a5568', label: 'ასეული',             desc: 'ითამაშე 100 თამაში',                                   repeatable: false },
  GAMES_150:              { Icon: Crown,         color: '#8e2b23', label: 'ლეგენდა',            desc: 'ითამაშე 150 თამაში',                                   repeatable: false },
  GAMES_250:              { Icon: Sparkle,       color: '#5b3d8f', label: 'ვეტერანი',           desc: 'ითამაშე 250 თამაში',                                   repeatable: false },
  GAMES_500:              { Icon: Sun,           color: '#a16207', label: 'ელიტა',              desc: 'ითამაშე 500 თამაში',                                   repeatable: false },
  GAMES_800:              { Icon: Medal,         color: '#8e6a1e', label: 'ოსტატი',             desc: 'ითამაშე 800 თამაში',                                   repeatable: false },
  GAMES_1000:             { Icon: Gem,           color: '#0e7490', label: 'დიდოსტატი',          desc: 'ითამაშე 1000 თამაში',                                  repeatable: false },
  WINS_10:                { Icon: Medal,         color: '#9c5a24', label: '10 მოგება',          desc: 'მოიგე 10 თამაში',                                      repeatable: false },
  WINS_25:                { Icon: Medal,         color: '#4a5568', label: '25 მოგება',          desc: 'მოიგე 25 თამაში',                                      repeatable: false },
  WINS_50:                { Icon: Medal,         color: '#8e2b23', label: '50 მოგება',          desc: 'მოიგე 50 თამაში',                                      repeatable: false },
  WINS_250:               { Icon: Trophy,        color: '#b45309', label: '250 მოგება',         desc: 'მოიგე 250 თამაში',                                     repeatable: false },
  WINS_500:               { Icon: Skull,         color: '#a5372b', label: '500 მოგება',         desc: 'მოიგე 500 თამაში',                                     repeatable: false },
  WINS_1000:              { Icon: Swords,        color: '#dc2626', label: '1000 მოგება',        desc: 'მოიგე 1000 თამაში',                                    repeatable: false },
  WIN_STREAK_3:           { Icon: Zap,           color: '#8e6a1e', label: '3 ზედიზედ',          desc: 'ზედიზედ 3 თამაში მოიგე',                               repeatable: false },
  WIN_STREAK_5:           { Icon: CloudLightning,color: '#4d7c0f', label: '5 ზედიზედ',          desc: 'ზედიზედ 5 თამაში მოიგე',                               repeatable: false },
  WIN_STREAK_10:          { Icon: Award,         color: '#b45309', label: '10 ზედიზედ',         desc: 'ზედიზედ 10 თამაში მოიგე',                              repeatable: false },
}

const NEGATIVE_CODES = new Set(['K', 'Q', 'J', 'H', 'L2', 'T'])
const PLUS_CODES = ['P1', 'P2', 'P3']
const SINGLE_CODES = new Set(['K']) // one player is the target; the rest score 0

// Order milestones are checked in (highest unlocked still gets set; they don't
// stack so value is always 1).
const GAMES_MILESTONES  = [[50, 'GAMES_50'], [100, 'GAMES_100'], [150, 'GAMES_150'], [250, 'GAMES_250'], [500, 'GAMES_500'], [800, 'GAMES_800'], [1000, 'GAMES_1000']]
const WINS_MILESTONES   = [[10, 'WINS_10'], [25, 'WINS_25'], [50, 'WINS_50'], [250, 'WINS_250'], [500, 'WINS_500'], [1000, 'WINS_1000']]
const STREAK_MILESTONES = [[3, 'WIN_STREAK_3'], [5, 'WIN_STREAK_5'], [10, 'WIN_STREAK_10']]

/**
 * The per-seat "unit count" relevant to a round's metric, or `null` when it
 * cannot be derived from the round record (treated as bad data → caller skips).
 *   Q→queens, J→jacks, H→hearts, T/P*→tricks, L2→last-two trick winners.
 * 'K' is a 'single' round and has no count metric (use kingOfHeartsTakenBy).
 */
function unitCounts(round) {
  const code = round.gameType
  if (code === 'Q') return round.queensTaken || null
  if (code === 'J') return round.jacksTaken || null
  if (code === 'H') return round.heartsTaken || null
  if (code === 'T' || PLUS_CODES.includes(code)) return round.tricksTaken || null
  if (code === 'L2') {
    const tw = round.trickWinners
    if (!Array.isArray(tw) || tw.length < 2) return null
    const counts = {}
    tw.slice(-2).forEach(s => { counts[s] = (counts[s] ?? 0) + 1 })
    return counts
  }
  return null
}

/**
 * Per-game achievements for ONE game.
 * @param {{seat:number,name?:string}[]} players
 * @param {object[]} rounds  roundDetails records
 * @returns {{ [seat:number]: string[] }} achievement codes per seat.
 *   PERFECT_PLUS appears once per 10/10 Plus round (up to 3 times).
 */
export function computePerGameAchievements(players, rounds) {
  const result = {}
  if (!players || !players.length || !rounds || !rounds.length) return result

  const seats = players.map(p => p.seat)

  const running = {}
  const lastPlaceCount = {}
  const neverBelow = {}
  const plusPerfect = {}
  const negLed = {}
  seats.forEach(s => {
    running[s] = 0
    lastPlaceCount[s] = 0
    neverBelow[s] = true
    plusPerfect[s] = { P1: false, P2: false, P3: false }
    negLed[s] = { led: 0, clean: 0 }
    result[s] = []
  })

  rounds.forEach(r => {
    // 1. Accumulate running totals; track whether anyone dipped below zero.
    seats.forEach(s => {
      running[s] += r.scores?.[s] ?? 0
      if (running[s] < 0) neverBelow[s] = false
    })

    // 2. Rounds spent in (tied) last place.
    const min = Math.min(...seats.map(s => running[s]))
    seats.forEach(s => { if (running[s] === min) lastPlaceCount[s]++ })

    // 3. Plus-round perfection.
    if (PLUS_CODES.includes(r.gameType)) {
      const counts = unitCounts(r)
      if (counts) {
        seats.forEach(s => {
          if (counts[s] === 10) {
            plusPerfect[s][r.gameType] = true
            result[s].push('PERFECT_PLUS')
          }
        })
      }
    }

    // 4. Negative-round leadership cleanliness (for UNTOUCHABLE).
    if (NEGATIVE_CODES.has(r.gameType)) {
      const leader = r.leaderSeat
      if (leader != null && negLed[leader]) {
        if (SINGLE_CODES.has(r.gameType)) {
          const target = r.kingOfHeartsTakenBy
          if (target != null) {                 // null ⇒ bad data, skip round
            negLed[leader].led++
            if (target !== leader) negLed[leader].clean++
          }
        } else {
          const counts = unitCounts(r)
          if (counts != null) {                  // null ⇒ bad data, skip round
            negLed[leader].led++
            if ((counts[leader] ?? 0) === 0) negLed[leader].clean++
          }
        }
      }
    }
  })

  // Final scores & winners (a tie on the top score crowns several seats).
  const finalScores = {}
  seats.forEach(s => { finalScores[s] = running[s] })
  const bestScore = Math.max(...seats.map(s => finalScores[s]))
  const winnerSeats = seats.filter(s => finalScores[s] === bestScore)

  seats.forEach(s => {
    if (plusPerfect[s].P1 && plusPerfect[s].P2 && plusPerfect[s].P3) result[s].push('PLUS_PERFECTIONIST')
    // Exactly 6 — every negative type was led AND every one of them was clean.
    if (negLed[s].led === 6 && negLed[s].clean === 6) result[s].push('UNTOUCHABLE')
    if (neverBelow[s]) result[s].push('NEVER_BELOW_ZERO')
  })

  // UNDERDOG — a winner who spent strictly more rounds in last place than
  // every non-winner. Checked per tied winner.
  for (const winner of winnerSeats) {
    const others = seats.filter(s => !winnerSeats.includes(s))
    const maxOtherLast = others.length ? Math.max(...others.map(s => lastPlaceCount[s])) : 0
    if (others.length && lastPlaceCount[winner] > maxOtherLast) result[winner].push('UNDERDOG')
  }

  // RUNAWAY_WIN — 100+ point margin over 2nd place. Impossible on a tie
  // (the margin between tied winners is 0), so only a sole winner earns it.
  const sorted = seats.slice().sort((a, b) => finalScores[b] - finalScores[a])
  if (winnerSeats.length === 1 && sorted.length >= 2 &&
      finalScores[sorted[0]] - finalScores[sorted[1]] >= 100) {
    result[winnerSeats[0]].push('RUNAWAY_WIN')
  }

  return result
}

/**
 * Lifetime achievements across every stored game.
 * @param {object[]} games  records from listGames() — each has
 *   { playedAt, winner:{name}, players:[{seat,name}], roundDetails:[…] }
 * @returns {{ [playerName:string]: { [code:string]: count } }}
 *   Only players with ≥1 achievement are included.
 */
export function computeAllLifetimeAchievements(games = []) {
  const perName = {} // name -> { code: count } (repeatable per-game counts)
  const bump = (name, code) => {
    if (!perName[name]) perName[name] = {}
    perName[name][code] = (perName[name][code] || 0) + 1
  }

  // 1. Accumulate repeatable per-game achievements.
  for (const g of games) {
    const players = g.players || []
    const rounds = g.roundDetails || []
    if (!players.length || !rounds.length) continue
    const perSeat = computePerGameAchievements(players, rounds)
    const seatName = {}
    players.forEach(p => { seatName[p.seat] = p.name })
    for (const seat of Object.keys(perSeat)) {
      const name = seatName[seat]
      if (!name) continue
      perSeat[seat].forEach(code => bump(name, code))
    }
  }

  // 2. Milestones per unique player name.
  const names = new Set()
  games.forEach(g => (g.players || []).forEach(p => names.add(p.name)))

  const result = {}
  for (const name of names) {
    const r = { ...(perName[name] || {}) }

    if ((r.PERFECT_PLUS || 0) >= 3) r.PERFECT_PLUS_HAT_TRICK = 1

    // Chronological games this player participated in.
    const mine = games
      .filter(g => (g.players || []).some(p => p.name === name))
      .slice()
      .sort((a, b) => new Date(a.playedAt) - new Date(b.playedAt))

    const gamesPlayed = mine.length
    let wins = 0
    let streak = 0
    let maxStreak = 0
    for (const g of mine) {
      // Tie-aware: shared top scores count as wins for everyone involved.
      const winnerNames = Array.isArray(g.winners) && g.winners.length
        ? g.winners.map(w => w?.name)
        : [g.winner?.name]
      if (winnerNames.includes(name)) {
        wins++
        streak++
        if (streak > maxStreak) maxStreak = streak
      } else {
        streak = 0
      }
    }

    GAMES_MILESTONES.forEach(([n, code]) => { if (gamesPlayed >= n) r[code] = 1 })
    WINS_MILESTONES.forEach(([n, code]) => { if (wins >= n) r[code] = 1 })
    STREAK_MILESTONES.forEach(([n, code]) => { if (maxStreak >= n) r[code] = 1 })

    if (Object.keys(r).length) result[name] = r
  }
  return result
}

/** Turn a flat codes array into a { [code]: count } map (deduped with counts). */
export function countCodes(codes = []) {
  const out = {}
  codes.forEach(c => { out[c] = (out[c] || 0) + 1 })
  return out
}
