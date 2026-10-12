import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useGameResults() {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchResults() {
      const { data } = await supabase
        .from('game_results')
        .select('*')
        .order('played_at', { ascending: false })
      if (data) setResults(data)
      setLoading(false)
    }
    fetchResults()
  }, [])

  return { results, loading }
}
