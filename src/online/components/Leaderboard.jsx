import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import {
  ArrowUpRight,
  Search,
  ArrowLeft,
  ArrowRight,
  Trophy,
} from "lucide-react";
import { aggregatePlayers } from "../lib/leaderboard";
import { api } from "../lib/api";
import { withCurrentAvatars } from "../lib/playerAvatars";
import { winRate } from "../utils/format";
import ClubShell from "./ui/ClubShell";
import AvatarImg from "./AvatarImg";
import PlayersTable from "./LeaderboardPanels/PlayersTable";
import { goBack, navigate, pathOf, useLocation } from "../../../shared/router";
const Insights = lazy(() => import("./LeaderboardPanels/Insights"));
const PastGamesList = lazy(() => import("./LeaderboardPanels/PastGamesList"));
const GameDetail = lazy(() => import("./LeaderboardPanels/GameDetail"));
const PlayerProfile = lazy(() => import("./LeaderboardPanels/PlayerProfile"));
const SeasonsPanel = lazy(() => import("./LeaderboardPanels/SeasonsPanel"));
const ComparePanel = lazy(() => import("./LeaderboardPanels/ComparePanel"));
const PAGE_SIZE = 12;
// Games played in King Online, games recorded at a table in ჩაწერა, or both.
const GAME_TYPES = [
  ["all", "ყველა"],
  ["online", "ონლაინ"],
  ["live", "ლაივი"],
];
const SECTIONS = ["rankings", "insights", "compare", "history", "seasons"];
const BASE = "/leaderboard";

// Each view has its own address:
//   /leaderboard[/insights|compare|history|seasons]   a section
//   /leaderboard/player/<name>                         a player's profile
//   /leaderboard/game/<id>                             one game
// with ?type=online|live for the game-type filter. `home` is where the
// logo goes back to (the lobby, or the table whose game just ended).
//
// The rankings, the history list and the seasons need only each game's
// result, so that is what loads first. The round-by-round details (a few MB
// over every game) load only for the views that read them: insights,
// compare and a player's profile. A game's own page fetches just that game.
const NEEDS_ROUNDS = ["insights", "compare", "player"];

