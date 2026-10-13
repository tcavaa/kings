import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { io } from 'socket.io-client'
import { EventBus } from '../game/EventBus'
import { SOCKET_URL, api, getClientKey } from '../lib/api'
import { getProfileToken, dropProfileSession } from '../lib/profiles'
import { voicePlayer } from '../lib/voicePlayer'
import { readSeatMarker, writeSeatMarker, clearSeatMarker } from '../lib/publicSeatStore'
import { getSounds, setSounds } from '../lib/soundRegistry'

const GameContext = createContext(null)
// Chat traffic (messages, table bubbles, typing pings) changes at keystroke
// frequency. It lives in its own context so that churn re-renders only the
// 2-3 chat consumers instead of every useGame() component + the canvas.
const ChatContext = createContext(null)

// ── Hand sorting ──────────────────────────────────────────────────────────────
const RANK_ORDER = ['A', 'K', 'Q', 'J', '10', '9', '8', '7']
const SUIT_ORDER = ['S', 'H', 'D', 'C']

function sortHand(hand) {
  return [...hand].sort((a, b) => {
    const sd = SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit)
    if (sd !== 0) return sd
    return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank)
  })
}

/**
 * Play `a` muted and immediately stop it. Two jobs: it satisfies the browser's
 * autoplay policy for this element (so a later socket-driven .play() outside
 * a gesture is allowed), and the play attempt is what actually downloads the
 * file — the elements are created with preload="none" so page load doesn't
 * pull down the whole clip library.
 *
 * The element STAYS muted afterwards. It's only unmuted in the real playback
 * path; unmuting here used to race — a rejected or interrupted prime could
 * flip `muted` back off while another prime was still running, occasionally
 * blasting every clip at once on page load.
 */
function primeAudioEl(a) {
  try {
    a.muted = true
    const stop = () => { a.pause(); a.currentTime = 0 }
    const p = a.play()
    if (p && typeof p.then === 'function') {
      p.then(stop).catch(() => { /* stays muted & idle — never audible */ })
    } else {
      setTimeout(stop, 0)
    }
  } catch { /* ignore */ }
}

const TRICK_DISPLAY_MS = 1300   // how long a completed trick stays on the table
const TRICK_ANIMATION_MS = 600  // how long the "fly to winner" animation runs

