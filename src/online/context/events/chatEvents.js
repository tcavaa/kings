import { getSounds } from '../../lib/soundRegistry'

/** Table talk: messages, voice clips, reactions, typing dots and sounds. */
export function registerChatEvents(socket, ctx) {
  const { chat, refs } = ctx

  // ── Sounds: a player triggered a saloon reaction ───────────────────
  socket.on('play-sound', ({ soundId, bySeat, targetSeat }) => {
    ctx.playClip(soundId)
    // Also flash a chat-bubble-style indicator above the targeted player.
    // The name comes from the catalogue, which is what the admin actually
    // typed: an uploaded clip named in Georgian has no readable id (it's a
    // token like `snd-ffd1d735`), and renaming a clip in /admin changes
    // what shows on the table.
    const target = typeof targetSeat === 'number' ? targetSeat : bySeat
    const label = getSounds().find(s => s.id === soundId)?.label || soundId
    chat.showBubble(target, { message: label, name: '', avatar: null }, 2500)
  })

  // ── Typing indicator ────────────────────────────────────────────────
  socket.on('chat-typing', ({ seat }) => {
    if (seat === refs.mySeat.current) return
    chat.typing(seat)
  })

  // ── Voice messages (ephemeral) ──────────────────────────────────────
  // The server relays the raw audio bytes; we wrap them in an object URL
  // and drop them into the same chat list as text messages. Nothing is
  // persisted — a refresh loses the clips, by design.
  socket.on('voice-message', (msg) => {
    try {
      if (!msg || !msg.audio) return
      const blob = new Blob([msg.audio], { type: msg.mime || 'audio/webm' })
      chat.addVoice({
        type: 'voice',
        // The id lets players react to a clip like to any message.
        id: msg.id,
        spectator: !!msg.spectator,
        url: URL.createObjectURL(blob),
        duration: msg.duration || 0,
        seat: msg.seat,
        name: msg.name,
        avatar: msg.avatar || null,
        at: msg.at || Date.now(),
      })
    } catch { /* malformed clip — ignore */ }
  })

  // ── Chat ────────────────────────────────────────────────────────────
  socket.on('chat-reaction', (reaction) => chat.toggleReaction(reaction))
  socket.on('chat-message', (msg) => chat.addMessage(msg))
}
