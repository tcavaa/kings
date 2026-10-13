import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react'
import { Volume2, Trash2, Upload, Play, Square, Pencil, Check, X, LogOut, GripVertical, Trophy, Users } from 'lucide-react-online'
import { adminApi, API_BASE } from '../../lib/api'
import { voicePlayer } from '../../lib/voicePlayer'
import SeasonsAdmin from './SeasonsAdmin'
import PlayersAdmin from './PlayersAdmin'

// Where the passcode lives between renders. sessionStorage, not local: the
// latch should lift when the tab closes.
const PASS_KEY = 'king.admin.pass'

const readPass = () => {
  try { return sessionStorage.getItem(PASS_KEY) || '' } catch { return '' }
}
const writePass = (v) => {
  try {
    if (v) sessionStorage.setItem(PASS_KEY, v)
    else sessionStorage.removeItem(PASS_KEY)
  } catch { /* private mode — the code just won't survive a refresh */ }
}

// Same ceiling the server enforces, checked here so a too-big file fails
// instantly instead of after a multi-megabyte upload.
const MAX_BYTES = 2 * 1024 * 1024

/** File → `data:audio/...;base64,...`, the shape the API expects. */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('ფაილის წაკითხვა ვერ მოხერხდა'))
    reader.readAsDataURL(file)
  })
}

/* ─── passcode gate ───────────────────────────────────────────────────── */

function PasscodeGate({ onUnlock }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const ok = await adminApi.login(code)
      if (!ok) { setError('არასწორი კოდი'); setCode(''); return }
      writePass(code)
      onUnlock(code)
    } catch (err) {
      setError(err.message || 'შეცდომა')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="saloon-bg flex flex-col items-center justify-center px-4 py-8 min-h-screen">
      <form onSubmit={submit} className="western-panel p-6 w-full max-w-xs text-center">
        <h1 className="text-2xl font-western mb-1" style={{ color: '#d5b982' }}>ადმინი</h1>
        <p className="text-xs font-typewriter mb-4" style={{ color: 'rgba(225,233,225,0.6)' }}>
          შეიყვანე კოდი
        </p>
        <input
          type="password"
          autoFocus
          value={code}
          onChange={(e) => { setCode(e.target.value); setError('') }}
          className="w-full text-center text-2xl tracking-[0.5em] font-mono px-3 py-3 rounded-lg mb-3"
          style={{
            background: 'rgba(35,57,45,0.95)',
            border: '1px solid rgba(151,176,162,0.45)',
            color: '#eeeae1',
          }}
        />
        {error && (
          <div className="text-xs font-typewriter mb-3" style={{ color: '#ef918b' }}>{error}</div>
        )}
        <button type="submit" disabled={busy || !code}
                className="western-pill w-full px-4 py-2.5 text-sm font-bold disabled:opacity-40"
                style={{ color: '#eeeae1' }}>
          {busy ? 'მოწმდება…' : 'შესვლა'}
        </button>
      </form>
    </div>
  )
}

/* ─── one row in the catalogue ────────────────────────────────────────── */

