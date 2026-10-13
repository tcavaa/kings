// Every game — recorded here ("live") or played in King Online ("online") —
// comes from the shared games table in King Online's shape. ჩაწერა's screens
// were built on its own two rows per game:
//   result  { id, played_at, winner_name, winners: [name], participants: [{ name, score }], duration_seconds? }
//   detail  { game_result_id, played_at, players: [{ id, name }],
//             rounds: [{ scores, gameTypeCode, leaderPlayerId, countsByPlayerId, singleTargetPlayerId }] }
// so both kinds are turned back into those. Player ids are profile ids, the
// same for a person in every game of either kind (names that aren't a profile
// get `guest:<name>`).

import { GAME_TYPES } from '../constants/gameTypes.js'
import { joinWinnerNames } from '../utils/winners.js'

const KIND = Object.fromEntries(GAME_TYPES.map(t => [t.code, t.kind]))

const bySeatToIds = (obj, idAtSeat) => obj == null
  ? null
  : Object.fromEntries(Object.entries(obj).map(([seat, v]) => [idAtSeat(Number(seat)), v]))

const guestId = name => `guest:${name}`

/**
 * A game saved by ჩაწერა, as its own result/detail rows. A seat keeps its
 * saved profile id only while that profile still exists (`knownIds`);
 * otherwise it is found by name with `idOfName`, the way King Online's games
 * are, so a removed player's games don't keep a dead id and a name added
 * again is one person, not two.
 */
export function liveGameToLegacy(game, { knownIds = null, idOfName = guestId } = {}) {
  const ps = [...game.players].sort((a, b) => a.seat - b.seat)
  const ids = ps.map(p => (p.profileId && (!knownIds || knownIds.has(p.profileId)) ? p.profileId : idOfName(p.name)))
  const idAt = seat => ids[seat]
  const order = game.legacy?.participantsOrder ?? ps.map(p => p.seat)
  const winners = game.winners.map(w => ps[w.seat].name)
  const result = {
    id: game.id,
    played_at: game.playedAt,
    winner_name: joinWinnerNames(winners),
    winners,
    participants: order.map(seat => ({ name: ps[seat].name, score: ps[seat].score })),
    type: 'live',
  }
  if (game.durationSeconds != null) result.duration_seconds = game.durationSeconds
  if (game.legacy?.noRounds) return { result, detail: null }
  const detail = {
    game_result_id: game.id,
    played_at: game.legacy?.detailPlayedAt ?? game.playedAt,
    players: ps.map(p => ({ id: idAt(p.seat), name: p.name })),
    rounds: game.roundDetails.map(r => ({
      scores: bySeatToIds(r.scores, idAt),
      gameTypeCode: r.gameType,
      leaderPlayerId: r.leaderSeat == null ? null : idAt(r.leaderSeat),
      countsByPlayerId: bySeatToIds(r.counts, idAt),
      singleTargetPlayerId: r.targetSeat == null ? null : idAt(r.targetSeat),
    })),
    type: 'live',
  }
  return { result, detail }
}

/**
 * A King Online game, as ჩაწერა result/detail rows. The card counts come
 * from King Online's per-round fields for the round's own type (what the
 * Online history tab has always shown).
 */
export function onlineGameToLegacy(game, idOfName) {
  const ps = [...(game.players || [])].sort((a, b) => a.seat - b.seat)
  const idBySeat = new Map(ps.map(p => [p.seat, idOfName(p.name)]))
  const idAt = seat => idBySeat.get(seat)
  const winners = (game.winners?.length ? game.winners : game.winner ? [game.winner] : []).map(w => w.name)
  const result = {
    id: game.id,
    played_at: game.playedAt,
    winner_name: joinWinnerNames(winners),
    winners,
    participants: (game.players || []).map(p => ({ name: p.name, score: p.score })),
    type: 'online',
  }
  if (!game.roundDetails?.length) return { result, detail: null }
  const rounds = game.roundDetails.map(rd => {
    const kind = KIND[rd.gameType]
    let counts = null
    if (kind === 'count') {
      counts = {}
      const l2 = {}
      if (rd.gameType === 'L2') (rd.trickWinners || []).slice(-2).forEach(s => { l2[s] = (l2[s] || 0) + 1 })
      ps.forEach(p => {
        const s = p.seat
        counts[idAt(s)] =
          rd.gameType === 'Q' ? rd.queensTaken?.[s] ?? 0
          : rd.gameType === 'J' ? rd.jacksTaken?.[s] ?? 0
          : rd.gameType === 'H' ? rd.heartsTaken?.[s] ?? 0
          : rd.gameType === 'L2' ? l2[s] ?? 0
          : rd.tricksTaken?.[s] ?? 0   // T, P1–P3
      })
    }
    return {
      scores: Object.fromEntries(ps.map(p => [idAt(p.seat), rd.scores?.[p.seat] ?? 0])),
      gameTypeCode: rd.gameType,
      leaderPlayerId: rd.leaderSeat == null ? null : idAt(rd.leaderSeat) ?? null,
      countsByPlayerId: counts,
      singleTargetPlayerId: kind === 'single' && rd.kingOfHeartsTakenBy != null ? idAt(rd.kingOfHeartsTakenBy) ?? null : null,
    }
  })
  const detail = {
    game_result_id: game.id,
    played_at: game.playedAt,
    players: ps.map(p => ({ id: idAt(p.seat), name: p.name })),
    rounds,
    type: 'online',
  }
  return { result, detail }
}
