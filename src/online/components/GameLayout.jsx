import "../styles/game-light.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Swords, Eye } from "lucide-react-online";
import { useGame, useChat } from "../context/GameContext";
import { EventBus } from "../game/EventBus";
import PhaserGame from "../game/PhaserGame";
import GameTypeSelector from "./GameTypeSelector";
import TrumpSelector from "./TrumpSelector";
import DiscardSelector from "./DiscardSelector";
import ChatOverlay from "./ChatOverlay";
import TopBar from "./Hud/TopBar";
import ScoreBoardPanel from "./Hud/ScoreBoardPanel";
import ActionPanel from "./Hud/ActionPanel";
import ScoreDrawer from "./Hud/ScoreDrawer";
import SoundBoard from "./Hud/SoundBoard";
import MenuDrawer from "./Hud/MenuDrawer";
import DisconnectBanner from "./Hud/DisconnectBanner";
import RoundResult from "./Hud/RoundResult";

import QuitModal from "./Hud/QuitModal";
import BracketOverview from "./Tournament/BracketOverview";
import { quoteForRound } from "../constants/quotes";
import { useWakeLock } from "../hooks/useWakeLock";

/**
 * Orchestrator for the in-game experience: hosts the Phaser canvas and
 * stitches together all the HUD overlays. Each visual block lives in its own
 * file under `Hud/`; this component is intentionally thin glue.
 */
