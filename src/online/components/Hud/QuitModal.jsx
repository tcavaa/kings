import { Flag, DoorOpen, Check, X } from 'lucide-react-online'
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
  const { quitProposal, proposeQuit, voteQuit, mySeat, chosenGameType } = useGame()

  const isPositiveRound = typeof chosenGameType === 'string' && chosenGameType.startsWith('P')

  // ── 2/3: a proposal is live ──────────────────────────────────────────────
  if (quitProposal) {
    const { kind, proposerSeat, proposerName, acceptedSeats = [] } = quitProposal
    const isMine    = proposerSeat === mySeat
    const iAccepted = acceptedSeats.includes(mySeat)
    const agreed    = Math.max(0, acceptedSeats.length - 1) // proposer doesn't count as a vote

    if (isMine || iAccepted) {
      return (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
          <div className="western-pill px-5 py-2 text-xs font-typewriter">
            {kind === 'game' ? 'დანებება' : 'ხელის დათმობა'} — ველოდებით თანხმობას… ({agreed}/2)
          </div>
        </div>
      )
    }

    const Icon = kind === 'game' ? Flag : DoorOpen
    const title = kind === 'game' ? 'ნებდები?' : 'დათმობ ამ ხელს?'
    const body = kind === 'game'
      ? `${proposerName}-ს უნდა დანებება — თამაში ახლავე დასრულდება და ვინც ქულებით ლიდერობს, ის მოიგებს.`
      : isPositiveRound
        ? `${proposerName}-ს უნდა ამ ხელის დათმობა — ხელს თმობს და +80-ს შენ და მესამე მოთამაშე გაიყოფთ.`
        : `${proposerName}-ს უნდა ამ ხელის დათმობა — მთელი -40 მას ჩაეწერება და მაგიდა შემდეგ ხელზე გადავა.`

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
            <button
              onClick={() => voteQuit(true)}
              className="flex-1 py-2 rounded-lg font-western uppercase text-[11px] lg:text-sm tracking-wider transition-all active:scale-95 casino-btn-gold inline-flex items-center justify-center gap-1.5"
            >
              <Check size={14} /> თანახმა ვარ
            </button>
            <button
              onClick={() => voteQuit(false)}
              className="casino-btn-secondary flex-1 py-2 rounded-lg font-western uppercase text-[11px] lg:text-sm tracking-wider transition-all active:scale-95 inline-flex items-center justify-center gap-1.5"
            >
              <X size={14} /> უარი
            </button>
          </div>
      </ModalShell>
    )
  }

  // ── 1: local confirmation before sending the proposal ───────────────────
  if (!confirmKind) return null

  const Icon = confirmKind === 'game' ? Flag : DoorOpen
  const title = confirmKind === 'game' ? 'ნებდები?' : 'დათმობ ამ ხელს?'
  const body = confirmKind === 'game'
    ? 'თამაში მაშინვე დასრულდება და ქულების ლიდერი მოიგებს. ორივე მოთამაშე უნდა დათანხმდეს.'
    : isPositiveRound
      ? 'ამ ხელს თმობ — +80-ს დანარჩენი ორი გაიყოფს. ორივე უნდა დათანხმდეს.'
      : 'ამ ხელის მთელი -40 შენ ჩაგეწერება და მაგიდა შემდეგ ხელზე გადავა. ორივე მოთამაშე უნდა დათანხმდეს.'

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
          <button
            onClick={() => { proposeQuit(confirmKind); onCloseConfirm() }}
            className="flex-1 py-2 rounded-lg font-western uppercase text-[11px] lg:text-sm tracking-wider transition-all active:scale-95 casino-btn-gold"
          >
            {confirmKind === 'game' ? 'შესთავაზე დანებება' : 'შესთავაზე დათმობა'}
          </button>
          <button
            onClick={onCloseConfirm}
            className="casino-btn-secondary flex-1 py-2 rounded-lg font-western uppercase text-[11px] lg:text-sm tracking-wider transition-all active:scale-95"
          >
            გაუქმება
          </button>
        </div>
    </ModalShell>
  )
}
