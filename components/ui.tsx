/* eslint-disable @next/next/no-img-element */
/**
 * Shared design-system pieces. Use these instead of one-off markup so every
 * screen shares the same loading, progress, status and empty-state language.
 * (ToastProvider lives in Toaster.tsx, ConfirmDialog in Dialog.tsx, Tooltip is
 * the `data-tip` attribute styled in globals.css.)
 */
import type { ReactNode } from "react";
import { IconAlert, IconCheck } from "./Icons";

/** CapMitra icon + animated waveform + status text. Never shows fake progress. */
export function BrandedLoader({ label, overlay = false, progress }: { label: string; overlay?: boolean; progress?: number }) {
  return (
    <div className={`branded-loader ${overlay ? "overlay" : ""}`} role="status" aria-live="polite">
      <img src="/brand/icon-96.png" width={56} height={56} alt="" />
      <span className="wave-loader" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 5) * 0.11}s` }} />)}
      </span>
      <p>{label}</p>
      {progress !== undefined ? <ProgressIndicator value={progress} /> : null}
    </div>
  );
}

/** Real progress bar (0..1). Omit `value` for an indeterminate bar. */
export function ProgressIndicator({ value, label, detail }: { value?: number; label?: string; detail?: string }) {
  const pct = value === undefined ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={`progress ${pct === undefined ? "indeterminate" : ""}`}>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label ?? "Progress"}>
        <div className="progress-fill" style={{ width: `${pct ?? 0}%` }} />
      </div>
      {label || detail || pct !== undefined ? (
        <div className="progress-meta">
          <span>{label}</span>
          <span>{detail ?? (pct !== undefined ? `${pct}%` : "")}</span>
        </div>
      ) : null}
    </div>
  );
}

export type StatusKind = "idle" | "busy" | "success" | "warning" | "error";

export function StatusBadge({ kind, children }: { kind: StatusKind; children: ReactNode }) {
  if (kind === "idle") return null;
  return (
    <span className={`status-badge ${kind}`} role="status" aria-live="polite">
      {kind === "busy" ? <span className="dot" /> : kind === "success" ? <IconCheck size={13} /> : <IconAlert size={13} />}
      <span className="lbl">{children}</span>
    </span>
  );
}

/** Branded empty state with an illustration and one next action. */
export function EmptyState({ art = "video", title, children, action, big = false }: { art?: "video" | "projects" | "done"; title: string; children?: ReactNode; action?: ReactNode; big?: boolean }) {
  return (
    <div className={`empty ${big ? "big" : ""}`}>
      <BrandArt kind={art} />
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

/** Lightweight SVG illustrations in the CapMitra style: ink outlines, lime accents, theme-aware fills. */
export function BrandArt({ kind, size = 150 }: { kind: "video" | "projects" | "done"; size?: number }) {
  const ink = "var(--text)";
  return (
    <svg viewBox="0 0 160 110" width={size} height={(size * 110) / 160} aria-hidden="true">
      {kind === "projects" ? (
        <rect x="34" y="10" width="96" height="62" rx="12" fill="var(--panel-2)" stroke={ink} strokeWidth="3" />
      ) : null}
      {/* hard offset shadow + card */}
      <rect x={kind === "projects" ? 28 : 22} y={kind === "projects" ? 24 : 18} width={kind === "projects" ? 104 : 112} height={kind === "projects" ? 70 : 76} rx="14" fill={ink} />
      <rect x={kind === "projects" ? 24 : 18} y={kind === "projects" ? 20 : 14} width={kind === "projects" ? 104 : 112} height={kind === "projects" ? 70 : 76} rx="14" fill="var(--panel)" stroke={ink} strokeWidth="3" />
      {kind === "done" ? (
        <>
          <circle cx="74" cy="48" r="20" fill="#D6FF36" stroke="#080808" strokeWidth="3" />
          <path d="M64 48l7 7 13-14" fill="none" stroke="#080808" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="74" cy="46" r="18" fill="#D6FF36" stroke="#080808" strokeWidth="3" />
          <path d="M69 37v18l14-9z" fill="#080808" />
        </>
      )}
      {Array.from({ length: 9 }, (_, i) => {
        const h = 6 + ((i * 7) % 5) * 3;
        return <rect key={i} x={36 + i * 9} y={78 - h / 2} width="4" height={h} rx="2" fill={ink} opacity=".75" />;
      })}
      {/* caption bubble */}
      <rect x="104" y="6" width="50" height="28" rx="10" fill="#D6FF36" stroke="#080808" strokeWidth="2.5" />
      <path d="M114 33l-3 9 10-9z" fill="#D6FF36" stroke="#080808" strokeWidth="2.5" strokeLinejoin="round" />
      <rect x="113" y="14" width="32" height="4" rx="2" fill="#080808" />
      <rect x="113" y="22" width="22" height="4" rx="2" fill="#080808" />
    </svg>
  );
}
