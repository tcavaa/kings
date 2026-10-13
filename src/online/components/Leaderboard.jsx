import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import {
  ArrowUpRight,
  Search,
  ArrowLeft,
  ArrowRight,
  Trophy,
} from "lucide-react-online";
import { listGames, aggregatePlayers } from "../lib/leaderboard";
import { api } from "../lib/api";
import { withCurrentAvatars } from "../lib/playerAvatars";
import { winRate } from "../utils/format";
import ClubShell from "./ui/ClubShell";
import AvatarImg from "./AvatarImg";
import PlayersTable from "./LeaderboardPanels/PlayersTable";
const Insights = lazy(() => import("./LeaderboardPanels/Insights"));
const PastGamesList = lazy(() => import("./LeaderboardPanels/PastGamesList"));
const GameDetail = lazy(() => import("./LeaderboardPanels/GameDetail"));
const PlayerProfile = lazy(() => import("./LeaderboardPanels/PlayerProfile"));
const SeasonsPanel = lazy(() => import("./LeaderboardPanels/SeasonsPanel"));
const PAGE_SIZE = 12;
// Games played in King Online, games recorded at a table in ჩაწერა, or both.
const GAME_TYPES = [
  ["all", "ყველა"],
  ["online", "ონლაინ"],
  ["live", "ლაივი"],
];

