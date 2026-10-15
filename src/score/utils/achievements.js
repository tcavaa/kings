// Achievements in ჩაწერა: the labels, icons and colours. The rules are
// shared with King Online (shared/achievements.js); this file only turns
// ჩაწერა's rows (keyed by player id) into the shape they read.

import {
  Star, Gem, Shield, TrendingUp, Flame, Rocket, Wand2,
  Gamepad2, Joystick, Crown, Sparkle, Stars, Medal, Diamond,
  Trophy, Ghost, Swords, Zap, CloudLightning,
  Handshake, RotateCcw, Flag, Hourglass, Camera, ShieldCheck, Magnet, Bomb,
  TrendingDown, Hammer, Users,
} from 'lucide-react'
import {
  defineAchievements,
  perGameAchievements,
  lifetimeAchievements,
} from '../../../shared/achievements.js'
import { winnerNamesOf } from './winners.js'

export { countCodes } from '../../../shared/achievements.js'

// `Icon` is a lucide-react component; `color` tints it wherever it renders.
export const ACHIEVEMENT_DEFS = defineAchievements({
  PERFECT_PLUS:          { Icon: Star,           color: '#eab308', label: 'უნაკლო პლიუსი',      desc: 'პლიუს რაუნდში 10/10 აღება' },
  PLUS_PERFECTIONIST:    { Icon: Gem,            color: '#06b6d4', label: 'პლიუსის ოსტატი',     desc: '10/10 სამივე პლიუს რაუნდში ერთ თამაშში' },
  UNTOUCHABLE:           { Icon: Shield,         color: '#2563eb', label: 'ხელშეუხებელი',       desc: 'ყველა მინუს რაუნდი შენ დაიწყე და ერთი ჯარიმაც არ აიღე' },
  NEVER_BELOW_ZERO:      { Icon: TrendingUp,     color: '#059669', label: 'მუდამ პლიუსში',      desc: 'ანგარიში ნულს ქვემოთ არასდროს ჩავარდნილა' },
  UNDERDOG:              { Icon: Flame,          color: '#ea580c', label: 'აუტსაიდერი',         desc: 'ყველაზე დიდხანს ბოლო ადგილზე იყავი და მაინც მოიგე' },
  RUNAWAY_WIN:           { Icon: Rocket,         color: '#7c3aed', label: 'გაქცეული',           desc: 'მეორე ადგილს 100+ ქულით გაუსწარი' },
  SHARED_WIN:            { Icon: Handshake,      color: '#0f766e', label: 'ფრე',                desc: 'მოგება გაიყავი — თამაში ქულებით თანაბრად დაასრულეთ' },
  COMEBACK:              { Icon: RotateCcw,      color: '#c2410c', label: 'დაბრუნება',          desc: 'ლიდერს 175+ ქულით ჩამორჩებოდი და მაინც მოიგე' },
  WIRE_TO_WIRE:          { Icon: Flag,           color: '#16a34a', label: 'თავიდან ბოლომდე',    desc: 'ყოველი რაუნდის შემდეგ მარტო იყავი პირველი და მოიგე' },
  LAST_ROUND_STEAL:      { Icon: Hourglass,      color: '#b45309', label: 'ბოლო წუთის ქურდი',   desc: 'ბოლო რაუნდამდე არ ლიდერობდი, მაგრამ მოიგე' },
  PHOTO_FINISH:          { Icon: Camera,         color: '#2563eb', label: 'ფოტოფინიში',         desc: 'მოიგე 8 ან ნაკლები ქულის სხვაობით' },
  CLEAN_SHEET:           { Icon: ShieldCheck,    color: '#15803d', label: 'სუფთა ფურცელი',      desc: 'მთელი თამაში ერთი ჯარიმის ქულის გარეშე' },
  KING_MAGNET:           { Icon: Magnet,         color: '#dc2626', label: 'მეფის მაგნიტი',      desc: 'თამაშის ყველა კინგის რაუნდში გულის მეფე შენ აიღე' },
  DISASTER:              { Icon: Bomb,           color: '#52525b', label: 'კატასტროფა',         desc: 'თამაში −200 ან ნაკლები ქულით დაასრულე' },
  UGLY_WIN:              { Icon: TrendingDown,   color: '#a16207', label: 'მინუსში მოგება',     desc: 'მოიგე უარყოფითი ქულით' },
  STREAK_BREAKER:        { Icon: Hammer,         color: '#78716c', label: 'სერიის გამწყვეტი',   desc: 'მოიგე თამაში, რომელმაც ვინმეს 5+ მოგების სერია გაწყვიტა' },
  TOURNAMENT_WINNER:     { Icon: Trophy,         color: '#ca8a04', label: 'ტურნირის ჩემპიონი',  desc: 'მოიგე ტურნირის ფინალი' },
  SEASON_CHAMPION:       { Icon: Crown,          color: '#d4a017', label: 'სეზონის ჩემპიონი',   desc: 'სეზონი პირველ ადგილზე დაასრულე' },
  PERFECT_PLUS_HAT_TRICK:{ Icon: Wand2,          color: '#d946ef', label: 'ჰეთ-ტრიკი პლიუსში',  desc: '10/10 პლიუს რაუნდში 3-ჯერ ან მეტჯერ (სულ)' },
  GAMES_50:              { Icon: Gamepad2,       color: '#64748b', label: 'ერთგული',            desc: 'ითამაშე 50 თამაში' },
  GAMES_100:             { Icon: Joystick,       color: '#0891b2', label: 'ასეული',             desc: 'ითამაშე 100 თამაში' },
  GAMES_150:             { Icon: Crown,          color: '#b45309', label: 'ლეგენდა',            desc: 'ითამაშე 150 თამაში' },
  GAMES_250:             { Icon: Sparkle,        color: '#0ea5e9', label: 'ვეტერანი',           desc: 'ითამაშე 250 თამაში' },
  GAMES_500:             { Icon: Stars,          color: '#eab308', label: 'ელიტა',              desc: 'ითამაშე 500 თამაში' },
  GAMES_800:             { Icon: Medal,          color: '#b8860b', label: 'ოსტატი',             desc: 'ითამაშე 800 თამაში' },
  GAMES_1000:            { Icon: Diamond,        color: '#7c3aed', label: 'დიდოსტატი',          desc: 'ითამაშე 1000 თამაში' },
  WINS_10:               { Icon: Medal,          color: '#a0642d', label: '10 მოგება',          desc: 'მოიგე 10 თამაში' },
  WINS_25:               { Icon: Medal,          color: '#8c8f96', label: '25 მოგება',          desc: 'მოიგე 25 თამაში' },
  WINS_50:               { Icon: Medal,          color: '#d4a017', label: '50 მოგება',          desc: 'მოიგე 50 თამაში' },
  WINS_250:              { Icon: Trophy,         color: '#d4a017', label: '250 მოგება',         desc: 'მოიგე 250 თამაში' },
  WINS_500:              { Icon: Ghost,          color: '#dc2626', label: '500 მოგება',         desc: 'მოიგე 500 თამაში' },
  WINS_1000:             { Icon: Swords,         color: '#b91c1c', label: '1000 მოგება',        desc: 'მოიგე 1000 თამაში' },
  WIN_STREAK_3:          { Icon: Zap,            color: '#eab308', label: '3 ზედიზედ',          desc: 'ზედიზედ 3 თამაში მოიგე' },
  WIN_STREAK_5:          { Icon: CloudLightning, color: '#0ea5e9', label: '5 ზედიზედ',          desc: 'ზედიზედ 5 თამაში მოიგე' },
  WIN_STREAK_10:         { Icon: Flame,          color: '#dc2626', label: '10 ზედიზედ',         desc: 'ზედიზედ 10 თამაში მოიგე' },
  CLUB_REGULAR:          { Icon: Users,          color: '#0891b2', label: 'კლუბის სული',        desc: 'ითამაშე 10 სხვადასხვა ადამიანთან' },
})

