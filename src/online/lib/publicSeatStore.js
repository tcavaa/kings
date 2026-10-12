// Where the browser remembers "I was sitting at quick-match table XYZ as
// <name>".
//
// Why this exists at all, given `live_games`: those are two halves of the
// same answer. `live_games` is the SERVER's memory — it knows room ABC123
// still exists and who is seated in it. It has no idea which of those seats
// belongs to the browser that just loaded the page: the socket id is new on
// every page load and nothing else identifies the tab. This marker is the
// CLIENT's half — "which room + name was me". The server still validates it
// (the room has to exist and the name has to already be seated), so a
// tampered or stale marker just gets refused.
//
// It is deliberately NOT auto-applied on page load any more. Silently
// re-seating a returning visitor meant that opening the homepage days later
// yanked you straight into a table you thought you'd left. The lobby now
// offers it as a button, and the marker expires on its own.

const KEY = 'king.publicSeat'

// After this long the marker is junk — the table has certainly moved on, and
// nobody coming back the next day means to rejoin yesterday's game.
const MAX_AGE_MS = 30 * 60 * 1000

/** Stored seat, or null if absent / malformed / expired. */
export function readSeatMarker() {
  let raw = null
  try { raw = localStorage.getItem(KEY) } catch { return null }
  if (!raw) return null
  let saved
  try { saved = JSON.parse(raw) } catch { clearSeatMarker(); return null }
  if (!saved?.roomCode || !saved?.name) { clearSeatMarker(); return null }
  // Markers written before `savedAt` existed have no timestamp — treat them
  // as expired rather than immortal.
  if (!saved.savedAt || Date.now() - saved.savedAt > MAX_AGE_MS) {
    clearSeatMarker()
    return null
  }
  return { roomCode: saved.roomCode, name: saved.name, savedAt: saved.savedAt }
}

export function writeSeatMarker(roomCode, name) {
  if (!roomCode || !name) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ roomCode, name, savedAt: Date.now() }))
  } catch { /* private mode / quota — the seat just won't be offered back */ }
}

export function clearSeatMarker() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
