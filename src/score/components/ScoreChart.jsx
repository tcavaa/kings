import { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { PLAYER_COLORS as COLORS } from '../constants/colors'
import { useChartTheme } from '../utils/chartTheme'
import { cumulativeTotals } from '../utils/rounds'

export default function ScoreChart({ players, rounds }) {
  const chart = useChartTheme()
  // One series per sheet column (s0, s1, ...), not per name: two players with
  // the same name stay two lines.
  const data = useMemo(
    () => cumulativeTotals(players, rounds).map((totals, idx) => {
      const point = { round: idx + 1 }
      players.forEach((p, i) => { point[`s${i}`] = totals[p.id] })
      return point
    }),
    [players, rounds]
  )

  return (
    <div className="card">
      <h2>Score Progression</h2>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
          <XAxis
            dataKey="round"
            label={{ value: 'Round', position: 'insideBottom', offset: -12, fill: chart.muted, fontSize: 12 }}
            tick={chart.tick}
          />
          <YAxis tick={chart.tick} width={40} />
          <ReferenceLine y={0} stroke={chart.text} strokeDasharray="4 2" />
          <Tooltip contentStyle={chart.tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
          {players.map((p, i) => (
            <Line
              key={p.id}
              type="monotone"
              dataKey={`s${i}`}
              name={p.name}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
