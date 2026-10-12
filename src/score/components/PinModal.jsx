import { useEffect, useRef, useState } from 'react'

const CORRECT_PIN = '2282'

export default function PinModal({ onSuccess, onCancel, title = 'Enter PIN' }) {
  const [digits, setDigits] = useState(['', '', '', ''])
  const [error, setError] = useState(false)
  const inputs = [useRef(), useRef(), useRef(), useRef()]

  useEffect(() => { inputs[0].current?.focus() }, [])

  function handleKey(i, e) {
    const val = e.target.value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[i] = val
    setDigits(next)
    setError(false)
    if (val && i < 3) inputs[i + 1].current?.focus()
    if (next.every(d => d !== '')) {
      const pin = next.join('')
      if (pin === CORRECT_PIN) {
        onSuccess()
      } else {
        setError(true)
        setDigits(['', '', '', ''])
        setTimeout(() => inputs[0].current?.focus(), 50)
      }
    }
  }

  function handleKeyDown(i, e) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      inputs[i - 1].current?.focus()
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 320 }}>
        <h3 style={{ margin: '0 0 6px' }}>{title}</h3>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 20px' }}>
          Enter the 4-digit PIN to continue.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 16 }}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={inputs[i]}
              type="password"
              inputMode="numeric"
              maxLength={1}
              autoComplete="off"
              value={d}
              onChange={e => handleKey(i, e)}
              onKeyDown={e => handleKeyDown(i, e)}
              style={{
                width: 52, height: 56, fontSize: 24, textAlign: 'center',
                borderRadius: 8, border: `2px solid ${error ? '#dc2626' : 'var(--line)'}`,
                background: 'var(--cell-bg)', color: 'var(--text)',
                outline: 'none', transition: 'border-color 0.15s',
              }}
            />
          ))}
        </div>
        {error && (
          <p style={{ color: '#dc2626', fontSize: 13, textAlign: 'center', margin: '0 0 12px' }}>
            Incorrect PIN. Try again.
          </p>
        )}
        <div className="modal-actions">
          <button className="link" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
