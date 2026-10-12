import {
  ResponsiveContainer,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  Legend,
  Line,
} from "recharts-online";
import { useGame } from "../context/GameContext";

// Duqani tri-color: wine-red, vine-green, deep-blue — readable on light parchment.
const COLORS = ["#d7fa52", "#b8c5a5", "#789e98"];

export default function ScoreChart() {
  const { roundScores, players } = useGame();

  if (!players.length || roundScores.length === 0)
    return (
      <p className="k-data-empty">
        გრაფიკი პირველი დასრულებული რაუნდის შემდეგ გამოჩნდება.
      </p>
    );

  const sortedPlayers = [...players].sort((a, b) => a.seat - b.seat);

  const running = { 0: 0, 1: 0, 2: 0 };
  const chartData = roundScores.map((rs) => {
    sortedPlayers.forEach((p) => {
      running[p.seat] = (running[p.seat] ?? 0) + (rs.scores?.[p.seat] ?? 0);
    });
    const point = { round: rs.round };
    sortedPlayers.forEach((p) => {
      point[`p${p.seat}`] = running[p.seat];
    });
    return point;
  });

  return (
    <div className="k-chart-panel">
      <p className="k-data-caption">ჯამური ქულა ყოველი რაუნდის შემდეგ</p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={chartData}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(151,176,162,0.18)"
          />
          <XAxis
            dataKey="round"
            stroke="rgba(225,233,225,0.6)"
            tick={{ fontSize: 11, fontFamily: "Inter, Arial, sans-serif" }}
          />
          <YAxis
            stroke="rgba(225,233,225,0.6)"
            width={44}
            tick={{ fontSize: 11, fontFamily: "Inter, Arial, sans-serif" }}
          />
          <ReferenceLine
            y={0}
            stroke="rgba(151,176,162,0.55)"
            strokeDasharray="3 3"
          />
          <Tooltip
            contentStyle={{
              background: "#20251f",
              border: "1px solid rgba(151,176,162,0.55)",
              borderRadius: 2,
              fontSize: 12,
              fontFamily: "Inter, Arial, sans-serif",
              color: "#eeeae1",
            }}
            labelStyle={{ color: "#d7fa52" }}
            labelFormatter={(v) => `ხელი ${v}`}
          />
          <Legend
            wrapperStyle={{
              fontSize: 11,
              color: "#eeeae1",
              fontFamily: "Inter, Arial, sans-serif",
            }}
          />
          {sortedPlayers.map((p, i) => (
            <Line
              key={p.seat}
              dataKey={`p${p.seat}`}
              name={p.name}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
