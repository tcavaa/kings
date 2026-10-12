import { useMemo } from 'react'
import { useGameData, gamesOfType } from '../lib/gameData'
import GlobalAnalyticsPage from './GlobalAnalyticsPage'
import TypeFilter, { useTypeFilter } from './TypeFilter'

/**
 * The "Stats" tab — Global Analytics for the CURRENT season, over the games
 * picked in the filter: all of them, King Online's league games, or the ones
 * recorded here. Casual online games never touch these numbers.
 */
export default function StatsPage({ currentSeasonStart, onBack }) {
  const { data, loading } = useGameData()
  const [type, setType] = useTypeFilter()

  const seasonStart = currentSeasonStart || new Date(0)
  const { results, details } = useMemo(() => {
    const games = gamesOfType(data, type)
    return {
      results: games.results.filter(r => new Date(r.played_at) > seasonStart),
      details: games.details.filter(d => new Date(d.played_at) > seasonStart),
    }
  }, [data, type, seasonStart])

  if (loading) {
    return (
      <div className="card">
        <h2>Global Analytics</h2>
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      </div>
    )
  }

  return (
    <GlobalAnalyticsPage
      details={details}
      results={results}
      filter={<TypeFilter value={type} onChange={setType} />}
      onBack={onBack}
    />
  )
}
