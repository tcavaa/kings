// A row-by-column count grid, each cell shaded by how it compares with the
// highest count in its row (the diagonal shows a dash).

/** heat-0..heat-3 for a count against its row's highest. */
export function heatClass(count, maxInRow) {
  if (!(maxInRow > 0)) return 'heat-0'
  const ratio = count / maxInRow
  if (ratio >= 0.75) return 'heat-3'
  if (ratio >= 0.5) return 'heat-2'
  if (ratio >= 0.25) return 'heat-1'
  return 'heat-0'
}

/**
 * rows/cols: [{ key, label }]; countOf(rowKey, colKey) gives a cell's count.
 * A row and a column with the same key are the same player (the diagonal).
 */
export default function HeatMatrix({ corner, rows, cols, countOf }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="king-matrix">
        <div className="km-row km-header">
          <div className="km-cell km-label">{corner}</div>
          {cols.map(c => (
            <div key={c.key} className="km-cell km-col-header">{c.label}</div>
          ))}
        </div>
        {rows.map(r => {
          const counts = cols.map(c => (c.key === r.key ? 0 : countOf(r.key, c.key) || 0))
          const maxInRow = Math.max(0, ...counts)
          return (
            <div key={r.key} className="km-row">
              <div className="km-cell km-row-header">{r.label}</div>
              {cols.map((c, i) => {
                const isSelf = c.key === r.key
                return (
                  <div key={c.key} className={`km-cell km-data ${isSelf ? 'km-self' : heatClass(counts[i], maxInRow)}`}>
                    {isSelf ? '—' : counts[i]}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
