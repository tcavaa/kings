// Achievements in ჩაწერა: the English labels, icons and colours. The rules
// are shared with King Online (shared/achievements.js); this file only turns
// ჩაწერა's rows (keyed by player id) into the shape they read.

import {
  Star, Gem, Shield, TrendingUp, Flame, Rocket, Wand2,
  Gamepad2, Joystick, Crown, Sparkle, Stars, Medal, Diamond,
  Trophy, Ghost, Swords, Zap, CloudLightning,
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
  PERFECT_PLUS:          { Icon: Star,           color: '#eab308', label: 'Perfect Plus',       desc: '10/10 tricks in a Plus round' },
  PLUS_PERFECTIONIST:    { Icon: Gem,            color: '#06b6d4', label: 'Plus Perfectionist', desc: '10/10 in all 3 Plus rounds in one game' },
  UNTOUCHABLE:           { Icon: Shield,         color: '#2563eb', label: 'Untouchable',        desc: 'Led every negative round without taking any penalty' },
  NEVER_BELOW_ZERO:      { Icon: TrendingUp,     color: '#059669', label: 'In the Green',       desc: 'Score never dropped below zero' },
  UNDERDOG:              { Icon: Flame,          color: '#ea580c', label: 'Underdog',           desc: 'Won despite being in last place the longest' },
  RUNAWAY_WIN:           { Icon: Rocket,         color: '#7c3aed', label: 'Runaway',            desc: 'Won with 100+ point margin over 2nd place' },
  PERFECT_PLUS_HAT_TRICK:{ Icon: Wand2,          color: '#d946ef', label: 'Hat Trick Plus',     desc: '10/10 in a Plus round 3+ times (lifetime)' },
  GAMES_50:              { Icon: Gamepad2,       color: '#64748b', label: 'Dedicated',          desc: 'Played 50 games' },
  GAMES_100:             { Icon: Joystick,       color: '#0891b2', label: 'Century',            desc: 'Played 100 games' },
  GAMES_150:             { Icon: Crown,          color: '#b45309', label: 'Legend',             desc: 'Played 150 games' },
  GAMES_250:             { Icon: Sparkle,        color: '#0ea5e9', label: 'Veteran',            desc: 'Played 250 games' },
  GAMES_500:             { Icon: Stars,          color: '#eab308', label: 'Elite',              desc: 'Played 500 games' },
  GAMES_800:             { Icon: Medal,          color: '#b8860b', label: 'Master',             desc: 'Played 800 games' },
  GAMES_1000:            { Icon: Diamond,        color: '#7c3aed', label: 'Grandmaster',        desc: 'Played 1000 games' },
  WINS_10:               { Icon: Medal,          color: '#a0642d', label: '10 Wins',            desc: 'Won 10 games' },
  WINS_25:               { Icon: Medal,          color: '#8c8f96', label: '25 Wins',            desc: 'Won 25 games' },
  WINS_50:               { Icon: Medal,          color: '#d4a017', label: '50 Wins',            desc: 'Won 50 games' },
  WINS_250:              { Icon: Trophy,         color: '#d4a017', label: '250 Wins',           desc: 'Won 250 games' },
  WINS_500:              { Icon: Ghost,          color: '#dc2626', label: '500 Wins',           desc: 'Won 500 games' },
  WINS_1000:             { Icon: Swords,         color: '#b91c1c', label: '1000 Wins',          desc: 'Won 1000 games' },
  WIN_STREAK_3:          { Icon: Zap,            color: '#eab308', label: '3 in a Row',         desc: 'Won 3 consecutive games' },
  WIN_STREAK_5:          { Icon: CloudLightning, color: '#0ea5e9', label: '5 in a Row',         desc: 'Won 5 consecutive games' },
  WIN_STREAK_10:         { Icon: Flame,          color: '#dc2626', label: '10 in a Row',        desc: 'Won 10 consecutive games' },
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
 * result rows say who played and won, the detail rows hold the rounds.
 * Returns { [playerName]: { [code]: count } }; milestones count 1.
 */
export function computeAllLifetimeAchievements(allGameDetails, allResults) {
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
    }
  }))
}
