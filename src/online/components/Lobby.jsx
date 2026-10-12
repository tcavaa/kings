import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  X,
  Users,
  Swords,
  LogOut,
  Crown,
} from "lucide-react-online";
import { useGame } from "../context/GameContext";
import {
  listProfiles,
  getActiveProfileId,
  clearActiveProfile,
  markProfileVerified,
} from "../lib/profiles";
import { api } from "../lib/api";
import ProfileForm, { ProfilePicker } from "./ProfileForm";
import PinPromptModal from "./PinPromptModal";
import PublicRoomPanel from "./PublicRoomPanel";
import LiveTables from "./LiveTables";
const TournamentPanel = lazy(() => import("./Tournament/TournamentPanel"));
import ClubShell, { openScoreApp } from "./ui/ClubShell";
import Sheet from "./ui/Sheet";
import AvatarImg from "./AvatarImg";

export default function Lobby({ onOpenLeaderboard }) {
  const {
    createRoom,
    joinRoom,
    connected,
    publicSeat,
    onlinePlayers,
    announcePresence,
    refreshLobby,
    resumableSeat,
    resumeSeat,
    dismissResumeSeat,
  } = useGame();

  const [mode, setMode] = useState("championship");
  const [dialog, setDialog] = useState(null);
  const [profileError, setProfileError] = useState(false);

  const [profiles, setProfiles] = useState([]);
  // The "locked-in" profile id (the one the user has already verified on
  // this device, persisted in localStorage). Never auto-set by the lobby —
  // it only changes when the user successfully types a PIN.
  const [activeId, setActiveId] = useState(() => getActiveProfileId());
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  // Pre-fill the room code from the last successful join so a quick refresh
  // or an accidental tab close doesn't force the player to retype it.
  const [joinCode, setJoinCode] = useState(() => {
    try {
      return localStorage.getItem("king.lastRoom") || "";
    } catch {
      return "";
    }
  });
  const [loading, setLoading] = useState(true);

  // The profile the user is trying to lock in to (PIN modal in flight).
  // null means no modal. Once the modal succeeds we promote `pinPending`
  // into `activeId`.
  const [pinPending, setPinPending] = useState(null);

  // Today's championship quota for the locked-in profile — null while
  // loading/unknown. Refetched whenever the active profile changes.
  const [quota, setQuota] = useState(null);

  // Load profiles from the server every time the lobby mounts. We
  // intentionally do NOT auto-pick the first one — on a fresh visit, the
  // user has to actively choose (and unlock) someone.
  const reload = useCallback(async () => {
    setLoading(true);
    setProfileError(false);
    try {
      const list = await listProfiles();
      const arr = Array.isArray(list) ? list : [];
      setProfiles(arr);
      // Only keep `activeId` if it still resolves to a real profile. If the
      // saved profile was deleted on another device, drop the lock-in.
      setActiveId((prev) => {
        if (prev && arr.some((p) => p.id === prev)) return prev;
        if (prev) clearActiveProfile();
        return null;
      });
      // First-time visitors with no saved profiles land straight in the
      // "create profile" form. Otherwise we always start by showing the
      // picker, even if there's a lock-in (the lock-in shows up there as
      // the highlighted entry).
      setShowForm(arr.length === 0);
      return arr;
    } catch (err) {
      setProfileError(true);
      setProfiles([]);
      setShowForm(true);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const active = activeId ? profiles.find((p) => p.id === activeId) : null;

  // Fetch who's online and which tables are live, and tell the server who is
  // here once a profile is chosen. Nobody on the homepage is in a room, so
  // without this they're invisible to the online count. Re-runs on reconnect:
  // the server forgets presence when a socket drops.
  useEffect(() => {
    if (!connected) return undefined;
    refreshLobby();
    if (active?.name) announcePresence(active.name, active.avatar);
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


  const onProfileSaved = async (saved) => {
    await reload();
    // Newly-created or just-edited profile: the user proved knowledge of
    // the PIN inside the form (they had to type it on create), so we can
    // skip the prompt and lock them straight in.
    if (saved?.id) {
      markProfileVerified(saved.id);
      setActiveId(saved.id);
    }
    setShowForm(false);
    setEditing(null);
    setDialog(null);
  };

  // Picking a *different* profile pops the PIN prompt. Clicking the
  // already-active one is a no-op (no need to re-authenticate). Profiles
  // without a PIN are promoted instantly.
  const pickProfile = (profile) => {
    if (!profile?.id) return;
    if (profile.id === activeId) return;
    if (!profile.has_pin) {
      markProfileVerified(profile.id);
      setActiveId(profile.id);
      return;
    }
    setPinPending(profile);
  };

  const switchProfile = () => {
    clearActiveProfile();
    setActiveId(null);
  };

  // Action buttons no longer need their own PIN prompt — `activeId` being
  // truthy already implies "verified on this device", so we just fire the
  // socket call directly.
  const handleCreate = () => {
    if (!active) return;
    // Every table is a league table (the casual "classic" mode is gone).
    createRoom(active.name, active.avatar, "championship");
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
    joinRoom(code, active.name, active.avatar);
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
  const canPlay = connected && active && publicSeat === null;
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
          {connected ? "სივრცე ღიაა" : "სერვერთან დაკავშირება…"}
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
              mode={mode}
              quota={quota}
              onNeedProfile={openProfile}
            />
          )}
          {mode === "tournament" && (
            <Suspense
              fallback={
                <p className="k-empty" role="status">
                  იტვირთება…
                </p>
              }
            >
              <TournamentPanel active={active} onNeedProfile={openProfile} />
            </Suspense>
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
        <Sheet
          title={active ? "შენი სივრცე." : "ყველაფერი შენით იწყება."}
          onClose={() => setDialog(null)}
        >
          <div className="k-profile-area">
            {loading ? (
              <p role="status">პროფილები იტვირთება…</p>
            ) : profileError ? (
              <div className="k-empty">
                <p>პროფილების ჩატვირთვა ვერ მოხერხდა.</p>
                <button className="k-button" onClick={reload}>
                  სცადე ხელახლა <ArrowRight size={16} />
                </button>
              </div>
            ) : showForm ? (
              <ProfileForm
                key={editing?.id || "new"}
                editing={editing}
                onDone={onProfileSaved}
                onCancel={
                  profiles.length
                    ? () => {
                        setShowForm(false);
                        setEditing(null);
                      }
                    : null
                }
              />
            ) : (
              <>
                {active && (
                  <div className="k-member">
                    <AvatarImg avatar={active.avatar} size={64} />
                    <div>
                      <small>PLAYER PROFILE</small>
                      <h3>{active.name}</h3>
                    </div>
                    <button
                      className="k-icon-button"
                      title="პროფილის გადართვა"
                      onClick={switchProfile}
                    >
                      <LogOut size={18} />
                    </button>
                  </div>
                )}
                <ProfilePicker
                  profiles={profiles}
                  value={activeId}
                  onChange={pickProfile}
                  onEdit={(p) => {
                    setEditing(p);
                    setShowForm(true);
                  }}
                />
                <button
                  className="k-button k-button-outline"
                  onClick={() => {
                    setEditing(null);
                    setShowForm(true);
                  }}
                >
                  ახალი პროფილი <Plus size={18} />
                </button>
              </>
            )}
          </div>
          {pinPending && (
            <PinPromptModal
              profile={pinPending}
              onSuccess={({ profile }) => {
                markProfileVerified(profile.id);
                setActiveId(profile.id);
                setPinPending(null);
                setDialog(null);
              }}
              onCancel={() => setPinPending(null)}
            />
          )}
        </Sheet>
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
