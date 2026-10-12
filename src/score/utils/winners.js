// Tie-aware winner helpers.
//
// A tied game has EVERY top scorer as a winner. Locally we store them in
// game_results.winner_name joined with ' & ' (e.g. "Maks & Misha") so no
// schema change is needed; these helpers are the single place that joins
// and splits that format. The online API (King Online) sends a `winners`
// array next to the legacy single `winner`.

const SEP = ' & '

/** Join tied winner names into the stored winner_name string. */
export function joinWinnerNames(names = []) {
  return names.filter(Boolean).join(SEP)
}

/** Split a stored winner_name (string) into individual names. */
export function splitWinnerNames(value) {
  if (!value || typeof value !== 'string') return []
  return value.split(SEP).map(s => s.trim()).filter(Boolean)
}

/** Winner names of a local game_results row (accepts row or raw string). */
export function winnerNamesOf(resultOrName) {
  const raw = typeof resultOrName === 'string' ? resultOrName : resultOrName?.winner_name
  return splitWinnerNames(raw)
}

/** Did `name` win this local game (including shared/tied wins)? */
export function isWinnerOf(resultOrName, name) {
  return winnerNamesOf(resultOrName).includes(name)
}

/** Is this local result a tie (more than one recorded winner)? */
export function isTieResult(resultOrName) {
  return winnerNamesOf(resultOrName).length > 1
}

/**
 * Winner names of an online-API game. New API payloads carry `winners`
 * (array of { seat, name, score }); old ones only `winner`.
 */
export function onlineWinnerNames(game) {
  if (Array.isArray(game?.winners) && game.winners.length) {
    return game.winners.map(w => w?.name).filter(Boolean)
  }
  return game?.winner?.name ? [game.winner.name] : []
}

/** Did `name` win this online game (including shared/tied wins)? */
export function isOnlineWinner(game, name) {
  return onlineWinnerNames(game).includes(name)
}

/**
 * Champion values can also hold co-champions ("A & B"). True when `name`
 * is (one of) the champion(s).
 */
export function isChampionName(championValue, name) {
  return splitWinnerNames(championValue).includes(name)
}
