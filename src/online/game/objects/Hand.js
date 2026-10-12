import { createFaceUpCard, createFaceDownCard, CARD_W, CARD_H } from './Card.js'

/**
 * Manages a collection of cards displayed in a horizontal fan.
 */
export class Hand {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} cx         centre x
   * @param {number} cy         centre y of cards
   * @param {number} spacing    horizontal gap between card centres
   */
  constructor(scene, cx, cy, spacing = 50) {
    this.scene    = scene
    this.cx       = cx
    this.cy       = cy
    this.spacing  = spacing
    this.cards    = []  // Phaser containers
  }

  /**
   * Render the hand from an array of card data.
   * @param {Array<{rank,suit}>} cardArray
   * @param {boolean} faceUp
   * @param {function(card):boolean} isPlayable   – determines glow
   * @param {function(card):void}   onClick
   */
  render(cardArray, faceUp = true, isPlayable = () => false, onClick = null) {
    this.clear()
    if (!cardArray || cardArray.length === 0) return

    const total   = cardArray.length
    const halfW   = ((total - 1) * this.spacing) / 2

    cardArray.forEach((card, i) => {
      const x = this.cx - halfW + i * this.spacing
      const y = this.cy

      const container = faceUp
        ? createFaceUpCard(this.scene, x, y, card, !!onClick)
        : createFaceDownCard(this.scene, x, y)

      if (faceUp && onClick) {
        const playable = isPlayable(card)
        container.setAlpha(playable ? 1 : 0.4)

        if (playable) {
          // Gold glow border
          const glow = this.scene.add.graphics()
          glow.lineStyle(3, 0xf0a500, 0.9)
          glow.strokeRoundedRect(-CARD_W / 2 - 2, -CARD_H / 2 - 2, CARD_W + 4, CARD_H + 4, 7)
          container.add(glow)
          container.bringToTop(glow)

          container.on('pointerover', () => {
            this.scene.tweens.add({ targets: container, y: y - 10, duration: 120, ease: 'Quad.easeOut' })
          })
          container.on('pointerout', () => {
            this.scene.tweens.add({ targets: container, y, duration: 120, ease: 'Quad.easeIn' })
          })
          container.on('pointerdown', () => onClick(card))
        }
      }

      this.cards.push(container)
    })
  }

  clear() {
    this.cards.forEach(c => c.destroy())
    this.cards = []
  }
}