function SoundRow({ sound, passcode, onChanged, onError, onGrab, dragging, innerRef }) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(sound.label)
  const [glyph, setGlyph] = useState(sound.glyph)
  const [color, setColor] = useState(sound.color)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)

  // The admin API returns raw catalogue urls (the registry's resolveUrl only
  // runs on the player-facing copy), so apply the same page-origin-vs-API
  // fix-up here: in dev the page is on :5173 while uploaded clips are served
  // from :3001. No-op in production, where API_BASE is ''.
  const url = sound.url.startsWith('/api/') ? `${API_BASE}${sound.url}` : sound.url

  useEffect(() => voicePlayer.subscribe((u) => setPlaying(u === url)), [url])

  const save = async () => {
    setBusy(true)
    try {
      await adminApi.updateSound(passcode, sound.id, { label, glyph, color })
      setEditing(false)
      onChanged()
    } catch (err) { onError(err.message) } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!window.confirm(`წავშალოთ „${sound.label}"?`)) return
    setBusy(true)
    try {
      if (playing) voicePlayer.stop()
      await adminApi.deleteSound(passcode, sound.id)
      onChanged()
    } catch (err) { onError(err.message) } finally { setBusy(false) }
  }

  return (
    <div ref={innerRef}
         className="flex items-center gap-2 py-2.5 px-3 rounded-xl"
         style={{
           background: dragging ? 'rgba(23,39,35,0.98)' : 'rgba(35,57,45,0.95)',
           border: `1px solid ${dragging ? 'rgba(213,185,130,0.55)' : 'rgba(151,176,162,0.25)'}`,
           boxShadow: dragging
             ? '0 10px 24px rgba(0,0,0,0.26)'
             : '0 0 0 rgba(0,0,0,0)',
           // Lift the row being dragged above its neighbours so its shadow
           // isn't clipped by the next card, and so it slides over them.
           position: 'relative',
           zIndex: dragging ? 5 : 'auto',
           // Only the pick-up styling is transitioned here. Movement is
           // animated separately (FLIP, in the parent) — a transition on
           // `transform` would fight that.
           transition: 'background 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
           willChange: dragging ? 'transform' : 'auto',
         }}>
      {/* Drag handle. `touch-action: none` is what stops a touch-drag from
          scrolling the page instead of moving the row. */}
      <button
        onPointerDown={(e) => onGrab(e, sound.id)}
        title="გადაათრიე რიგის შესაცვლელად"
        aria-label="რიგის შეცვლა"
        className="shrink-0 p-1 -ml-1 cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none', color: 'rgba(225,233,225,0.35)' }}
      >
        <GripVertical size={16} />
      </button>

      <span className="flex items-center justify-center rounded-full font-bold shrink-0"
            style={{
              width: 38, height: 38, background: '#172725',
              border: `2px solid ${sound.color}`, color: '#eeeae1', fontSize: 16,
            }}>
        {sound.glyph}
      </span>

      {editing ? (
        <div className="flex-1 flex flex-wrap items-center gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)}
                 className="flex-1 min-w-[8rem] px-2 py-1.5 rounded text-sm"
                 style={{ background: '#fff', border: '1px solid rgba(151,176,162,0.4)', color: '#eeeae1' }} />
          <input value={glyph} onChange={(e) => setGlyph(e.target.value)} maxLength={2}
                 title="ნიშანი"
                 className="w-12 px-2 py-1.5 rounded text-sm text-center"
                 style={{ background: '#fff', border: '1px solid rgba(151,176,162,0.4)', color: '#eeeae1' }} />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                 title="ფერი"
                 className="w-10 h-8 rounded cursor-pointer"
                 style={{ border: '1px solid rgba(151,176,162,0.4)', background: 'transparent' }} />
        </div>
      ) : (
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate" style={{ color: '#eeeae1' }}>{sound.label}</div>
          <div className="text-[10px] font-mono truncate" style={{ color: 'rgba(225,233,225,0.45)' }}>
            {sound.id}{sound.source === 'builtin' ? ' · ჩაშენებული' : ''}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => voicePlayer.toggle(url)} title="მოსმენა"
                className="p-2 rounded-lg transition-opacity hover:opacity-70"
                style={{ color: '#7ac7a5' }}>
          {playing ? <Square size={16} /> : <Play size={16} />}
        </button>
        {editing ? (
          <>
            <button onClick={save} disabled={busy || !label.trim()} title="შენახვა"
                    className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-30"
                    style={{ color: '#7ac7a5' }}>
              <Check size={16} />
            </button>
            <button onClick={() => {
                      setEditing(false)
                      setLabel(sound.label); setGlyph(sound.glyph); setColor(sound.color)
                    }} title="გაუქმება"
                    className="p-2 rounded-lg transition-opacity hover:opacity-70"
                    style={{ color: 'rgba(225,233,225,0.5)' }}>
              <X size={16} />
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} title="რედაქტირება"
                    className="p-2 rounded-lg transition-opacity hover:opacity-70"
                    style={{ color: '#31536b' }}>
              <Pencil size={16} />
            </button>
            <button onClick={remove} disabled={busy} title="წაშლა"
                    className="p-2 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-30"
                    style={{ color: '#ef918b' }}>
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ─── upload form ─────────────────────────────────────────────────────── */

function UploadForm({ passcode, onAdded, onError }) {
  const [name, setName] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const pick = (e) => {
    const f = e.target.files?.[0] || null
    if (f && f.size > MAX_BYTES) {
      onError(`ფაილი ძალიან დიდია (მაქს. ${Math.round(MAX_BYTES / 1024)} KB)`)
      e.target.value = ''
      return
    }
    setFile(f)
    // Empty name → seed it from the filename so the common case is one field.
    if (f && !name.trim()) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy || !file || !name.trim()) return
    setBusy(true)
    try {
      const audio = await fileToDataUrl(file)
      await adminApi.createSound(passcode, { label: name.trim(), audio })
      setName(''); setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      onAdded()
    } catch (err) { onError(err.message) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="western-panel p-4 mb-5">
      <h2 className="text-sm font-western uppercase tracking-wider mb-3" style={{ color: '#eeeae1' }}>
        ახალი ხმა
      </h2>
      <div className="flex flex-col gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="სახელი (მაგ. ბედი)"
          maxLength={64}
          className="px-3 py-2.5 rounded-lg text-sm"
          style={{ background: 'rgba(35,57,45,0.95)', border: '1px solid rgba(151,176,162,0.4)', color: '#eeeae1' }}
        />
        <label className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer"
               style={{ background: 'rgba(35,57,45,0.95)', border: '1px dashed rgba(151,176,162,0.5)' }}>
          <Upload size={18} style={{ color: '#d5b982' }} />
          <span className="text-sm font-typewriter truncate" style={{ color: file ? '#eeeae1' : 'rgba(225,233,225,0.5)' }}>
            {file ? file.name : 'აირჩიე აუდიო ფაილი (mp3, ogg, wav, m4a)'}
          </span>
          <input ref={fileRef} type="file" accept="audio/*" onChange={pick} className="hidden" />
        </label>
        <button type="submit" disabled={busy || !file || !name.trim()}
                className="western-pill px-4 py-2.5 text-sm font-bold disabled:opacity-40"
                style={{ color: '#eeeae1' }}>
          {busy ? 'იტვირთება…' : 'დამატება'}
        </button>
      </div>
      <p className="text-[10px] font-typewriter mt-3" style={{ color: 'rgba(225,233,225,0.45)' }}>
        ნიშანი და ფერი ავტომატურად შეირჩევა — დამატების შემდეგ შეგიძლია შეცვალო.
      </p>
    </form>
  )
}

/* ─── sounds tab ──────────────────────────────────────────────────────── */

function SoundsAdmin({ passcode, onLocked }) {
  const [sounds, setSounds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ── Drag-to-reorder ────────────────────────────────────────────────────
  // Pointer events rather than HTML5 drag-and-drop: the same handlers cover
  // mouse and touch, and pointer capture means the drag survives the cursor
  // leaving the row (which native DnD on touch doesn't do at all).
  //
  // `dragId` is the clip being moved; `hoverIdx` is where it currently sits
  // in the previewed order. The list renders `preview`, so what you see mid-
  // drag is exactly what gets saved on release.
  const [dragId, setDragId] = useState(null)
  const [hoverIdx, setHoverIdx] = useState(null)
  const listRef = useRef(null)

  const preview = useMemo(() => {
    if (dragId === null || hoverIdx === null) return sounds
    const from = sounds.findIndex(s => s.id === dragId)
    if (from === -1) return sounds
    const arr = [...sounds]
    const [moved] = arr.splice(from, 1)
    arr.splice(hoverIdx, 0, moved)
    return arr
  }, [sounds, dragId, hoverIdx])

  const grab = useCallback((e, id) => {
    // Don't let the button take focus or start a text selection.
    e.preventDefault()
    setDragId(id)
    setHoverIdx(sounds.findIndex(s => s.id === id))
  }, [sounds])

  // Which slot is the pointer over? Measured against the rows as currently
  // rendered (i.e. the preview), so the answer stays consistent as the list
  // shuffles underneath the cursor.
  const trackPointer = useCallback((clientY) => {
    const rows = listRef.current ? [...listRef.current.children] : []
    if (!rows.length) return
    let target = rows.length - 1
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect()
      if (clientY < r.top + r.height / 2) { target = i; break }
    }
    setHoverIdx(target)
  }, [])

  const dropRef = useRef(null)
  const trackRef = useRef(null)

  const drop = useCallback(async () => {
    if (dragId === null) return
    const ordered = preview.map(s => s.id)
    const unchanged = sounds.every((s, i) => s.id === ordered[i])
    setDragId(null)
    setHoverIdx(null)
    if (unchanged) return
    // Show the new order immediately; the server call just persists it.
    setSounds(preview)
    try {
      await adminApi.reorderSounds(passcode, ordered)
    } catch (err) {
      setError(err.message)
      // Put the old order back — the save didn't land.
      setSounds(sounds)
    }
  }, [dragId, preview, sounds, passcode])

  // Move/release are tracked on the window, not on the row or the list.
  // Handlers on the container only fire while the pointer is over it, so a
  // release anywhere else — or a pointerup the browser never delivers to the
  // list — would leave the drag running forever with a row stuck to the
  // cursor. Listening globally for the life of the drag means the release is
  // always heard, and the effect cleanup is what guarantees we unsubscribe.
  //
  // The refs keep the listeners stable: `drop` and `trackPointer` change
  // identity whenever the catalogue does, and re-binding mid-drag drops
  // events.
  dropRef.current = drop
  trackRef.current = trackPointer

  // ── Smooth movement (FLIP) ─────────────────────────────────────────────
  // Reordering the array moves real DOM nodes, and moved nodes jump — CSS
  // can't transition a change of document position. FLIP gets the animation
  // back: after every render, compare each row's new top against where it
  // was, instantly offset it back to the old spot with a transform, then let
  // it transition to zero. The row never actually renders in the old place;
  // the browser just animates the correction.
  const rowRefs = useRef({})
  const prevTops = useRef({})
  const flipAnims = useRef({})

  useLayoutEffect(() => {
    const tops = {}
    for (const [id, el] of Object.entries(rowRefs.current)) {
      if (!el) continue
      // offsetTop, NOT getBoundingClientRect().top. The rect is the *visual*
      // box, so it includes any animation currently in flight — measuring
      // that folds the old offset into the new delta and rows drift further
      // with every move. offsetTop is pure layout.
      const top = el.offsetTop
      tops[id] = top
      const was = prevTops.current[id]

      // The row under the cursor is deliberately not animated: it should
      // feel pinned to the pointer, and easing it into each new slot makes
      // it trail behind the hand.
      if (id === dragId) {
        flipAnims.current[id]?.cancel()
        delete flipAnims.current[id]
        continue
      }
      if (was === undefined || was === top) continue

      // Web Animations rather than a transition + rAF dance with inline
      // styles: this runs entirely off the inline style attribute, so a move
      // interrupted mid-flight can't strand a `transform` on the row (which
      // is exactly how an earlier version left rows visibly displaced). A new
      // animation supersedes the one it cancels, so rapid moves just retarget.
      flipAnims.current[id]?.cancel()
      const anim = el.animate(
        [{ transform: `translateY(${was - top}px)` }, { transform: 'translateY(0px)' }],
        { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
      )
      flipAnims.current[id] = anim
      anim.onfinish = () => { if (flipAnims.current[id] === anim) delete flipAnims.current[id] }
    }
    prevTops.current = tops
  })

  // Animations still running when the page navigates away would touch
  // detached nodes.
  useEffect(() => () => {
    Object.values(flipAnims.current).forEach(a => a.cancel())
    flipAnims.current = {}
  }, [])

  useEffect(() => {
    if (dragId === null) return undefined
    // Kill text selection for the duration — dragging across labels
    // otherwise paints half the list blue.
    const prevSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const onMove = (e) => { e.preventDefault(); trackRef.current(e.clientY) }
    const onUp   = () => { dropRef.current() }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    // Last resort. A pointerup isn't actually guaranteed: alt-tabbing away,
    // a context menu, or a mobile browser deciding the gesture is a system
    // swipe all end the drag without one. Without this the row stays glued
    // to the cursor and the page keeps `user-select: none` forever. Settling
    // on the current preview is the right call — it's what the user last
    // saw.
    window.addEventListener('blur', onUp)
    return () => {
      document.body.style.userSelect = prevSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [dragId])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setSounds(await adminApi.listSounds(passcode))
      setError('')
    } catch (err) {
      // A stale sessionStorage code (server passcode changed) lands here —
      // drop it and fall back to the gate rather than showing an empty list.
      if ((err.message || '').includes('HTTP 401')) {
        onLocked()
        return
      }
      setError(err.message)
    } finally { setLoading(false) }
  }, [passcode, onLocked])

  useEffect(() => { reload() }, [reload])

  // Stop any preview when leaving the page — the player lives outside React.
  useEffect(() => () => voicePlayer.stop(), [])

  return (
    <>
        <UploadForm passcode={passcode} onAdded={() => reload()} onError={setError} />

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm font-typewriter"
               style={{ background: 'rgba(239,145,139,0.12)', border: '1px solid rgba(239,145,139,0.4)', color: '#ef918b' }}>
            {error}
          </div>
        )}

        <div className="western-panel p-4">
          <h2 className="text-sm font-western uppercase tracking-wider mb-3" style={{ color: '#eeeae1' }}>
            კატალოგი {sounds.length > 0 && `(${sounds.length})`}
          </h2>
          {sounds.length > 1 && (
            <p className="text-[10px] font-typewriter mb-2" style={{ color: 'rgba(225,233,225,0.45)' }}>
              რიგის შესაცვლელად გადაათრიე ⠿ სახელური — ეს რიგი ჩანს თამაშშიც.
            </p>
          )}
          {loading ? (
            <div className="text-sm font-typewriter py-3 text-center" style={{ color: 'rgba(225,233,225,0.55)' }}>
              იტვირთება…
            </div>
          ) : sounds.length === 0 ? (
            <div className="text-sm font-typewriter py-3 text-center" style={{ color: 'rgba(225,233,225,0.55)' }}>
              ჯერ არცერთი ხმა არ არის.
            </div>
          ) : (
            <div ref={listRef} className="flex flex-col gap-2">
              {preview.map(s => (
                <SoundRow key={s.id} sound={s} passcode={passcode}
                          onChanged={() => reload()} onError={setError}
                          onGrab={grab} dragging={s.id === dragId}
                          innerRef={(el) => {
                            if (el) rowRefs.current[s.id] = el
                            else delete rowRefs.current[s.id]
                          }} />
              ))}
            </div>
          )}
        </div>

        <p className="text-[10px] font-typewriter mt-4 text-center" style={{ color: 'rgba(225,233,225,0.4)' }}>
          ცვლილებები მოთამაშეებთან შემდეგი გვერდის გახსნისას გამოჩნდება.
        </p>
    </>
  )
}

/* ─── page ────────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'sounds',  label: 'ხმები',       Icon: Volume2 },
  { id: 'seasons', label: 'სეზონები',    Icon: Trophy },
  { id: 'players', label: 'მოთამაშეები', Icon: Users },
]

export default function AdminApp() {
  const [passcode, setPasscode] = useState(readPass)
  const [tab, setTab] = useState('sounds')
  const lock = useCallback(() => { writePass(''); setPasscode('') }, [])

  if (!passcode) {
    return <PasscodeGate onUnlock={(code) => setPasscode(code)} />
  }

  return (
    <div className="saloon-bg min-h-screen px-4 py-8">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-western" style={{ color: '#d5b982' }}>ადმინი</h1>
          <div className="flex items-center gap-2">
            <a href="/" className="text-xs font-typewriter underline" style={{ color: 'rgba(225,233,225,0.6)' }}>
              მთავარი
            </a>
            <button onClick={lock}
                    title="გასვლა"
                    className="p-2 rounded-lg transition-opacity hover:opacity-70"
                    style={{ color: 'rgba(225,233,225,0.6)' }}>
              <LogOut size={16} />
            </button>
          </div>
        </div>

        <div className="flex gap-2 mb-5" role="tablist">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                    className="western-pill px-3 py-2 text-xs font-bold inline-flex items-center gap-1.5"
                    style={{ color: '#eeeae1', opacity: tab === id ? 1 : 0.55 }}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {tab === 'sounds'  && <SoundsAdmin  passcode={passcode} onLocked={lock} />}
        {tab === 'seasons' && <SeasonsAdmin passcode={passcode} onLocked={lock} />}
        {tab === 'players' && <PlayersAdmin passcode={passcode} onLocked={lock} />}
      </div>
    </div>
  )
}