export default function GameLayout() {
  // Before paint, so the first frame already has the light game styles.
  useLayoutEffect(() => {
    document.body.classList.add("king-light-game");
    return () => document.body.classList.remove("king-light-game");
  }, []);
  const {
    hand,
    cardCounts,
    centerCards,
    currentTrick,
    ledSuit,
    currentTurn,
    mySeat,
    players,
    leaderSeat,
    gamePhase,
    chosenGameType,
    trumpSuit,
    round,
    cumulativeScores,
    trickAnimation,
    playCard,
    playPending,
    roomCode,
    tournamentSeat,
    spectating,
    stopSpectating,
    quitProposal,
    reconnecting,
  } = useGame();
  const { chatBubbles, typingSeats, canSpeak } = useChat();

  // One famous Georgian line per round — same pick for all three players,
  // and the round-end modal shows the identical sentence.
  const roundQuote = quoteForRound(roomCode, round);

  const [drawer, setDrawer] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(null); // null | 'round' | 'game'
  const [bracketOpen, setBracketOpen] = useState(false);

  const openDrawer = useCallback(
    (id) => setDrawer((prev) => (prev === id ? null : id)),
    [],
  );
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const toggleMenu = useCallback(() => setMenuOpen((o) => !o), []);
  const toggleChat = useCallback(() => setChatOpen((o) => !o), []);
  const openScores = useCallback(() => openDrawer("scores"), [openDrawer]);
  const openLast = useCallback(() => openDrawer("last"), [openDrawer]);

  const handleMenuPick = (id) => {
    if (id === "quitRound") setConfirmQuit("round");
    else if (id === "surrender") setConfirmQuit("game");
    else openDrawer(id);
  };

  // Table-side typing indicator: seats typing in chat get a "…" bubble above
  // their avatar via the same canvas bubble pipeline as real messages — a
  // real message (spread last) always wins over the typing placeholder.
  const bubblesWithTyping = useMemo(
    () => ({
      ...Object.fromEntries(
        Object.keys(typingSeats || {}).map((s) => [s, { message: "• • •" }]),
      ),
      ...chatBubbles,
    }),
    [typingSeats, chatBubbles],
  );

  // Memoized so PhaserGame's `useEffect([gameState])` — which triggers a full
  // scene teardown/redraw via EventBus — fires only when the game state
  // actually changed, not on every unrelated GameLayout render (drawer
  // toggles, quote changes, chat traffic). setState always produces fresh
  // objects for real updates, so no legitimate emit is ever skipped.
  const gameState = useMemo(
    () => ({
      hand,
      cardCounts,
      centerCards,
      currentTrick,
      ledSuit,
      currentTurn,
      mySeat,
      players,
      leaderSeat,
      gamePhase,
      chosenGameType,
      trumpSuit,
      round,
      cumulativeScores,
      trickAnimation,
      chatBubbles: bubblesWithTyping,
      // While offline (or not yet back in our seat) a tap can't reach the
      // server in time, so the hand stays locked like a play in flight.
      playPending: playPending || reconnecting,
      // Lets the canvas tell "the seat this view is anchored to" apart from
      // "the person looking" — a watcher is anchored to seat 0 but owns none.
      spectator: !!spectating,
    }),
    [
      hand,
      cardCounts,
      centerCards,
      currentTrick,
      ledSuit,
      currentTurn,
      mySeat,
      players,
      leaderSeat,
      gamePhase,
      chosenGameType,
      trumpSuit,
      round,
      cumulativeScores,
      trickAnimation,
      bubblesWithTyping,
      playPending,
      reconnecting,
      spectating,
    ],
  );

  const handleCardPlay = useCallback((card) => playCard(card), [playCard]);

  // A watcher has no seat, so `mySeat === leaderSeat` is already false for
  // every selector below and the empty hand leaves nothing clickable. The
  // flag is here to make the intent explicit and to gate the menu actions.
  const isSpectator = !!spectating;

  const showTypeSelector =
    gamePhase === "type_selection" && mySeat === leaderSeat;
  const showTrumpSelector =
    gamePhase === "trump_selection" && mySeat === leaderSeat;
  const showDiscard = gamePhase === "discard" && mySeat === leaderSeat;
  const showRoundResult = gamePhase === "round_end";
  const showWaiting =
    gamePhase === "playing" && currentTurn !== mySeat && !trickAnimation;

  const turnName = players.find((p) => p.seat === currentTurn)?.name ?? "…";
  const leaderName = players.find((p) => p.seat === leaderSeat)?.name ?? "…";
  const leaderBusy =
    (gamePhase === "type_selection" ||
      gamePhase === "trump_selection" ||
      gamePhase === "discard") &&
    mySeat !== leaderSeat;
  const leaderBusyLabel =
    gamePhase === "type_selection"
      ? "თამაშის არჩევას"
      : gamePhase === "trump_selection"
        ? "კოზირის არჩევას"
        : gamePhase === "discard"
          ? "2 კარტის გადადებას"
          : "";

  // ── On-our-turn handling: vibrate + force a canvas resync ──────────────────
  // The vibrate is the original mobile nicety. The force-render is a desync
  // guard for the "I can't see the card they just played, so I can't take my
  // turn" bug: if our React state is already correct but the Phaser canvas
  // skipped a render (e.g. a state-update arrived while the trick-fly
  // animation gate was up), this clears the gate and repaints the freshest
  // snapshot the instant it's our move. Small delay so a legitimate trick-fly
  // animation finishes first. (The deeper case — our React state itself being
  // stale — is handled by the request-state watchdog in GameContext.)
  const wasMyTurnRef = useRef(false);
  useEffect(() => {
    const isMyTurn =
      gamePhase === "playing" && currentTurn === mySeat && !trickAnimation;
    const justBecameMyTurn = isMyTurn && !wasMyTurnRef.current;
    wasMyTurnRef.current = isMyTurn;
    if (!justBecameMyTurn) return;
    if (typeof navigator !== "undefined" && navigator.vibrate)
      navigator.vibrate(80);
    const t = setTimeout(() => EventBus.emit("force-render"), 250);
    return () => clearTimeout(t);
  }, [gamePhase, currentTurn, mySeat, trickAnimation]);

  // Keep the screen awake while a game is in progress.
  useWakeLock();

  // Another player's quit proposal replaces any confirm dialog we had open;
  // drop ours, or it pops back up once their vote is over.
  useEffect(() => {
    if (quitProposal) setConfirmQuit(null);
  }, [quitProposal]);

  return (
    // The wrapper must track the *visible* viewport height, not the layout
    // viewport. On mobile (esp. landscape) `inset-0`/`100vh` reports the
    // taller layout viewport — the area behind the browser chrome — so the
    // FIT-scaled Phaser canvas renders its bottom (own avatar + cards) below
    // the fold and it gets clipped. `.h-screen-dvh` (100dvh w/ fallbacks)
    // pins the height to what's actually on screen so the table always fits
    // 100%. `safe-area-pad` then keeps HUD elements clear of notch / home-
    // indicator / rounded-corner regions.
    <div
      className={`k-game-screen ${canSpeak ? "has-sounds" : ""} fixed top-0 left-0 right-0 h-screen-dvh overflow-hidden safe-area-pad`}
    >
      <PhaserGame gameState={gameState} onCardPlay={handleCardPlay} />

      <TopBar
        waiting={
          leaderBusy
            ? { name: leaderName, label: leaderBusyLabel }
            : showWaiting
              ? { name: turnName, label: "სვლას" }
              : null
        }
        onToggleRounds={() => openDrawer("matrix")}
        onToggleMenu={toggleMenu}
        onToggleScores={openScores}
        onToggleChat={toggleChat}
      />

      {/* Tournament chrome. Deliberately a LEFT-aligned column rather than
          centred: the middle of that band now belongs to the clock, and the
          spectator badge used to sit exactly on top of it. */}
      {(tournamentSeat || spectating) && (
        <div
          className="absolute z-30 flex flex-col items-start gap-1.5 pointer-events-none"
          style={{
            top: "calc(env(safe-area-inset-top, 0px) + 58px)",
            left: 12,
          }}
        >
          {/* The bracket button belongs to tournament play only. A watcher who
              came in off the homepage has no bracket to open. */}
          {(tournamentSeat || spectating?.tournamentId) && (
            <button
              onClick={() => setBracketOpen(true)}
              title="ტურნირის მიმოხილვა"
              className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold active:scale-95 transition-transform"
              style={{
                background: "linear-gradient(180deg, #172725 0%, #13221f 100%)",
                border: "1px solid rgba(213,185,130,0.6)",
                color: "#eeeae1",
                boxShadow: "0 2px 0 rgba(0,0,0,0.25)",
              }}
            >
              <Swords size={14} /> ტურნირი
            </button>
          )}

          {spectating && (
            <div
              className="pointer-events-auto inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-bold"
              style={{
                background: "rgba(49,83,107,0.92)",
                color: "#eeeae1",
                border: "1px solid rgba(244,232,207,0.35)",
              }}
            >
              <Eye size={13} /> უყურებ
              <button
                onClick={stopSpectating}
                className="underline ml-1 font-normal"
              >
                გასვლა
              </button>
            </div>
          )}
        </div>
      )}

      {bracketOpen && <BracketOverview onClose={() => setBracketOpen(false)} />}
      <ScoreBoardPanel onOpen={openScores} />
      <ActionPanel onLastTrick={openLast} />

      {/* Per-round poet line, hanging centre-top below the round tracker.
          Offset clears both the TopBar pills (~56px) and the transient
          "waiting for X" chip (80–116px) so nothing overlaps. */}
      {roundQuote && (
        <div
          className="k-game-quote absolute left-1/2 -translate-x-1/2 z-10 pointer-events-none select-none text-center px-4 hide-on-phone-landscape"
          style={{
            top: "calc(env(safe-area-inset-top, 0px) + 96px)",
            maxWidth: "min(560px, 72vw)",
          }}
        >
          <p
            className="k-table-quote font-handwritten text-xs leading-snug"
            style={{ textShadow: "0 2px 8px rgba(0,0,0,0.4)" }}
          >
            „{roundQuote.text}“
          </p>
          <p
            className="text-[9px] font-typewriter uppercase tracking-widest mt-0.5"
            style={{ color: "rgba(213,185,130,0.6)" }}
          >
            — {roundQuote.author}
          </p>
        </div>
      )}

      {/* Sound Board trigger, parked next to the own ("You") avatar. The
          avatar sits bottom-centre, ~10% up from the bottom of the FIT-scaled
          canvas; we align the button's vertical centre to it and nudge it
          right into the gap where the old in-canvas grid used to be. The
          wrapper is pointer-events-none so only the button itself is clickable
          (the modal manages its own full-screen layer). */}
      <div className="k-game-audio absolute z-20 pointer-events-none">
        <SoundBoard />
      </div>

      <DisconnectBanner />

      {showTypeSelector && <GameTypeSelector />}
      {showTrumpSelector && <TrumpSelector />}
      {showDiscard && <DiscardSelector />}
      {showRoundResult && <RoundResult />}

      <QuitModal
        confirmKind={confirmQuit}
        onCloseConfirm={() => setConfirmQuit(null)}
      />

      <MenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onPick={handleMenuPick}
        spectator={isSpectator}
      />
      <ScoreDrawer panel={drawer} onClose={closeDrawer} />
      <ChatOverlay open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
