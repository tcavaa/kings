import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Focus-contained dialog; native dialog supplies inert background and Escape. */
export default function Sheet({
  title,
  onClose,
  children,
  drawer = false,
  className = "",
  eyebrow = "YOUR CLUB / YOUR CHOICE",
}) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = oldOverflow;
      previous?.focus?.();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={`k-sheet ${drawer ? "k-drawer" : ""} ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        <span className="k-eyebrow">{eyebrow}</span>
        <button
          className="k-icon-button"
          onClick={onClose}
          aria-label="დახურვა"
        >
          <X size={20} />
        </button>
      </header>
      <h2>{title}</h2>
      <div className="k-sheet-body">{children}</div>
    </dialog>,
    document.body,
  );
}
