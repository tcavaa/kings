import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Eye, Trophy, Swords } from 'lucide-react'
import { useGame, useLobby } from '../../context/GameContext'
import AvatarImg from '../AvatarImg'

const PHASE_LABEL = {
  type_selection:  'თამაშს ირჩევს',
  trump_selection: 'კოზირს ირჩევს',
  discard:         'კარტს დებს',
  playing:         'თამაშობს',
  round_end:       'რაუნდი დასრულდა',
  game_over:       'დასრულდა',
}

function TableCard({ table, isFinal, myRoomCode, watching, onSpectate }) {
  const finished = table.status === 'finished' || table.phase === 'game_over'
  const mine = table.roomCode === myRoomCode
  const watched = table.roomCode === watching
  // Highest score first so the leader of each table reads at a glance.
  const players = [...(table.players || [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  return (
    <div className="rounded-xl p-3"
         style={{
           background: mine ? 'rgba(213,185,130,0.08)' : 'rgba(255,255,255,0.45)',
           border: `1px solid ${mine ? 'rgba(213,185,130,0.45)' : 'rgba(151,176,162,0.25)'}`,
         }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-western inline-flex items-center gap-1.5" style={{ color: '#d5b982' }}>
          {isFinal ? <Trophy size={14} /> : <Swords size={14} />}
          {table.label}
          {mine && <span className="text-[10px] font-typewriter" style={{ color: 'rgba(225,233,225,0.5)' }}>(შენი)</span>}
        </span>
        <span className="text-[10px] font-typewriter" style={{ color: 'rgba(225,233,225,0.55)' }}>
          {finished
            ? 'დასრულდა'
            : table.round ? `რაუნდი ${table.round}/27 · ${PHASE_LABEL[table.phase] || ''}` : '—'}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {players.map((p, i) => (
          <div key={`${p.name}-${i}`} className="flex items-center gap-2">
            <span className="rounded-full overflow-hidden shrink-0"
                  style={{ opacity: p.connected === false ? 0.4 : 1 }}>
              <AvatarImg avatar={p.avatar} name={p.name} size={20} />
            </span>
            <span className="text-xs truncate flex-1 min-w-0" style={{ color: '#eeeae1' }}>
              {p.name}
              {p.connected === false && (
                <span className="text-[9px] ml-1" style={{ color: '#ef918b' }}>offline</span>
              )}
            </span>
            <span className="text-xs font-bold font-mono tabular-nums"
                  style={{ color: (p.score ?? 0) < 0 ? '#ef918b' : '#7ac7a5' }}>
              {p.score ?? 0}
            </span>
          </div>
        ))}
      </div>

      {/* You can watch any table that isn't the one you're sitting at. */}
      {!mine && !watched && !finished && (
        <button onClick={() => onSpectate(table.roomCode)}
                className="mt-2.5 w-full px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                style={{ background: 'rgba(49,83,107,0.12)', border: '1px solid rgba(49,83,107,0.4)', color: '#31536b' }}>
          <Eye size={13} /> ყურება
        </button>
      )}
    </div>
  )
}

/**
 * Live bracket: where every table is, what the scores are, and a way into
 * watching one. Open from the HUD during a tournament, from the game-over
 * screen, or from the homepage for any tournament (`code`) — following one
 * is open to everybody.
 */
export default function BracketOverview({ code, onClose }) {
  const { refreshOverview, roomCode, spectating, tournament, spectateTable, watchGame } = useGame()
  const { tournamentOverview } = useLobby()
  // One overview is kept at a time, and our own tournament pushes its
  // updates unasked: show only the one this panel is for.
  const ov = !code || tournamentOverview?.code === code ? tournamentOverview : null

  // The server pushes an update whenever a table finishes, but scores move
  // constantly mid-round — poll while the panel is actually open.
  useEffect(() => {
    const refresh = () => refreshOverview(code)
    refresh()
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [refreshOverview, code])

  // An entrant watches as one (voice and sounds stay theirs); anyone else
  // watches the way the homepage does.
  const entrant = !!ov && tournament?.id === ov.id
  const watch = (rc) => {
    if (entrant) spectateTable(rc)
    else watchGame(rc)
    onClose()
  }
  // The table we are watching right now has nothing to switch to.
  const here = spectating ? null : roomCode

  // A dialog's keyboard basics: focus moves in, Escape closes, and focus
  // goes back to the button that opened it.
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  useEffect(() => {
    const previous = document.activeElement
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3"
         style={{ background: 'rgba(32,18,10,0.72)', backdropFilter: 'blur(4px)' }}
         onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="ტურნირის მიმოხილვა"
           className="w-full max-w-md max-h-[88vh] flex flex-col rounded-2xl overflow-hidden"
           style={{
             background: 'linear-gradient(180deg, #172725 0%, #13221f 100%)',
             border: '1px solid rgba(151,176,162,0.45)',
             boxShadow: '0 12px 48px rgba(0,0,0,0.25)',
           }}
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3"
             style={{ borderBottom: '1px solid rgba(151,176,162,0.32)' }}>
          <h3 className="text-sm font-western uppercase tracking-wider" style={{ color: '#eeeae1' }}>
            ტურნირი {ov?.code ? `· ${ov.code}` : ''}
          </h3>
          <button ref={closeRef} onClick={onClose} aria-label="დახურვა" style={{ color: '#eeeae1' }}>
            <X size={20} />
          </button>
        </div>

        <div className="p-3 overflow-y-auto flex flex-col gap-2.5">
          {!ov ? (
            <div className="text-sm font-typewriter py-6 text-center" style={{ color: 'rgba(225,233,225,0.55)' }}>
              იტვირთება…
            </div>
          ) : (
            <>
              {ov.status === 'done' && ov.winners?.length > 0 && (
                <div className="rounded-xl p-3 text-center"
                     style={{ background: 'rgba(213,185,130,0.12)', border: '1px solid rgba(213,185,130,0.45)' }}>
                  <div className="text-[10px] font-typewriter uppercase" style={{ color: 'rgba(225,233,225,0.55)' }}>
                    ტურნირის გამარჯვებული
                  </div>
                  <div className="text-base font-western inline-flex items-center gap-1.5" style={{ color: '#d5b982' }}>
                    <Trophy size={16} /> {ov.winners.map((w) => w.name).join(' და ')}
                  </div>
                </div>
              )}

              {(ov.tables || []).map((t) => (
                <TableCard key={t.roomCode} table={t} myRoomCode={here} watching={spectating?.roomCode} onSpectate={watch} />
              ))}

              {ov.final && (
                <>
                  <div className="western-divider font-western text-[10px] uppercase my-1">
                    <span className="px-2">ფინალი</span>
                  </div>
                  <TableCard table={ov.final} isFinal myRoomCode={here} watching={spectating?.roomCode} onSpectate={watch} />
                </>
              )}

              {/* Who advanced and who didn't, once the semifinals are in. */}
              {ov.standings?.length > 0 && (
                <>
                  <div className="western-divider font-western text-[10px] uppercase my-1">
                    <span className="px-2">შედეგები</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {ov.standings.map((s) => (
                      <div key={s.name}
                           className="flex items-center gap-2 px-2 py-1 rounded"
                           style={{ background: s.advanced ? 'rgba(122,199,165,0.1)' : 'transparent' }}>
                        <span className="text-[10px] font-mono w-4" style={{ color: 'rgba(225,233,225,0.45)' }}>
                          {s.rank}
                        </span>
                        <span className="text-xs flex-1 truncate" style={{ color: '#eeeae1' }}>
                          {s.name}
                          {s.wildcard && (
                            <span className="text-[9px] ml-1" style={{ color: '#d5b982' }}>wildcard</span>
                          )}
                        </span>
                        <span className="text-xs font-mono tabular-nums" style={{ color: '#eeeae1' }}>
                          {s.score}
                        </span>
                        {s.advanced && <Trophy size={11} style={{ color: '#7ac7a5' }} />}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
