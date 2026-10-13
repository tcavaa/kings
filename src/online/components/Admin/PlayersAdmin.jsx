import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, LockOpen, Lock } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { adminCall, ErrorNote, PanelTitle, inputStyle, muted } from './adminUi'

/** /admin → players: the one player list both apps use. */
export default function PlayersAdmin({ passcode, onLocked }) {
  const [players, setPlayers] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const call = useCallback((fn) => adminCall(fn, { onLocked, onError: setError }), [onLocked])

  const reload = useCallback(async () => {
    const list = await call(() => adminApi.listPlayers())
    if (list) setPlayers(list)
  }, [call])
  useEffect(() => { reload() }, [reload])

  const run = async (fn) => {
    setBusy(true); setError('')
    const ok = await call(fn)
    if (ok) await reload()
    setBusy(false)
    return ok
  }

  const add = async (e) => {
    e.preventDefault()
    if (name.trim() && await run(() => adminApi.addPlayer(passcode, name.trim()))) setName('')
  }

  const remove = (p) => {
    if (window.confirm(`წავშალოთ „${p.name}“? მისი თამაშები დარჩება.`)) run(() => adminApi.deletePlayer(passcode, p.id))
  }

  // A player without a PIN can't change their own profile (nobody could tell
  // it's them), so the admin gives them one and tells them what it is.
  const setPin = (p) => {
    const pin = window.prompt(`„${p.name}“-ის ახალი 4-ციფრიანი PIN-კოდი:`)
    if (pin === null) return
    if (!/^\d{4}$/.test(pin.trim())) { setError('PIN-კოდი ზუსტად 4 ციფრი უნდა იყოს.'); return }
    run(() => adminApi.setPlayerPin(passcode, p.id, pin.trim()))
  }

  const clearPin = (p) => {
    if (window.confirm(`მოვხსნათ „${p.name}“-ის PIN-კოდი?`)) run(() => adminApi.clearPlayerPin(passcode, p.id))
  }

  return (
    <>
      <ErrorNote text={error} />
      <form onSubmit={add} className="k-admin-panel p-4 mb-5 flex gap-2">
        <input value={name} maxLength={64} onChange={(e) => setName(e.target.value)}
               placeholder="მოთამაშის სახელი" aria-label="მოთამაშის სახელი"
               className="min-w-0 flex-1 px-3 py-2 text-sm" style={inputStyle} />
        <button type="submit" disabled={busy || !name.trim()}
                className="k-button px-4 py-2 text-sm font-bold disabled:opacity-40 inline-flex items-center gap-1">
          <Plus size={14} /> დამატება
        </button>
      </form>

      <div className="k-admin-panel p-4">
        <PanelTitle>მოთამაშეები {players && `(${players.length})`}</PanelTitle>
        {players === null ? (
          <p className="text-sm" style={muted}>იტვირთება…</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {players.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2 px-3" style={inputStyle}>
                <span className="flex-1 text-sm">{p.name}</span>
                {p.has_pin ? (
                  <button onClick={() => clearPin(p)} disabled={busy} title="PIN-ის მოხსნა"
                          className="p-1.5 hover:opacity-70 disabled:opacity-40" style={muted}>
                    <LockOpen size={15} />
                  </button>
                ) : (
                  <button onClick={() => setPin(p)} disabled={busy} title="PIN-ის დაყენება"
                          className="p-1.5 hover:opacity-70 disabled:opacity-40" style={muted}>
                    <Lock size={15} />
                  </button>
                )}
                <button onClick={() => remove(p)} disabled={busy} title="წაშლა"
                        className="p-1.5 hover:opacity-70 disabled:opacity-40" style={{ color: '#ef918b' }}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