/** A ჩაწერა round in the shared rules' shape. */
const toRound = (r) => ({
  code: r.gameTypeCode,
  leader: r.leaderPlayerId,
  scores: r.scores,
  counts: r.countsByPlayerId,
  target: r.singleTargetPlayerId,
})

/**
 * Per-game achievements for all players in a single game.
 * Returns { [playerId]: string[] } — PERFECT_PLUS appears once per 10/10 round earned.
 */
export function computePerGameAchievements(players, rounds) {
  return perGameAchievements((players || []).map(p => p.id), (rounds || []).map(toRound))
}

/**
 * Lifetime achievement counts for all players across all games: the
 * result rows say who played and won, the detail rows hold the rounds, and
 * the seasons crown their champions.
 * Returns { [playerName]: { [code]: count } }; milestones count 1.
 */
export function computeAllLifetimeAchievements(allGameDetails, allResults, { seasons } = {}) {
  const detailById = new Map((allGameDetails || []).map(d => [d.game_result_id, d]))
  return lifetimeAchievements((allResults || []).map(r => {
    const detail = detailById.get(r.id)
    return {
      playedAt: r.played_at,
      players: detail?.players
        ? detail.players.map(p => ({ key: p.id, name: p.name }))
        : (r.participants || []).map(p => ({ key: p.name, name: p.name })),
      winners: winnerNamesOf(r),
      rounds: detail?.rounds ? detail.rounds.map(toRound) : [],
      tournamentFinal: !!r.tournamentFinal,
    }
  }), { seasons })
}
