import type { ReactNode } from "react";
import type { CaptionFont } from "../../lib/types";

export const FONT_OPTIONS: { value: CaptionFont; label: string }[] = [
  { value: "bebas", label: "Bebas" },
  { value: "tiktok", label: "TikTok Sans" },
  { value: "inter", label: "Inter" },
];

export function Section({
  title,
  children,
  aside,
  wide,
  className,
}: {
  title: string;
  children?: ReactNode;
  aside?: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <section className={`insp-sec${wide ? " wide" : ""}${className ? ` ${className}` : ""}`}>
      <div className="insp-sec-head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="insp-row">
      <span>{label}</span>
      <div className="insp-ctl">{children}</div>
    </div>
  );
}

export function StackField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="insp-field">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function fmtSignedPct(v: number): string {
  const pct = Math.round(v * 100);
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}
