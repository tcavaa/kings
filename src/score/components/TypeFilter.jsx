import { useState } from 'react'
import { Globe } from 'lucide-react'

// Which games the stats count: all of them, King Online's, or the ones
// recorded here at a table. Remembered on this device.
const KEY = 'king-score-game-type'
const TYPES = [['all', 'ყველა'], ['online', 'ონლაინ'], ['live', 'ლაივი']]

export function useTypeFilter() {
  const [type, setType] = useState(() => {
    try {
      const saved = localStorage.getItem(KEY)
      return TYPES.some(([key]) => key === saved) ? saved : 'all'
    } catch { return 'all' }
  })
  const choose = (next) => {
    setType(next)
    try { localStorage.setItem(KEY, next) } catch { /* private mode */ }
  }
  return [type, choose]
}

export default function TypeFilter({ value, onChange }) {
  return (
    <div role="group" aria-label="რომელი თამაშები ჩაითვალოს" style={{ display: 'flex', gap: 8, margin: '12px 0 0' }}>
      {TYPES.map(([key, label]) => (
        <button
          key={key}
          className={`${value === key ? 'primary' : 'link'} icon-btn`}
          style={{ fontSize: 13, padding: '6px 14px' }}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          {key === 'online' && <Globe size={13} />}{label}
        </button>
      ))}
    </div>
  )
}
