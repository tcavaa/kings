import { useCallback, useEffect, useState } from 'react'
import {
  listProfiles,
  getActiveProfileId,
  clearActiveProfile,
  onProfileSessionLost,
  verifyPin,
} from '../lib/profiles'

/**
 * The lobby's profile state: the shared profile list, the one this device
 * plays as (`active`), and the profile sheet's form and PIN prompts.
 */
export function useProfiles() {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(false)
  // Shown when someone tries to edit a profile without a PIN: nobody can
  // prove it's theirs, so only the admin can change it (by setting a PIN).
  const [editNotice, setEditNotice] = useState(null)
  // The "locked-in" profile id (signed in on this device, with a session
  // token in localStorage). Never auto-set by the lobby — it only changes
  // when the user picks a profile (and types its PIN, if it has one).
  const [activeId, setActiveId] = useState(() => getActiveProfileId())
  // The game server refused our session (PIN changed, profile removed).
  useEffect(() => onProfileSessionLost(() => setActiveId(null)), [])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  // A PIN-protected profile waiting for its PIN before the edit form opens,
  // and the PIN that opened it (the server needs it to save or delete).
  const [editPending, setEditPending] = useState(null)
  const [editPin, setEditPin] = useState('')
  // The profile the user is trying to lock in to (PIN modal in flight).
  // null means no modal. Once the modal succeeds it becomes `activeId`.
  const [pinPending, setPinPending] = useState(null)

  // Load profiles from the server every time the lobby mounts. We
  // intentionally do NOT auto-pick the first one — on a fresh visit, the
  // user has to actively choose (and unlock) someone.
  const reload = useCallback(async () => {
    setLoading(true)
    setProfileError(false)
    try {
      const list = await listProfiles()
      const arr = Array.isArray(list) ? list : []
      setProfiles(arr)
      // Only keep `activeId` if it still resolves to a real profile. If the
      // saved profile was deleted on another device, drop the lock-in.
      setActiveId((prev) => {
        if (prev && arr.some((p) => p.id === prev)) return prev
        if (prev) clearActiveProfile()
        return null
      })
      // First-time visitors with no saved profiles land straight in the
      // "create profile" form. Otherwise we always start by showing the
      // picker, even if there's a lock-in (the lock-in shows up there as
      // the highlighted entry).
      setShowForm(arr.length === 0)
      return arr
    } catch {
      setProfileError(true)
      setProfiles([])
      setShowForm(true)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const active = activeId ? profiles.find((p) => p.id === activeId) || null : null

  const resetForm = () => {
    setEditNotice(null)
    setEditing(null)
    setEditPin('')
    setEditPending(null)
    setPinPending(null)
  }

  /**
   * Closing the sheet (Escape, X, backdrop) drops any half-done PIN prompt or
   * edit, so they don't pop back up the next time it opens.
   */
  const closeProfileSheet = () => {
    resetForm()
    setShowForm(profiles.length === 0)
  }

  const onProfileSaved = async (saved) => {
    await reload()
    // A new profile signs this device in; editing the active one refreshes
    // its session. Editing anyone else's leaves the active profile as is.
    if (saved?.id) setActiveId(getActiveProfileId())
    setShowForm(false)
    resetForm()
  }

  const editProfile = (profile) => {
    setEditPin('')
    if (profile.has_pin) {
      setEditNotice(null)
      setEditPending(profile)
      return
    }
    setEditNotice(`${profile.name}-ს PIN-კოდი არ აქვს — შესაცვლელად ადმინს სთხოვე PIN-ის დაყენება.`)
  }

  const startNewProfile = () => {
    setEditing(null)
    setShowForm(true)
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditing(null)
    setEditPin('')
  }

  // Picking a *different* profile pops the PIN prompt. Clicking the
  // already-active one is a no-op (no need to re-authenticate). Profiles
  // without a PIN are promoted instantly.
  const pickProfile = async (profile) => {
    if (!profile?.id) return
    if (profile.id === activeId) return
    if (profile.has_pin) {
      setPinPending(profile)
      return
    }
    try {
      const out = await verifyPin(profile.id, '')
      if (out.ok) setActiveId(profile.id)
      else if (out.reason === 'not_found') reload()
    } catch {
      setProfileError(true)
    }
  }

  const switchProfile = () => {
    clearActiveProfile()
    setActiveId(null)
  }

  /** The PIN prompt for picking a profile succeeded. */
  const confirmPin = ({ profile }) => {
    setActiveId(profile.id)
    setPinPending(null)
  }

  /** The PIN prompt before editing succeeded: open the form. */
  const confirmEditPin = ({ profile, pin }) => {
    setEditPin(pin)
    setEditing(profile)
    setShowForm(true)
    setEditPending(null)
  }

  /** The profile behind a PIN prompt was deleted on another device. */
  const profileGone = () => {
    setPinPending(null)
    setEditPending(null)
    reload()
  }

  return {
    profiles, loading, profileError, editNotice, reload,
    activeId, active,
    showForm, editing, editPin, editPending, pinPending,
    closeProfileSheet, onProfileSaved, editProfile, startNewProfile, cancelForm,
    pickProfile, switchProfile,
    confirmPin, cancelPin: () => setPinPending(null),
    confirmEditPin, cancelEditPin: () => setEditPending(null),
    profileGone,
  }
}
