import { EventBus } from '../../game/EventBus'
import { clearSeatMarker } from '../../lib/publicSeatStore'
import { SUIT_NAMES } from '../../constants/suits'
import { TRICK_DISPLAY_MS, TRICK_ANIMATION_MS } from '../tableReducer'

/**
 * The game being played: deals, contracts, cards, tricks, rounds, the end of
 * the game and full snapshots. Table state changes go through the pure
 * tableReducer; the timers that stage a finished trick (show it, fly it to
 * the winner, clear it) live here, in `refs.trickTimers`.
 */
export function registerTableEvents(socket, ctx) {
  const { refs, dispatch } = ctx
  const later = (fn, ms) => { refs.trickTimers.current.push(setTimeout(fn, ms)) }

  socket.on('game-started', ({ round, leaderSeat, players: p, startedAt }) => {
    ctx.clearGameOverTimer()
    ctx.forgetResults()
    refs.snapshotAfterRejoin.current = false
    // Everyone is at the table, whatever the banner said before.
    ctx.clearDisconnected()
    ctx.setGameStartedAt(startedAt || Date.now())
    dispatch({ type: 'game-started', round, leaderSeat })
    ctx.setPlayers(p)
    ctx.setAppPhase('game')
    // Wipe rematch state from any previous game; the new game-over for
    // THIS room is the only thing that should populate it.
    ctx.setRematch({ newRoomCode: null, joinedOldSeats: [] })
    ctx.setQuitProposal(null)
  })

  socket.on('hand-dealt', ({ hand, centerCards, leaderSeat, round, cardCounts }) => {
    ctx.clearTrickTimers()
    dispatch({ type: 'hand-dealt', hand, centerCards, leaderSeat, round, cardCounts })
    ctx.clearGameOverTimer()
  })

  socket.on('round-started', ({ round, leaderSeat, phase, usedTypes, cardCounts }) => {
    ctx.clearTrickTimers()
    dispatch({ type: 'round-started', round, leaderSeat, phase, usedTypes, cardCounts })
    ctx.setQuitProposal(null)
  })

  socket.on('game-type-selected', ({ typeCode, leaderSeat, phase, usedTypes }) => {
    dispatch({ type: 'game-type-selected', typeCode, leaderSeat, phase, usedTypes })
    ctx.addToast(`${ctx.seatName(leaderSeat)}-მ აირჩია — „${typeCode}“`, 'info')
  })

  socket.on('trump-selected', ({ trumpSuit, phase }) => {
    dispatch({ type: 'trump-selected', trumpSuit, phase })
    ctx.addToast(`კოზირი: ${trumpSuit ? SUIT_NAMES[trumpSuit] : 'უკოზირო'}`, 'info')
  })

  socket.on('hand-updated', ({ hand, lastCenterCards }) => {
    dispatch({ type: 'hand-updated', hand, lastCenterCards })
  })

  socket.on('cards-discarded', ({ phase, currentTurn, leaderSeat }) => {
    dispatch({ type: 'cards-discarded', phase, currentTurn, leaderSeat })
  })

  socket.on('card-played', ({ seat, card, currentTrick, currentTurn, ledSuit, cardCounts }) => {
    // The next trick has begun. If the last one's show-and-clear timers
    // are still pending (a throttled tab), they'd wipe this lead card and
    // reset the turn — drop them, the server's values below are newer.
    const endsTrickAnimation = refs.trickTimers.current.length > 0
    if (endsTrickAnimation) ctx.clearTrickTimers()
    dispatch({
      type: 'card-played', card, currentTrick, currentTurn, ledSuit, cardCounts,
      mine: seat === refs.mySeat.current, endsTrickAnimation,
    })
  })

  socket.on('trick-complete', ({ winnerSeat, trick, nextTurn, cardCounts }) => {
    // Show the full 3-card trick on the table for a moment, then animate
    // toward the winner, then clear.
    dispatch({ type: 'trick-complete', winnerSeat, trick, cardCounts })
    ctx.clearTrickTimers()
    // Phase 1: fly the cards to the winner avatar
    later(() => {
      dispatch({ type: 'trick-animate', winnerSeat, trick, status: 'animating' })
      EventBus.emit('animate-trick-winner', { winnerSeat, trick })
    }, TRICK_DISPLAY_MS)
    // Phase 2: clear & advance turn after the animation finishes
    later(() => dispatch({ type: 'trick-cleared', nextTurn }), TRICK_DISPLAY_MS + TRICK_ANIMATION_MS)
  })

  socket.on('round-complete', ({ winnerSeat, trick, scores, cumulativeScores, round, gameType, isGameOver, cardCounts, roundDetail, quitBySeat }) => {
    dispatch({
      type: 'round-complete', winnerSeat, trick, scores, cumulativeScores, round, gameType,
      isGameOver, cardCounts, roundDetail,
    })
    ctx.setQuitProposal(null)
    ctx.clearTrickTimers()

    // Quit-round vote passed: there's no final trick to show or animate —
    // the reducer went straight to the round summary.
    if (!trick) {
      if (typeof quitBySeat === 'number') {
        ctx.addToast(`${ctx.seatName(quitBySeat)}-მ დათმო ხელი.`, 'warning')
      }
      return
    }

    // Show the last trick of the round briefly, then transition.
    later(() => {
      dispatch({ type: 'trick-animate', winnerSeat, trick })
      EventBus.emit('animate-trick-winner', { winnerSeat, trick })
    }, TRICK_DISPLAY_MS)
    later(() => {
      dispatch({ type: 'trick-cleared' })
      // No round summary after the last round: game-over moves us to the
      // results, and a summary flashing in between offered a dead button.
      if (!isGameOver) {
        dispatch({ type: 'round-end' })
        ctx.addToast(`ხელი ${round} დასრულდა.`, 'success')
      }
    }, TRICK_DISPLAY_MS + TRICK_ANIMATION_MS)
  })

  socket.on('game-over', ({ finalScores, winner, winners, isTie, mode, players: p, roundDetails, surrenderedBySeat, abandonedSeats }) => {
    // Older server payloads carry only `winner` — normalise so the
    // game-over screen can always render from `winners`.
    const winnersList = Array.isArray(winners) && winners.length ? winners : (winner ? [winner] : [])
    const tie = !!isTie && winnersList.length > 1
    ctx.setFinalResults({
      finalScores, winner, winners: winnersList, isTie: tie, mode, players: p, roundDetails,
      roomCode: refs.roomCode.current,
    })
    dispatch({ type: 'game-over', roundDetails })
    ctx.setQuitProposal(null)
    // The public-seat bookmark (if any) has served its purpose — the game
    // it pointed at is finished, so a later refresh shouldn't chase it.
    clearSeatMarker()
    // Switch to the results once the last trick has played out — unless we
    // have moved on by then (seated at the tournament final, or sent back
    // to the lobby after watching).
    const endedRoom = refs.roomCode.current
    ctx.clearGameOverTimer()
    refs.gameOverTimer.current = setTimeout(() => {
      refs.gameOverTimer.current = null
      if (refs.roomCode.current !== endedRoom || refs.appPhase.current !== 'game') return
      ctx.setAppPhase('gameover')
    }, TRICK_DISPLAY_MS + TRICK_ANIMATION_MS + 200)
    const winnerLabel = winnersList.map(w => w.name).join(' და ')
    if (Array.isArray(abandonedSeats) && abandonedSeats.length) {
      const gone = abandonedSeats.map(s => ctx.seatName(s, p)).join(' და ')
      ctx.addToast(`${gone} წავიდა — თამაში დასრულდა, ${winnerLabel} იმარჯვებს!`, 'success')
    } else if (typeof surrenderedBySeat === 'number') {
      ctx.addToast(`${ctx.seatName(surrenderedBySeat, p)} დანებდა — ${winnerLabel} იმარჯვებს!`, 'success')
    } else if (tie) {
      ctx.addToast(`ფრეა! გამარჯვებულები: ${winnerLabel} 🤝`, 'success')
    } else {
      ctx.addToast(`${winnerLabel} იმარჯვებს!`, 'success')
    }
  })

  socket.on('game-state', (state) => {
    // A snapshot of a FINISHED game must never drag the user back onto
    // the table. Late snapshots arrive after game over (visibility-resume
    // resync, a socket blip reconnect, the error-path resync) — route
    // them to the game-over screen instead, rebuilding finalResults from
    // the snapshot if this client never saw this room's `game-over` event
    // (e.g. a refresh on the results screen, or a missed one).
    if (state.phase === 'game_over') {
      ctx.setFinalResults(prev => {
        if (prev && prev.roomCode === refs.roomCode.current) return prev
        return resultsFromSnapshot(state, refs.roomCode.current)
      })
      ctx.setAppPhase('gameover')
    } else {
      ctx.setAppPhase('game')
    }
    if (state.players) ctx.setPlayers(state.players)
    ctx.clearTrickTimers()
    dispatch({ type: 'game-state', state })
    // Snapshots don't carry a quit vote. After a reconnect that means none
    // is running (any we showed is stale); a routine resync leaves a live
    // vote alone.
    if ('quitProposal' in state) ctx.setQuitProposal(state.quitProposal ?? null)
    else if (refs.snapshotAfterRejoin.current) ctx.setQuitProposal(null)
    refs.snapshotAfterRejoin.current = false
    // Force the canvas to repaint the rehydrated state. The dispatch above
    // queues a React re-render → PhaserGame re-emits state-update; we fire
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
}

/** Results for the game-over screen, rebuilt from a finished snapshot. */
function resultsFromSnapshot(state, roomCode) {
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
    roomCode,
  }
}
