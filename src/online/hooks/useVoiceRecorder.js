import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Records one short voice clip at a time from the microphone.
 *
 * `toggle()` starts a recording, or stops (and sends) the one running.
 * `stop(true)` throws the clip away. `onClip(blob, seconds)` gets each
 * finished clip; `onError('unsupported' | 'denied')` reports a failed start.
 *
 * While the browser is still asking for the microphone, `recording` is
 * false, so a second tap used to start a second recorder whose mic and timer
 * nobody could stop. `startingRef` ignores taps until the first start settles.
 */
export function useVoiceRecorder({ onClip, onError, maxMs = 15 * 1000 }) {
  const [recording, setRecording] = useState(false)
  const [secs, setSecs] = useState(0)
  const recRef = useRef(null) // { recorder, chunks, cancelled, startAt, tickId, maxId }
  const startingRef = useRef(false)
  const aliveRef = useRef(true)
  // Latest callbacks, so a clip finishing after a re-render uses current ones.
  const handlers = useRef({ onClip, onError })
  useEffect(() => { handlers.current = { onClip, onError } })

  const stop = useCallback((cancel = false) => {
    const r = recRef.current
    if (!r) return
    r.cancelled = cancel
    if (r.recorder.state !== 'inactive') r.recorder.stop()
  }, [])

  const toggle = useCallback(async () => {
    if (recRef.current) { stop(false); return }
    if (startingRef.current) return
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      handlers.current.onError?.('unsupported')
      return
    }
    startingRef.current = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Closed while the permission prompt was up: release the mic at once.
      if (!aliveRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      // Chrome/Firefox → webm/opus; iOS Safari → mp4/aac. Receivers play
      // whatever mime tag rides along with the bytes.
      const mime = MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported?.('audio/mp4')
          ? 'audio/mp4'
          : ''
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)
      const r = { recorder, chunks: [], cancelled: false, startAt: Date.now() }
      recRef.current = r

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) r.chunks.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        clearInterval(r.tickId)
        clearTimeout(r.maxId)
        if (recRef.current === r) recRef.current = null
        if (aliveRef.current) {
          setRecording(false)
          setSecs(0)
        }
        if (r.cancelled || !r.chunks.length) return
        const seconds = Math.max(1, Math.round((Date.now() - r.startAt) / 1000))
        const blob = new Blob(r.chunks, { type: recorder.mimeType || 'audio/webm' })
        handlers.current.onClip?.(blob, seconds)
      }

      recorder.start()
      setRecording(true)
      setSecs(0)
      r.tickId = setInterval(() => setSecs((s) => s + 1), 1000)
      r.maxId = setTimeout(() => stop(false), maxMs)
    } catch {
      handlers.current.onError?.('denied')
    } finally {
      startingRef.current = false
    }
  }, [stop, maxMs])

  // Unmounting mid-recording throws the clip away.
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      stop(true)
    }
  }, [stop])

  return { recording, secs, toggle, stop }
}
