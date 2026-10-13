import { useCallback, useEffect, useState } from 'react'
import { Trophy, Check } from 'lucide-react-online'
import { adminApi } from '../../lib/api'
import { adminCall, ErrorNote, PanelTitle, inputStyle, muted } from './adminUi'

// Same ids as King Score's themes (src/score/utils/themes.js).
const THEMES = [
  { id: 'casual',    label: 'ჩვეულებრივი' },
  { id: 'summer',    label: 'ზაფხული' },
  { id: 'mountain',  label: 'მთა' },
  { id: 'christmas', label: 'შობა' },
]

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('ka-GE') : '—')

function SeasonForm({ initial, submitLabel, busy, onSubmit }) {
  const [name, setName] = useState(initial?.name || '')
  const [theme, setTheme] = useState(initial?.theme || 'casual')
  useEffect(() => { setName(initial?.name || ''); setTheme(initial?.theme || 'casual') }, [initial])
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit({ name: name.trim(), theme }) }}>
      <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)}
             placeholder="სეზონის სახელი"
             className="w-full px-3 py-2 rounded-lg text-sm mb-3" style={inputStyle} />
      <div className="grid grid-cols-2 gap-2 mb-3">
        {THEMES.map((t) => (
          <button key={t.id} type="button" onClick={() => setTheme(t.id)}
                  className="px-3 py-2 rounded-lg text-xs font-bold"
                  style={{ ...inputStyle, borderColor: theme === t.id ? '#d5b982' : inputStyle.border, opacity: theme === t.id ? 1 : 0.6 }}>
            {t.label}
          </button>
        ))}
      </div>
      <button type="submit" disabled={busy || !name.trim()}
              className="western-pill w-full px-4 py-2.5 text-sm font-bold disabled:opacity-40"
              style={{ color: '#eeeae1' }}>
        {busy ? '…' : submitLabel}
      </button>
    </form>
  )
}

/** /admin → seasons: rename or re-theme the current season, end it, see past ones. */
export default function SeasonsAdmin({ passcode, onLocked }) {
  const [rows, setRows] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const call = useCallback((fn) => adminCall(fn, { onLocked, onError: setError }), [onLocked])

  const reload = useCallback(async () => {
    const list = await call(() => adminApi.listSeasons())
    if (list) setRows(list)
  }, [call])
  useEffect(() => { reload() }, [reload])

  const current = rows?.find((r) => !r.ended_at) || null
  const past = (rows || []).filter((r) => r.ended_at)

  const save = async (body) => {
    setBusy(true); setError(''); setNote('')
    if (await call(() => adminApi.updateSeason(passcode, body))) {
      setNote('შენახულია.')
      await reload()
    }
    setBusy(false)
  }

  const showChampion = async () => {
    setBusy(true); setError(''); setNote('')
    const out = await call(() => adminApi.previewSeasonEnd(passcode))
    if (out) setPreview(out)
    setBusy(false)
  }

  const end = async (next) => {
    if (!window.confirm(`დავასრულოთ სეზონი? ჩემპიონი: ${preview.champion}`)) return
    setBusy(true); setError(''); setNote('')
    const out = await call(() => adminApi.endSeason(passcode, next))
    if (out) {
      setNote(`სეზონი დასრულდა — ჩემპიონი: ${out.champion}. დაიწყო „${next.name}“.`)
      setPreview(null)
      await reload()
    }
    setBusy(false)
  }

  return (
    <>
      <ErrorNote text={error} />
      {note && <p className="mb-4 text-sm font-typewriter" style={{ color: '#9fd3a8' }}>{note}</p>}

      <div className="western-panel p-4 mb-5">
        <PanelTitle>მიმდინარე სეზონი</PanelTitle>
        <p className="text-xs font-typewriter mb-3" style={muted}>
          {current ? `დაიწყო ${day(current.started_at)}` : 'სახელი ჯერ არ აქვს.'}
        </p>
        <SeasonForm initial={current} submitLabel={<><Check size={14} className="inline" /> შენახვა</>}
                    busy={busy} onSubmit={save} />
      </div>

      <div className="western-panel p-4 mb-5">
        <PanelTitle>სეზონის დასრულება</PanelTitle>
        {!preview ? (
          <>
            <p className="text-xs font-typewriter mb-3" style={muted}>
              ჩემპიონი = ყველაზე მეტი მოგება ამ სეზონში (ჩაწერის თამაშები + ლიგის თამაშები). ფრეზე — ყველა.
            </p>
            <button onClick={showChampion} disabled={busy}
                    className="western-pill w-full px-4 py-2.5 text-sm font-bold disabled:opacity-40"
                    style={{ color: '#eeeae1' }}>
              <Trophy size={14} className="inline" /> ჩემპიონის ნახვა
            </button>
          </>
        ) : !preview.champion ? (
          <p className="text-sm font-typewriter" style={muted}>ამ სეზონში ჯერ თამაში არ ყოფილა.</p>
        ) : (
          <>
            <p className="text-lg font-western mb-2" style={{ color: '#d5b982' }}>
              <Trophy size={16} className="inline" /> {preview.champion}
            </p>
            <ol className="text-xs font-typewriter mb-4" style={muted}>
              {preview.table.slice(0, 5).map((r) => <li key={r.name}>{r.name} — {r.wins}</li>)}
            </ol>
            <p className="text-xs font-typewriter mb-2" style={muted}>ახალი სეზონი:</p>
            <SeasonForm submitLabel="დასრულება და ახლის დაწყება" busy={busy} onSubmit={end} />
          </>
        )}
      </div>

      <div className="western-panel p-4">
        <PanelTitle>წინა სეზონები</PanelTitle>
        {rows === null ? (
          <p className="text-sm font-typewriter" style={muted}>იტვირთება…</p>
        ) : past.length === 0 ? (
          <p className="text-sm font-typewriter" style={muted}>ჯერ არცერთი.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {past.map((s) => (
              <li key={s.id} className="text-sm font-typewriter" style={{ color: '#eeeae1' }}>
                <b>{s.name || 'უსახელო'}</b> · {s.champion_name || '—'}
                <span className="text-xs" style={muted}> ({day(s.started_at)} – {day(s.ended_at)})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
