"use client";

import type { ReactNode } from "react";

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`field ${className ?? ""}`}>
      <span className="field-label">
        {label}
        {hint ? <em>{hint}</em> : null}
      </span>
      <span className="field-input">{children}</span>
    </label>
  );
}

export function Slider({
  label, value, min, max, step = 1, onChange, unit = "", hint,
}: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input
        className="num"
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? +value.toFixed(3) : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {unit ? <span className="unit">{unit}</span> : null}
    </Field>
  );
}

/** Colour picker + free text (accepts #hex or rgba()). */
export function Color({ label, value, onChange, allowNone, hint }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; allowNone?: boolean; hint?: string }) {
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
  return (
    <Field label={label} hint={hint} className="field-color">
      {allowNone ? (
        <input type="checkbox" checked={value !== undefined} onChange={(e) => onChange(e.target.checked ? hex : undefined)} title="On / off" />
      ) : null}
      <input type="color" value={hex} disabled={value === undefined} onChange={(e) => onChange(e.target.value)} />
      <input className="txt" value={value ?? ""} placeholder="none" disabled={value === undefined} onChange={(e) => onChange(e.target.value || (allowNone ? undefined : "#ffffff"))} />
    </Field>
  );
}

export function Select<T extends string | number>({ label, value, options, onChange, hint }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <select
        value={String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint} className="field-toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </Field>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="section">
      <h3>
        {title}
        {right}
      </h3>
      {children}
    </section>
  );
}
