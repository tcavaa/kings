// Achievements in King Online: the Georgian labels, icons and colours. The
// rules are shared with ჩაწერა (shared/achievements.js); this file only
// turns King Online's game records into the shape they read.
//
// King Online keys everything by SEAT (0,1,2). Round records map as:
//   code    ← gameType ('K','Q',…,'P3')
//   leader  ← leaderSeat
//   counts  ← the round's own unit field (queens in Q, …, the last two trick
//             winners in L2) — see unitCountsOf in server/game/gameTypes.js
//   target  ← kingOfHeartsTakenBy (K)

import {
  Star, Gem, Shield, TrendingUp, Flame, Rocket,
  Sparkles, Gamepad2, Joystick, Crown, Sparkle, Sun, Medal,
  Trophy, Skull, Swords, Zap, CloudLightning, Award,
} from 'lucide-react'
import { unitCountsOf } from '../../../server/game/gameTypes.js'
import { winnerNames } from '../../../server/games/results.js'
import {
  defineAchievements,
  perGameAchievements,
  lifetimeAchievements,
  achievementTimeline,
} from '../../../shared/achievements.js'

export { countCodes } from '../../../shared/achievements.js'

// Each def carries a real Lucide `Icon` component (the project's icon system —
// no emoji) and a theme color, plus the label/desc.
export const ACHIEVEMENT_DEFS = defineAchievements({
  // ── Per-game (repeatable — show ×N if earned multiple times) ──────────────
  PERFECT_PLUS:           { Icon: Star,          color: '#8e6a1e', label: 'უნაკლო პლიუსი',      desc: 'პლიუს რაუნდში 10/10 აღება — ყველა შენ წაიღე' },
  PLUS_PERFECTIONIST:     { Icon: Gem,           color: '#0369a1', label: 'პლიუსის ოსტატი',     desc: '10/10 სამივე პლიუს რაუნდში ერთ თამაშში' },
  UNTOUCHABLE:            { Icon: Shield,        color: '#4c7a2f', label: 'ხელშეუხებელი',       desc: 'ყველა მინუს რაუნდი შენ დაიწყე და ერთი ჯარიმაც არ აიღე' },
  NEVER_BELOW_ZERO:       { Icon: TrendingUp,    color: '#16803c', label: 'მუდამ პლიუსში',      desc: 'ანგარიში ნულს ქვემოთ არასდროს ჩავარდნილა' },
  UNDERDOG:               { Icon: Flame,         color: '#9c5a24', label: 'აუტსაიდერი',         desc: 'ყველაზე დიდხანს ბოლო ადგილზე იჯექი და მაინც მოიგე' },
  RUNAWAY_WIN:            { Icon: Rocket,        color: '#6b3151', label: 'გაქცეული',           desc: 'მეორე ადგილს 100+ ქულით გაუსწარი' },

  // ── Lifetime milestones (earned once) ─────────────────────────────────────
  PERFECT_PLUS_HAT_TRICK: { Icon: Sparkles,      color: '#b45309', label: 'ჰეთ-ტრიკი პლიუსში',  desc: '10/10 პლიუს რაუნდში 3-ჯერ ან მეტჯერ (სულ)' },
  GAMES_50:               { Icon: Gamepad2,      color: '#4a5568', label: 'ერთგული',            desc: 'ითამაშე 50 თამაში' },
  GAMES_100:              { Icon: Joystick,      color: '#4a5568', label: 'ასეული',             desc: 'ითამაშე 100 თამაში' },
  GAMES_150:              { Icon: Crown,         color: '#8e2b23', label: 'ლეგენდა',            desc: 'ითამაშე 150 თამაში' },
  GAMES_250:              { Icon: Sparkle,       color: '#5b3d8f', label: 'ვეტერანი',           desc: 'ითამაშე 250 თამაში' },
  GAMES_500:              { Icon: Sun,           color: '#a16207', label: 'ელიტა',              desc: 'ითამაშე 500 თამაში' },
  GAMES_800:              { Icon: Medal,         color: '#8e6a1e', label: 'ოსტატი',             desc: 'ითამაშე 800 თამაში' },
  GAMES_1000:             { Icon: Gem,           color: '#0e7490', label: 'დიდოსტატი',          desc: 'ითამაშე 1000 თამაში' },
  WINS_10:                { Icon: Medal,         color: '#9c5a24', label: '10 მოგება',          desc: 'მოიგე 10 თამაში' },
  WINS_25:                { Icon: Medal,         color: '#4a5568', label: '25 მოგება',          desc: 'მოიგე 25 თამაში' },
  WINS_50:                { Icon: Medal,         color: '#8e2b23', label: '50 მოგება',          desc: 'მოიგე 50 თამაში' },
  WINS_250:               { Icon: Trophy,        color: '#b45309', label: '250 მოგება',         desc: 'მოიგე 250 თამაში' },
  WINS_500:               { Icon: Skull,         color: '#a5372b', label: '500 მოგება',         desc: 'მოიგე 500 თამაში' },
  WINS_1000:              { Icon: Swords,        color: '#dc2626', label: '1000 მოგება',        desc: 'მოიგე 1000 თამაში' },
  WIN_STREAK_3:           { Icon: Zap,           color: '#8e6a1e', label: '3 ზედიზედ',          desc: 'ზედიზედ 3 თამაში მოიგე' },
  WIN_STREAK_5:           { Icon: CloudLightning,color: '#4d7c0f', label: '5 ზედიზედ',          desc: 'ზედიზედ 5 თამაში მოიგე' },
  WIN_STREAK_10:          { Icon: Award,         color: '#b45309', label: '10 ზედიზედ',         desc: 'ზედიზედ 10 თამაში მოიგე' },
})

