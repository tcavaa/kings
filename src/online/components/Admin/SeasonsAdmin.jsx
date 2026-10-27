import { useCallback, useEffect, useRef, useState } from 'react'
import { Trophy, Check } from 'lucide-react'
import Sheet from '../ui/Sheet'
import { adminApi } from '../../lib/api'
import { adminCall, ErrorNote, PanelTitle, inputStyle, muted } from './adminUi'

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('ka-GE') : '—')

function SeasonForm({ initial, submitLabel, busy, onSubmit }) {
  const [name, setName] = useState(initial?.name || '')
  useEffect(() => { setName(initial?.name || '') }, [initial])
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit({ name: name.trim() }) }}>
      <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)}
             placeholder="სეზონის სახელი" aria-label="სეზონის სახელი" required
             className="w-full px-3 py-2 text-sm mb-3" style={inputStyle} />
      <button type="submit" disabled={busy || !name.trim()}
              className="k-button w-full px-4 py-2.5 text-sm font-bold disabled:opacity-40">
        {busy ? '…' : submitLabel}
      </button>
    </form>
  )
}

/** /admin → seasons: rename the current season, end it, see past ones. */
export default function SeasonsAdmin({ passcode, onLocked }) {
  const [rows, setRows] = useState(null)
  const [preview, setPreview] = useState(null)
  const [pendingSeason, setPendingSeason] = useState(null)
  const ending = useRef(false)
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

  const end = async () => {
    if (!pendingSeason || !preview?.champion || ending.current) return
    const next = pendingSeason
    ending.current = true
    setBusy(true); setError(''); setNote('')
    const out = await call(() => adminApi.endSeason(passcode, next))
    if (out) {
      setNote(`სეზონი დასრულდა — ჩემპიონი: ${out.champion}. დაიწყო „${next.name}“.`)
      setPreview(null)
      setPendingSeason(null)
      await reload()
    }
    setBusy(false)
    ending.current = false
  }

  return (
    <>
      {!pendingSeason && <ErrorNote text={error} />}
      {pendingSeason && (
        <Sheet title="დავასრულოთ სეზონი?" eyebrow="THE CLUB / SEASON FINALE"
               className="k-admin-confirm" onClose={() => { if (!ending.current) setPendingSeason(null) }}>
          <p className="k-admin-confirm-copy">მიმდინარე სეზონი დასრულდება, შედეგები არქივში შეინახება და ახალი სეზონი დაიწყება.</p>
          <dl className="k-admin-season-summary">
            <div><dt>მიმდინარე სეზონი</dt><dd>{current?.name || 'უსახელო'}</dd></div>
            <div><dt>ჩემპიონი</dt><dd><Trophy size={18} /> {preview?.champion}</dd></div>
            <div><dt>ახალი სეზონი</dt><dd>{pendingSeason.name}</dd></div>
          </dl>
          <ErrorNote text={error} />
          <div className="k-admin-confirm-actions">
            <button autoFocus className="k-button k-button-outline" disabled={busy} onClick={() => setPendingSeason(null)}>გაუქმება</button>
            <button className="k-button" disabled={busy} onClick={end}>{busy ? 'სრულდება…' : 'სეზონის დასრულება'}</button>
          </div>
        </Sheet>
      )}
      {note && <p role="status" className="k-admin-success mb-4 text-sm" style={{ color: '#9fd3a8' }}>{note}</p>}

      <div className="k-admin-panel p-4 mb-5">
        <PanelTitle>მიმდინარე სეზონი</PanelTitle>
        <p className="text-xs mb-3" style={muted}>
          {current ? `დაიწყო ${day(current.started_at)}` : 'სახელი ჯერ არ აქვს.'}
        </p>
        <SeasonForm initial={current} submitLabel={<><Check size={14} className="inline" /> შენახვა</>}
                    busy={busy} onSubmit={save} />
      </div>

      <div className="k-admin-panel p-4 mb-5">
        <PanelTitle>სეზონის დასრულება</PanelTitle>
        {!preview ? (
          <>
            <p className="text-xs mb-3" style={muted}>
              ჩემპიონი = ყველაზე მეტი მოგება ამ სეზონში (ჩაწერის თამაშები + ლიგის თამაშები). ფრეზე — ყველა.
            </p>
            <button onClick={showChampion} disabled={busy}
                    className="k-button w-full px-4 py-2.5 text-sm font-bold disabled:opacity-40">
              <Trophy size={14} className="inline" /> ჩემპიონის ნახვა
            </button>
          </>
        ) : !preview.champion ? (
          <p className="text-sm" style={muted}>ამ სეზონში ჯერ თამაში არ ყოფილა.</p>
        ) : (
          <>
            <p className="text-lg mb-2" style={{ color: '#d7fa52' }}>
              <Trophy size={16} className="inline" /> {preview.champion}
            </p>
            <ol className="text-xs mb-4" style={muted}>
              {preview.table.slice(0, 5).map((r) => <li key={r.name}>{r.name} — {r.wins}</li>)}
            </ol>
            <p className="text-xs mb-2" style={muted}>ახალი სეზონი:</p>
            <SeasonForm submitLabel="დასრულება და ახლის დაწყება" busy={busy} onSubmit={(next) => { setError(''); setPendingSeason(next) }} />
          </>
        )}
      </div>

      <div className="k-admin-panel p-4">
        <PanelTitle>წინა სეზონები</PanelTitle>
        {rows === null ? (
          <p className="text-sm" style={muted}>იტვირთება…</p>
        ) : past.length === 0 ? (
          <p className="text-sm" style={muted}>ჯერ არცერთი.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {past.map((s) => (
              <li key={s.id} className="text-sm" >
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
