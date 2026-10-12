import { useGameResults } from '../hooks/useGameResults'
import { useAllGameDetails } from '../hooks/useAllGameDetails'
import { usePlayers } from '../hooks/usePlayers'
import { useOnlineGames } from '../hooks/useOnlineData'
import GlobalAnalyticsPage from './GlobalAnalyticsPage'

/**
 * The "Stats" tab — Global Analytics for the CURRENT season, addressable
 * straight from the bottom nav. Online data arrives championship-only from
 * the public API, so public/casual online games never touch these numbers.
 */
export default function StatsPage({ currentSeasonStart, onBack }) {
  const { results, loading: resultsLoading } = useGameResults()
  const { details, loading: detailsLoading } = useAllGameDetails()
  const { players: supabasePlayers } = usePlayers()
  const { games: onlineGames } = useOnlineGames(500)

  const seasonStart = currentSeasonStart || new Date(0)
  const seasonDetails     = details.filter(d => new Date(d.played_at) > seasonStart)
  const seasonResults     = results.filter(r => new Date(r.played_at) > seasonStart)
  const seasonOnlineGames = onlineGames.filter(g => new Date(g.playedAt) > seasonStart)

  if (resultsLoading || detailsLoading) {
    return (
      <div className="card">
        <h2>Global Analytics</h2>
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      </div>
    )
  }

  return (
    <GlobalAnalyticsPage
      details={seasonDetails}
      results={seasonResults}
      onlineGames={seasonOnlineGames}
      supabasePlayers={supabasePlayers}
      onBack={onBack}
    />
  )
}
