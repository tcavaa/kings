export const GAME_TYPES = [
  { code: 'K', label: 'K — No King of hearts', kind: 'single', points: -40, totalUnits: 1 },
  { code: 'Q', label: 'Q — No Queens', kind: 'count', pointsPerUnit: -10, totalUnits: 4, unitLabel: 'Queens' },
  { code: 'J', label: 'J — No Jacks', kind: 'count', pointsPerUnit: -10, totalUnits: 4, unitLabel: 'Jacks' },
  { code: 'H', label: '<3 — No Hearts', kind: 'count', pointsPerUnit: -5, totalUnits: 8, unitLabel: 'Hearts' },
  { code: 'L2', label: 'L2 — No Last 2', kind: 'count', pointsPerUnit: -20, totalUnits: 2, unitLabel: 'Last 2' },
  { code: 'T', label: '- — No Tricks', kind: 'count', pointsPerUnit: -4, totalUnits: 10, unitLabel: 'Tricks' },
  { code: 'P1', label: '+ — Pluses (1)', kind: 'count', pointsPerUnit: 8, totalUnits: 10, unitLabel: 'Tricks' },
  { code: 'P2', label: '+ — Pluses (2)', kind: 'count', pointsPerUnit: 8, totalUnits: 10, unitLabel: 'Tricks' },
  { code: 'P3', label: '+ — Pluses (3)', kind: 'count', pointsPerUnit: 8, totalUnits: 10, unitLabel: 'Tricks' },
]


