import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  Legend,
} from "recharts-online";

const COLOURS = ["#d7fa52", "#b8c5a5", "#789e98", "#e0a458"];

/**
 * Recharts line chart of the running tally per round. Same data as
 * `ProgressionTable`, just visual.
 */
export default function ProgressionChart({ rows, players }) {
  if (!rows.length) return null;
  return (
    <div className="px-3 py-3">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart
          data={rows}
          margin={{ top: 6, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(151,176,162,0.12)"
          />
          <XAxis
            dataKey="round"
            stroke="rgba(225,233,225,0.6)"
            tick={{ fontSize: 11 }}
          />
          <YAxis
            stroke="rgba(225,233,225,0.6)"
            width={42}
            tick={{ fontSize: 11 }}
          />
          <ReferenceLine
            y={0}
            stroke="rgba(151,176,162,0.5)"
            strokeDasharray="3 3"
          />
          <Tooltip
            contentStyle={{
              background: "#20251f",
              border: "1px solid rgba(151,176,162,0.4)",
              borderRadius: 2,
              fontSize: 12,
              color: "#eeeae1",
            }}
            labelFormatter={(v) => `ხელი ${v}`}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {players.map((p, i) => (
            <Line
              key={p.seat}
              dataKey={String(p.seat)}
              name={p.name}
              stroke={COLOURS[i % COLOURS.length]}
              strokeWidth={2.4}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
