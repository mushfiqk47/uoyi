import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  width = 460,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    // Remember the opener so closing returns focus to it instead of dropping the user at <body>.
    const prev = document.activeElement as HTMLElement | null;
    const el = dialogRef.current;
    const focusable = () => Array.from(el?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []);
    // Land on the first field or the primary action, not the close X in the header.
    const preferred =
      el?.querySelector<HTMLElement>(".modal-body input:not([disabled]), .modal-body textarea:not([disabled]), .modal-body select:not([disabled])") ??
      el?.querySelector<HTMLElement>(".modal-foot .btn.accent:not([disabled])");
    (preferred ?? focusable()[0])?.focus();
    // The page behind the dialog must not scroll while it is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prev?.focus();
    };
  }, []);
  // Portal to <body> so the backdrop escapes the page's scroll container and stacking
  // context — otherwise a tall video preview can put the header behind the top bar.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        style={{ width: `min(100%, ${width}px)` }}
      >
        <div className="modal-head">
          <div>
            <h2 id={id}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="btn plain icon sm x" onClick={onClose} aria-label="Close">
            <X className="ic" />
          </button>
        </div>
        {children && <div className="modal-body">{children}</div>}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  full,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  full?: boolean;
  label?: string;
}) {
  return (
    <div className={`seg${full ? " full" : ""}`} role="group" aria-label={label}>
      {options.map((o) => (
        <span key={String(o.value)} className="seg-item">
          <button type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        </span>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function Range({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <input
      className="range"
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ["--p" as string]: `${p}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="color">
      <i style={{ background: value }} />
      {value.toUpperCase()}
      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Textarea that grows/shrinks to fit its content, up to `maxHeight`. */
export function AutoTextarea({
  value,
  onChange,
  label,
  rows = 2,
  maxHeight = 520,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  rows?: number;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, maxHeight]);
  return (
    <textarea
      ref={ref}
      className="textarea"
      rows={rows}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted" style={{ fontSize: 11.5, lineHeight: 1.45 }}>{hint}</small>}
    </label>
  );
}

export function NumberInput({
  value,
  onChange,
  step = 0.1,
  min,
  max,
  label,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  label: string;
  suffix?: string;
}) {
  // Keep the typed text while focused; rounding every keystroke snapped "0.005" to "0.01"
  // and moved the caret.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="numfield">
      <input
        className="input num"
        type="number"
        aria-label={label}
        value={draft ?? Number(value.toFixed(2))}
        step={step}
        min={min}
        max={max}
        onFocus={() => setDraft(String(Number(value.toFixed(2))))}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() && Number.isFinite(v)) onChange(v);
        }}
        onBlur={() => setDraft(null)}
      />
      {suffix && <em>{suffix}</em>}
    </div>
  );
}
