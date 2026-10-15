import { useEffect, useMemo, useState } from "react";
import { Crown } from "lucide-react";
import { api } from "../lib/api";
import { withCurrentAvatars } from "../lib/playerAvatars";
import { recentForm } from "../lib/playerStats";
import { currentSeasonOf, gamesSince, standingsOf } from "../lib/seasons";
import { navigate, pathOf } from "../../../shared/router";
import AvatarImg from "./AvatarImg";
import FormGuide from "./LeaderboardPanels/FormGuide";

const TOP = 3;

/**
 * The homepage's opening: the current season's name and its top three, by
 * the same table as the leaderboard's Seasons tab. The leader wears the
 * crown. A name opens the player's profile, a form box the game.
 */
export default function SeasonHero({ profiles }) {
  const [seasons, setSeasons] = useState(null);
  const [games, setGames] = useState(null);
  useEffect(() => {
    let alive = true;
    api.listSeasons().then(
      (s) => alive && setSeasons(Array.isArray(s) ? s : []),
      () => alive && setSeasons([]),
    );
    // Results only: the table and the form need no round-by-round details.
    api.listGames("all", { rounds: false }).then(
      (g) => alive && setGames(Array.isArray(g) ? g : []),
      () => alive && setGames([]),
    );
    return () => {
      alive = false;
    };
  }, []);

  const { season, start } = currentSeasonOf(seasons);
  // Photos follow the current profiles, like everywhere on the leaderboard.
  const seasonGames = useMemo(
    () => withCurrentAvatars(gamesSince(games || [], start), profiles || []),
    [games, start, profiles],
  );
  const top = useMemo(() => standingsOf(seasonGames).slice(0, TOP), [seasonGames]);
  const loading = seasons === null || games === null;

  return (
    <>
      <h1 className="k-season-title">
        {season?.name || (loading ? " " : "მიმდინარე სეზონი")}
        <i>↗</i>
      </h1>
      {loading ? (
        <p className="k-season-top-note" role="status">
          სეზონი იტვირთება…
        </p>
      ) : top.length === 0 ? (
        <p className="k-season-top-note">ამ სეზონში თამაში ჯერ არ არის.</p>
      ) : (
        <div className="k-rank-table-wrap k-season-top">
          <table className="k-rank-table">
            <thead>
              <tr>
                <th>#</th>
                <th>მოთამაშე</th>
                <th>ფორმა</th>
                <th>თამაში</th>
                <th>მოგება</th>
              </tr>
            </thead>
            <tbody>
              {top.map((p, i) => (
                <tr key={p.name} className={i === 0 ? "is-leader" : undefined}>
                  <td>{String(i + 1).padStart(2, "0")}</td>
                  <td>
                    <button
                      className="k-player-link"
                      onClick={() => navigate(pathOf("/leaderboard", "player", p.name))}
                      aria-label={`${p.name} — პროფილი`}
                    >
                      <span className="k-season-avatar">
                        {i === 0 && (
                          <Crown className="k-season-crown" size={18} aria-label="ლიდერი" />
                        )}
                        <AvatarImg avatar={p.avatar} name={p.name} size={36} />
                      </span>
                      <strong>{p.name}</strong>
                    </button>
                  </td>
                  <td className="k-form-cell">
                    <FormGuide
                      form={recentForm(seasonGames, p.name, 5)}
                      name={p.name}
                      onSelectGame={(g) => navigate(pathOf("/leaderboard", "game", g.id))}
                      size="sm"
                    />
                  </td>
                  <td>{p.gamesPlayed}</td>
                  <td>
                    <span className="k-wins-badge">{p.wins}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
