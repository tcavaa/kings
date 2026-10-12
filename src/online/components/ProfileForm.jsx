import { AvatarPhoto } from "./AvatarImg";
import { useEffect, useRef, useState } from "react";
import { Upload, Trash2, ArrowRight, Pencil, Check } from "lucide-react-online";
import {
  saveProfile,
  fileToDataURL,
  deleteProfile,
  setActiveProfileId,
} from "../lib/profiles";

const PIN_DIGITS = 4;

/**
 * Inline form for creating or editing a profile (username + avatar + PIN).
 * `editing` is the profile object (or null to create new). Calls onDone(profile|null).
 *
 * PIN behaviour
 *   - On *create*, the PIN is required (4 digits).
 *   - On *edit*, leaving the PIN field empty leaves the existing PIN
 *     untouched. Typing a new 4-digit PIN replaces it. There is no UI for
 *     "remove PIN" — easier mental model for casual users.
 */
export default function ProfileForm({ editing, onDone, onCancel }) {
  const [name, setName] = useState(editing?.name || "");
  const [avatar, setAvatar] = useState(editing?.avatar || null);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    fileRef.current?.closest("dialog")?.scrollTo(0, 0);
  }, []);

  const isNewProfile = !editing;
  const hadPin = !!editing?.has_pin;

  const onPickPin = (e) => {
    const cleaned = (e.target.value || "")
      .replace(/\D/g, "")
      .slice(0, PIN_DIGITS);
    setPin(cleaned);
    if (pinErr) setPinErr("");
  };

  const onPick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const dataURL = await fileToDataURL(f, 256);
      setAvatar(dataURL);
    } catch {
      setError("ფოტო ვერ ჩაიტვირთა. სცადე სხვა ფაილი.");
    }
  };

  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;

    // PIN validation. New profiles must set one; edits may keep the existing
    // one by leaving the field blank, but if they type *anything* it has to
    // be 4 digits.
    if (isNewProfile && pin.length !== PIN_DIGITS) {
      setPinErr(
        "დააყენე 4-ციფრიანი კოდი, რომ მხოლოდ შენ შეძლო ამ პროფილით შესვლა.",
      );
      return;
    }
    if (!isNewProfile && pin.length > 0 && pin.length !== PIN_DIGITS) {
      setPinErr("PIN-კოდი ზუსტად 4 ციფრი უნდა იყოს.");
      return;
    }

    setError("");
    setBusy(true);
    try {
      const saved = await saveProfile({
        id: editing?.id,
        name,
        avatar,
        // Send PIN only when the user actually typed one; otherwise keep
        // the existing hash on the server.
        ...(pin.length === PIN_DIGITS ? { pin } : {}),
      });
      setActiveProfileId(saved.id);
      onDone?.(saved);
    } catch (err) {
      setError(`პროფილის შენახვა ვერ მოხერხდა: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!editing?.id || busy) return;
    setError("");
    setBusy(true);
    try {
      await deleteProfile(editing.id);
      onDone?.(null);
    } catch (err) {
      setError(`პროფილის წაშლა ვერ მოხერხდა: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="k-profile-form">
      <div className="k-profile-photo">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="პროფილის ფოტოს ატვირთვა"
        >
          <AvatarPhoto avatar={avatar} />
          <span>
            <Upload size={16} />
          </span>
        </button>
        <div>
          <span className="k-eyebrow">YOUR PLAYER ID</span>
          <h3>{name || "შენი ახალი დასაწყისი"}</h3>
          <button
            type="button"
            className="k-link"
            onClick={() => fileRef.current?.click()}
          >
            შეცვალე ფოტო <ArrowRight size={14} />
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onPick}
      />
      <label className="k-form-field">
        <span>
          <small>01</small> შენი სახელი
        </span>
        <input
          required
          maxLength={20}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="როგორ მოგმართოთ?"
          autoComplete="nickname"
        />
      </label>
      <label className="k-form-field">
        <span>
          <small>02</small> შენი PIN-კოდი
        </span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={PIN_DIGITS}
          value={pin}
          onChange={onPickPin}
          placeholder="••••"
          aria-describedby="pin-help"
          required={isNewProfile}
        />
        <small id="pin-help">
          {!isNewProfile && hadPin
            ? "დატოვე ცარიელი, თუ კოდის შეცვლა არ გსურს."
            : "4 ციფრი. შენი პროფილის გასახსნელად ახალ მოწყობილობაზე."}
        </small>
      </label>
      {(pinErr || error) && (
        <p className="k-form-error" role="alert">
          {pinErr || error}
        </p>
      )}
      <button
        className="k-button"
        type="submit"
        disabled={busy || !name.trim()}
      >
        {busy
          ? "ინახება…"
          : editing
            ? "ცვლილებების შენახვა"
            : "შევიდეთ თამაშში"}
        <ArrowRight size={18} />
      </button>
      <div className="k-form-bottom">
        {onCancel && (
          <button type="button" className="k-link" onClick={onCancel}>
            უკან დაბრუნება
          </button>
        )}
        {editing && (
          <button
            type="button"
            disabled={busy}
            className="k-delete"
            onClick={onDelete}
          >
            <Trash2 size={13} />
            პროფილის წაშლა
          </button>
        )}
      </div>
    </form>
  );
}

export function ProfilePicker({ profiles = [], value, onChange, onEdit }) {
  if (!profiles.length) return null;
  return (
    <div className="k-profile-picker">
      <span className="k-eyebrow">CHOOSE YOUR IDENTITY</span>
      {profiles.map((p) => (
        <div key={p.id} className={p.id === value ? "active" : ""}>
          <button
            type="button"
            aria-pressed={p.id === value}
            onClick={() => onChange(p)}
          >
            <AvatarPhoto avatar={p.avatar} />
            <span>
              {p.name}
              <small>
                {p.id === value ? "აქტიური პროფილი" : "აირჩიე პროფილი"}
              </small>
            </span>
            {p.id === value ? <Check size={16} /> : <ArrowRight size={16} />}
          </button>
          {onEdit && (
            <button
              type="button"
              className="k-edit-profile"
              onClick={() => onEdit(p)}
              aria-label={`${p.name} — პროფილის შეცვლა`}
            >
              <Pencil size={15} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
