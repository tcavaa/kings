import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react-online";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts-online";
import { api } from "../../lib/api";
import { aggregatePlayers, isWinnerName } from "../../lib/leaderboard";
import AvatarImg from "../AvatarImg";

// Seasons are King Score's: each has a start, an end (none while it runs)
// and a champion. A season counts league games — online ones and the ones
// recorded at a table — exactly like the score app's season tables.
const COLOURS = ["#d7fa52", "#b8c5a5", "#789e98", "#e0a458", "#c98fd1"];
const RACE_PLAYERS = 5;
const fmt = (d) =>
  new Date(d).toLocaleDateString("ka-GE", { day: "2-digit", month: "short", year: "numeric" });
const pct = (p) => (p.gamesPlayed ? Math.round((p.wins / p.gamesPlayed) * 100) : 0);
const avg = (p) => (p.gamesPlayed ? (p.totalScore / p.gamesPlayed).toFixed(1) : "0");
const signed = (v) => (Number(v) > 0 ? `+${v}` : `${v}`);

function Standings({ players, champion }) {
  if (!players.length) return <p className="k-data-empty">ამ სეზონში თამაში ჯერ არ არის.</p>;
  const champs = new Set(String(champion || "").split(" & ").filter(Boolean));
  return (
    <div className="k-table-scroll">
      <table className="k-data-table">
        <thead>
          <tr>
            <th>მოთამაშე</th>
            <th>თამაში</th>
            <th>მოგება</th>
            <th>მოგ. %</th>
            <th>
              საშუალო<small>ქულა</small>
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => (
            <tr key={p.name} className={champs.has(p.name) ? "is-current" : undefined}>
              <th>
                <div className="k-player-cell">
                  <span className="k-muted">{String(i + 1).padStart(2, "0")}</span>
                  <AvatarImg avatar={p.avatar} size={28} />
                  <span>{p.name}</span>
                  {champs.has(p.name) && <Trophy size={14} />}
                </div>
              </th>
              <td>{p.gamesPlayed}</td>
              <td>
                <b>{p.wins}</b>
              </td>
              <td>{pct(p)}%</td>
              <td>{signed(avg(p))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Wins piling up game by game across the season, for the top players. */
function SeasonRace({ games, players }) {
  const names = players.slice(0, RACE_PLAYERS).map((p) => p.name);
  const rows = useMemo(() => {
    const wins = Object.fromEntries(names.map((n) => [n, 0]));
    return [...games]
      .sort((a, b) => new Date(a.playedAt) - new Date(b.playedAt))
      .map((g, i) => {
        for (const n of names) if (isWinnerName(g, n)) wins[n]++;
        return { n: i + 1, date: fmt(g.playedAt), ...wins };
      });
  }, [games, names.join("|")]);
  if (rows.length < 2) return null;
  return (
    <div className="k-season-race">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(151,176,162,0.12)" />
          <XAxis dataKey="n" stroke="rgba(225,233,225,0.6)" tick={{ fontSize: 11 }} />
          <YAxis stroke="rgba(225,233,225,0.6)" width={34} tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: "#20251f",
              border: "1px solid rgba(151,176,162,0.4)",
              borderRadius: 2,
              fontSize: 12,
              color: "#eeeae1",
            }}
            labelFormatter={(n) => `თამაში ${n} · ${rows[n - 1]?.date ?? ""}`}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {names.map((name, i) => (
            <Line
              key={name}
              type="stepAfter"
              dataKey={name}
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

export default function SeasonsPanel({ games }) {
  const [seasons, setSeasons] = useState(null);
  const [error, setError] = useState(false);
  const [pastId, setPastId] = useState("");
  useEffect(() => {
    let alive = true;
    api.listSeasons().then(
      (s) => alive && setSeasons(Array.isArray(s) ? s : []),
      () => alive && setError(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  const league = useMemo(() => games.filter((g) => g.isChampionship !== false), [games]);
  const current = seasons?.find((s) => !s.ended_at) || null;
  const past = useMemo(() => (seasons || []).filter((s) => s.ended_at), [seasons]);
  // A season starts where its row says, or where the last one ended.
  const currentStart = current?.started_at || past[0]?.ended_at || null;
  const currentGames = useMemo(
    () => (currentStart ? league.filter((g) => new Date(g.playedAt) > new Date(currentStart)) : []),
    [league, currentStart],
  );
  const currentPlayers = useMemo(() => aggregatePlayers(currentGames), [currentGames]);
  const pastRows = useMemo(
    () =>
      past.map((s) => {
        const from = new Date(s.started_at);
        const to = new Date(s.ended_at);
        const sGames = league.filter((g) => {
          const t = new Date(g.playedAt);
          return t >= from && t <= to;
        });
        return { season: s, games: sGames, players: aggregatePlayers(sGames) };
      }),
    [past, league],
  );
  const shownPast = pastRows.find((r) => r.season.id === pastId) || pastRows[0];

  if (error) return <p className="k-empty">სეზონების ჩატვირთვა ვერ მოხერხდა.</p>;
  if (!seasons)
    return (
      <p className="k-empty" role="status">
        სეზონები იტვირთება…
      </p>
    );

  const days = currentStart ? Math.max(1, Math.ceil((Date.now() - new Date(currentStart)) / 86400000)) : 0;
  const leader = currentPlayers[0];
  return (
    <div className="k-insights-grid k-seasons">
      <section className="k-analysis-panel k-season-current">
        <header>
          <div>
            <span className="k-eyebrow">01 / CURRENT SEASON</span>
            <h2>{current?.name || "მიმდინარე სეზონი"}</h2>
          </div>
        </header>
        <div className="k-season-facts">
          <div>
            <span>დაიწყო</span>
            <strong>{currentStart ? fmt(currentStart) : "—"}</strong>
          </div>
          <div>
            <span>დღე</span>
            <strong>{days}</strong>
          </div>
          <div>
            <span>თამაში</span>
            <strong>{currentGames.length}</strong>
          </div>
          <div>
            <span>ლიდერი</span>
            <strong>{leader ? leader.name : "—"}</strong>
            {leader && <small>{leader.wins} მოგება</small>}
          </div>
        </div>
        <SeasonRace games={currentGames} players={currentPlayers} />
        <Standings players={currentPlayers} />
      </section>
      <section className="k-analysis-panel">
        <header>
          <div>
            <span className="k-eyebrow">02 / CHAMPIONS</span>
            <h2>ჩემპიონები</h2>
          </div>
        </header>
        {!pastRows.length ? (
          <p className="k-data-empty">დასრულებული სეზონი ჯერ არ არის.</p>
        ) : (
          <div className="k-table-scroll">
            <table className="k-data-table">
              <thead>
                <tr>
                  <th>სეზონი</th>
                  <th>ჩემპიონი</th>
                  <th>თამაში</th>
                </tr>
              </thead>
              <tbody>
                {pastRows.map(({ season, games: sGames }) => (
                  <tr
                    key={season.id}
                    className={shownPast?.season.id === season.id ? "is-current" : undefined}
                    onClick={() => setPastId(season.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <th>
                      {season.name || "სეზონი"}
                      <small>
                        {fmt(season.started_at)} — {fmt(season.ended_at)}
                      </small>
                    </th>
                    <td>
                      <b>{season.champion_name || "—"}</b>
                    </td>
                    <td>{sGames.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {shownPast && (
        <section className="k-analysis-panel">
          <header>
            <div>
              <span className="k-eyebrow">03 / SEASON TABLE</span>
              <h2>{shownPast.season.name || "სეზონი"}</h2>
            </div>
            <select
              aria-label="სეზონი"
              value={shownPast.season.id}
              onChange={(e) => setPastId(e.target.value)}
            >
              {pastRows.map(({ season }) => (
                <option key={season.id} value={season.id}>
                  {season.name || fmt(season.started_at)}
                </option>
              ))}
            </select>
          </header>
          <Standings players={shownPast.players} champion={shownPast.season.champion_name} />
        </section>
      )}
    </div>
  );
}
