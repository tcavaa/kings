import { useGameData } from '../lib/gameData'

const NONE = []

// Every King Online league game, newest first.
export function useOnlineGames() {
  const { data, loading, error } = useGameData()
  return { games: data?.online.games ?? NONE, loading, error }
}