/** A King Online round record in the shared rules' shape. */
const toRound = (r) => ({
  code: r.gameType,
  leader: r.leaderSeat,
  scores: r.scores,
  counts: unitCountsOf(r),
  target: r.kingOfHeartsTakenBy,
})

/**
 * Per-game achievements for ONE game.
 * @param {{seat:number,name?:string}[]} players
 * @param {object[]} rounds  roundDetails records
 * @returns {{ [seat:number]: string[] }} achievement codes per seat.
 */
export function computePerGameAchievements(players, rounds) {
  return perGameAchievements((players || []).map(p => p.seat), (rounds || []).map(toRound))
}

/**
 * Lifetime achievements across every stored game.
 * @param {object[]} games  records from listGames() — each has
 *   { playedAt, winners/winner, players:[{seat,name}], roundDetails:[…] }
 * @returns {{ [playerName:string]: { [code:string]: count } }}
 *   Only players with ≥1 achievement are included.
 */
export function computeAllLifetimeAchievements(games = []) {
  return lifetimeAchievements(games.map(toSharedGame))
}

const toSharedGame = (g) => ({
  playedAt: g.playedAt,
  players: (g.players || []).map(p => ({ key: p.seat, name: p.name })),
  winners: winnerNames(g),
  rounds: (g.roundDetails || []).map(toRound),
})

/** Rarity by the share of players holding a badge. */
export function rarityOf(share) {
  if (!share) return { id: 'unclaimed', label: 'ჯერ არავის' }
  if (share <= 0.1) return { id: 'legendary', label: 'ლეგენდარული' }
  if (share <= 0.25) return { id: 'epic', label: 'ეპიკური' }
  if (share <= 0.5) return { id: 'rare', label: 'იშვიათი' }
  return { id: 'common', label: 'ჩვეულებრივი' }
}

/**
 * The club's view of the collection, over the ranked players `names`:
 *  - `badges`: per achievement (display order) { code, holders, share,
 *    rarity, total, most, bestRate, first, latest }. holders are
 *    { name, count, rate, first, last }, most first; `rate` is the share of
 *    their games it came in (PERFECT_PLUS: of their Plus rounds), for
 *    repeatable badges only, and `bestRate` counts players with `minGames`+.
 *  - `collectors`: { name, unique, total }, most unique badges first.
 *  - `rarest`: the earned badge the fewest hold; `latest`: the newest unlock
 *    { code, name, at }; `total`: every badge won, repeats included.
 */
export function clubAchievementStats(games = [], names = [], { minGames = 10 } = {}) {
  const timeline = achievementTimeline(games.map(toSharedGame))
  const ranked = names.filter((n) => timeline[n])
  const time = (t) => new Date(t).getTime() || 0
  const badges = Object.values(ACHIEVEMENT_DEFS).map(({ id: code, repeatable }) => {
    const holders = ranked
      .filter((n) => timeline[n].earned[code])
      .map((n) => {
        const t = timeline[n]
        const e = t.earned[code]
        const chances = code === 'PERFECT_PLUS' ? t.plusRounds : t.games
        return {
          name: n,
          count: e.count,
          rate: repeatable && chances ? e.count / chances : null,
          games: t.games,
          first: e.first,
          last: e.last,
        }
      })
      .sort((a, b) => b.count - a.count || time(a.first) - time(b.first))
    const share = ranked.length ? holders.length / ranked.length : 0
    const byTime = [...holders].sort((a, b) => time(a.first) - time(b.first))
    const rated = holders.filter((h) => h.rate != null && h.games >= minGames)
    return {
      code,
      repeatable,
      holders,
      share,
      rarity: rarityOf(share),
      total: holders.reduce((s, h) => s + h.count, 0),
      most: repeatable ? holders[0] || null : null,
      bestRate: rated.sort((a, b) => b.rate - a.rate)[0] || null,
      first: byTime[0] || null,
      latest: [...holders].sort((a, b) => time(b.last) - time(a.last))[0] || null,
    }
  })
  const collectors = ranked
    .map((name) => {
      const earned = Object.values(timeline[name].earned)
      return { name, unique: earned.length, total: earned.reduce((s, e) => s + e.count, 0) }
    })
    .sort((a, b) => b.unique - a.unique || b.total - a.total || a.name.localeCompare(b.name))
  const earned = badges.filter((b) => b.holders.length)
  const rarest = earned.length
    ? earned.reduce((m, b) => (b.holders.length < m.holders.length ? b : m))
    : null
  let latest = null
  for (const b of badges) {
    for (const h of b.holders) {
      if (!latest || time(h.last) > time(latest.at)) latest = { code: b.code, name: h.name, at: h.last }
    }
  }
  return { badges, collectors, rarest, latest, total: badges.reduce((s, b) => s + b.total, 0) }
}
