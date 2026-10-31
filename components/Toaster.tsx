"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconInfo, IconX } from "./Icons";

export type ToastKind = "success" | "error" | "warning" | "info" | "busy";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  /** Reuse an id to update a toast in place (e.g. progress). */
  id?: string;
  kind: ToastKind;
  title: string;
  message?: string;
  /** 0..1 for a progress bar. */
  progress?: number;
  action?: ToastAction;
  /** ms; default 3.5s (success/info), 8s (error), never for busy. */
  duration?: number;
}

interface Toast extends ToastInput {
  id: string;
  leaving?: boolean;
}

interface Api {
  toast: (t: ToastInput) => string;
  dismiss: (id: string) => void;
}

const Ctx = createContext<Api | null>(null);

export function useToast(): Api {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
}

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 220);
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (t: ToastInput) => {
      const id = t.id ?? `t${++seq}`;
      setToasts((ts) => {
        const exists = ts.some((x) => x.id === id);
        const next = { ...t, id, leaving: false };
        return exists ? ts.map((x) => (x.id === id ? next : x)) : [...ts.slice(-4), next];
      });
      const old = timers.current.get(id);
      if (old) clearTimeout(old);
      const ms = t.duration ?? (t.kind === "busy" ? 0 : t.kind === "error" ? 8000 : t.kind === "warning" ? 6000 : 3500);
      if (ms > 0) timers.current.set(id, setTimeout(() => dismiss(id), ms));
      return id;
    },
    [dismiss],
  );

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind} ${t.leaving ? "leaving" : ""}`} role={t.kind === "error" ? "alert" : "status"}>
            <span className="toast-icon">
              {t.kind === "success" ? <IconCheck /> : t.kind === "error" || t.kind === "warning" ? <IconAlert /> : t.kind === "busy" ? <span className="spinner" /> : <IconInfo />}
            </span>
            <div className="toast-body">
              <strong>{t.title}</strong>
              {t.message ? <p>{t.message}</p> : null}
              {t.progress !== undefined ? (
                <div className="toast-progress">
                  <span style={{ width: `${Math.round(Math.min(1, Math.max(0, t.progress)) * 100)}%` }} />
                </div>
              ) : null}
              {t.action ? (
                <button className="toast-action" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>
                  {t.action.label}
                </button>
              ) : null}
            </div>
            {t.kind !== "busy" ? (
              <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <IconX size={14} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
