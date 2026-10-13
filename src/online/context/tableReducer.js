// The table: everything the canvas and the in-game HUD draw for the current
// hand. Each socket event that touches it is one action here. The reducer is
// pure (no timers, no sockets), so it can be tested in node; the trick
// timers that stage a finished trick live next to it in tableEvents.js.

export const TRICK_DISPLAY_MS = 1300   // how long a completed trick stays on the table
export const TRICK_ANIMATION_MS = 600  // how long the "fly to winner" animation runs

// ── Hand sorting ──────────────────────────────────────────────────────────────
const RANK_ORDER = ['A', 'K', 'Q', 'J', '10', '9', '8', '7']
const SUIT_ORDER = ['S', 'H', 'D', 'C']

export function sortHand(hand) {
  return [...hand].sort((a, b) => {
    const sd = SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit)
    if (sd !== 0) return sd
    return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank)
  })
}

export const sameCard = (a, b) => a.rank === b.rank && a.suit === b.suit

const perSeat = (v) => ({ 0: v(), 1: v(), 2: v() })

export const initialTable = {
  gamePhase: null,
  round: 1,
  leaderSeat: 0,
  chosenGameType: null,
  trumpSuit: null,
  usedTypes: perSeat(() => []),

  hand: [],
  cardCounts: perSeat(() => 0),
  centerCards: [],
  lastCenterCards: [],

  currentTrick: [],
  ledSuit: null,
  currentTurn: null,
  lastTrickResult: null,
  trickAnimation: null, // { winnerSeat, trick, status? } while a trick is shown / flown

  roundScores: [],
  roundDetails: [],
  cumulativeScores: perSeat(() => 0),

  selectedDiscards: [],
  // "Play in flight" lock — set the moment the user clicks a card, cleared
  // when the server acks (card-played / trick-complete) or rejects (error).
  // Prevents a rapid second click from optimistically removing a *second*
  // card from the hand before the first round-trip completes.
  playPending: false,
}

// A fresh hand: no trick on the table, nothing in flight.
const FRESH_HAND = {
  currentTrick: [],
  ledSuit: null,
  trumpSuit: null,
  lastTrickResult: null,
  lastCenterCards: [],
  trickAnimation: null,
  selectedDiscards: [],
  playPending: false,
}

/** The table part of a `game-state` snapshot (reconnect, resync). */
function applySnapshot(state, snap) {
  const next = { ...state }
  if (snap.hand)                    next.hand = sortHand(snap.hand)
  if (snap.phase)                   next.gamePhase = snap.phase
  if (snap.round)                   next.round = snap.round
  if (snap.leaderSeat !== undefined) next.leaderSeat = snap.leaderSeat
  // By key, not truthiness: a null in the snapshot clears the old value.
  if ('chosenGameType' in snap)     next.chosenGameType = snap.chosenGameType ?? null
  if (snap.trumpSuit !== undefined) next.trumpSuit = snap.trumpSuit
  if (snap.usedTypes)               next.usedTypes = snap.usedTypes
  if (snap.cardCounts)              next.cardCounts = snap.cardCounts
  if (snap.centerCards)             next.centerCards = snap.centerCards
  if (snap.lastCenterCards)         next.lastCenterCards = snap.lastCenterCards
  if (snap.currentTrick)            next.currentTrick = snap.currentTrick
  if (snap.ledSuit !== undefined)   next.ledSuit = snap.ledSuit
  if (snap.currentTurn !== undefined) next.currentTurn = snap.currentTurn
  if (snap.cumulativeScores)        next.cumulativeScores = snap.cumulativeScores
  if ('lastTrick' in snap)          next.lastTrickResult = snap.lastTrick ?? null
  if (snap.roundScores) {
    next.roundScores = snap.roundScores.map(rs => ({ round: rs.round, scores: rs.scores, gameType: rs.gameType }))
  }
  if (snap.roundDetails)            next.roundDetails = snap.roundDetails
  // Authoritative state sync — drop any optimistic locks/animations the
  // client might have been holding on to. Important on reconnect: the
  // server's snapshot is the truth, the local play-in-flight flag was an
  // optimism we don't need anymore.
  next.playPending = false
  next.trickAnimation = null
  next.selectedDiscards = []
  return next
}

