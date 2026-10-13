import { roundScores } from '../../../server/game/gameTypes.js'

/** A round's points per player id — the same rule the server checks saved games against. */
export function computeScoresForRound(type, players, countsByPlayerId, singleTargetPlayerId) {
  if (!type) return {}
  return roundScores(type.code, players.map(p => p.id), {
    counts: countsByPlayerId,
    target: singleTargetPlayerId,
  })
}
