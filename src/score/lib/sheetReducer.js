// The score sheet's state: who plays, the rounds entered so far, whose turn
// it is to pick a game type, and the game clock.

import { GAME_TYPES } from '../constants/gameTypes.js'

// Each game in progress is published under its own id so others can follow it.
export const newSheetId = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '')

// `surrenderedBy` is the id of a player who ended the game early.
export const EMPTY_SHEET = { players: null, activePlayerIndex: 0, rounds: [], startedAt: null, endedAt: null, sheetId: null, surrenderedBy: null }

/** Rounds in a full game: every player picks every game type once. */
export const targetRoundsOf = players => (players ? players.length * GAME_TYPES.length : 0)

export function sheetReducer(s, action) {
  switch (action.type) {
    case 'HYDRATE': {
      const merged = { ...s, ...action.payload }
      // Snapshots saved before the game clock existed have no
      // startedAt — start counting from the moment they're restored.
      if (merged.players && !merged.startedAt) merged.startedAt = Date.now()
      if (merged.players && !merged.sheetId) merged.sheetId = newSheetId()
      return merged
    }
    case 'START':
      return { players: action.players, activePlayerIndex: 0, rounds: [], startedAt: Date.now(), endedAt: null, sheetId: newSheetId(), surrenderedBy: null }
    case 'END_ROUND': {
      const rounds = [...s.rounds, action.round]
      const nextLeader = s.players ? (s.activePlayerIndex + 1) % s.players.length : 0
      // Freeze the game clock the moment the final round is entered.
      const target = s.players ? targetRoundsOf(s.players) : Infinity
      const endedAt = !s.endedAt && rounds.length >= target ? Date.now() : s.endedAt
      return { ...s, rounds, activePlayerIndex: nextLeader, endedAt }
    }
    case 'EDIT_LAST': {
      if (!s.rounds.length) return s
      const next = [...s.rounds]
      next[next.length - 1] = action.round
      return { ...s, rounds: next }
    }
    case 'UNDO_LAST': {
      if (!s.rounds.length) return s
      const prevLeader = s.players
        ? (s.activePlayerIndex - 1 + s.players.length) % s.players.length
        : 0
      // Undoing the final round un-finishes the game — resume the clock.
      return { ...s, rounds: s.rounds.slice(0, -1), activePlayerIndex: prevLeader, endedAt: null, surrenderedBy: null }
    }
    case 'SURRENDER': {
      // Ends the game where it stands (after at least one round): the clock
      // stops and the sheet shows the final result, ready to save.
      if (!s.players || !s.rounds.length || s.surrenderedBy) return s
      if (!s.players.some(p => p.id === action.playerId)) return s
      return { ...s, surrenderedBy: action.playerId, endedAt: Date.now() }
    }
    case 'RESUME':
      // Take a surrender back: the game goes on from the same round.
      if (!s.surrenderedBy) return s
      return { ...s, surrenderedBy: null, endedAt: null }
    case 'RESET':
      return EMPTY_SHEET
    default:
      return s
  }
}
