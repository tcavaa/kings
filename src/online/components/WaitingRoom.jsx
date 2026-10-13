import { useEffect, useRef, useState } from "react";
import { Check, Copy, ArrowRight, Plus, ArrowLeft } from "lucide-react";
import { useGame } from "../context/GameContext";
import AvatarImg from "./AvatarImg";
import { Wordmark } from "./ui/ClubShell";

export default function WaitingRoom() {
  const {
    roomCode,
    players,
    mySeat,
    isCreator,
    startGame,
    roomMode,
    leaveRoom,
  } = useGame();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);
  useEffect(() => {
    import("./GameLayout");
  }, []);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  const canStart =
    isCreator &&
    players.length === 3 &&
    players.every((p) => p.connected !== false);
  return (
    <div className="k-wait-page">
      <header className="k-wait-nav">
        <Wordmark />
        <button className="k-link" onClick={leaveRoom}>
          <ArrowLeft size={17} />
          სივრცეში დაბრუნება
        </button>
        <span>
          {roomMode === "championship" ? "KING / RANKED" : "KING / CLASSIC"}
        </span>
      </header>
      <main className="k-wait-layout">
        <section className="k-wait-copy">
          <span className="k-eyebrow">THE TABLE IS YOURS</span>
          <h1>
            კარგი კომპანია.
            <br />
            <em>უკეთესი თამაში.</em>
          </h1>
          <p>
            შენი ადგილი უკვე აქ არის.
            <br />
            მოიწვიე მეგობრები და დაიწყეთ თამაში.
          </p>
          <div className="k-invite-ticket">
            <span>შენი მოწვევის კოდი</span>
            <div>
              <strong>{roomCode}</strong>
              <button
                className="k-icon-button"
                onClick={copyCode}
                aria-label="კოდის კოპირება"
              >
                {copied ? <Check size={20} /> : <Copy size={20} />}
              </button>
            </div>
            <small role="status">
              {copied
                ? "კოდი დაკოპირდა. გაუზიარე მეგობრებს."
                : "დააკოპირე. გაუზიარე. ითამაშე."}
            </small>
          </div>
          <button className="k-button" disabled={!canStart} onClick={startGame}>
            {canStart
              ? "დავიწყოთ თამაში"
              : isCreator
                ? `ველოდებით მოთამაშეებს (${players.length}/3)`
                : "წამყვანი დაიწყებს თამაშს"}
            <ArrowRight size={20} />
          </button>
        </section>
        <section className="k-wait-table" aria-label="მოთამაშეები">
          <span className="k-table-edition">PRIVATE SESSION / {roomCode}</span>
          <div className="k-oval">
            <span>
              kıng<small>THE TABLE IS SET.</small>
            </span>
          </div>
          {[0, 1, 2].map((seat) => {
            const p = players.find((p) => p.seat === seat);
            return (
              <div
                className={`k-wait-seat seat-${seat} ${p ? "filled" : ""}`}
                key={seat}
              >
                <div>
                  {p ? (
                    <AvatarImg avatar={p.avatar} size={74} />
                  ) : (
                    <Plus size={26} />
                  )}
                </div>
                <strong>{p?.name || "ღია ადგილი"}</strong>
                <small>
                  {p
                    ? p.connected === false
                      ? "კავშირი წყდება…"
                      : seat === mySeat
                        ? "შენი ადგილი"
                        : "მზადაა"
                    : "მოიწვიე მეგობარი"}
                </small>
              </div>
            );
          })}
          <div className="k-seat-progress">
            {[0, 1, 2].map((i) => (
              <i key={i} className={players.length > i ? "filled" : ""} />
            ))}
            <span>{players.length} / 3 მოთამაშე</span>
          </div>
        </section>
      </main>
      <footer className="k-wait-footer">
        A GOOD GAME STARTS WITH GOOD COMPANY.<span>კინგი / ახალი თაობა</span>
      </footer>
    </div>
  );
}
