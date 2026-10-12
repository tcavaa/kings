import { useGameData } from '../lib/gameData'

const NONE = []

// Games recorded here (at a table), newest first.
export function useGameResults() {
  const { data, loading } = useGameData()
  return { results: data?.live.results ?? NONE, loading }
}
