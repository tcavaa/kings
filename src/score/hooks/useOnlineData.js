import { useState, useEffect } from 'react'
import { useGameData } from '../lib/gameData'

// King Online's games live in the same database as ours. The leaderboard
// below still reads the old public-API contract (championship games only).
const BASE = '/api/online'
const NONE = []

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

// Every King Online league game, newest first (no longer capped at 200).
export function useOnlineGames() {
  const { data, loading, error } = useGameData()
  return { games: data?.online.games ?? NONE, loading, error }
}
