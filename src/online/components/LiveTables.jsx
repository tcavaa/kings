import { useState } from "react";
import { Eye, Swords, Trophy } from "lucide-react";
import { useGame, useLobby } from "../context/GameContext";
import AvatarImg from "./AvatarImg";
import BracketOverview from "./Tournament/BracketOverview";

const TOURNAMENT_STAGE = {
  semifinal: "ნახევარფინალი",
  final: "ფინალი",
  done: "დასრულდა",
};

const TOTAL_ROUNDS = 27;

function tableLabel(game) {
  if (game.tournament) {
    return game.tournament.stage === "final" ? "ფინალი" : "ნახევარფინალი";
  }
  return game.mode === "championship" ? "ლიგა" : "კლასიკური";
}

/** A tournament past its draw: where it stands, and its bracket for anyone. */
function TournamentCard({ t, onOpen }) {
  const winners = (t.winners || []).map((w) => w.name).join(" და ");
  return (
    <article className="k-live-table" aria-label={`ტურნირი ${t.code}`}>
      <header>
        <span>
          <Swords size={12} className="inline" /> ტურნირი · {t.code}
        </span>
        <span>{TOURNAMENT_STAGE[t.status] || ""}</span>
      </header>
      {t.status === "done" ? (
        <p className="k-live-tournament-result">
          <Trophy size={16} /> {winners || "—"}
        </p>
      ) : (
        <ol className="k-live-players">
          {(t.finalists?.length
            ? t.players.filter((p) => t.finalists.includes(p.name))
            : t.players
          ).map((p) => (
            <li key={p.name} className={p.connected ? undefined : "is-away"}>
              <AvatarImg avatar={p.avatar} name={p.name} size={24} />
              <span>{p.name}</span>
            </li>
          ))}
        </ol>
      )}
      <button className="k-button k-button-outline" onClick={() => onOpen(t.code)}>
        ტურნირის ცხრილი <Swords size={17} />
      </button>
    </article>
  );
}

function LiveTableCard({ game, active, connected, waitingAtTable, onWatch, onNeedProfile }) {
  const seated =
    !!active &&
    game.players.some((p) => p.name.toLowerCase() === active.name.toLowerCase());
  const players = [...game.players].sort((a, b) => b.score - a.score);
  const left = Math.max(0, TOTAL_ROUNDS - game.round);
  return (
    <article
      className="k-live-table"
      aria-label={players.map((p) => p.name).join(" · ")}
    >
      <header>
        <span>{tableLabel(game)}</span>
        {game.watchers > 0 && (
          <span className="k-live-watchers" title={`${game.watchers} მაყურებელი`}>
            <Eye size={13} /> {game.watchers}
          </span>
        )}
      </header>
      <ol className="k-live-players">
        {players.map((p) => (
          <li key={p.seat} className={p.connected ? undefined : "is-away"}>
            <AvatarImg avatar={p.avatar} name={p.name} size={30} />
            <span>{p.name}</span>
            <b className={p.score < 0 ? "k-negative" : undefined}>{p.score}</b>
          </li>
        ))}
      </ol>
      <div className="k-live-progress">
        <span>
          რაუნდი {game.round}/{TOTAL_ROUNDS}
        </span>
        <span>დარჩა {left}</span>
      </div>
      <div className="k-live-bar" aria-hidden="true">
        <i style={{ width: `${(game.round / TOTAL_ROUNDS) * 100}%` }} />
      </div>
      {/* Three different dead ends, and each needs its own words: your own
          table, no profile yet (which opens the picker rather than refusing),
          or a homepage seat that could start a game under you mid-watch. */}
      {seated ? (
        <button className="k-button k-button-outline" disabled>
          შენი მაგიდაა
        </button>
      ) : !active ? (
        <button className="k-button k-button-outline" onClick={onNeedProfile}>
          აირჩიე პროფილი <Eye size={17} />
        </button>
      ) : (
        <button
          className="k-button k-button-outline"
          disabled={!connected || waitingAtTable}
          title={waitingAtTable ? "ჯერ დატოვე მიმდინარე მაგიდა" : undefined}
          onClick={() => onWatch(game.roomCode)}
        >
          ყურება <Eye size={17} />
        </button>
      )}
    </article>
  );
}

/**
 * King games in progress right now, each open to watch from the homepage.
 * The server only lists games that are actually being played by someone
 * still connected.
 *
 * Renders nothing while no game is live, so a quiet evening doesn't leave an
 * empty "live" section on the page.
 */
export default function LiveTables({ active, onNeedProfile }) {
  const { connected, publicSeat, tournament, watchGame, spectateTable } = useGame();
  const { liveGames, tournamentList } = useLobby();
  const [bracket, setBracket] = useState(null);
  // Only a homepage seat stops watching: it could start a game under you.
  // A tournament entrant may watch — the bracket seats them when it needs to.
  const busy = publicSeat !== null;
  const tournaments = tournamentList.filter((t) => t.status !== "lobby");
  if (!liveGames.length && !tournaments.length) return null;

  // Our own tournament's tables are watched as an entrant (voice and the
  // sound board stay ours); everything else the way anyone would.
  const watch = (roomCode) => {
    const game = liveGames.find((g) => g.roomCode === roomCode);
    if (tournament && game?.tournament?.id === tournament.id) spectateTable(roomCode);
    else watchGame(roomCode, active.name);
  };
  return (
    <section className="k-live-tables" aria-labelledby="live-tables-title">
      <div className="k-section-title">
        <div>
          <span className="k-eyebrow">
            <span className="k-live-dot" /> LIVE NOW
          </span>
          <h2 id="live-tables-title">ახლა თამაშობენ</h2>
        </div>
      </div>
      <div className="k-live-grid">
        {tournaments.map((t) => (
          <TournamentCard key={t.id} t={t} onOpen={setBracket} />
        ))}
        {liveGames.map((g) => (
          <LiveTableCard
            key={g.roomCode}
            game={g}
            active={active}
            connected={connected}
            waitingAtTable={busy}
            onWatch={watch}
            onNeedProfile={onNeedProfile}
          />
        ))}
      </div>
      {bracket && <BracketOverview code={bracket} onClose={() => setBracket(null)} />}
    </section>
  );
}
