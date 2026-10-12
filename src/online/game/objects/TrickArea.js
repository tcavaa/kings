import { createFaceUpCard } from './Card.js'

/**
 * Manages the 3 played cards in the centre of the table.
 *
 * Positions are defined relative to the table centre.
 *   slot 0 (self / bottom) → (450, 340)
 *   slot 1 (left opp)      → (250, 250)
 *   slot 2 (right opp)     → (650, 250)
 *
 * The slot for a given absolute seat depends on mySeat.
 */
export class TrickArea {
  static POSITIONS = [
    { x: 450, y: 340 }, // relative to mySeat
    { x: 250, y: 260 }, // left  opponent
    { x: 650, y: 260 }, // right opponent
  ]

  constructor(scene) {
    this.scene     = scene
    this.cards     = []
    this.winnerAnim = null
  }

  /**
   * @param {Array<{seat,card}>} trick
   * @param {number} mySeat
   * @param {Array<{id,name,seat}>} players
   */
  render(trick, mySeat, players) {
    this.clear()
    if (!trick || trick.length === 0) return

    trick.forEach(({ seat, card }) => {
      const relSlot  = (seat - mySeat + 3) % 3
      const pos      = TrickArea.POSITIONS[relSlot]
      const container = createFaceUpCard(this.scene, pos.x, pos.y, card, false)
      this.cards.push(container)
    })
  }

  /**
   * Flash the winning card then fade out the whole trick.
   * @param {number} winnerSeat
   * @param {number} mySeat
   * @param {function} onComplete
   */
  animateWin(winnerSeat, mySeat, onComplete) {
    const relSlot   = (winnerSeat - mySeat + 3) % 3
    const winnerPos = TrickArea.POSITIONS[relSlot]

    // Flash all cards towards winner
    this.cards.forEach(c => {
      this.scene.tweens.add({
        targets: c,
        x: winnerPos.x,
        y: winnerPos.y,
        alpha: 0,
        scaleX: 0.6,
        scaleY: 0.6,
        duration: 500,
        ease: 'Quad.easeIn',
        onComplete: () => { c.destroy() },
      })
    })

    setTimeout(() => {
      this.cards = []
      if (onComplete) onComplete()
    }, 600)
  }

  clear() {
    this.cards.forEach(c => c.destroy())
    this.cards = []
  }
}
