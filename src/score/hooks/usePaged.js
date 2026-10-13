import { useMemo, useState } from 'react'

// Long lists show a page at a time: the whole history is hundreds of cards.
export function usePaged(items, pageSize = 50) {
  const [count, setCount] = useState(pageSize)
  const visible = useMemo(() => (items.length > count ? items.slice(0, count) : items), [items, count])
  return {
    visible,
    remaining: Math.max(0, items.length - count),
    showMore: () => setCount(c => c + pageSize),
  }
}