export function tableReducer(state, action) {
  switch (action.type) {
    case 'game-started':
      return {
        ...state,
        round: action.round,
        leaderSeat: action.leaderSeat,
        gamePhase: 'type_selection',
        // Fresh game — wipe the per-seat used-type ledger. Without this a
        // rematch (same browser session, new room) leaves the previous game's
        // fully-used matrix in place and the first leader sees every game
        // type greyed out until a page refresh.
        usedTypes: perSeat(() => []),
        roundScores: [],
        roundDetails: [],
        cumulativeScores: perSeat(() => 0),
        lastTrickResult: null,
        trickAnimation: null,
        lastCenterCards: [],
      }

    case 'hand-dealt':
      return {
        ...state,
        ...FRESH_HAND,
        hand: sortHand(action.hand || []),
        centerCards: action.centerCards || [],
        leaderSeat: action.leaderSeat,
        round: action.round,
        cardCounts: action.cardCounts,
        chosenGameType: null,
      }

    case 'round-started':
      // Same defensive reset as hand-dealt — clears the play-in-flight lock
      // before the new round so nobody starts the round with their cards
      // still greyed out from a stale optimistic update.
      return {
        ...state,
        ...FRESH_HAND,
        round: action.round,
        leaderSeat: action.leaderSeat,
        gamePhase: action.phase,
        usedTypes: action.usedTypes,
        // Watchers get no `hand-dealt`, so the new round's counts and reset
        // come from here (players get the same again from `hand-dealt`).
        ...(action.cardCounts && { cardCounts: action.cardCounts }),
        chosenGameType: null,
        centerCards: [],
      }

    case 'game-type-selected':
      return {
        ...state,
        chosenGameType: action.typeCode,
        leaderSeat: action.leaderSeat,
        gamePhase: action.phase,
        usedTypes: action.usedTypes,
      }

    case 'trump-selected':
      return { ...state, trumpSuit: action.trumpSuit, gamePhase: action.phase }

    case 'hand-updated':
      return {
        ...state,
        hand: sortHand(action.hand || []),
        ...(action.lastCenterCards ? { lastCenterCards: action.lastCenterCards } : {}),
      }

    case 'cards-discarded':
      // Phase has just changed to 'playing' — release any stale optimistic
      // lock so the leader can immediately play their first card.
      return {
        ...state,
        gamePhase: action.phase,
        currentTurn: action.currentTurn,
        leaderSeat: action.leaderSeat,
        centerCards: [],
        lastCenterCards: [],
        playPending: false,
        trickAnimation: null,
      }

    case 'card-played': {
      const next = {
        ...state,
        currentTrick: action.currentTrick,
        currentTurn: action.currentTurn,
        ledSuit: action.ledSuit,
      }
      // The previous trick's show-and-clear timers were dropped (see
      // tableEvents): its animation is over too.
      if (action.endsTrickAnimation) next.trickAnimation = null
      if (action.cardCounts) next.cardCounts = action.cardCounts
      if (action.mine) {
        next.hand = sortHand(state.hand.filter(c => !sameCard(c, action.card)))
        // Server acked our play — release the click-lock.
        next.playPending = false
      }
      return next
    }

    case 'trick-complete': {
      const { winnerSeat, trick } = action
      return {
        ...state,
        // Show the full 3-card trick on the table for a moment.
        currentTrick: trick,
        ledSuit: trick[0]?.card?.suit ?? null,
        lastTrickResult: { winnerSeat, trick },
        ...(action.cardCounts ? { cardCounts: action.cardCounts } : {}),
        // By the time a trick completes, no play of ours can still be in
        // flight.
        playPending: false,
        // Lock the hand through the whole reveal + animation window, so the
        // player who played the 3rd card can't see a "playable" hand before
        // currentTurn moves on.
        trickAnimation: { winnerSeat, trick, status: 'showing' },
      }
    }

    case 'trick-animate':
      return {
        ...state,
        trickAnimation: action.status
          ? { winnerSeat: action.winnerSeat, trick: action.trick, status: action.status }
          : { winnerSeat: action.winnerSeat, trick: action.trick },
      }

    case 'trick-cleared':
      return {
        ...state,
        currentTrick: [],
        ledSuit: null,
        trickAnimation: null,
        ...('nextTurn' in action ? { currentTurn: action.nextTurn } : {}),
      }

    case 'round-complete': {
      const { winnerSeat, trick } = action
      const next = {
        ...state,
        roundScores: [...state.roundScores, { round: action.round, scores: action.scores, gameType: action.gameType }],
        roundDetails: action.roundDetail ? [...state.roundDetails, action.roundDetail] : state.roundDetails,
        cumulativeScores: action.cumulativeScores,
        playPending: false,
        selectedDiscards: [],
      }
      if (action.cardCounts) next.cardCounts = action.cardCounts
      if (trick) {
        // The last trick of the round stays up briefly (see tableEvents).
        next.currentTrick = trick
        next.lastTrickResult = { winnerSeat, trick }
        return next
      }
      // Quit-round vote passed: no final trick to show — straight to the
      // round summary (or, after the last round, to game-over).
      next.currentTrick = []
      next.ledSuit = null
      next.trickAnimation = null
      if (!action.isGameOver) next.gamePhase = 'round_end'
      return next
    }

    case 'round-end':
      return { ...state, gamePhase: 'round_end' }

    case 'game-over':
      return {
        ...state,
        ...(action.roundDetails ? { roundDetails: action.roundDetails } : {}),
        gamePhase: 'game_over',
      }

    case 'game-state':
      return applySnapshot(state, action.state)

    // Watching starts or stops: none of the cards in hand are ours.
    case 'hand-cleared':
      return { ...state, hand: [] }

    // Our own click: take the card out of the hand now, lock until the ack.
    case 'play-sent':
      return {
        ...state,
        playPending: true,
        hand: sortHand(state.hand.filter(c => !sameCard(c, action.card))),
      }

    case 'play-released':
      return state.playPending ? { ...state, playPending: false } : state

    case 'toggle-discard': {
      const prev = state.selectedDiscards
      let selectedDiscards
      if (prev.some(c => sameCard(c, action.card))) selectedDiscards = prev.filter(c => !sameCard(c, action.card))
      else if (prev.length >= 2) return state
      else selectedDiscards = [...prev, action.card]
      return { ...state, selectedDiscards }
    }

    case 'discards-cleared':
      return state.selectedDiscards.length ? { ...state, selectedDiscards: [] } : state

    // Leaving a room: its last trick and discard picks don't follow us.
    case 'room-reset':
      return { ...state, lastTrickResult: null, selectedDiscards: [] }

    default:
      return state
  }
}
