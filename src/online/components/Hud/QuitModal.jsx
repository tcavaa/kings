import { Flag, DoorOpen, Check, X } from 'lucide-react'
import { useGame } from '../../context/GameContext'
import ModalShell from '../ModalShell'

/**
 * Quit-round / surrender coordination UI. Three faces:
 *  1. Local confirm dialog before the proposal is sent (confirmKind set).
 *  2. Vote dialog shown to the two other players while a proposal is live.
 *  3. "Waiting for votes" pill for the proposer (and for a voter who
 *     already accepted while the third player decides).
 */
export default function QuitModal({ confirmKind, onCloseConfirm }) {
  const { quitProposal, proposeQuit, voteQuit, mySeat, chosenGameType, players } = useGame()

  const isPositiveRound = typeof chosenGameType === 'string' && chosenGameType.startsWith('P')
  // Players who are offline: if they stay away, the rest decide without them.
  const away = players.filter(p => p.connected === false)

  // ── 2/3: a proposal is live ──────────────────────────────────────────────
  if (quitProposal) {
    const { kind, proposerSeat, proposerName, acceptedSeats = [], voters = [0, 1, 2] } = quitProposal
    // Spectators don't vote.
    if (mySeat === null || mySeat === undefined) return null
    const isMine    = proposerSeat === mySeat
    const iAccepted = acceptedSeats.includes(mySeat)
    const agreed    = Math.max(0, acceptedSeats.length - 1) // proposer doesn't count as a vote
    const needed    = Math.max(0, voters.length - 1)

    if (isMine || iAccepted) {
      return (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
          <div className="western-pill px-5 py-2 text-xs font-typewriter">
            {kind === 'game' ? 'დანებება' : 'ხელის დათმობა'} — ველოდებით თანხმობას… ({agreed}/{needed})
          </div>
        </div>
      )
    }

    const body = kind === 'game'
      ? `${proposerName}-ს უნდა დანებება — თამაში ახლავე დასრულდება და ვინც ქულებით ლიდერობს, ის მოიგებს.`
      : isPositiveRound
        ? `${proposerName}-ს უნდა ამ ხელის დათმობა — ხელს თმობს და +80-ს შენ და მესამე მოთამაშე გაიყოფთ.`
        : `${proposerName}-ს უნდა ამ ხელის დათმობა — მთელი -40 მას ჩაეწერება და მაგიდა შემდეგ ხელზე გადავა.`

    return (
      <QuitDialog
        kind={kind}
        body={body}
        confirmLabel={<><Check size={14} /> თანახმა ვარ</>}
        cancelLabel={<><X size={14} /> უარი</>}
        onConfirm={() => voteQuit(true)}
        onCancel={() => voteQuit(false)}
      />
    )
  }

  // ── 1: local confirmation before sending the proposal ───────────────────
  if (!confirmKind) return null

  const body = confirmKind === 'game'
    ? away.length
      ? `${away.map(p => p.name).join(' და ')} მაგიდას გაეთიშა. თამაში დასრულდება და ქულების ლიდერი მოიგებს — მაგიდასთან დარჩენილები უნდა დათანხმდნენ.`
      : 'თამაში მაშინვე დასრულდება და ქულების ლიდერი მოიგებს. ორივე მოთამაშე უნდა დათანხმდეს.'
    : isPositiveRound
      ? 'ამ ხელს თმობ — +80-ს დანარჩენი ორი გაიყოფს. ორივე უნდა დათანხმდეს.'
      : 'ამ ხელის მთელი -40 შენ ჩაგეწერება და მაგიდა შემდეგ ხელზე გადავა. ორივე მოთამაშე უნდა დათანხმდეს.'

  return (
    <QuitDialog
      kind={confirmKind}
      body={body}
      confirmLabel={confirmKind === 'game' ? 'შესთავაზე დანებება' : 'შესთავაზე დათმობა'}
      cancelLabel="გაუქმება"
      onConfirm={() => { proposeQuit(confirmKind); onCloseConfirm() }}
      onCancel={onCloseConfirm}
    />
  )
}

/** The one dialog shape both the proposer's confirm and the vote share. */
function QuitDialog({ kind, body, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  const Icon = kind === 'game' ? Flag : DoorOpen
  const title = kind === 'game' ? 'ნებდები?' : 'დათმობ ამ ხელს?'
  const buttonClass = 'flex-1 py-2 rounded-lg font-western uppercase text-[11px] lg:text-sm tracking-wider transition-all active:scale-95 inline-flex items-center justify-center gap-1.5'
  return (
    <ModalShell className="items-center z-40 px-4" panelClassName="max-w-sm p-4 lg:p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={18} style={{ color: '#d5b982' }} />
        <h2 className="text-sm lg:text-base font-western uppercase tracking-wide" style={{ color: '#eeeae1' }}>
          {title}
        </h2>
      </div>
      <p className="text-xs lg:text-sm font-typewriter mb-4" style={{ color: 'rgba(225,233,225,0.85)' }}>
        {body}
      </p>
      <div className="flex gap-2">
        <button onClick={onConfirm} className={`casino-btn-gold ${buttonClass}`}>
          {confirmLabel}
        </button>
        <button onClick={onCancel} className={`casino-btn-secondary ${buttonClass}`}>
          {cancelLabel}
        </button>
      </div>
    </ModalShell>
  )
}
