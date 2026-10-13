import { useRef, useState } from 'react'
import { voicePlayer } from '../lib/voicePlayer'

const MAX_MESSAGES = 50

/**
 * The table chat: messages (text and voice), the bubbles over avatars and
 * the typing dots. Chat changes at keystroke frequency, so it lives in its
 * own context (see GameContext). `chat` holds the stable helpers the socket
 * handlers and actions use.
 */
export function useChatState() {
  const [chatMessages, setChatMessages] = useState([])  // [{seat,name,avatar,message,at}]
  const [chatBubbles, setChatBubbles]   = useState({})  // seat -> {message, at}
  // Typing indicator — seats (other than ours) currently typing in chat.
  // Each entry auto-expires a couple of seconds after the last typing ping.
  const [typingSeats, setTypingSeats]   = useState({})  // seat -> true

  const helpers = useRef(null)
  if (!helpers.current) {
    const bubbleTimers = {}
    const typingTimers = {}
    // Object URLs of the voice clips we hold, revoked when they leave the chat.
    const voiceUrls = new Set()
    // Chat typed while offline, sent once the server has us back in our seat.
    let queue = []

    const dropTyping = (seat) => {
      clearTimeout(typingTimers[seat])
      delete typingTimers[seat]
      setTypingSeats(prev => {
        if (!prev[seat]) return prev
        const next = { ...prev }; delete next[seat]; return next
      })
    }

    helpers.current = {
      // A message (or sound label) over a seat's avatar for `ms`.
      showBubble(seat, bubble, ms) {
        setChatBubbles(prev => ({ ...prev, [seat]: bubble }))
        clearTimeout(bubbleTimers[seat])
        bubbleTimers[seat] = setTimeout(() => {
          delete bubbleTimers[seat]
          setChatBubbles(prev => {
            const next = { ...prev }; delete next[seat]; return next
          })
        }, ms)
      },

      addMessage(msg) {
        setChatMessages(prev => [...prev.slice(-(MAX_MESSAGES - 1)), msg])
        // Their message landed — retire the typing indicator immediately.
        dropTyping(msg.seat)
        // Show bubble above the sender's avatar for ~5 seconds
        helpers.current.showBubble(msg.seat, msg, 5000)
      },

      addVoice(entry) {
        voiceUrls.add(entry.url)
        setChatMessages(prev => {
          const next = [...prev, entry]
          // Release object URLs of clips that scroll out of the 50-message
          // window, otherwise every voice message leaks its blob.
          const dropped = next.length > MAX_MESSAGES ? next.slice(0, next.length - MAX_MESSAGES) : []
          dropped.forEach(m => {
            // Never yank the blob out from under a clip that's mid-play.
            if (m.type === 'voice' && m.url && voicePlayer.playingUrl() !== m.url) {
              URL.revokeObjectURL(m.url)
              voiceUrls.delete(m.url)
            }
          })
          return next.slice(-MAX_MESSAGES)
        })
        // Flash a mic bubble above the sender's avatar on the table.
        helpers.current.showBubble(entry.seat, { message: '🎤 ხმოვანი' }, 4000)
      },

      // Reactions arrive as individual toggles and are folded into the message
      // they belong to. A reaction for a message we no longer hold (pruned out
      // of the 50-message window, or sent before we joined) is simply dropped.
      toggleReaction({ messageId, emoji, seat, name }) {
        setChatMessages(prev => prev.map(m => {
          if (m.id !== messageId) return m
          const by = m.reactions?.[emoji] || []
          const mine = by.some(r => r.seat === seat && r.name === name)
          // Same person, same emoji = un-react. Keeps one tap-back per person
          // per emoji without the server tracking any state.
          const next = mine
            ? by.filter(r => !(r.seat === seat && r.name === name))
            : [...by, { seat, name }]
          const reactions = { ...(m.reactions || {}) }
          if (next.length) reactions[emoji] = next
          else delete reactions[emoji]
          return { ...m, reactions }
        }))
      },

      typing(seat) {
        setTypingSeats(prev => (prev[seat] ? prev : { ...prev, [seat]: true }))
        clearTimeout(typingTimers[seat])
        typingTimers[seat] = setTimeout(() => dropTyping(seat), 2500)
      },

      /** Hold a message typed while offline (the last ten). */
      queue(message) {
        queue = [...queue.slice(-9), message]
      },
      /** The held messages, emptied. */
      takeQueue() {
        const out = queue
        queue = []
        return out
      },

      /** A new table: nothing of the old one's chat stays. */
      reset() {
        voicePlayer.stop()
        voiceUrls.forEach(url => URL.revokeObjectURL(url))
        voiceUrls.clear()
        queue = []
        setChatMessages([])
        Object.keys(bubbleTimers).forEach(k => { clearTimeout(bubbleTimers[k]); delete bubbleTimers[k] })
        setChatBubbles({})
        Object.keys(typingTimers).forEach(k => { clearTimeout(typingTimers[k]); delete typingTimers[k] })
        setTypingSeats({})
      },
    }
  }

  return { chatMessages, chatBubbles, typingSeats, chat: helpers.current }
}
