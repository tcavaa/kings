import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useAllGameDetails() {
  const [details, setDetails] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchDetails() {
      const { data } = await supabase
        .from('game_details')
        .select('id, game_result_id, players, rounds, played_at')
        .order('played_at', { ascending: false })
      if (data) setDetails(data)
      setLoading(false)
    }
    fetchDetails()
  }, [])

  return { details, loading }
}
