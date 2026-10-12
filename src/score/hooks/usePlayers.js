import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function usePlayers() {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchPlayers = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('players')
      .select('id, name, online_name, created_at')
      .order('name')
    if (error) setError(error.message)
    else setPlayers(data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchPlayers() }, [fetchPlayers])

  const addPlayer = useCallback(async (name) => {
    const { error } = await supabase
      .from('players')
      .insert({ name: name.trim() })
    if (error) return error.message
    await fetchPlayers()
    return null
  }, [fetchPlayers])

  const deletePlayer = useCallback(async (id) => {
    const { error } = await supabase
      .from('players')
      .delete()
      .eq('id', id)
    if (!error) await fetchPlayers()
  }, [fetchPlayers])

  return { players, loading, error, addPlayer, deletePlayer }
}
