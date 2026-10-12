export function computeScoresForRound(type, players, countsByPlayerId, singleTargetPlayerId) {
  const scores = {}
  if (!type) return scores
  if (type.kind === 'count') {
    players.forEach((p) => {
      const units = Number((countsByPlayerId && countsByPlayerId[p.id]) || 0)
      scores[p.id] = units * (type.pointsPerUnit || 0)
    })
  } else if (type.kind === 'single') {
    players.forEach((p) => {
      scores[p.id] = p.id === singleTargetPlayerId ? type.points : 0
    })
  }
  return scores
}