export function GameProvider({ children }) {
  const socketRef = useRef(null)

  const [connected, setConnected] = useState(false)

  const [roomCode, setRoomCode]   = useState('')
  const [players, setPlayers]     = useState([])
  const [mySeat, setMySeat]       = useState(null)
  const [isCreator, setIsCreator] = useState(false)

  const [appPhase, setAppPhase] = useState('lobby')

  const [gamePhase, setGamePhase]           = useState(null)
  const [round, setRound]                   = useState(1)
  const [leaderSeat, setLeaderSeat]         = useState(0)
  const [chosenGameType, setChosenGameType] = useState(null)
  const [trumpSuit, setTrumpSuit]           = useState(null)
  const [usedTypes, setUsedTypes]           = useState({ 0: [], 1: [], 2: [] })

  const [hand, setHand]                     = useState([])
  const [cardCounts, setCardCounts]         = useState({ 0: 0, 1: 0, 2: 0 })
  const [centerCards, setCenterCards]       = useState([])
  const [lastCenterCards, setLastCenterCards] = useState([])

  const [currentTrick, setCurrentTrick]       = useState([])
  const [ledSuit, setLedSuit]                 = useState(null)
  const [currentTurn, setCurrentTurn]         = useState(null)
  const [lastTrickResult, setLastTrickResult] = useState(null)
  const [trickAnimation, setTrickAnimation]   = useState(null) // { winnerSeat, trick } during animation

  const [roundScores, setRoundScores]           = useState([])
  const [roundDetails, setRoundDetails]         = useState([])
  const [cumulativeScores, setCumulativeScores] = useState({ 0: 0, 1: 0, 2: 0 })
  const [finalResults, setFinalResults]         = useState(null)

  const [toasts, setToasts]                     = useState([])
  const [disconnectedPlayer, setDisconnectedPlayer] = useState(null)
  // True from the moment our own socket goes offline until it reconnects
  // AND the server confirms re-attachment (room-joined { reconnected: true }).
  // Drives the self-disconnect banner.
  const [reconnecting, setReconnecting] = useState(false)
  const [selectedDiscards, setSelectedDiscards] = useState([])

  // Chat
  const [chatMessages, setChatMessages] = useState([])  // [{seat,name,avatar,message,at}]
  const [chatBubbles, setChatBubbles]   = useState({})  // seat -> {message, at}
  const bubbleTimers = useRef({})
  // Typing indicator — seats (other than ours) currently typing in chat.
  // Each entry auto-expires a couple of seconds after the last typing ping.
  const [typingSeats, setTypingSeats] = useState({})    // seat -> true
  const typingTimers    = useRef({})
  const typingSentAtRef = useRef(0)

  // ── Public quick-match room (homepage) ──────────────────────────────────
  // Live snapshot of the shared homepage table, broadcast to every socket.
  // `publicSeat` is OUR seat there (null = not sitting); while seated the
  // user stays on the lobby screen — the game only starts (and appPhase
  // flips) when the server sees the 3rd seat fill.
  // Two homepage quick-match tables — one casual, one championship.
  const EMPTY_TABLE = { roomCode: null, seats: [] }
  const [publicRoom, setPublicRoom] = useState({ public: EMPTY_TABLE, championship: EMPTY_TABLE })
  const [publicSeat, setPublicSeat] = useState(null)
  const publicSeatRef = useRef(null)
  const setPublicSeatBoth = (v) => { publicSeatRef.current = v; setPublicSeat(v) }
  // Which quick-match table the seat belongs to ('public' | 'championship').
  const [publicSeatMode, setPublicSeatMode] = useState(null)
  // A seat we *could* go back to, read from localStorage on boot. Offered as
  // a button in the lobby — never applied on our own (see publicSeatStore).
  const [resumableSeat, setResumableSeat] = useState(null)
  // Homepage: who's around, and which King tables can be watched.
  const [onlinePlayers, setOnlinePlayers] = useState([])
  const [liveGames, setLiveGames]         = useState([])
  // Mode of the room we're currently in ('public' | 'championship') — shown
  // in the waiting room and on the game-over screen.
  const [roomMode, setRoomMode] = useState('public')
  // Server wall-clock of the deal, origin for the in-game elapsed timer.
  const [gameStartedAt, setGameStartedAt] = useState(null)

  // ── Tournament ──────────────────────────────────────────────────────────
  // `tournament` is our own lobby/bracket membership; `tournamentOverview` is
  // the cross-table scoreboard; `tournamentSeat` tags the room we're playing
  // as a bracket table; `spectating` is set while watching someone else's.
  const [tournament, setTournament]                 = useState(null)
  const [tournamentList, setTournamentList]         = useState([])
  const [tournamentOverview, setTournamentOverview] = useState(null)
  const [tournamentSeat, setTournamentSeat]         = useState(null)
  const [spectating, setSpectating]                 = useState(null)
  const spectatingRef = useRef(null)
  const setSpectatingBoth = (v) => { spectatingRef.current = v; setSpectating(v) }

  // ── Quit-round / surrender vote ─────────────────────────────────────────
  // Set while a proposal is waiting on votes:
  //   { kind: 'round'|'game', proposerSeat, proposerName, acceptedSeats }
  // Cleared when it passes (round-complete / game-over lands), is declined,
  // or expires server-side.
  const [quitProposal, setQuitProposal] = useState(null)

  const playersRef = useRef(players)
  const mySeatRef  = useRef(null)
  const trickTimers = useRef([])
  // The switch to the results screen, a moment after game-over. Cancelled by
  // anything that moves us to another table first (the tournament final).
  const gameOverTimerRef = useRef(null)
  // Per-session credentials needed to silently rejoin our room after the
  // socket auto-reconnects with a fresh id. Stored as refs (not state) so
  // the `connect` listener — which is registered once inside the mount-only
  // useEffect below — can read the *current* values without re-binding.
  const roomCodeRef = useRef('')
  const myNameRef   = useRef('')
  // The tournament we're entered in, so a reconnect can rejoin it too.
  const tournamentCodeRef = useRef('')
  const hadDisconnectRef = useRef(false)
  // Mirrors `appPhase` for the mount-only socket effect (which can't see the
  // state variable). Used to keep background resyncs to screens that
  // actually have a table to resync.
  const appPhaseRef = useRef('lobby')
  // "Play in flight" lock — set the moment the user clicks a card, cleared
  // when the server acks (card-played / trick-complete) or rejects (error).
  // Prevents a rapid second click from optimistically removing a *second*
  // card from the hand before the first round-trip completes.
  const playPendingRef = useRef(false)
  const [playPending, setPlayPending] = useState(false)
  const setPlayPendingBoth = (v) => { playPendingRef.current = v; setPlayPending(v) }

  // ── Rematch coordination ────────────────────────────────────────────────
  // Populated from the server's `rematch-status` broadcast after the game
  // ends. `newRoomCode` is the rematch lobby; `joinedOldSeats` is the set
  // of seats (from the *old* / finished room) that have already clicked
  // Play Again. The game-over screen uses this to render the "wants to
  // play again" badge over each joined seat's avatar.
  const [rematch, setRematch] = useState({ newRoomCode: null, joinedOldSeats: [] })

  useEffect(() => { playersRef.current = players }, [players])

  // ── Desync recovery watchdog ──────────────────────────────────────────────
  // If we sit "waiting on someone else to play" for too long during the
  // playing phase, the likeliest cause is a dropped socket event that left our
  // view stale: we still think it's their turn while the server has already
  // advanced to ours → a deadlock the user can currently only escape by
  // refreshing. Quietly re-pull the authoritative snapshot.
  //
  // Armed ONLY while it's *not* our turn — when it's our turn we already hold
  // everything we need, so the active player never triggers a resync (no
  // flicker for the person actually thinking). The timer is re-armed every
  // time the turn changes; a normal hand-off clears it long before it fires.
  useEffect(() => {
    // Who must act right now: the current player while a trick is in
    // progress, or the leader during the per-round decision phases.
    const ACTIVE_PHASES = ['playing', 'type_selection', 'trump_selection', 'discard']
    if (!ACTIVE_PHASES.includes(gamePhase)) return
    const actorSeat = gamePhase === 'playing' ? currentTurn : leaderSeat
    if (actorSeat === null || actorSeat === undefined || actorSeat === mySeat) return
    const t = setTimeout(() => {
      socketRef.current?.emit('request-state')
    }, 9000)
    return () => clearTimeout(t)
  }, [gamePhase, currentTurn, leaderSeat, mySeat])

  // Mirrors the server's `canSpeak`: a watcher who wandered in from the
  // homepage gets text and reactions only, while a tournament watcher (a
  // fellow entrant, and accountable) keeps voice and the sound board. Used to
  // hide controls the server would refuse anyway.
  const canSpeak = !spectating || !!spectating.tournamentId

  // Who we play as, on every emit that seats or names us: the profile's
  // session token (the server takes the name and photo from it), plus the
  // name for a server that can't resolve the token.
  const identity = (name = myNameRef.current) => ({
    playerName: name, profileToken: getProfileToken(),
  })
  const setMe = (name) => { myNameRef.current = name }

  // Keep the ref in step with the state — cheaper than threading it through
  // every setAppPhase call site.
  useEffect(() => { appPhaseRef.current = appPhase }, [appPhase])

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const clearTrickTimers = () => {
    trickTimers.current.forEach(t => clearTimeout(t))
    trickTimers.current = []
  }
  const clearGameOverTimer = () => {
    clearTimeout(gameOverTimerRef.current)
    gameOverTimerRef.current = null
  }

  // One reusable <audio> per clip, keyed by wire id. They have to be
  // constructed up front and primed inside a user gesture (see the unlock
  // pass below) — a freshly-constructed Audio() inside a socket callback is
  // blocked by the autoplay policy.
  const audioElsRef = useRef(null)
  const audioUnlockedRef = useRef(false)
  // id -> the url its element was built from, so a clip whose audio an admin
  // replaced can be told apart from one that's unchanged.
  const audioUrlsRef = useRef({})

  // Build (or top up) the pool from whatever the registry currently holds.
  // Existing elements are kept as-is so a catalogue refresh never discards
  // an element that's already been unlocked.
  const syncAudioPool = useCallback(() => {
    if (typeof window === 'undefined') return
    const map = audioElsRef.current || {}
    for (const s of getSounds()) {
      // Compared on the url, not just the id: when an admin replaces a
      // clip's audio the id stays put but the url's `?v=` moves, and we want
      // the new bytes rather than the element still holding the old ones.
      if (map[s.id] && audioUrlsRef.current[s.id] === s.url) continue
      // Built-in urls carry a filename; `Male!` has a reserved URL character,
      // which the registry has already encoded.
      const a = new Audio(s.url)
      // 'none': don't fetch every clip during page load. The unlock pass
      // plays each element muted, which triggers the actual download — same
      // audible behavior, off the critical path.
      a.preload = 'none'
      a.volume = 0.7
      // Clips added after the first user gesture missed the unlock pass, so
      // prime them now — we're outside a gesture, but the autoplay policy is
      // per-document once it has been satisfied.
      if (audioUnlockedRef.current) primeAudioEl(a)
      map[s.id] = a
      audioUrlsRef.current[s.id] = s.url
    }
    audioElsRef.current = map
  }, [])

  if (!audioElsRef.current && typeof window !== 'undefined') syncAudioPool()

  // Pull the live catalogue (admin-managed) and refresh the button lists +
  // audio pool. A failure leaves the built-in fallback in place.
  useEffect(() => {
    let cancelled = false
    api.listSounds()
      .then(list => {
        if (cancelled) return
        setSounds(list)
        syncAudioPool()
      })
      .catch(err => console.warn('[sounds] catalogue fetch failed:', err.message))
    return () => { cancelled = true }
  }, [syncAudioPool])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let unlocked = false
    const unlock = () => {
      if (unlocked) return
      unlocked = true
      // Prime every element inside this user gesture so later socket-driven
      // .play() calls are allowed by the autoplay policy (see primeAudioEl).
      // Strictly once per session — no retry loop to interleave with itself.
      // The flag lets clips that arrive later (catalogue fetch resolving
      // after the first click) prime themselves as they're created.
      audioUnlockedRef.current = true
      Object.values(audioElsRef.current || {}).forEach(primeAudioEl)
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown',     unlock)
    }
    window.addEventListener('pointerdown', unlock, { once: false })
    window.addEventListener('keydown',     unlock, { once: false })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown',     unlock)
    }
  }, [])

  useEffect(() => {
    // Use socket.io's default transport flow: connect via long-polling first
    // (which works on any HTTP server, including cPanel/LiteSpeed), then
    // *optimistically* upgrade to WebSocket in the background. If the host
    // doesn't allow WS upgrades, we silently stay on polling instead of
    // hanging on the WS handshake forever — that's why the page was stuck on
    // "Saddlin' up…". The game server is its own host (see SOCKET_URL).
    //
    // Reconnection is socket.io's default — we just turn the knobs to be
    // a bit more aggressive on the first few attempts because mobile wifi
    // tends to come back within seconds.
    const socket = io(SOCKET_URL, {
      // This browser's own secret: the server binds our seats to it, so a
      // refresh gets them back and nobody else can.
      auth: { clientKey: getClientKey() },
      withCredentials: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 8000,
    })
    socketRef.current = socket

    // ── Rematch broadcast ───────────────────────────────────────────────
    // Server fans this out to every socket still in the (just-finished)
    // old room whenever a Play Again click lands: the new lobby code +
    // the list of old seats that have signed up so far.
    socket.on('rematch-status', ({ newRoomCode, joinedOldSeats }) => {
      setRematch({
        newRoomCode: newRoomCode || null,
        joinedOldSeats: Array.isArray(joinedOldSeats) ? joinedOldSeats : [],
      })
    })

    socket.on('connect', () => {
      setConnected(true)
      // Always refresh the homepage public-table snapshot on (re)connect.
      socket.emit('public-room-info')
      // After a prior `disconnect`, socket.io has just (re)opened the
      // pipe — but the new socket id has no server-side mapping. Re-emit
      // `join-room` with our saved room/name so the server can run its
      // reconnection branch (returns `room-joined { reconnected: true }`
      // and a fresh `game-state` snapshot). Without this, the table looks
      // frozen on the previous tick and the user has to refresh.
      if (hadDisconnectRef.current && (roomCodeRef.current || tournamentCodeRef.current)) {
        if (roomCodeRef.current) {
          socket.emit('join-room', { roomCode: roomCodeRef.current, ...identity() })
        }
        // The tournament keeps sending roster/bracket updates — and seats the
        // final — to whichever socket its entry points at.
        if (tournamentCodeRef.current) {
          socket.emit('tournament-join', { code: tournamentCodeRef.current, ...identity() })
        }
        // Stay in the "reconnecting…" state until the server-side
        // reconnect path acknowledges via `room-joined { reconnected: true }`
        // (or `tournament-joined` in a tournament lobby).
      } else {
        // Fresh connect (page load, no prior session). We may have a stored
        // quick-match seat, but taking it back automatically is exactly the
        // behaviour that made the homepage teleport returning visitors into
        // a game they'd walked away from. Surface it instead and let the
        // lobby offer a "rejoin" button.
        if (!roomCodeRef.current) {
          const saved = readSeatMarker()
          setResumableSeat(saved)
        }
        setReconnecting(false)
      }
    })
    socket.on('disconnect', () => {
      setConnected(false)
      // Only flag the reconnect banner if we were actually mid-game / mid-
      // lobby — a brief blip during the very first connection attempt
      // shouldn't pop the banner.
      if (roomCodeRef.current || tournamentCodeRef.current) {
        hadDisconnectRef.current = true
        setReconnecting(true)
      }
    })

    socket.on('room-created', ({ roomCode: code, seat, mode }) => {
      setRoomCode(code)
      roomCodeRef.current = code
      setMySeat(seat)
      mySeatRef.current = seat
      setIsCreator(true)
      setRoomMode(mode === 'championship' ? 'championship' : 'public')
      setAppPhase('waiting')
    })

    socket.on('room-joined', ({ roomCode: code, seat, reconnected, status, mode, tournament: tournamentTag, startedAt }) => {
      clearGameOverTimer()
      setRoomCode(code)
      roomCodeRef.current = code
      setMySeat(seat)
      mySeatRef.current = seat
      setIsCreator(seat === 0)
      if (mode) setRoomMode(mode === 'championship' ? 'championship' : 'public')
      // Set when the server seats us at a bracket table; drives the HUD's
      // tournament button and blocks the quit/rematch affordances.
      if (startedAt) setGameStartedAt(startedAt)
      setTournamentSeat(tournamentTag || null)
      if (tournamentTag) setSpectatingBoth(null)
      if (reconnected) {
        // Server re-bound this socket to the existing seat. Pick the
        // right screen based on the room's lifecycle: lobby reconnects go
        // back to WaitingRoom, finished games go to the results screen
        // (never the table), and live games rehydrate via the follow-up
        // `game-state` snapshot.
        setAppPhase(status === 'waiting' ? 'waiting' : status === 'finished' ? 'gameover' : 'game')
        hadDisconnectRef.current = false
        setReconnecting(false)
      } else {
        setAppPhase('waiting')
      }
    })

    // ── tournament ────────────────────────────────────────────────────
    socket.on('online-players', (l) => setOnlinePlayers(Array.isArray(l) ? l : []))
    socket.on('live-games',     (l) => setLiveGames(Array.isArray(l) ? l : []))

    const enterTournament = (t) => {
      setTournament(t)
      tournamentCodeRef.current = t?.code || ''
    }
    socket.on('tournament-joined', (t) => {
      enterTournament(t)
      // A reconnect in a tournament lobby has no room-joined to wait for.
      if (!roomCodeRef.current) { hadDisconnectRef.current = false; setReconnecting(false) }
    })
    socket.on('tournament-state',   (t) => { enterTournament(t) })
    socket.on('tournament-left',    ()  => { enterTournament(null) })
    socket.on('tournament-list',    (l) => { setTournamentList(Array.isArray(l) ? l : []) })
    socket.on('tournament-overview',(o) => { setTournamentOverview(o) })

    socket.on('tournament-final', () => {
      addToast('ფინალი იწყება!', 'success')
    })

    socket.on('tournament-complete', (payload) => {
      tournamentCodeRef.current = ''
      const names = (payload.winners || []).map(w => w.name).join(' და ')
      if (names) addToast(`ტურნირის გამარჯვებული: ${names} 🏆`, 'success')
    })

    // Watching someone else's table. The server sends a masked snapshot, so
    // `hand` arrives empty and the canvas simply has nothing of ours to draw.
    socket.on('spectate-started', (payload) => {
      clearGameOverTimer()
      setSpectatingBoth(payload)
      if (payload.startedAt) setGameStartedAt(payload.startedAt)
      roomCodeRef.current = payload.roomCode
      setRoomCode(payload.roomCode)
      setMySeat(null); mySeatRef.current = null
      setHand([])
      setAppPhase('game')
    })

    socket.on('spectate-stopped', () => {
      clearGameOverTimer()
      setSpectatingBoth(null)
      // Not our room: a reconnect must not try to join the table we watched.
      roomCodeRef.current = ''
      setRoomCode('')
      setHand([])
      setAppPhase('lobby')
    })

    socket.on('player-joined', ({ players: p }) => setPlayers(p))
    socket.on('player-left',   ({ players: p }) => setPlayers(p))

    // ── Quick-match tables (casual + championship) ─────────────────────
    socket.on('public-room', (view = {}) => {
      const norm = (t) => ({
        roomCode: t?.roomCode || null,
        seats: Array.isArray(t?.seats) ? t.seats : [],
      })
      // Legacy single-table payloads (server mid-deploy) land as the casual table.
      const v = view.public || view.championship
        ? { public: norm(view.public), championship: norm(view.championship) }
        : { public: norm(view), championship: { roomCode: null, seats: [] } }
      setPublicRoom(v)
      if (publicSeatRef.current === null) return
      const myTable = [v.public, v.championship].find(t => t.roomCode && t.roomCode === roomCodeRef.current)
      if (myTable) {
        // Still the same table — but if our seat is gone the server swept
        // us out (disconnect grace expired). Stand down locally.
        if (!myTable.seats.some(s => s.seat === publicSeatRef.current)) {
          setPublicSeatBoth(null)
          setPublicSeatMode(null)
          roomCodeRef.current = ''
          setRoomCode('')
          setMySeat(null); mySeatRef.current = null
          setIsCreator(false)
          clearSeatMarker()
        }
      } else {
        // The quick-match lobby moved on — either our table filled and the
        // game is starting (game-started handles the transition; keep the
        // room refs for reconnection) or a fresh table opened. Either way
        // we're no longer "seated on the homepage".
        setPublicSeatBoth(null)
        setPublicSeatMode(null)
      }
    })

    socket.on('public-seated', ({ roomCode: code, seat, mode }) => {
      setRoomCode(code)
      roomCodeRef.current = code
      setMySeat(seat)
      mySeatRef.current = seat
      setIsCreator(seat === 0)
      setPublicSeatBoth(seat)
      const tableMode = mode === 'championship' ? 'championship' : 'public'
      setPublicSeatMode(tableMode)
      setRoomMode(tableMode)
      // Remember the seat so the lobby can offer it back after a refresh.
      writeSeatMarker(code, myNameRef.current)
      setResumableSeat(null)
    })

    socket.on('public-unseated', () => {
      setPublicSeatBoth(null)
      setPublicSeatMode(null)
      setRoomCode('')
      roomCodeRef.current = ''
      setMySeat(null)
      mySeatRef.current = null
      setIsCreator(false)
      clearSeatMarker()
    })

    socket.on('public-rejoin-failed', () => {
      setPublicSeatBoth(null)
      setPublicSeatMode(null)
      clearSeatMarker()
      setResumableSeat(null)
    })

    socket.on('game-started', ({ round: r, leaderSeat: ls, players: p, startedAt }) => {
      clearGameOverTimer()
      setGameStartedAt(startedAt || Date.now())
      setRound(r)
      setLeaderSeat(ls)
      setPlayers(p)
      setGamePhase('type_selection')
      setAppPhase('game')
      // Fresh game — wipe the per-seat used-type ledger. Without this a
      // rematch (same browser session, new room) leaves the previous game's
      // fully-used matrix in place and the first leader sees every game
      // type greyed out until a page refresh.
      setUsedTypes({ 0: [], 1: [], 2: [] })
      setRoundScores([])
      setRoundDetails([])
      setCumulativeScores({ 0: 0, 1: 0, 2: 0 })
      setLastTrickResult(null)
      setTrickAnimation(null)
      setLastCenterCards([])
      // Wipe rematch state from any previous game; the new game-over for
      // THIS room is the only thing that should populate it.
      setRematch({ newRoomCode: null, joinedOldSeats: [] })
      setQuitProposal(null)
    })

    socket.on('hand-dealt', ({ hand: h, centerCards: cc, leaderSeat: ls, round: r, cardCounts: counts }) => {
      setHand(sortHand(h || []))
      setCenterCards(cc || [])
      setLeaderSeat(ls)
      setRound(r)
      setCardCounts(counts)
      setCurrentTrick([])
      setLedSuit(null)
      setChosenGameType(null)
      setTrumpSuit(null)
      setLastTrickResult(null)
      setLastCenterCards([])
      setTrickAnimation(null)
      setPlayPendingBoth(false)
      clearTrickTimers()
      clearGameOverTimer()
    })

    socket.on('round-started', ({ round: r, leaderSeat: ls, phase, usedTypes: ut }) => {
      setRound(r)
      setLeaderSeat(ls)
      setGamePhase(phase)
      setUsedTypes(ut)
      setCurrentTrick([])
      setLedSuit(null)
      setLastTrickResult(null)
      setLastCenterCards([])
      setTrumpSuit(null)
      setTrickAnimation(null)
      // Same defensive reset as hand-dealt — clears the play-in-flight lock
      // before the new round so nobody starts the round with their cards
      // still greyed out from a stale optimistic update.
      setPlayPendingBoth(false)
      setQuitProposal(null)
      clearTrickTimers()
    })

    socket.on('game-type-selected', ({ typeCode, leaderSeat: ls, phase, usedTypes: ut }) => {
      setChosenGameType(typeCode)
      setLeaderSeat(ls)
      setGamePhase(phase)
      setUsedTypes(ut)
      const leaderName = playersRef.current.find(p => p.seat === ls)?.name || `მოთამაშე ${ls}`
      addToast(`${leaderName}-მ აირჩია — „${typeCode}“`, 'info')
    })

    socket.on('trump-selected', ({ trumpSuit: ts, phase }) => {
      setTrumpSuit(ts)
      setGamePhase(phase)
      const label = ts ? { H: 'გული', D: 'აგური', S: 'ყვავი', C: 'ჯვარი' }[ts] : 'უკოზირო'
      addToast(`კოზირი: ${label}`, 'info')
    })

    socket.on('hand-updated', ({ hand: h, lastCenterCards: lcc }) => {
      setHand(sortHand(h || []))
      if (lcc) setLastCenterCards(lcc)
    })

    socket.on('cards-discarded', ({ phase, currentTurn: ct, leaderSeat: ls }) => {
      setGamePhase(phase)
      setCurrentTurn(ct)
      setLeaderSeat(ls)
      setCenterCards([])
      setLastCenterCards([])
      // Phase has just changed to 'playing' — release any stale optimistic
      // lock so the leader can immediately play their first card. Without
      // this, a leader whose playPending got stuck earlier in the game
      // would discard 2 cards but then find their hand greyed out.
      setPlayPendingBoth(false)
      setTrickAnimation(null)
    })

    socket.on('card-played', ({ seat, card, currentTrick: ct, currentTurn: turn, ledSuit: ls, cardCounts: cc }) => {
      setCurrentTrick(ct)
      setCurrentTurn(turn)
      setLedSuit(ls)
      if (cc) setCardCounts(cc)
      if (seat === mySeatRef.current) {
        setHand(prev => sortHand(prev.filter(c => !(c.rank === card.rank && c.suit === card.suit))))
        // Server acked our play — release the click-lock.
        setPlayPendingBoth(false)
      }
    })

    socket.on('trick-complete', ({ winnerSeat, trick, nextTurn, cardCounts: cc }) => {
      // Show the full 3-card trick on the table for a moment, then animate
      // toward the winner, then clear.
      setCurrentTrick(trick)
      setLedSuit(trick[0]?.card?.suit ?? null)
      setLastTrickResult({ winnerSeat, trick })
      if (cc) setCardCounts(cc)
      // Whoever played the 3rd card was us if it's the local seat; release
      // the click-lock unconditionally — by the time a trick completes, no
      // play of ours can still be in flight.
      setPlayPendingBoth(false)

      // Lock cards immediately: the local player just played the 3rd card and
      // their hand might still look "playable" until currentTurn updates.
      // Setting trickAnimation here freezes hand interaction during the entire
      // reveal + animation window, preventing the "card disappears but says
      // not your turn" race.
      setTrickAnimation({ winnerSeat, trick, status: 'showing' })

      clearTrickTimers()

      // Phase 1: fly the cards to the winner avatar
      trickTimers.current.push(setTimeout(() => {
        setTrickAnimation({ winnerSeat, trick, status: 'animating' })
        EventBus.emit('animate-trick-winner', { winnerSeat, trick })
      }, TRICK_DISPLAY_MS))

      // Phase 2: clear & advance turn after the animation finishes
      trickTimers.current.push(setTimeout(() => {
        setCurrentTrick([])
        setLedSuit(null)
        setCurrentTurn(nextTurn)
        setTrickAnimation(null)
      }, TRICK_DISPLAY_MS + TRICK_ANIMATION_MS))
    })

    socket.on('round-complete', ({ winnerSeat, trick, scores, cumulativeScores: cs, round: r, gameType, isGameOver, cardCounts: cc, roundDetail, quitBySeat }) => {
      // Show the last trick of the round briefly, then transition.
      if (trick) {
        setCurrentTrick(trick)
        setLastTrickResult({ winnerSeat, trick })
      }
      setRoundScores(prev => [...prev, { round: r, scores, gameType }])
      if (roundDetail) setRoundDetails(prev => [...prev, roundDetail])
      setCumulativeScores(cs)
      if (cc) setCardCounts(cc)

      setPlayPendingBoth(false)
      setQuitProposal(null)

      clearTrickTimers()

      // Quit-round vote passed: there's no final trick to show or animate —
      // jump straight to the round summary.
      if (!trick) {
        setCurrentTrick([])
        setLedSuit(null)
        setTrickAnimation(null)
        setGamePhase('round_end')
        if (typeof quitBySeat === 'number') {
          const quitterName = playersRef.current.find(p => p.seat === quitBySeat)?.name || `მოთამაშე ${quitBySeat}`
          addToast(`${quitterName}-მ დათმო ხელი.`, 'warning')
        }
        return
      }

      trickTimers.current.push(setTimeout(() => {
        setTrickAnimation({ winnerSeat, trick: trick || [] })
        EventBus.emit('animate-trick-winner', { winnerSeat, trick: trick || [] })
      }, TRICK_DISPLAY_MS))
      trickTimers.current.push(setTimeout(() => {
        setCurrentTrick([])
        setLedSuit(null)
        setTrickAnimation(null)
      }, TRICK_DISPLAY_MS + TRICK_ANIMATION_MS))
      trickTimers.current.push(setTimeout(() => {
        setGamePhase('round_end')
        if (!isGameOver) addToast(`ხელი ${r} დასრულდა.`, 'success')
      }, TRICK_DISPLAY_MS + TRICK_ANIMATION_MS))
    })

    socket.on('game-over', ({ finalScores, winner, winners, isTie, mode, players: p, roundDetails: rd, surrenderedBySeat }) => {
      // Older server payloads carry only `winner` — normalise so the
      // game-over screen can always render from `winners`.
      const winnersList = Array.isArray(winners) && winners.length ? winners : (winner ? [winner] : [])
      const tie = !!isTie && winnersList.length > 1
      setFinalResults({ finalScores, winner, winners: winnersList, isTie: tie, mode, players: p, roundDetails: rd })
      if (rd) setRoundDetails(rd)
      setGamePhase('game_over')
      setQuitProposal(null)
      // The public-seat bookmark (if any) has served its purpose — the game
      // it pointed at is finished, so a later refresh shouldn't chase it.
      clearSeatMarker()
      // Switch to the results once the last trick has played out — unless we
      // have moved on by then (seated at the tournament final, or sent back
      // to the lobby after watching).
      const endedRoom = roomCodeRef.current
      clearGameOverTimer()
      gameOverTimerRef.current = setTimeout(() => {
        gameOverTimerRef.current = null
        if (roomCodeRef.current !== endedRoom || appPhaseRef.current !== 'game') return
        setAppPhase('gameover')
      }, TRICK_DISPLAY_MS + TRICK_ANIMATION_MS + 200)
      const winnerLabel = winnersList.map(w => w.name).join(' და ')
      if (typeof surrenderedBySeat === 'number') {
        const surrenderName = (p || []).find(pl => pl.seat === surrenderedBySeat)?.name || `მოთამაშე ${surrenderedBySeat}`
        addToast(`${surrenderName} დანებდა — ${winnerLabel} იმარჯვებს!`, 'success')
      } else if (tie) {
        addToast(`ფრეა! გამარჯვებულები: ${winnerLabel} 🤝`, 'success')
      } else {
        addToast(`${winnerLabel} იმარჯვებს!`, 'success')
      }
    })

    // ── Sounds: a player triggered a saloon reaction ───────────────────
    socket.on('play-sound', ({ soundId, bySeat, targetSeat }) => {
      // Reuse the same HTMLAudioElement that was unlocked on the first user
      // gesture — a freshly-constructed Audio() would be blocked by the
      // browser's autoplay policy because *this* call is happening inside a
      // socket event, not inside a click handler.
      const a = audioElsRef.current?.[soundId]
      if (a) {
        try {
          a.pause()
          a.currentTime = 0
          // Elements are kept muted after the unlock priming pass — unmute
          // only here, in the real playback path.
          a.muted = false
          a.volume = 0.7
          a.play().catch(() => { /* still blocked — needs a fresh gesture */ })
        } catch { /* ignore */ }
      }
      // Also flash a chat-bubble-style indicator above the targeted player.
      // The name comes from the catalogue, which is what the admin actually
      // typed. It used to be a hardcoded map of three built-ins with the
      // upper-cased id as fallback — fine while every id was a readable word,
      // but an uploaded clip named in Georgian has no ASCII slug, so its id
      // is a token like `snd-ffd1d735` and that is what players saw. Reading
      // the registry also means renaming a clip in /admin now actually
      // changes what shows on the table.
      const target = typeof targetSeat === 'number' ? targetSeat : bySeat
      const label = getSounds().find(s => s.id === soundId)?.label || soundId
      setChatBubbles(prev => ({ ...prev, [target]: { message: label, name: '', avatar: null } }))
      if (bubbleTimers.current[target]) clearTimeout(bubbleTimers.current[target])
      bubbleTimers.current[target] = setTimeout(() => {
        setChatBubbles(prev => {
          const next = { ...prev }; delete next[target]; return next
        })
      }, 2500)
    })

    // ── Quit-round / surrender votes ────────────────────────────────────
    socket.on('quit-proposal', ({ kind, proposerSeat, proposerName, acceptedSeats }) => {
      setQuitProposal({
        kind,
        proposerSeat,
        proposerName,
        acceptedSeats: Array.isArray(acceptedSeats) ? acceptedSeats : [proposerSeat],
      })
    })

    socket.on('quit-rejected', ({ kind, voterSeat, reason }) => {
      setQuitProposal(null)
      const what = kind === 'game' ? 'დანებებაზე' : 'ხელის დათმობაზე'
      if (reason === 'declined') {
        const voterName = playersRef.current.find(p => p.seat === voterSeat)?.name || 'ვიღაცამ'
        addToast(`${voterName}-მ უარი თქვა ${what} — თამაში გრძელდება.`, 'warning')
      } else {
        addToast(`${what} ხმის მიცემის დრო ამოიწურა — თამაში გრძელდება.`, 'warning')
      }
    })

    // ── Typing indicator ────────────────────────────────────────────────
    socket.on('chat-typing', ({ seat }) => {
      if (seat === mySeatRef.current) return
      setTypingSeats(prev => (prev[seat] ? prev : { ...prev, [seat]: true }))
      if (typingTimers.current[seat]) clearTimeout(typingTimers.current[seat])
      typingTimers.current[seat] = setTimeout(() => {
        delete typingTimers.current[seat]
        setTypingSeats(prev => {
          const next = { ...prev }; delete next[seat]; return next
        })
      }, 2500)
    })

    // ── Voice messages (ephemeral) ──────────────────────────────────────
    // The server relays the raw audio bytes; we wrap them in an object URL
    // and drop them into the same chat list as text messages. Nothing is
    // persisted — a refresh loses the clips, by design.
    socket.on('voice-message', (msg) => {
      try {
        if (!msg || !msg.audio) return
        const blob = new Blob([msg.audio], { type: msg.mime || 'audio/webm' })
        const url = URL.createObjectURL(blob)
        const entry = {
          type: 'voice',
          url,
          duration: msg.duration || 0,
          seat: msg.seat,
          name: msg.name,
          avatar: msg.avatar || null,
          at: msg.at || Date.now(),
        }
        setChatMessages(prev => {
          const next = [...prev, entry]
          // Release object URLs of clips that scroll out of the 50-message
          // window, otherwise every voice message leaks its blob.
          const dropped = next.length > 50 ? next.slice(0, next.length - 50) : []
          dropped.forEach(m => {
            // Never yank the blob out from under a clip that's mid-play.
            if (m.type === 'voice' && m.url && voicePlayer.playingUrl() !== m.url) {
              URL.revokeObjectURL(m.url)
            }
          })
          return next.slice(-50)
        })
        // Flash a mic bubble above the sender's avatar on the table.
        setChatBubbles(prev => ({ ...prev, [msg.seat]: { message: '🎤 ხმოვანი' } }))
        if (bubbleTimers.current[msg.seat]) clearTimeout(bubbleTimers.current[msg.seat])
        bubbleTimers.current[msg.seat] = setTimeout(() => {
          setChatBubbles(prev => {
            const next = { ...prev }
            delete next[msg.seat]
            return next
          })
        }, 4000)
      } catch { /* malformed clip — ignore */ }
    })

    // ── Chat ────────────────────────────────────────────────────────────
    // Reactions arrive as individual toggles and are folded into the message
    // they belong to. A reaction for a message we no longer hold (pruned out
    // of the 50-message window, or sent before we joined) is simply dropped —
    // there is nothing to attach it to.
    socket.on('chat-reaction', ({ messageId, emoji, seat, name }) => {
      setChatMessages(prev => prev.map(m => {
        if (m.id !== messageId) return m
        const by = m.reactions?.[emoji] || []
        const mine = by.some(r => r.seat === seat && r.name === name)
        // Same person, same emoji = un-react. Keeps one tap-back per person
        // per emoji without the server tracking any state.
        const next = mine
          ? by.filter(r => !(r.seat === seat && r.name === name))
          : [...by, { seat, name }]
        const reactions = { ...(m.reactions || {}) }
        if (next.length) reactions[emoji] = next
        else delete reactions[emoji]
        return { ...m, reactions }
      }))
    })

    socket.on('chat-message', (msg) => {
      setChatMessages(prev => [...prev.slice(-49), msg])
      // Their message landed — retire the typing indicator immediately.
      if (typingTimers.current[msg.seat]) {
        clearTimeout(typingTimers.current[msg.seat])
        delete typingTimers.current[msg.seat]
      }
      setTypingSeats(prev => {
        if (!prev[msg.seat]) return prev
        const next = { ...prev }; delete next[msg.seat]; return next
      })
      // Show bubble above the sender's avatar for ~5 seconds
      setChatBubbles(prev => ({ ...prev, [msg.seat]: msg }))
      if (bubbleTimers.current[msg.seat]) clearTimeout(bubbleTimers.current[msg.seat])
      bubbleTimers.current[msg.seat] = setTimeout(() => {
        setChatBubbles(prev => {
          const next = { ...prev }
          delete next[msg.seat]
          return next
        })
      }, 5000)
    })

    // Brief network blips happen all the time on mobile; suppress the
    // disconnect banner for a few seconds so a fast auto-rejoin (which
    // socket.io-client does for free) goes unnoticed.
    let disconnectGraceTimer = null
    socket.on('player-disconnected', ({ playerName }) => {
      if (disconnectGraceTimer) clearTimeout(disconnectGraceTimer)
      disconnectGraceTimer = setTimeout(() => {
        setDisconnectedPlayer(playerName)
        addToast(`${playerName} გაითიშა…`, 'warning')
      }, 5000)
    })

    socket.on('player-reconnected', ({ players: p }) => {
      // No toast here — if the rejoin happens inside the grace window the
      // user never saw a drop in the first place, and a stray "reconnected"
      // banner would just confuse them.
      if (disconnectGraceTimer) { clearTimeout(disconnectGraceTimer); disconnectGraceTimer = null }
      setDisconnectedPlayer(null)
      if (p) setPlayers(p)
    })

    socket.on('game-state', (state) => {
      // A snapshot of a FINISHED game must never drag the user back onto
      // the table. Late snapshots arrive after game over (visibility-resume
      // resync, a socket blip reconnect, the error-path resync) — route
      // them to the game-over screen instead, rebuilding finalResults from
      // the snapshot if this client never saw the live `game-over` event
      // (e.g. a refresh on the results screen).
      if (state.phase === 'game_over') {
        setFinalResults(prev => {
          if (prev) return prev
          const fs = state.cumulativeScores || {}
          const best = Math.max(...[0, 1, 2].map(s => fs[s] ?? -Infinity))
          const winnersList = [0, 1, 2]
            .filter(s => (fs[s] ?? -Infinity) === best)
            .map(s => ({
              seat: s,
              name: (state.players || []).find(pl => pl.seat === s)?.name || `მოთამაშე ${s}`,
              score: fs[s] ?? 0,
            }))
          return {
            finalScores: fs,
            winner: winnersList[0],
            winners: winnersList,
            isTie: winnersList.length > 1,
            players: state.players || [],
            roundDetails: state.roundDetails || [],
          }
        })
        setAppPhase('gameover')
      } else {
        setAppPhase('game')
      }
      if (state.players)                       setPlayers(state.players)
      if (state.hand)                          setHand(sortHand(state.hand))
      if (state.phase)                         setGamePhase(state.phase)
      if (state.round)                         setRound(state.round)
      if (state.leaderSeat !== undefined)      setLeaderSeat(state.leaderSeat)
      if (state.chosenGameType)                setChosenGameType(state.chosenGameType)
      if (state.trumpSuit !== undefined)       setTrumpSuit(state.trumpSuit)
      if (state.usedTypes)                     setUsedTypes(state.usedTypes)
      if (state.cardCounts)                    setCardCounts(state.cardCounts)
      if (state.centerCards)                   setCenterCards(state.centerCards)
      if (state.lastCenterCards)               setLastCenterCards(state.lastCenterCards)
      if (state.currentTrick)                  setCurrentTrick(state.currentTrick)
      if (state.ledSuit !== undefined)         setLedSuit(state.ledSuit)
      if (state.currentTurn !== undefined)     setCurrentTurn(state.currentTurn)
      if (state.cumulativeScores)              setCumulativeScores(state.cumulativeScores)
      if (state.lastTrick)                     setLastTrickResult(state.lastTrick)
      if (state.roundScores) {
        setRoundScores(
          state.roundScores.map(rs => ({ round: rs.round, scores: rs.scores, gameType: rs.gameType }))
        )
      }
      if (state.roundDetails)                  setRoundDetails(state.roundDetails)
      // Authoritative state sync — drop any optimistic locks/animations the
      // client might have been holding on to. Important on reconnect: the
      // server's snapshot is the truth, the local play-in-flight flag was
      // an optimism we don't need anymore.
      setPlayPendingBoth(false)
      setTrickAnimation(null)
      clearTrickTimers()
      // Force the canvas to repaint the rehydrated state. The setX calls above
      // queue a React re-render → PhaserGame re-emits state-update; we fire
      // force-render *after* that has committed (double rAF = past commit +
      // paint) so the scene drops any stuck animation gate and draws the fresh
      // snapshot. Fixes the "blank table / stale trick until I interact" bug
      // on rejoin and after a desync resync.
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => requestAnimationFrame(() => EventBus.emit('force-render')))
      } else {
        setTimeout(() => EventBus.emit('force-render'), 80)
      }
    })

    socket.on('error', ({ message, code }) => {
      // If a play was in flight and got rejected, the client may have
      // optimistically removed a card — re-sync hand state from the server
      // so the player sees the correct deck again. Always release the lock.
      if (playPendingRef.current) {
        setPlayPendingBoth(false)
        socketRef.current?.emit('request-state')
      }
      // Still in the lobby without a seat: a join was refused, so forget the
      // room code joinRoom stashed, or a later blip would rejoin it.
      if (appPhaseRef.current === 'lobby' && publicSeatRef.current === null) roomCodeRef.current = ''
      if (code === 'AUTH') {
        // Our profile session is gone (PIN changed, profile removed): the
        // lobby asks us to pick the profile again.
        dropProfileSession()
        addToast('აირჩიე პროფილი თავიდან.', 'error')
        return
      }
      if (code === 'CHAMPIONSHIP_LIMIT') {
        addToast('დღის ლიმიტი ამოიწურა — 8 ლიგის თამაში დღეში. აირჩიე კლასიკური თამაში.', 'error')
        return
      }
      addToast(message, 'error')
    })

    // ── Visibility-resume safety net ────────────────────────────────────────
    // Mobile browsers throttle background tabs aggressively: setTimeout can
    // be coalesced to ≥1 Hz, Phaser's scene clock can stall, and socket.io
    // can lose its heartbeat without firing a visible disconnect. The net
    // effect on production was "I came back to the tab and a card the other
    // player put down ages ago is still missing from my screen". Whenever
    // the tab returns to `visible`, ask the server for the authoritative
    // snapshot. Cheap and idempotent — the `game-state` handler is built
    // for replay.
    let lastResyncAt = 0
    const onResumeVisibility = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState !== 'visible') return
      if (!roomCodeRef.current) return            // not in a room — nothing to sync
      // Only a live table has a snapshot to resync. Sitting in a waiting
      // room (public quick-match seat, pre-start lobby) there is nothing on
      // the server to ask for, so the round-trip is pure noise.
      if (appPhaseRef.current !== 'game') return
      const now = Date.now()
      // Throttle: visibilitychange can fire in rapid bursts (focus + page
      // visibility events on iOS sometimes double-fire). One resync per
      // second is plenty.
      if (now - lastResyncAt < 1000) return
      lastResyncAt = now
      socketRef.current?.emit('request-state')
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onResumeVisibility)
    }

    return () => {
      clearTrickTimers()
      clearGameOverTimer()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onResumeVisibility)
      }
      socket.disconnect()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── rematch action ────────────────────────────────────────────────────
  // Triggered from the Play Again button on the game-over screen. The new
  // room keeps the identity of the seat we held.
  const requestRematch = useCallback(() => {
    socketRef.current?.emit('request-rematch')
  }, [])

  const createRoom = useCallback((name, mode = 'public') => {
    setMe(name)
    socketRef.current?.emit('create-room', { ...identity(name), mode })
  }, [])

  const joinRoom = useCallback((code, name) => {
    setMe(name)
    // Pre-stash the room code too — the very first join is the only place
    // we know it before the server's `room-joined` round-trip lands, and
    // `roomCodeRef` drives the auto-rejoin path on a subsequent disconnect.
    // A refused join clears it again (see the `error` handler).
    roomCodeRef.current = code
    socketRef.current?.emit('join-room', { roomCode: code, ...identity(name) })
  }, [])

  const startGame      = useCallback(() => { socketRef.current?.emit('start-game') }, [])
  const sendChat       = useCallback((message) => {
    if (!message || !message.trim()) return
    socketRef.current?.emit('chat-message', { message: message.trim() })
  }, [])
  // Ship a recorded clip to the room. 400 KB matches the server's hard cap.
  const sendVoice      = useCallback(async (blob, duration = 0) => {
    if (!blob || !blob.size) return
    if (blob.size > 400 * 1024) {
      addToast('ჩანაწერი ძალიან დიდი გამოვიდა.', 'error')
      return
    }
    try {
      const buf = await blob.arrayBuffer()
      socketRef.current?.emit('voice-message', {
        audio: buf,
        mime: blob.type || 'audio/webm',
        duration,
      })
    } catch { /* ignore */ }
  }, [addToast])
  const playSound      = useCallback((soundId, targetSeat = null) => {
    socketRef.current?.emit('play-sound', { soundId, targetSeat })
  }, [])
  // Throttled "I'm typing" ping — at most one every 1.2s while keys are
  // being pressed; receivers expire the indicator on their own 2.5s timer.
  const reactToMessage = useCallback((messageId, emoji) => {
    socketRef.current?.emit('chat-react', { messageId, emoji })
  }, [])

  const sendTyping     = useCallback(() => {
    const now = Date.now()
    if (now - typingSentAtRef.current < 1200) return
    typingSentAtRef.current = now
    socketRef.current?.emit('chat-typing')
  }, [])
  const proposeQuit    = useCallback((kind) => { socketRef.current?.emit('propose-quit', { kind }) }, [])
  const voteQuit       = useCallback((accept) => { socketRef.current?.emit('vote-quit', { accept }) }, [])

  // ── public quick-match actions ──────────────────────────────────────────
  const sitPublic = useCallback((name, emoji = null, mode = 'public') => {
    setMe(name)
    socketRef.current?.emit('sit-public', { ...identity(name), emoji, mode })
  }, [])
  const standPublic    = useCallback(() => { socketRef.current?.emit('stand-public') }, [])

  // ── Stored quick-match seat: user-driven resume ────────────────────────
  // `rejoin-public` only ever re-attaches to a seat already holding this
  // name, so the worst a stale marker can do is come back as
  // `public-rejoin-failed`. Deliberately a click, not a page-load effect.
  const resumeSeat = useCallback(() => {
    const saved = readSeatMarker()
    if (!saved) { setResumableSeat(null); return }
    setMe(saved.name)
    socketRef.current?.emit('rejoin-public', { roomCode: saved.roomCode, ...identity(saved.name) })
    setResumableSeat(null)
  }, [])

  // ── tournament actions ──────────────────────────────────────────────────
  const createTournament = useCallback((name, size) => {
    setMe(name)
    socketRef.current?.emit('tournament-create', { ...identity(name), size })
  }, [])

  const joinTournament = useCallback((code, name) => {
    setMe(name)
    socketRef.current?.emit('tournament-join', {
      code: String(code || '').toUpperCase(), ...identity(name),
    })
  }, [])

  const leaveTournament  = useCallback(() => { socketRef.current?.emit('tournament-leave') }, [])
  const refreshTournaments = useCallback(() => { socketRef.current?.emit('tournament-list') }, [])
  const refreshOverview  = useCallback(() => { socketRef.current?.emit('tournament-overview') }, [])

  const spectateTable = useCallback((roomCode) => {
    socketRef.current?.emit('tournament-spectate', { roomCode, ...identity() })
  }, [])

  // `stop-watching` covers both kinds of watcher — it clears the same
  // spectator registry entry and additionally refreshes the homepage lists.
  const stopSpectating = useCallback(() => {
    socketRef.current?.emit('stop-watching')
  }, [])

  // ── homepage presence ───────────────────────────────────────────────────
  const announcePresence = useCallback((name) => {
    if (!name) return
    setMe(name)
    socketRef.current?.emit('announce-presence', identity(name))
  }, [])

  const refreshLobby = useCallback(() => {
    socketRef.current?.emit('lobby-info')
  }, [])

  // The name is passed in rather than read off the ref: watching happens
  // straight from the lobby, before any room has set it.
  const watchGame = useCallback((roomCode, name) => {
    const who = String(name || myNameRef.current || '').trim()
    if (!who) return
    setMe(who)
    socketRef.current?.emit('watch-game', { roomCode, ...identity(who) })
  }, [])

  const dismissResumeSeat = useCallback(() => {
    clearSeatMarker()
    setResumableSeat(null)
  }, [])
  const setPublicEmoji = useCallback((emoji) => { socketRef.current?.emit('set-public-emoji', { emoji }) }, [])
  const selectGameType = useCallback((typeCode) => { socketRef.current?.emit('select-game-type', { typeCode }) }, [])
  const selectTrump    = useCallback((suit) => { socketRef.current?.emit('select-trump', { suit }) }, [])
  const discardCards   = useCallback((cards) => {
    socketRef.current?.emit('discard-cards', { cards })
    setSelectedDiscards([])
  }, [])

  const playCard = useCallback((card) => {
    if (playPendingRef.current) return
    setPlayPendingBoth(true)
    setHand(prev => sortHand(prev.filter(c => !(c.rank === card.rank && c.suit === card.suit))))
    socketRef.current?.emit('play-card', { card })
  }, [])

  const nextRound = useCallback(() => { socketRef.current?.emit('next-round') }, [])

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit('leave-room')
    clearGameOverTimer()
    setAppPhase('lobby')
    setRoomCode('')
    roomCodeRef.current = ''
    setPlayers([])
    setMySeat(null)
    mySeatRef.current = null
    setIsCreator(false)
    setPublicSeatBoth(null)
    setPublicSeatMode(null)
    setRoomMode('public')
    setGameStartedAt(null)
    clearSeatMarker()
  }, [])

  const toggleDiscard = useCallback((card) => {
    setSelectedDiscards(prev => {
      const exists = prev.find(c => c.rank === card.rank && c.suit === card.suit)
      if (exists) return prev.filter(c => !(c.rank === card.rank && c.suit === card.suit))
      if (prev.length >= 2) return prev
      return [...prev, card]
    })
  }, [])

  // Both context values are memoized so a provider re-render only invalidates
  // consumers whose slice actually changed. All the callbacks below are
  // useCallback-stable, so in practice each memo recomputes only when one of
  // its state fields updates.
  const chatValue = useMemo(() => ({
    chatMessages, chatBubbles, typingSeats,
    sendChat, sendVoice, sendTyping, playSound, reactToMessage, canSpeak,
  }), [
    chatMessages, chatBubbles, typingSeats,
    sendChat, sendVoice, sendTyping, playSound, reactToMessage, canSpeak,
  ])

  const gameValue = useMemo(() => ({
    connected,
    roomCode, players, mySeat, isCreator,
    appPhase,
    gamePhase, round, leaderSeat, chosenGameType, trumpSuit, usedTypes,
    hand, cardCounts, centerCards, lastCenterCards,
    currentTrick, ledSuit, currentTurn,
    lastTrickResult, trickAnimation, playPending,
    roundScores, roundDetails, cumulativeScores, finalResults,
    toasts, disconnectedPlayer, reconnecting, selectedDiscards,
    quitProposal, proposeQuit, voteQuit,
    publicRoom, publicSeat, publicSeatMode, sitPublic, standPublic, setPublicEmoji,
    resumableSeat, resumeSeat, dismissResumeSeat,
    gameStartedAt,
    onlinePlayers, liveGames,
    announcePresence, refreshLobby, watchGame,
    tournament, tournamentList, tournamentOverview, tournamentSeat,
    spectating,
    createTournament, joinTournament, leaveTournament,
    refreshTournaments, refreshOverview, spectateTable, stopSpectating,
    roomMode,
    rematch, requestRematch,
    createRoom, joinRoom, startGame, selectGameType, selectTrump, discardCards,
    playCard, nextRound, leaveRoom, toggleDiscard, addToast,
  }), [
    connected,
    roomCode, players, mySeat, isCreator,
    appPhase,
    gamePhase, round, leaderSeat, chosenGameType, trumpSuit, usedTypes,
    hand, cardCounts, centerCards, lastCenterCards,
    currentTrick, ledSuit, currentTurn,
    lastTrickResult, trickAnimation, playPending,
    roundScores, roundDetails, cumulativeScores, finalResults,
    toasts, disconnectedPlayer, reconnecting, selectedDiscards,
    quitProposal, proposeQuit, voteQuit,
    publicRoom, publicSeat, publicSeatMode, sitPublic, standPublic, setPublicEmoji,
    resumableSeat, resumeSeat, dismissResumeSeat,
    gameStartedAt,
    onlinePlayers, liveGames,
    announcePresence, refreshLobby, watchGame,
    tournament, tournamentList, tournamentOverview, tournamentSeat,
    spectating,
    createTournament, joinTournament, leaveTournament,
    refreshTournaments, refreshOverview, spectateTable, stopSpectating,
    roomMode,
    rematch, requestRematch,
    createRoom, joinRoom, startGame, selectGameType, selectTrump, discardCards,
    playCard, nextRound, leaveRoom, toggleDiscard, addToast,
  ])

  return (
    <GameContext.Provider value={gameValue}>
      <ChatContext.Provider value={chatValue}>
        {children}
      </ChatContext.Provider>
    </GameContext.Provider>
  )
}

export const useGame = () => useContext(GameContext)
export const useChat = () => useContext(ChatContext)