export default function Leaderboard({ onBack }) {
  const [allGames, setAllGames] = useState([]);
  const [gameType, setGameType] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(null);
  const [profileName, setProfileName] = useState(null);
  const [section, setSection] = useState("rankings");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("wins");
  const [page, setPage] = useState(0);
  const games = useMemo(
    () =>
      gameType === "all"
        ? allGames
        : allGames.filter((g) => (g.type || "online") === gameType),
    [allGames, gameType],
  );
  const typeCounts = useMemo(() => {
    const counts = { all: allGames.length, online: 0, live: 0 };
    for (const g of allGames) counts[g.type || "online"]++;
    return counts;
  }, [allGames]);
  const aggregated = useMemo(() => aggregatePlayers(games), [games]);
  // Ranked in the table's current order; a profile opened from it shows the
  // same rank as its row.
  const rankedAll = useMemo(
    () =>
      [...aggregated]
        .sort((a, b) =>
          sort === "score"
            ? b.totalScore - a.totalScore
            : b.wins - a.wins || b.totalScore - a.totalScore,
        )
        .map((p, i) => ({ ...p, rank: i + 1 })),
    [aggregated, sort],
  );
  const ranked = useMemo(
    () =>
      rankedAll.filter((p) =>
        p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ),
    [rankedAll, query],
  );
  const profilePlayer = profileName
    ? rankedAll.find((p) => p.name === profileName)
    : null;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    Promise.all([listGames("all"), api.listProfiles().catch(() => [])])
      .then(([list, profiles]) => {
        if (!cancelled)
          setAllGames(
            withCurrentAvatars(
              Array.isArray(list) ? list : [],
              Array.isArray(profiles) ? profiles : [],
            ),
          );
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const leader = aggregated[0];
  const count = section === "history" ? games.length : ranked.length;
  const pages = Math.ceil(count / PAGE_SIZE);
  const changeSection = (id) => {
    setProfileName(null);
    setSection(id);
    setPage(0);
    setSelected(null);
  };
  const changeType = (type) => {
    setProfileName(null);
    setGameType(type);
    setPage(0);
    setSelected(null);
  };
  return (
    <ClubShell
      page="rankings"
      title="ლიდერბორდი"
      onHome={onBack}
      onLeaderboard={() => changeSection("rankings")}
    >
      <header className="k-ranking-heading">
        <div>
          <span className="k-eyebrow">THE PEOPLE WHO SET THE PACE</span>
          <h1>
            შედეგი
            <br />
            <em>ყველაფერს ამბობს.</em>
          </h1>
        </div>
        <span className="k-ranking-symbol">↗</span>
      </header>
      <div className="k-ranking-stats">
        <div>
          <span>მოთამაშე</span>
          <strong>
            {loading || error
              ? "—"
              : aggregated.length.toString().padStart(2, "0")}
          </strong>
        </div>
        <div>
          <span>დასრულებული თამაში</span>
          <strong>
            {loading || error ? "—" : games.length.toString().padStart(2, "0")}
          </strong>
        </div>
        <div>
          <span>THE STANDARD</span>
          <strong>
            PLAY.
            <br />
            EVOLVE.
          </strong>
        </div>
      </div>
      {!loading && !error && (
        <div className="k-type-filter" role="group" aria-label="თამაშის ტიპი">
          {GAME_TYPES.map(([id, label]) => (
            <button
              key={id}
              aria-pressed={gameType === id}
              onClick={() => changeType(id)}
            >
              {label}
              <small>{typeCounts[id]}</small>
            </button>
          ))}
        </div>
      )}
      <nav className="k-page-tabs" aria-label="რეიტინგის სექციები">
        {[
          ["rankings", "რეიტინგი"],
          ["insights", "ანალიტიკა"],
          ["history", "თამაშების ისტორია"],
          ["seasons", "სეზონები"],
        ].map(([id, label], i) => (
          <button
            key={id}
            aria-pressed={section === id}
            onClick={() => changeSection(id)}
          >
            <small>0{i + 1}</small>
            {label}
            <ArrowUpRight size={16} />
          </button>
        ))}
      </nav>
      {loading ? (
        <div className="k-empty" role="status">
          შედეგები იტვირთება…
        </div>
      ) : error ? (
        <div className="k-ranking-empty">
          <span>OFFLINE / FOR NOW</span>
          <h2>შედეგებს მალე დავუბრუნდებით.</h2>
          <p>მონაცემების ჩატვირთვა ვერ მოხერხდა.</p>
          <button className="k-button" onClick={() => setAttempt((n) => n + 1)}>
            სცადე ხელახლა <ArrowRight size={18} />
          </button>
        </div>
      ) : games.length === 0 ? (
        <div className="k-ranking-empty">
          <Trophy size={48} strokeWidth={1} />
          <h2>შენი ისტორია ჯერ წინ არის.</h2>
          <p>პირველი დასრულებული თამაში აქ გამოჩნდება.</p>
          <button className="k-button" onClick={onBack}>
            იპოვე შენი თამაში <ArrowUpRight size={18} />
          </button>
        </div>
      ) : (
        <Suspense
          fallback={
            <p className="k-empty" role="status">
              იტვირთება…
            </p>
          }
        >
          {selected ? (
            <div className="k-detail">
              <GameDetail game={selected} onBack={() => setSelected(null)} />
            </div>
          ) : profilePlayer ? (
            <PlayerProfile
              player={profilePlayer}
              rank={profilePlayer.rank}
              games={games}
              onBack={() => setProfileName(null)}
              onSelectGame={setSelected}
            />
          ) : section === "rankings" && !leader ? (
            // Every game in this filter was played by removed players only.
            <p className="k-empty">ამ ფილტრით რეიტინგში მოთამაშე არ არის.</p>
          ) : section === "rankings" ? (
            <div className="k-ranking-layout">
              <aside className="k-leader-feature">
                <span className="k-eyebrow">THE ONE TO BEAT</span>
                <span className="k-leader-number">01</span>
                <button
                  className="k-player-link k-feature-profile"
                  onClick={() => setProfileName(leader.name)}
                  aria-label={`${leader.name} — პროფილი`}
                >
                  <AvatarImg avatar={leader.avatar} size={88} />
                  <h2>
                    {leader.name} <ArrowUpRight size={20} />
                  </h2>
                </button>
                <div>
                  <strong>{leader.wins}</strong>
                  <span>გამარჯვება</span>
                  <strong>{winRate(leader)}%</strong>
                  <span>მოგების მაჩვენებელი</span>
                </div>
                <span className="k-leader-foot">
                  CONSISTENCY IS EVERYTHING.
                </span>
              </aside>
              <section className="k-rank-list">
                <div className="k-rank-tools">
                  <label>
                    <Search size={16} />
                    <input
                      aria-label="მოთამაშის ძებნა"
                      placeholder="იპოვე მოთამაშე"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setPage(0);
                      }}
                    />
                  </label>
                  <select
                    aria-label="დალაგება"
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="wins">მოგებებით</option>
                    <option value="score">ქულებით</option>
                  </select>
                </div>
                <PlayersTable
                  onPlayerSelect={setProfileName}
                  aggregated={ranked.slice(
                    page * PAGE_SIZE,
                    (page + 1) * PAGE_SIZE,
                  )}
                />
                {!ranked.length && (
                  <p className="k-empty">მოთამაშე ვერ მოიძებნა.</p>
                )}
              </section>
            </div>
          ) : section === "seasons" ? (
            <SeasonsPanel games={games} />
          ) : section === "insights" ? (
            aggregated.length > 1 ? (
              <Insights
                key={gameType}
                games={games}
                players={aggregated}
                gameType={gameType}
              />
            ) : (
              <p className="k-empty">
                ანალიტიკისთვის საჭიროა ორი მოთამაშის შედეგები.
              </p>
            )
          ) : (
            <div className="k-history">
              <PastGamesList
                games={games.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
                onSelect={setSelected}
              />
            </div>
          )}
        </Suspense>
      )}
      {!selected &&
        !profileName &&
        !loading &&
        !error &&
        section !== "insights" &&
        section !== "seasons" &&
        pages > 1 && (
          <div className="k-pagination">
            <span>
              {page + 1} / {pages}
            </span>
            <button
              className="k-icon-button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              aria-label="წინა გვერდი"
            >
              <ArrowLeft size={17} />
            </button>
            <button
              className="k-icon-button"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
              aria-label="შემდეგი გვერდი"
            >
              <ArrowRight size={17} />
            </button>
          </div>
        )}
    </ClubShell>
  );
}
