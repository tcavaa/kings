import { useGameData } from '../lib/gameData'

const NONE = []

// One player list for ჩაწერა and King Online (King Online's profiles), by name.
// Players are added and removed in /admin.
export function usePlayers() {
  const { data, loading, error } = useGameData()
  return { players: data?.players ?? NONE, loading, error }
}
