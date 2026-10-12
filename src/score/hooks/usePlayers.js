import { useCallback } from 'react'
import { useGameData, savePlayer, removePlayer } from '../lib/gameData'

const NONE = []

// One player list for ჩაწერა and King Online (King Online's profiles), by name.
export function usePlayers() {
  const { data, loading, error } = useGameData()

  const addPlayer = useCallback(async (name) => {
    try { await savePlayer(name.trim()); return null }
    catch (err) { return err.message }
  }, [])

  const deletePlayer = useCallback(async (id) => {
    try { await removePlayer(id); return null }
    catch (err) { return err.message }
  }, [])

  return { players: data?.players ?? NONE, loading, error, addPlayer, deletePlayer }
}
