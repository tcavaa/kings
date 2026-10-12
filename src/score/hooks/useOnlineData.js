import { useState, useEffect } from 'react'

// King Online's games now live in the same database — read them through
// the app's own API (same contract the old public API had: championship
// games only, avatars stripped).
const BASE = '/api/online'

export function useOnlineLeaderboard() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`${BASE}/leaderboard`)
      .then(r => r.json())
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return { data, loading, error }
}

export function useOnlineGames(limit = 200) {
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`${BASE}/games?limit=${limit}`)
      .then(r => r.json())
      .then(setGames)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [limit])

  return { games, loading, error }
}
