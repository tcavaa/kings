import { useEffect, useState } from "react";
import { ArrowRight, Plus, LogOut } from "lucide-react-online";
import { useGame } from "../../context/GameContext";
import AvatarImg from "../AvatarImg";

const SIZES = [6, 9];

/**
 * Lobby entry point for King tournaments.
 *
 * A tournament needs exactly 6 or 9 entrants; the creator picks which. Once
 * the last seat fills the server draws the tables and everyone is dropped
 * straight onto a table, so this panel only ever shows the waiting stage.
 */
export default function TournamentPanel({ active, onNeedProfile }) {
  const {
    connected,
    publicSeat,
    tournament,
    tournamentList,
    createTournament,
    joinTournament,
    leaveTournament,
    refreshTournaments,
  } = useGame();

  const [size, setSize] = useState(6);
  const [code, setCode] = useState("");

  // Refresh the open-tournament list on mount and whenever ours changes
  // (creating or leaving one changes what everybody else should see).
  useEffect(() => {
    if (connected) refreshTournaments();
  }, [connected, tournament, refreshTournaments]);

  // One table at a time: not while sitting at the homepage table.
  const canAct = connected && !!active && publicSeat === null;

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
                  <AvatarImg avatar={p.avatar} size={48} />
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
        {tournamentList.length ? (
          tournamentList.map((t) => (
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
