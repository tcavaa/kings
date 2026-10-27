import { useEffect, useState } from "react";
import { ArrowRight, Plus, LogOut, Trophy, Swords } from "lucide-react";
import { useGame, useLobby } from "../../context/GameContext";
import AvatarImg from "../AvatarImg";
import BracketOverview from "./BracketOverview";

const SIZES = [6, 9];

/**
 * Lobby entry point for King tournaments.
 *
 * A tournament needs exactly 6 or 9 entrants; the creator picks which. Once
 * the last seat fills the server draws the tables and everyone is dropped
 * straight onto a table. Back in the lobby, this panel shows where your
 * tournament stands: waiting, in progress, or finished with its winners.
 */
export default function TournamentPanel({ active, onNeedProfile }) {
  const {
    connected,
    publicSeat,
    tournament,
    createTournament,
    joinTournament,
    leaveTournament,
    dismissTournament,
    refreshTournaments,
  } = useGame();
  const { tournamentList } = useLobby();
  // The list also carries running and finished tournaments (the homepage
  // shows those); only a lobby can be joined.
  const openList = tournamentList.filter((t) => t.status === "lobby");

  const [size, setSize] = useState(6);
  const [code, setCode] = useState("");
  const [bracketOpen, setBracketOpen] = useState(false);
  const bracket = bracketOpen && tournament && (
    <BracketOverview code={tournament.code} onClose={() => setBracketOpen(false)} />
  );
  const bracketButton = (
    <button className="k-button k-button-outline" onClick={() => setBracketOpen(true)}>
      ტურნირის ცხრილი <Swords size={18} />
    </button>
  );

  // Fetch the open-tournament list on mount and after a reconnect. Later
  // changes (ours included) arrive in the server's own broadcast.
  useEffect(() => {
    if (connected) refreshTournaments();
  }, [connected, refreshTournaments]);

  // One table at a time: not while sitting at the homepage table.
  const canAct = connected && !!active && publicSeat === null;

  if (tournament?.status === "done")
    return (
      <div className="k-tournament">
        <section>
          <span className="k-eyebrow">TOURNAMENT OVER / {tournament.code}</span>
          <h3>
            <Trophy size={22} className="inline" />{" "}
            {(tournament.winners || []).map((w) => w.name).join(" და ") || "—"}
          </h3>
          <p>ტურნირი დასრულდა. გილოცავთ გამარჯვებულს!</p>
          <button className="k-button" onClick={dismissTournament}>
            ახალი ტურნირი <ArrowRight size={18} />
          </button>
          {bracketButton}
        </section>
        {bracket}
      </div>
    );

  if (tournament && tournament.status !== "lobby")
    return (
      <div className="k-tournament">
        <section>
          <span className="k-eyebrow">YOUR TOURNAMENT / {tournament.code}</span>
          <h3>
            ტურნირი
            <br />
            მიმდინარეობს.
          </h3>
          <p>
            {tournament.eliminated
              ? "ფინალში ვერ გახვედი. შეგიძლია უყურო ფინალს ან ითამაშო ლიგაში."
              : tournament.status === "final"
                ? "ფინალი მიმდინარეობს. როცა დასრულდება, გამარჯვებული აქ გამოჩნდება."
                : "ნახევარფინალები მიმდინარეობს. ფინალისტები ყველა მაგიდის დასრულების შემდეგ გაირკვევა. მანამდე შეგიძლია სხვა მაგიდებს უყურო."}
          </p>
          {bracketButton}
        </section>
        {bracket}
      </div>
    );

  if (tournament)
    return (
      <div className="k-tournament">
        <section>
          <span className="k-eyebrow">YOUR TOURNAMENT / {tournament.code}</span>
          <h3>
            შემდეგი ეტაპი
            <br />
            ახლოსაა.
          </h3>
          <p>
            {tournament.size - tournament.players.length > 0
              ? `ველოდებით კიდევ ${tournament.size - tournament.players.length} მოთამაშეს.`
              : "მაგიდები მზადდება…"}
          </p>
          <div className="k-tournament-meter">
            {Array.from({ length: tournament.size }, (_, i) => (
              <i
                key={i}
                className={i < tournament.players.length ? "filled" : ""}
              />
            ))}
          </div>
          {tournament.status === "lobby" && (
            <button
              className="k-button k-button-outline"
              onClick={leaveTournament}
            >
              ტურნირის დატოვება <LogOut size={17} />
            </button>
          )}
        </section>
        <div className="k-six-seats">
          {Array.from({ length: tournament.size }, (_, i) => {
            const p = tournament.players[i];
            return (
              <div key={i}>
                {p ? (
                  <AvatarImg avatar={p.avatar} name={p.name} size={48} />
                ) : (
                  <span>
                    <Plus size={20} />
                  </span>
                )}
                <strong>{p?.name || "ღია ადგილი"}</strong>
                <small>
                  {p?.connected === false
                    ? "კავშირი წყდება…"
                    : `SEAT / 0${i + 1}`}
                </small>
              </div>
            );
          })}
        </div>
      </div>
    );
  return (
    <div className="k-tournament">
      <section>
        <span className="k-eyebrow">TAKE THE STAGE</span>
        <h3>
          ერთი მიზანი.
          <br />
          მეტი მეტოქე.
        </h3>
        <p>
          ნახევარფინალიდან ფინალამდე.
          <br />
          აირჩიე ფორმატი და დაიწყე შენი ტურნირი.
        </p>
        <div className="k-segment">
          {SIZES.map((n) => (
            <button
              key={n}
              aria-pressed={size === n}
              onClick={() => setSize(n)}
            >
              {n} მოთამაშე
            </button>
          ))}
        </div>
        <button
          className="k-button"
          disabled={active && !canAct}
          onClick={() =>
            active
              ? createTournament(active.name, size)
              : onNeedProfile?.()
          }
        >
          {active ? "შექმენი ტურნირი" : "აირჩიე პროფილი"}
          <ArrowRight size={18} />
        </button>
      </section>
      <section className="k-open-tournaments">
        <span className="k-eyebrow">OPEN TOURNAMENTS</span>
        {openList.length ? (
          openList.map((t) => (
            <button
              key={t.id}
              disabled={!canAct}
              onClick={() => joinTournament(t.code, active.name)}
            >
              <strong>
                {t.code}
                <small>{t.createdBy}</small>
              </strong>
              <span>
                {t.players.length} / {t.size}
              </span>
              <ArrowRight size={18} />
            </button>
          ))
        ) : (
          <div className="k-tournament-empty">
            <span>↗</span>
            <h4>პირველი სვლა შენია.</h4>
            <p>
              ღია ტურნირი ჯერ არ არის.
              <br />
              შექმენი ახალი ან შემოდი კოდით.
            </p>
          </div>
        )}
        <form
          className="k-join-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canAct && code.trim().length >= 4)
              joinTournament(code.trim(), active.name);
          }}
        >
          <input
            className="k-input"
            aria-label="ტურნირის კოდი"
            placeholder="ტურნირის კოდი"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button
            className="k-button"
            aria-label="ტურნირში შეერთება"
            disabled={!canAct || code.trim().length < 4}
          >
            <ArrowRight size={18} />
          </button>
        </form>
      </section>
    </div>
  );
}
