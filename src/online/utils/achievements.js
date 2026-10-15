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
  Handshake, RotateCcw, Flag, Hourglass, Camera, ShieldCheck, Magnet, Bomb,
  TrendingDown, Hammer, Users,
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
  SHARED_WIN:             { Icon: Handshake,     color: '#0f766e', label: 'ფრე',                desc: 'მოგება გაიყავი — თამაში ქულებით თანაბრად დაასრულეთ' },
  COMEBACK:               { Icon: RotateCcw,     color: '#9a3412', label: 'დაბრუნება',          desc: 'ლიდერს 175+ ქულით ჩამორჩებოდი და მაინც მოიგე' },
  WIRE_TO_WIRE:           { Icon: Flag,          color: '#166534', label: 'თავიდან ბოლომდე',    desc: 'ყოველი რაუნდის შემდეგ მარტო იყავი პირველი და მოიგე' },
  LAST_ROUND_STEAL:       { Icon: Hourglass,     color: '#7c2d12', label: 'ბოლო წუთის ქურდი',   desc: 'ბოლო რაუნდამდე არ ლიდერობდი, მაგრამ მოიგე' },
  PHOTO_FINISH:           { Icon: Camera,        color: '#1e40af', label: 'ფოტოფინიში',         desc: 'მოიგე 8 ან ნაკლები ქულის სხვაობით' },
  CLEAN_SHEET:            { Icon: ShieldCheck,   color: '#15803d', label: 'სუფთა ფურცელი',      desc: 'მთელი თამაში ერთი ჯარიმის ქულის გარეშე' },
  KING_MAGNET:            { Icon: Magnet,        color: '#b91c1c', label: 'მეფის მაგნიტი',      desc: 'თამაშის ყველა კინგის რაუნდში გულის მეფე შენ აიღე' },
  DISASTER:               { Icon: Bomb,          color: '#3f3f46', label: 'კატასტროფა',         desc: 'თამაში −200 ან ნაკლები ქულით დაასრულე' },
  UGLY_WIN:               { Icon: TrendingDown,  color: '#854d0e', label: 'მინუსში მოგება',     desc: 'მოიგე უარყოფითი ქულით' },
  STREAK_BREAKER:         { Icon: Hammer,        color: '#57534e', label: 'სერიის გამწყვეტი',   desc: 'მოიგე თამაში, რომელმაც ვინმეს 5+ მოგების სერია გაწყვიტა' },
  TOURNAMENT_WINNER:      { Icon: Trophy,        color: '#a16207', label: 'ტურნირის ჩემპიონი',  desc: 'მოიგე ტურნირის ფინალი' },
  SEASON_CHAMPION:        { Icon: Crown,         color: '#b45309', label: 'სეზონის ჩემპიონი',   desc: 'სეზონი პირველ ადგილზე დაასრულე' },

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
  CLUB_REGULAR:           { Icon: Users,         color: '#0e7490', label: 'კლუბის სული',        desc: 'ითამაშე 10 სხვადასხვა ადამიანთან' },
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
 * @param {{ seasons?: object[] }} options  the API's seasons, for SEASON_CHAMPION
 * @returns {{ [playerName:string]: { [code:string]: count } }}
 *   Only players with ≥1 achievement are included.
 */
export function computeAllLifetimeAchievements(games = [], { seasons } = {}) {
  return lifetimeAchievements(games.map(toSharedGame), { seasons })
}

const toSharedGame = (g) => ({
  playedAt: g.playedAt,
  players: (g.players || []).map(p => ({ key: p.seat, name: p.name })),
  winners: winnerNames(g),
  rounds: (g.roundDetails || []).map(toRound),
  tournamentFinal: g.tournamentStage === 'final',
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
 *  - `badges`: per achievement (display order) { code, perGame, holders,
 *    share, rarity, total, most, bestRate, first, latest }. holders are
 *    { name, count, rate, first, last }, most first; `rate` is the share of
 *    their games it came in (PERFECT_PLUS: of their Plus rounds), for
 *    per-game badges only, and `bestRate` counts players with `minGames`+.
 *    `seasons` (the API's) crown the season champions.
 *  - `collectors`: { name, unique, total }, most unique badges first.
 *  - `rarest`: the earned badge the fewest hold; `latest`: the newest unlock
 *    { code, name, at }; `total`: every badge won, repeats included.
 */
export function clubAchievementStats(games = [], names = [], { minGames = 10, seasons } = {}) {
  const timeline = achievementTimeline(games.map(toSharedGame), { seasons })
  const ranked = names.filter((n) => timeline[n])
  const time = (t) => new Date(t).getTime() || 0
  const badges = Object.values(ACHIEVEMENT_DEFS).map(({ id: code, repeatable, perGame }) => {
    const holders = ranked
      .filter((n) => timeline[n].earned[code])
      .map((n) => {
        const t = timeline[n]
        const e = t.earned[code]
        const chances = code === 'PERFECT_PLUS' ? t.plusRounds : t.games
        return {
          name: n,
          count: e.count,
          // Per-game badges only: a season or a tournament isn't won per game.
          rate: perGame && chances ? e.count / chances : null,
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
      perGame,
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
