import { AvatarPhoto } from "./AvatarImg";
import { useEffect, useRef, useState } from "react";
import { Lock, ShieldCheck, X, Delete } from "lucide-react-online";
import { verifyPin } from "../lib/profiles";

/**
 * Western-themed 4-digit PIN prompt. Used by the Lobby whenever the user
 * picks a profile that has a PIN and this device hasn't yet verified it.
 *
 * Props:
 *   profile  — the profile object being authenticated
 *   onSuccess({ profile, pin }) — called once the server returns ok:true
 *   onCancel()             — user dismissed the modal
 *   check(id, pin)         — the verify call (default: verify and sign in)
 *   hint                   — the line under the name
 */
export default function PinPromptModal({
  profile,
  onSuccess,
  onCancel,
  check = verifyPin,
  hint = "შეიყვანე შენი 4-ციფრიანი კოდი შესასვლელად.",
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  // Autofocus the input as soon as the modal opens — desktop pops the
  // keyboard cursor, mobile pops the numeric keypad.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  // Reset state if a different profile is presented while the modal is open
  // (rare, but happens if the Lobby quickly re-clicks a different player).
  useEffect(() => {
    setPin("");
    setError("");
  }, [profile?.id]);

  const onChange = (e) => {
    const v = (e.target.value || "").replace(/\D/g, "").slice(0, 4);
    setPin(v);
    if (error) setError("");
  };

  // On-screen keypad — phone-style 1-9, 0 in the middle of the bottom row,
  // backspace bottom-right. Tapping a digit appends to the current PIN
  // (capped at 4); the auto-submit useEffect below fires the verify call as
  // soon as the 4th digit lands. Same code path as keyboard input.
  const tapDigit = (d) => {
    if (busy) return;
    setPin((prev) => {
      if (prev.length >= 4) return prev;
      return (prev + String(d)).slice(0, 4);
    });
    if (error) setError("");
  };
  const tapBackspace = () => {
    if (busy) return;
    setPin((prev) => prev.slice(0, -1));
    if (error) setError("");
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!profile?.id || pin.length !== 4 || busy) return;
    setBusy(true);
    try {
      const r = await check(profile.id, pin);
      if (r.ok) {
        onSuccess?.({ profile, pin });
        return;
      }
      setError(r.reason === "locked"
        ? "ძალიან ბევრი მცდელობა. სცადე 15 წუთში."
        : "არასწორი კოდი, სცადე ხელახლა.");
      setPin("");
      // Brief shake animation feedback handled via CSS class (added below).
      const el = inputRef.current;
      if (el) {
        el.classList.remove("pin-shake");
        // eslint-disable-next-line no-unused-expressions
        el.offsetWidth; // reflow so animation can re-trigger
        el.classList.add("pin-shake");
      }
    } catch (err) {
      setError(err.message || "PIN-კოდის შემოწმება ვერ მოხერხდა.");
    } finally {
      setBusy(false);
    }
  };

  // Submit-on-complete: the moment a 4th digit lands, fire the verify call.
  // Avoids requiring an explicit Enter on mobile.
  useEffect(() => {
    if (pin.length === 4 && !busy) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  if (!profile) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 western-backdrop"
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl p-5 western-panel relative"
      >
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="absolute top-3 right-3 hover:opacity-80"
            style={{ color: "rgba(225,233,225,0.7)" }}
          >
            <X size={16} />
          </button>
        )}

        <div className="flex flex-col items-center gap-3 mb-4">
          <div
            className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center"
            style={{
              background: "#000",
              border: "2px solid rgba(213,185,130,0.55)",
              boxShadow: "0 0 16px rgba(213,185,130,0.35)",
            }}
          >
            <AvatarPhoto
              avatar={profile.avatar}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="text-center">
            <div
              className="text-[10px] uppercase tracking-[0.4em] mb-1 font-western inline-flex items-center gap-1"
              style={{ color: "rgba(213,185,130,0.7)" }}
            >
              <Lock size={11} /> საჭიროა PIN-კოდი
            </div>
            <h3 className="text-lg font-western" style={{ color: "#eeeae1" }}>
              გამარჯობა,{" "}
              <span style={{ color: "#d5b982" }}>{profile.name}</span>
            </h3>
            <p
              className="text-xs font-typewriter mt-1"
              style={{ color: "rgba(225,233,225,0.6)" }}
            >
              {hint}
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          value={pin}
          onChange={onChange}
          placeholder="••••"
          aria-label="4-ციფრიანი კოდი"
          className="casino-input font-typewriter text-center text-2xl"
          style={{ letterSpacing: "0.7em", paddingLeft: "0.7em" }}
        />

        {error && (
          <p
            className="text-[11px] text-center font-typewriter mt-2"
            style={{ color: "#ef918b" }}
          >
            {error}
          </p>
        )}

        {/* On-screen keypad — primary input on touch devices. Buttons are
            tagged `type="button"` so tapping them never accidentally
            submits the form (only the 4th-digit auto-submit does). */}
        <div className="grid grid-cols-3 gap-2 mt-4 select-none">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => tapDigit(d)}
              disabled={busy}
              className="pin-key py-3 rounded-xl text-xl font-typewriter font-bold disabled:opacity-40"
            >
              {d}
            </button>
          ))}
          {/* Empty cell to push 0 into the middle and backspace to the right. */}
          <span aria-hidden="true" />
          <button
            type="button"
            onClick={() => tapDigit(0)}
            disabled={busy}
            className="pin-key py-3 rounded-xl text-xl font-typewriter font-bold disabled:opacity-40"
          >
            0
          </button>
          <button
            type="button"
            onClick={tapBackspace}
            disabled={busy || !pin.length}
            aria-label="წაშლა"
            className="pin-key py-3 rounded-xl inline-flex items-center justify-center disabled:opacity-30"
          >
            <Delete size={18} />
          </button>
        </div>

        <div className="flex gap-2 mt-4">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="casino-btn-secondary flex-1 py-2 rounded-xl font-western uppercase text-xs tracking-wider"
            >
              გაუქმება
            </button>
          )}
          <button
            type="submit"
            disabled={pin.length !== 4 || busy}
            className="flex-[2] casino-btn-gold py-2 rounded-xl font-western uppercase text-xs tracking-wider inline-flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <ShieldCheck size={14} />
            {busy ? "მოწმდება…" : "შესვლა"}
          </button>
        </div>
      </form>
    </div>
  );
}