export default function Leaderboard({ home = "/" }) {
  const [results, setResults] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [withRounds, setWithRounds] = useState(null);
  const [oneGame, setOneGame] = useState(null); // { id, game } for a game page
  // Every view reads the same games; the fuller copy once it is here.
  const allGames = withRounds || results;
  const { segments, query: params } = useLocation();
  const [, view, key] = segments;
  const gameType = ["online", "live"].includes(params.get("type"))
    ? params.get("type")
    : "all";
  const profileName = view === "player" && key ? key : null;
  const gameId = view === "game" && key ? key : null;
  // A profile or a game keeps the section it was opened from lit up.
  const lastSection = useRef("rankings");
  if (SECTIONS.includes(view)) lastSection.current = view;
  else if (!view) lastSection.current = "rankings";
  const section = lastSection.current;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const roundsPending = NEEDS_ROUNDS.includes(view) && !withRounds;
  const selected = useMemo(() => {
    if (!gameId) return null;
    const found = withRounds?.find((g) => String(g.id) === gameId);
    if (found) return found;
    return oneGame?.id === gameId ? oneGame.game : null;
  }, [withRounds, oneGame, gameId]);
  const gamePending = !!gameId && !selected && oneGame?.id !== gameId;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("wins");
  const [page, setPage] = useState(0);
  const [compare, setCompare] = useState({ picked: null, scope: "shared" });
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
    Promise.all([
      api.listGames("all", { rounds: false }),
      api.listProfiles().catch(() => []),
    ])
      .then(([list, people]) => {
        if (cancelled) return;
        const current = Array.isArray(people) ? people : [];
        setProfiles(current);
        setResults(withCurrentAvatars(Array.isArray(list) ? list : [], current));
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
  // The round-by-round details, the first time a view needs them.
  const needsRounds = NEEDS_ROUNDS.includes(view);
  const roundsRequested = useRef(false);
  useEffect(() => {
    if (!needsRounds || loading || error || roundsRequested.current) return;
    roundsRequested.current = true;
    api.listGames("all").then(
      (list) => setWithRounds(withCurrentAvatars(Array.isArray(list) ? list : [], profiles)),
      () => {
        roundsRequested.current = false;
        setError(true);
      },
    );
  }, [needsRounds, loading, error, profiles]);
  // A game's page: just that game, unless every game is already here.
  useEffect(() => {
    if (!gameId || loading || withRounds || oneGame?.id === gameId) return;
    let cancelled = false;
    api.getGame(gameId).then(
      (game) => {
        if (!cancelled)
          setOneGame({ id: gameId, game: game ? withCurrentAvatars([game], profiles)[0] : null });
      },
      () => {
        if (!cancelled) setOneGame({ id: gameId, game: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [gameId, loading, withRounds, oneGame, profiles]);
  const leader = aggregated[0];
  const count = section === "history" ? games.length : ranked.length;
  const pages = Math.ceil(count / PAGE_SIZE);
  const withType = (path, type = gameType) =>
    type === "all" ? path : `${path}?type=${type}`;
  const sectionPath = (id, type) =>
    withType(pathOf(BASE, id === "rankings" ? null : id), type);
  // The section tabs sit under the page's heading: switching keeps the place.
  const changeSection = (id) => navigate(sectionPath(id), { scroll: false });
  const changeType = (type) =>
    navigate(sectionPath(section, type), { replace: true });
  const setSelected = (game) =>
    game
      ? navigate(withType(pathOf(BASE, "game", game.id)))
      : goBack(sectionPath(section));
  const setProfileName = (name) =>
    name
      ? navigate(withType(pathOf(BASE, "player", name)))
      : goBack(sectionPath(section));
  const goHome = () => navigate(home);
  // A new section or filter starts on its first page.
  useEffect(() => setPage(0), [section, gameType]);
  return (
    <ClubShell
      page="rankings"
      title="ლიდერბორდი"
      onHome={goHome}
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
          ["compare", "შედარება"],
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
          <button className="k-button" onClick={goHome}>
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
          {roundsPending || gamePending ? (
            <p className="k-empty" role="status">
              იტვირთება…
            </p>
          ) : selected ? (
            <div className="k-detail">
              <GameDetail game={selected} onBack={() => setSelected(null)} />
            </div>
          ) : gameId ? (
            <div className="k-ranking-empty">
              <h2>თამაში ვერ მოიძებნა.</h2>
              <button className="k-button" onClick={() => setSelected(null)}>
                <ArrowLeft size={18} /> უკან
              </button>
            </div>
          ) : profileName && !profilePlayer ? (
            <div className="k-ranking-empty">
              <h2>მოთამაშე ვერ მოიძებნა.</h2>
              <button className="k-button" onClick={() => setProfileName(null)}>
                <ArrowLeft size={18} /> უკან
              </button>
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
                  games={games}
                  onPlayerSelect={setProfileName}
                  onSelectGame={setSelected}
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
          ) : section === "compare" ? (
            aggregated.length > 1 ? (
              <ComparePanel
                games={games}
                players={aggregated}
                onSelectGame={setSelected}
                state={compare}
                onState={setCompare}
              />
            ) : (
              <p className="k-empty">
                შედარებისთვის საჭიროა ორი მოთამაშის შედეგები.
              </p>
            )
          ) : section === "seasons" ? (
            <SeasonsPanel games={games} />
          ) : section === "insights" ? (
            aggregated.length > 1 ? (
              <Insights
                key={gameType}
                games={games}
                players={aggregated}
                gameType={gameType}
                onSelectGame={setSelected}
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
      {!gameId &&
        !profileName &&
        !loading &&
        !error &&
        section !== "insights" &&
        section !== "compare" &&
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
