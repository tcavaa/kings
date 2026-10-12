import { useGameData } from '../lib/gameData'

const NONE = []

// Round-by-round data of the games recorded here, newest first.
export function useAllGameDetails() {
  const { data, loading } = useGameData()
  return { details: data?.live.details ?? NONE, loading }
}
