import { usePlayerList } from '../lib/gameData'

const NONE = []

// One player list for ჩაწერა and King Online (King Online's profiles), by name.
// Players are added and removed in /admin. Loaded on its own, without waiting
// for the game history.
export function usePlayers() {
  const { data, loading, error } = usePlayerList()
  return { players: data ?? NONE, loading, error }
}
