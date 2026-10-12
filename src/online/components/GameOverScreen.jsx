import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import ClubShell from "./ui/ClubShell";
import AvatarImg from "./AvatarImg";
import { ArrowUpRight, ArrowRight, Check, RefreshCw } from "lucide-react-online";
import { useGame } from "../context/GameContext";
import { getGameType } from "../constants/gameTypes";
import { SuitIcon } from "./Icons";
const ScoreChart = lazy(() => import("./ScoreChart"));
import StatRow from "./StatRow";
import AchievementBadges from "./AchievementBadges";
import { computePerGameAchievements, countCodes } from "../utils/achievements";
import { scoreColorClass } from "../utils/scoreColor";

export default function GameOverScreen(props) {
  const game = useGame();
  if (!game.finalResults)
    return (
      <div className="k-loading" role="status">
        შედეგები იტვირთება…
      </div>
    );
  return <ResultsContent {...props} game={game} />;
}

function ResultsContent({ onOpenLeaderboard, game }) {
  const {
    finalResults,
    players,
    roundScores,
    roundDetails,
    mySeat,
    rematch,
    requestRematch,
    leaveRoom,
  } = game;
  const [tab, setTab] = useState("overview");
  useEffect(() => {
    const winners = finalResults.winners?.length
      ? finalResults.winners
      : [finalResults.winner].filter(Boolean);
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !winners.some((p) => p.seat === mySeat)
    )
      return;
    let cancelled = false;
    import("canvas-confetti").then(({ default: confetti }) => {
      if (!cancelled)
        confetti({
          particleCount: 75,
          spread: 80,
          origin: { y: 0.55 },
          colors: ["#d7fa52", "#ecebe4", "#20251e"],
        });
    });
    return () => {
      cancelled = true;
    };
  }, [finalResults, mySeat]);

  // Set of seats (in the OLD room) who have clicked Play Again.
  const joinedSet = useMemo(
    () => new Set(rematch?.joinedOldSeats || []),
    [rematch?.joinedOldSeats],
  );
  const iJoined = joinedSet.has(mySeat);

  const handlePlayAgain = () => {
    if (iJoined) return; // already pressed — don't double-fire
    requestRematch();
    // No navigation here — the server will respond with `room-joined`
    // for the new lobby, which GameContext's existing handler routes to
    // the WaitingRoom screen.
  };

  const { winner, finalScores, players: fp, mode } = finalResults;
  const resultOf = (seat) => finalScores?.[seat] ?? 0;
  // Ties crown everyone on the top score; single wins are a 1-element list.
  const winners = finalResults.winners?.length
    ? finalResults.winners
    : [winner].filter(Boolean);
  const winnerSeats = new Set(winners.map((w) => w.seat));
  const isTie = winnerSeats.size > 1;
  const playerList = (fp || players).slice().sort((a, b) => a.seat - b.seat);
  const allPlayers = (fp || players)
    .slice()
    .sort((a, b) => resultOf(b.seat) - resultOf(a.seat));
  const details =
    roundDetails && roundDetails.length
      ? roundDetails
      : finalResults.roundDetails || [];

  const stats = useMemo(() => {
    const tally = {};
    playerList.forEach((p) => {
      tally[p.seat] = {
        roundsLed: 0,
        totalTricks: 0,
        queensTaken: 0,
        jacksTaken: 0,
        heartsTaken: 0,
        kingsOfHeartsTaken: 0,
        bestRound: { score: -Infinity, round: null, type: null },
        worstRound: { score: Infinity, round: null, type: null },
      };
    });
    details.forEach((d) => {
      const ld = d.leaderSeat;
      if (tally[ld]) tally[ld].roundsLed++;
      for (const seat of [0, 1, 2]) {
        if (!tally[seat]) continue;
        tally[seat].totalTricks += d.tricksTaken?.[seat] ?? 0;
        tally[seat].queensTaken += d.queensTaken?.[seat] ?? 0;
        tally[seat].jacksTaken += d.jacksTaken?.[seat] ?? 0;
        tally[seat].heartsTaken += d.heartsTaken?.[seat] ?? 0;
        if (d.kingOfHeartsTakenBy === seat) tally[seat].kingsOfHeartsTaken++;
        const sc = d.scores?.[seat] ?? 0;
        if (sc > tally[seat].bestRound.score) {
          tally[seat].bestRound = {
            score: sc,
            round: d.round,
            type: d.gameType,
          };
        }
        if (sc < tally[seat].worstRound.score) {
          tally[seat].worstRound = {
            score: sc,
            round: d.round,
            type: d.gameType,
          };
        }
      }
    });
    return tally;
  }, [details, playerList]);

  // Per-game achievements, computed on the fly from this game's rounds.
  const achievements = useMemo(
    () => computePerGameAchievements(playerList, details),
    [playerList, details],
  );
  const achieversList = playerList.filter(
    (p) => (achievements[p.seat] || []).length > 0,
  );

  return (
    <ClubShell
      page="results"
      onHome={leaveRoom}
      onLeaderboard={onOpenLeaderboard}
      title="თამაშის შედეგები"
    >
      <section className="k-results-hero">
        <div>
          <span className="k-eyebrow">THAT WAS A GOOD GAME.</span>
          <h1>
            {isTie ? "ერთი თამაში." : "ეს მომენტი"}
            <br />
            <em>{isTie ? "რამდენიმე გამარჯვებული." : "შენია."}</em>
          </h1>
          <p>
            {mode === "championship" ? "KING / RANKED" : "KING / CLASSIC"}{" "}
            · {details.length || roundScores.length} ხელი დასრულებულია
          </p>
        </div>
        <span className="k-results-star" aria-hidden="true">
          ✳
        </span>
      </section>
      <div className="k-results-layout">
        <aside className={`k-winner-feature${isTie ? " is-tie" : ""}`}>
          <span className="k-eyebrow">
            {isTie ? "THE WINNERS" : "THE WINNER"}
          </span>
          <strong className="k-winner-place">
            01<span>↗</span>
          </strong>
          <div className="k-winner-avatars">
            {winners.map((w) => (
              <AvatarImg
                key={w.seat}
                avatar={
                  w.avatar || playerList.find((p) => p.seat === w.seat)?.avatar
                }
                size={72}
              />
            ))}
          </div>
          {/* One name per line, so a shared win never squeezes names apart. */}
          <h2>
            {winners.map((w) => (
              <span key={w.seat}>{w.name}</span>
            ))}
          </h2>
          <span className="k-winner-value">
            {resultOf(winners[0]?.seat).toLocaleString()}
            <small>ქულა</small>
          </span>
          <p>
            ყოველი დასასრული
            <br />
            შემდეგი სვლის დასაწყისია.
          </p>
        </aside>
        <section className="k-results-main">
          <div className="k-section-heading">
            <span className="k-eyebrow">THE FINAL STANDINGS</span>
            <span>{playerList.length} მოთამაშე</span>
          </div>
          <div className="k-finish-list">
            {allPlayers.map((p, idx) => (
              <div key={p.seat} className={p.seat === mySeat ? "own" : ""}>
                <span>{String(idx + 1).padStart(2, "0")}</span>
                <AvatarImg avatar={p.avatar} size={42} />
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    {winnerSeats.has(p.seat)
                      ? "გამარჯვებული"
                      : p.seat === mySeat
                        ? "შენი შედეგი"
                        : "კარგი თამაში"}
                    {joinedSet.has(p.seat) ? " · მზადაა ახალი თამაშისთვის" : ""}
                  </small>
                </div>
                <b>{resultOf(p.seat).toLocaleString()}</b>
              </div>
            ))}
          </div>
          {rematch?.newRoomCode && (
            <p className="k-rematch-note" role="status">
              <RefreshCw size={16} />
              ახალი მაგიდა: {rematch.newRoomCode} · {joinedSet.size}/
              {playerList.length} მზადაა
            </p>
          )}
          <div className="k-result-actions">
            <button
              className="k-button"
              disabled={iJoined}
              onClick={handlePlayAgain}
            >
              {iJoined
                ? "ველოდებით დანარჩენებს…"
                : rematch?.newRoomCode
                  ? "შეუერთდი ახალ თამაშს"
                  : "კიდევ ერთი თამაში"}
              {iJoined ? <Check size={18} /> : <ArrowRight size={18} />}
            </button>
            {onOpenLeaderboard && (
              <button className="k-link" onClick={onOpenLeaderboard}>
                ლიდერბორდი <ArrowUpRight size={18} />
              </button>
            )}
          </div>
          <nav className="k-page-tabs" aria-label="თამაშის ანალიზი">
            {[
              ["overview", "შეჯამება"],
              ["chart", "ქულების დინამიკა"],
              ["details", "ყველა დეტალი"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === "overview" && (
            <div className="k-result-reflection">
              <span>BEYOND THE SCORE</span>
              <p>
                „რაც შენს ხელშია,
                <br />
                ყოველთვის კარტი არ არის.“
              </p>
              <small>შემდეგი თამაში — ახალი არჩევანი.</small>
            </div>
          )}
          {tab === "chart" && (
            <div className="k-result-details">
              <Suspense fallback={<p role="status">გრაფიკი იტვირთება…</p>}>
                <ScoreChart />
              </Suspense>
            </div>
          )}
          {tab === "details" && (
            <div className="k-result-details">
              {" "}
              {details.length > 0 && (
                <div
                  className="rounded-2xl overflow-hidden mb-5"
                  style={{
                    background:
                      "linear-gradient(180deg, #172725 0%, #13221f 100%)",
                    border: "1px solid rgba(151,176,162,0.35)",
                  }}
                >
                  <div
                    className="px-5 py-4"
                    style={{ borderBottom: "1px solid rgba(151,176,162,0.32)" }}
                  >
                    <h2
                      className="text-base font-bold text-white"
                      style={{ color: "#eeeae1" }}
                    >
                      მოთამაშეების სტატისტიკა
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4">
                    {playerList.map((p) => {
                      const s = stats[p.seat] || {};
                      const best = s.bestRound?.round
                        ? `${s.bestRound.score > 0 ? "+" : ""}${s.bestRound.score} (ხელი ${s.bestRound.round}, ${s.bestRound.type})`
                        : "—";
                      const worst = s.worstRound?.round
                        ? `${s.worstRound.score} (ხელი ${s.worstRound.round}, ${s.worstRound.type})`
                        : "—";
                      return (
                        <div
                          key={p.seat}
                          className="rounded-xl p-3"
                          style={{
                            background: "rgba(21,37,32,0.85)",
                            border: "1px solid rgba(151,176,162,0.3)",
                          }}
                        >
                          <p
                            className="text-xs font-black text-white mb-2"
                            style={{ color: "#eeeae1" }}
                          >
                            {p.name}
                          </p>
                          <div className="space-y-1 text-[11px]">
                            <StatRow
                              label="წამყვანი ხელები"
                              value={s.roundsLed}
                            />
                            <StatRow label="მინუსები" value={s.totalTricks} />
                            <StatRow
                              label="აღებული დამები"
                              value={s.queensTaken}
                            />
                            <StatRow
                              label="აღებული ვალეტები"
                              value={s.jacksTaken}
                            />
                            <StatRow
                              label="აღებული გულები"
                              value={s.heartsTaken}
                            />
                            <StatRow
                              label="აღებული კინგი"
                              value={s.kingsOfHeartsTaken}
                            />
                            <StatRow
                              label="საუკეთესო ხელი"
                              value={best}
                              color="#7ac7a5"
                            />
                            <StatRow
                              label="ყველაზე ცუდი ხელი"
                              value={worst}
                              color="#ef918b"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {achieversList.length > 0 && (
                <div
                  className="rounded-2xl overflow-hidden mb-5"
                  style={{
                    background:
                      "linear-gradient(180deg, #172725 0%, #13221f 100%)",
                    border: "1px solid rgba(151,176,162,0.35)",
                  }}
                >
                  <div
                    className="px-5 py-4"
                    style={{ borderBottom: "1px solid rgba(151,176,162,0.32)" }}
                  >
                    <h2
                      className="text-base font-bold text-white"
                      style={{ color: "#eeeae1" }}
                    >
                      მიღწევები
                    </h2>
                  </div>
                  <div className="p-4 flex flex-col gap-4">
                    {achieversList.map((p) => (
                      <div key={p.seat}>
                        <p
                          className="text-xs font-black text-white mb-2"
                          style={{ color: "#eeeae1" }}
                        >
                          {p.name}
                        </p>
                        <AchievementBadges
                          achievements={countCodes(achievements[p.seat] || [])}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(roundScores.length > 0 || details.length > 0) && (
                <div
                  className="rounded-2xl overflow-hidden mb-6"
                  style={{
                    background:
                      "linear-gradient(180deg, #172725 0%, #13221f 100%)",
                    border: "1px solid rgba(151,176,162,0.35)",
                  }}
                >
                  <div
                    className="px-5 py-4"
                    style={{ borderBottom: "1px solid rgba(151,176,162,0.32)" }}
                  >
                    <h2
                      className="text-base font-bold text-white"
                      style={{ color: "#eeeae1" }}
                    >
                      ხელების დეტალები
                    </h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead style={{ background: "rgba(213,185,130,0.07)" }}>
                        <tr>
                          <th
                            className="px-3 py-2 text-left text-[10px] uppercase tracking-widest"
                            style={{ color: "rgba(213,185,130,0.7)" }}
                          >
                            ხელი
                          </th>
                          <th
                            className="px-3 py-2 text-left text-[10px] uppercase tracking-widest"
                            style={{ color: "rgba(213,185,130,0.7)" }}
                          >
                            თამაში
                          </th>
                          <th
                            className="px-3 py-2 text-left text-[10px] uppercase tracking-widest"
                            style={{ color: "rgba(213,185,130,0.7)" }}
                          >
                            წამყვანი
                          </th>
                          <th
                            className="px-3 py-2 text-left text-[10px] uppercase tracking-widest"
                            style={{ color: "rgba(213,185,130,0.7)" }}
                          >
                            კოზირი
                          </th>
                          {playerList.map((p) => (
                            <th
                              key={p.seat}
                              className="px-3 py-2 text-center text-[10px] uppercase tracking-widest"
                              style={{ color: "rgba(213,185,130,0.7)" }}
                            >
                              {p.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(details.length ? details : roundScores).map(
                          (rs, idx) => {
                            const gt = getGameType(rs.gameType);
                            const TypeIcon = gt?.Icon;
                            const leaderName =
                              playerList.find((p) => p.seat === rs.leaderSeat)
                                ?.name ?? "—";
                            return (
                              <tr
                                key={idx}
                                style={{
                                  borderTop: "1px solid rgba(151,176,162,0.18)",
                                }}
                              >
                                <td
                                  className="px-3 py-2 font-mono"
                                  style={{ color: "rgba(213,185,130,0.7)" }}
                                >
                                  {rs.round}
                                </td>
                                <td className="px-3 py-2">
                                  <span
                                    className="inline-flex items-center gap-1 text-xs rounded-md px-1.5 py-0.5"
                                    style={{
                                      backgroundColor: `${gt?.color ?? "#555"}22`,
                                      color: gt?.color ?? "#eeeae1",
                                    }}
                                  >
                                    {TypeIcon && <TypeIcon size={11} />}{" "}
                                    {rs.gameType}
                                  </span>
                                </td>
                                <td
                                  className="px-3 py-2 text-[11px]"
                                  style={{ color: "rgba(225,233,225,0.7)" }}
                                >
                                  {leaderName}
                                </td>
                                <td
                                  className="px-3 py-2 text-[11px]"
                                  style={{
                                    color: rs.trumpSuit
                                      ? "#d5b982"
                                      : "rgba(225,233,225,0.4)",
                                  }}
                                >
                                  {rs.trumpSuit ? (
                                    <span className="inline-flex items-center gap-1">
                                      <SuitIcon
                                        suit={rs.trumpSuit}
                                        size={11}
                                        mono
                                        style={{ color: "#d5b982" }}
                                      />
                                      {rs.trumpSuit}
                                    </span>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                {playerList.map((p) => {
                                  const v = rs.scores?.[p.seat] ?? 0;
                                  return (
                                    <td
                                      key={p.seat}
                                      className={`px-3 py-2 text-center font-mono font-semibold
                              ${scoreColorClass(v)}`}
                                      style={{
                                        color:
                                          v > 0
                                            ? "#7ac7a5"
                                            : v < 0
                                              ? "#ef918b"
                                              : "rgba(225,233,225,0.45)",
                                      }}
                                    >
                                      {v > 0 ? "+" : ""}
                                      {v}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          },
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {!details.length && !roundScores.length && (
                <p>ხელების დეტალები ხელმისაწვდომი არ არის.</p>
              )}
            </div>
          )}
        </section>
      </div>
    </ClubShell>
  );
}
