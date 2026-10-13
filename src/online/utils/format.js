// Number formatting shared by the leaderboard panels.

/** "+12", "-4", "0". */
export const signed = (n) => `${Number(n) > 0 ? '+' : ''}${n}`

/** Wins as a whole percentage of games played (0 with no games). */
export const winRate = (p) => (p?.gamesPlayed ? Math.round((p.wins / p.gamesPlayed) * 100) : 0)

/** Average score per game, to one decimal (the season table and profiles). */
export const averageScore = (p) =>
  p?.gamesPlayed ? Math.round((p.totalScore / p.gamesPlayed) * 10) / 10 : 0
