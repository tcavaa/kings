import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  X,
  Users,
  Swords,
  Crown,
} from "lucide-react-online";
import { useGame, useLobby } from "../context/GameContext";
import { api } from "../lib/api";
import { useProfiles } from "../hooks/useProfiles";
import ProfileSheet from "./ProfileSheet";
import PublicRoomPanel from "./PublicRoomPanel";
import LiveTables from "./LiveTables";
// Small, and shown on the first tab click: not worth a lazy chunk.
import TournamentPanel from "./Tournament/TournamentPanel";
import ClubShell, { openScoreApp } from "./ui/ClubShell";
import Sheet from "./ui/Sheet";

// After this long without a connection the server is most likely asleep
// (Render's free tier cold-starts in up to ~30 s); say so.
const WAKING_NOTE_MS = 5000;

export default function Lobby({ onOpenLeaderboard }) {
  const {
    createRoom,
    joinRoom,
    connected,
    publicSeat,
    tournament,
    announcePresence,
    refreshLobby,
    resumableSeat,
    resumeSeat,
    dismissResumeSeat,
  } = useGame();
  const { onlinePlayers } = useLobby();

  const [mode, setMode] = useState("championship");
  const [dialog, setDialog] = useState(null);
  const profileState = useProfiles();
  const { active } = profileState;
  // Pre-fill the room code from the last successful join so a quick refresh
  // or an accidental tab close doesn't force the player to retype it.
  const [joinCode, setJoinCode] = useState(() => {
    try {
      return localStorage.getItem("king.lastRoom") || "";
    } catch {
      return "";
    }
  });

  // Today's championship quota for the locked-in profile — null while
  // loading/unknown. Refetched whenever the active profile changes.
  const [quota, setQuota] = useState(null);

  const [waking, setWaking] = useState(false);
  useEffect(() => {
    setWaking(false);
    if (connected) return undefined;
    const t = setTimeout(() => setWaking(true), WAKING_NOTE_MS);
    return () => clearTimeout(t);
  }, [connected]);

  // Fetch who's online and which tables are live, and tell the server who is
  // here once a profile is chosen. Nobody on the homepage is in a room, so
  // without this they're invisible to the online count. Re-runs on reconnect:
  // the server forgets presence when a socket drops.
  useEffect(() => {
    if (!connected) return undefined;
    refreshLobby();
    if (active?.name) announcePresence(active.name);
  }, [connected, active?.name, active?.avatar, announcePresence, refreshLobby]);

  // Championship quota for the active profile. Refetched on profile switch;
  // a failed fetch just hides the counter (server still enforces the limit).
  useEffect(() => {
    let cancelled = false;
    setQuota(null);
    if (!active?.name) return undefined;
    api
      .getChampionshipQuota(active.name)
      .then((q) => {
        if (!cancelled) setQuota(q);
      })
      .catch(() => {
        /* counter hidden; server-side check still applies */
      });
    return () => {
      cancelled = true;
    };
  }, [active?.name]);

  const quotaSpent = quota != null && quota.remaining <= 0;

  // Action buttons need no PIN prompt of their own — an active profile is
  // already verified on this device, so we just fire the socket call.
  const handleCreate = () => {
    if (!active) return;
    // Every table is a league table (the casual "classic" mode is gone).
    createRoom(active.name, "championship");
  };

  const handleJoin = () => {
    if (!active) return;
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    try {
      localStorage.setItem("king.lastRoom", code);
    } catch {
      /* ignore quota */
    }
    joinRoom(code, active.name);
  };

  const modes = [
    {
      id: "championship",
      n: "01",
      title: "ლიგა",
      subtitle: "MAKE YOUR MARK",
      icon: Crown,
    },
    {
      id: "tournament",
      n: "02",
      title: "ტურნირი",
      subtitle: "TAKE THE STAGE",
      icon: Swords,
    },
  ];
  // One table at a time: not while seated at the homepage table or entered
  // in a tournament.
  const canPlay = connected && active && publicSeat === null
    && !(tournament && tournament.status !== "done");
  const openProfile = () => setDialog("profile");
  return (
    <ClubShell
      onHome={() => {
        setMode("championship");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
      onLeaderboard={onOpenLeaderboard}
      onProfile={openProfile}
      profile={active}
      connected={connected}
    >
      <section className="k-welcome">
        <div className="k-welcome-copy">
          <span className="k-eyebrow">
            <span className="k-live-dot" /> THE GAME HAS CHANGED
          </span>
          <h1>
            ითამაშე
            <br />
            <span>სხვანაირად.</span>
            <i>↗</i>
          </h1>
          <p>
            კარტი იგივეა. გამოცდილება — სრულიად ახალი.
            <br />
            იპოვე შენი რიტმი, შენი მეტოქე, შენი თამაში.
          </p>
          <a className="k-link" href="#games">
            შენი შემდეგი სვლა <ArrowRight size={19} />
          </a>
        </div>
        <div className="k-deck-art" aria-hidden="true">
          <span className="k-art-orbit" />
          <span className="k-art-label">
            THE NEW
            <br />
            STANDARD.
          </span>
          <div className="k-graphic-card k-card-back">
            <img src="/art/card-back.webp" alt="" width="240" height="342" />
          </div>
          <div className="k-graphic-card k-card-front">
            <span>
              A<small>♠</small>
            </span>
            <b>♠</b>
            <em>KING / 01</em>
          </div>
          <span className="k-art-bottom">LESS LUCK. MORE YOU.</span>
        </div>
      </section>
      <div className="k-live-line">
        <span>
          <i className={connected ? "k-live-dot" : ""} />
          {connected
            ? "სივრცე ღიაა"
            : waking
              ? "სერვერი იღვიძებს — ამას ნახევარი წუთი შეიძლება დასჭირდეს…"
              : "სერვერთან დაკავშირება…"}
        </span>
        <span>
          <Users size={14} />
          {onlinePlayers?.length || 0} მოთამაშე ონლაინ
        </span>
        <span>3 მოთამაშე. 27 რაუნდი. ერთი გამარჯვება.</span>
      </div>
      {resumableSeat && publicSeat === null && (
        <div className="k-resume">
          <span>
            შენი მაგიდა გელოდება <b>{resumableSeat.roomCode}</b>
          </span>
          <button className="k-link" disabled={!connected} onClick={resumeSeat}>
            დაბრუნება <ArrowRight size={16} />
          </button>
          <button
            className="k-icon-button"
            aria-label="შეხსენების დახურვა"
            onClick={dismissResumeSeat}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <section id="games" className="k-game-section">
        <div className="k-section-title">
          <div>
            <span className="k-eyebrow">01 / FIND YOUR GAME</span>
            <h2>როგორ თამაშობ დღეს?</h2>
          </div>
          <button className="k-link" onClick={() => setDialog("private")}>
            მეგობრებთან ერთად <ArrowUpRight size={18} />
          </button>
        </div>
        <div className="k-mode-tabs" role="tablist" aria-label="თამაშის რეჟიმი">
          {modes.map((m) => (
            <button
              role="tab"
              tabIndex={mode === m.id ? 0 : -1}
              onKeyDown={(e) => {
                const direction =
                  e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (direction) {
                  e.preventDefault();
                  const next =
                    modes[
                      (modes.findIndex((x) => x.id === m.id) +
                        direction +
                        modes.length) %
                        modes.length
                    ];
                  setMode(next.id);
                  document.getElementById(`mode-${next.id}`)?.focus();
                }
              }}
              id={`mode-${m.id}`}
              aria-selected={mode === m.id}
              aria-controls="mode-panel"
              key={m.id}
              onClick={() => setMode(m.id)}
            >
              <span>
                {m.n}
                <m.icon size={20} />
              </span>
              <strong>{m.title}</strong>
              <small>{m.subtitle}</small>
              <ArrowUpRight className="k-mode-arrow" size={19} />
            </button>
          ))}
        </div>
        <div
          id="mode-panel"
          role="tabpanel"
          aria-labelledby={`mode-${mode}`}
          className="k-mode-panel"
        >
          {mode === "championship" && (
            <PublicRoomPanel
              active={active}
              quota={quota}
              onNeedProfile={openProfile}
            />
          )}
          {mode === "tournament" && (
            <TournamentPanel active={active} onNeedProfile={openProfile} />
          )}
        </div>
      </section>
      <LiveTables active={active} onNeedProfile={openProfile} />
      <div className="k-discover">
        <button className="k-discover-tile" onClick={onOpenLeaderboard}>
          <span className="k-eyebrow">02 / THE LEADERBOARD</span>
          <h3>
            ვინ ცვლის
            <br />
            თამაშის წესებს?
          </h3>
          <span className="k-discover-index">#01</span>
          <span className="k-circle-arrow">
            <ArrowUpRight size={23} />
          </span>
          <small>აღმოაჩინე ლიდერები</small>
        </button>
        <button
          className="k-discover-tile k-discover-dark"
          onClick={openScoreApp}
        >
          <span className="k-eyebrow">03 / KEEP THE SCORE</span>
          <h3>
            მაგიდასთან ხარ?
            <br />
            ჩაწერე ქულები.
          </h3>
          <span className="k-discover-suit">♣</span>
          <span className="k-circle-arrow">
            <ArrowUpRight size={23} />
          </span>
          <small>ჩაწერა · King Score</small>
        </button>
      </div>
      <div className="k-thought">
        <span>BETWEEN THE MOVES</span>
        <p>
          „მარცხი შედეგია.
          <br />
          დანებება — არჩევანი.“
        </p>
        <span>— KING REFLECTIONS</span>
      </div>
      {dialog === "profile" && (
        <ProfileSheet p={profileState} onClose={() => setDialog(null)} />
      )}
      {dialog === "private" && (
        <Sheet title="შენი ხალხი. შენი მაგიდა." onClose={() => setDialog(null)}>
          <div className="k-private-setup">
            <p>მოიწვიე მეგობრები ან შეუერთდი მათ კოდით.</p>
            {!active && (
              <button className="k-button" onClick={openProfile}>
                ჯერ აირჩიე პროფილი <ArrowRight size={18} />
              </button>
            )}
            <span className="k-eyebrow">CREATE A LEAGUE TABLE</span>
            <button
              className="k-button"
              disabled={!canPlay || quotaSpent}
              onClick={handleCreate}
            >
              შექმენი მაგიდა <Plus size={18} />
            </button>
            {quotaSpent && <small>ლიგის დღიური ლიმიტი ამოიწურა.</small>}
            <span className="k-eyebrow">HAVE AN INVITE?</span>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleJoin();
              }}
              className="k-join-form"
            >
              <input
                aria-label="ოთახის კოდი"
                className="k-input"
                placeholder="ოთახის კოდი"
                maxLength={6}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              />
              <button
                className="k-button"
                disabled={!canPlay || !joinCode.trim()}
                type="submit"
                aria-label="მაგიდასთან შეერთება"
              >
                <ArrowRight size={20} />
              </button>
            </form>
          </div>
        </Sheet>
      )}
    </ClubShell>
  );
}
