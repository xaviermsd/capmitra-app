"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface Ask {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Show a text field; the promise resolves to its value. */
  input?: { value: string; placeholder?: string };
}

type Resolver = (v: string | boolean | null) => void;

const Ctx = createContext<{ ask: (a: Ask) => Promise<string | boolean | null> } | null>(null);

/** confirm(): true/false. prompt(): string or null. */
export function useDialog() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDialog outside DialogProvider");
  return {
    confirm: async (a: Omit<Ask, "input">) => (await c.ask(a)) === true,
    prompt: async (a: Ask & { input: NonNullable<Ask["input"]> }) => {
      const v = await c.ask(a);
      return typeof v === "string" ? v : null;
    },
  };
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [cur, setCur] = useState<(Ask & { resolve: Resolver }) | null>(null);
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  const ask = useCallback(
    (a: Ask) =>
      new Promise<string | boolean | null>((resolve) => {
        setVal(a.input?.value ?? "");
        setCur({ ...a, resolve });
      }),
    [],
  );

  useEffect(() => {
    if (!cur) return;
    const t = setTimeout(() => (cur.input ? inputRef.current?.select() : okRef.current?.focus()), 30);
    return () => clearTimeout(t);
  }, [cur]);

  const close = (v: string | boolean | null) => {
    cur?.resolve(v);
    setCur(null);
  };

  return (
    <Ctx.Provider value={{ ask }}>
      {children}
      {cur ? (
        <div className="modal-veil" onMouseDown={(e) => e.target === e.currentTarget && close(cur.input ? null : false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onKeyDown={(e) => e.key === "Escape" && close(cur.input ? null : false)}>
            <h2 id="dlg-title">{cur.title}</h2>
            {cur.message ? <p>{cur.message}</p> : null}
            {cur.input ? (
              <input
                ref={inputRef}
                className="dialog-input"
                value={val}
                placeholder={cur.input.placeholder}
                onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && val.trim() && close(val.trim())}
              />
            ) : null}
            <div className="dialog-actions">
              <button className="btn ghost" onClick={() => close(cur.input ? null : false)}>
                {cur.cancelLabel ?? "Cancel"}
              </button>
              <button
                ref={okRef}
                className={`btn ${cur.danger ? "danger-solid" : "primary"}`}
                disabled={!!cur.input && !val.trim()}
                onClick={() => close(cur.input ? val.trim() : true)}
              >
                {cur.confirmLabel ?? "OK"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Ctx.Provider>
  );
}
