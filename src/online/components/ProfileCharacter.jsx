import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Upload, Trash2 } from "lucide-react";
import { MAX_HEAD_BYTES, validGLB } from "../game/three/characters";

const CharacterPreview = lazy(() => import("../game/three/CharacterPreview"));

/**
 * The profile's look at the 3D table: male/female body and, optionally, the
 * player's own face as a .glb head model. Controlled: `value` is
 * { gender, head } where head is the stored model's URL, a freshly picked
 * { buffer, url } or null. The form saves it with the profile.
 */
export default function ProfileCharacter({ value, onChange, disabled }) {
  const fileRef = useRef(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const headUrl =
    typeof value.head === "string" ? value.head : value.head?.url || null;

  // Picked files live as blob URLs until saved; free them when replaced.
  const pickedUrl = typeof value.head === "object" ? value.head?.url : null;
  useEffect(
    () => () => {
      if (pickedUrl) URL.revokeObjectURL(pickedUrl);
    },
    [pickedUrl],
  );

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      if (file.size > MAX_HEAD_BYTES)
        throw new Error("ფაილი ძალიან დიდია — მაქსიმუმ 2 MB.");
      const buffer = await file.arrayBuffer();
      if (!validGLB(buffer))
        throw new Error(
          "აირჩიე GLB 2.0 ფაილი ჩაშენებული ტექსტურებით (მაქს. 2 MB).",
        );
      const url = URL.createObjectURL(
        new Blob([buffer], { type: "model/gltf-binary" }),
      );
      onChange({ ...value, head: { buffer, url, name: file.name } });
    } catch (err) {
      setError(err.message || "ფაილი ვერ წავიკითხე.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="k-form-field k-character" disabled={disabled}>
      <legend>
        <small>03</small> 3D პერსონაჟი
      </legend>
      <div className="k-character-body">
        <Suspense fallback={<div className="k-character-preview" />}>
          <CharacterPreview
            gender={value.gender}
            head={headUrl}
            onError={setError}
          />
        </Suspense>
        <div className="k-character-controls">
          <div
            className="k-segmented"
            role="radiogroup"
            aria-label="სქესი 3D მაგიდისთვის"
          >
            {[
              ["male", "კაცი"],
              ["female", "ქალი"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={value.gender === id}
                className={value.gender === id ? "on" : ""}
                onClick={() => onChange({ ...value, gender: id })}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="k-link"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} />
            {busy
              ? "იკითხება…"
              : headUrl
                ? "სახის შეცვლა (.glb)"
                : "შენი სახის ატვირთვა (.glb)"}
          </button>
          {headUrl && (
            <button
              type="button"
              className="k-link"
              onClick={() => onChange({ ...value, head: null })}
            >
              <Trash2 size={13} /> საწყისი სახე
            </button>
          )}
          <small>
            თავის/სახის GLB მოდელი (ტექსტურებით, მაქს. 2 MB) ჩაენაცვლება
            პერსონაჟის თავს. თუ არ ატვირთავ, გამოჩნდება საწყისი სახე.
          </small>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".glb,model/gltf-binary"
        hidden
        onChange={onPick}
      />
      {error && (
        <p className="k-form-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
