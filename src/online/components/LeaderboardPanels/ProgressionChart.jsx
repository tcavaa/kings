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
import {
  CHART_COLOURS,
  gridProps,
  axisProps,
  zeroLineProps,
  tooltipProps,
  legendProps,
  lineProps,
} from "../../utils/chartTheme";

/**
 * Recharts line chart of the running tally per round: `rows` are
 * `{ round, [seat]: total }`. Same data as `ProgressionTable`, just visual;
 * the in-game ScoreChart draws it too.
 */
export default function ProgressionChart({
  rows,
  players,
  height = 220,
  className = "px-3 py-3",
}) {
  if (!rows.length) return null;
  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={rows}
          margin={{ top: 6, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="round" {...axisProps} />
          <YAxis width={42} {...axisProps} />
          <ReferenceLine {...zeroLineProps} />
          <Tooltip {...tooltipProps} labelFormatter={(v) => `ხელი ${v}`} />
          <Legend {...legendProps} />
          {players.map((p, i) => (
            <Line
              key={p.seat}
              dataKey={String(p.seat)}
              name={p.name}
              stroke={CHART_COLOURS[i % CHART_COLOURS.length]}
              {...lineProps}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
