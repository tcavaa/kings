let ctx = null

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  return ctx
}

async function resume() {
  const c = getCtx()
  if (c.state === 'suspended') await c.resume()
  return c
}

function tone(c, startTime, freq, duration, gainVal = 0.15, type = 'sine') {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.connect(gain)
  gain.connect(c.destination)
  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)
  gain.gain.setValueAtTime(gainVal, startTime)
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.01)
}

export async function playRoundEnd() {
  try {
    const c = await resume()
    const t = c.currentTime
    tone(c, t, 330, 0.08, 0.12)
    tone(c, t + 0.09, 440, 0.12, 0.12)
  } catch {}
}

export async function playBigPenalty() {
  try {
    const c = await resume()
    const t = c.currentTime
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.connect(gain)
    gain.connect(c.destination)
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(320, t)
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.35)
    gain.gain.setValueAtTime(0.14, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
    osc.start(t)
    osc.stop(t + 0.36)
  } catch {}
}

export async function playGameWin() {
  try {
    const c = await resume()
    const t = c.currentTime
    tone(c, t, 523, 0.18, 0.15)        // C5
    tone(c, t + 0.18, 659, 0.18, 0.15) // E5
    tone(c, t + 0.36, 784, 0.28, 0.15) // G5
    tone(c, t + 0.60, 1047, 0.4, 0.12) // C6
  } catch {}
}

export async function playRematch() {
  try {
    const c = await resume()
    const t = c.currentTime
    tone(c, t, 440, 0.1, 0.12)
    tone(c, t + 0.15, 440, 0.1, 0.12)
  } catch {}
}
