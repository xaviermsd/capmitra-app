"use client";

import { useState } from "react";
import { Section } from "./Controls";
import { useDialog } from "./Dialog";
import { useToast } from "./Toaster";
import { StatusBadge } from "./ui";
import { IconLock, IconRefresh, IconTrash } from "./Icons";

export const ELEVENLABS_KEYS_URL = "https://elevenlabs.io/app/developers/api-keys";

export interface KeyStatus {
  ok: boolean;
  at: number;
  note?: string;
}

/** Always masked: only the last 6 characters are ever shown, e.g. ••••••••••••sdk7dw */
export const mask = (k: string) => `${"•".repeat(12)}${k.slice(-6)}`;

/** Looks like an ElevenLabs key (format only; checkKey asks ElevenLabs). */
export const looksLikeKey = (k: string) => /^sk_[A-Za-z0-9]{16,}$/.test(k) || /^[a-f0-9]{32}$/i.test(k);

/** Ask ElevenLabs whether a key works, without spending credits. */
export async function checkKey(key: string): Promise<KeyStatus> {
  const res = await fetch("/api/check-key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) }).catch(() => null);
  const d = ((await res?.json().catch(() => ({}))) ?? { reason: "network" }) as { ok?: boolean; limited?: boolean; tier?: string | null; reason?: string };
  if (d.ok) return { ok: true, at: Date.now(), note: d.tier ? `${d.tier} plan` : d.limited ? "restricted key" : undefined };
  return {
    ok: false,
    at: Date.now(),
    note: d.reason === "invalid" ? "ElevenLabs didn't accept this key" : d.reason === "network" ? "couldn't reach ElevenLabs" : d.reason,
  };
}
const when = (t: number) => new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Lets each person use their own ElevenLabs key: add, test, show, replace,
 * remove. The key is stored only in this browser on this device.
 */
export function ApiKeyManager({
  apiKey, status, serverHasKey, serverReason = null, onSave, onRemove,
}: {
  apiKey: string;
  status?: KeyStatus;
  serverHasKey: boolean;
  /** why the server key is allowed here: signed in as admin, owner master code, or shared with everyone */
  serverReason?: "admin" | "master" | "everyone" | null;
  onSave: (key: string, status: KeyStatus) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(!apiKey);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const dialog = useDialog();

  const check = checkKey;

  const save = async () => {
    const key = draft.trim();
    setError("");
    if (!looksLikeKey(key)) {
      setError("That doesn't look like an ElevenLabs key. New keys start with “sk_” followed by letters and numbers.");
      return;
    }
    setBusy(true);
    const st = await check(key);
    setBusy(false);
    if (!st.ok && st.note === "ElevenLabs didn't accept this key") {
      setError("ElevenLabs didn't accept this key. Check you copied all of it, or create a new one.");
      return;
    }
    onSave(key, st);
    setDraft("");
    setEditing(false);
    toast(st.ok
      ? { kind: "success", title: "API key saved", message: "Captioning will use your ElevenLabs account." }
      : { kind: "warning", title: "API key saved, but not verified", message: st.note });
  };

  const test = async () => {
    setBusy(true);
    const st = await check(apiKey);
    setBusy(false);
    onSave(apiKey, st);
    toast(st.ok ? { kind: "success", title: "Your API key works", message: st.note } : { kind: "error", title: "API key isn't working", message: `${st.note}. Replace it with a new key.` });
  };

  const remove = async () => {
    const ok = await dialog.confirm({
      title: "Remove your API key from this device?",
      message: "CapMitra forgets it on this phone or computer. To make the key unusable everywhere, also delete it on your ElevenLabs API keys page.",
      confirmLabel: "Remove key",
      danger: true,
    });
    if (!ok) return;
    onRemove();
    setEditing(true);
    toast({ kind: "success", title: "API key removed", message: "Delete it on ElevenLabs too if you no longer need it.", action: { label: "Open ElevenLabs", onClick: () => window.open(ELEVENLABS_KEYS_URL, "_blank", "noopener") } });
  };

  const badge = !apiKey
    ? serverHasKey ? <StatusBadge kind="success">{serverReason === "admin" ? "Your server key (signed in as admin)" : serverReason === "master" ? "Your server key (master code)" : "Using the app's shared key"}</StatusBadge> : <StatusBadge kind="warning">No key yet</StatusBadge>
    : status?.ok ? <StatusBadge kind="success">Working</StatusBadge>
    : status ? <StatusBadge kind="error">Not working</StatusBadge>
    : <StatusBadge kind="warning">Saved, not tested</StatusBadge>;

  return (
    <Section title="Your ElevenLabs API key" right={badge}>
      {apiKey && !editing ? (
        <div className="key-card">
          <div className="key-line">
            <IconLock size={16} />
            <code aria-label={`Key ending in ${apiKey.slice(-6)}`}>{mask(apiKey)}</code>
          </div>
          {status ? <p className="muted">{status.ok ? "Checked" : "Failed"} {when(status.at)}{status.note ? `: ${status.note}` : ""}.</p> : null}
          <div className="row-btns wrap">
            <button className="btn small" onClick={test} disabled={busy}><IconRefresh size={14} /> {busy ? "Testing…" : "Test key"}</button>
            <button className="btn small" onClick={() => { setEditing(true); setError(""); }}>Replace key</button>
            <button className="btn small danger" onClick={remove}><IconTrash size={14} /> Remove</button>
          </div>
        </div>
      ) : (
        <div className="key-form">
          <label className="field stack">
            <span className="field-label">Paste your key<em>starts with sk_</em></span>
            <input
              id="elevenlabs-key-input"
              type="password"
              className="key-input"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk_…"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && draft.trim() && void save()}
              aria-invalid={!!error}
              aria-describedby="key-err"
            />
          </label>
          {error ? <p className="field-error" id="key-err" role="alert">{error}</p> : null}
          <div className="row-btns">
            <button className="btn primary small" onClick={save} disabled={!draft.trim() || busy}>{busy ? "Checking…" : "Save and test"}</button>
            {apiKey ? <button className="btn small ghost" onClick={() => { setEditing(false); setDraft(""); setError(""); }}>Cancel</button> : null}
          </div>
        </div>
      )}

      <details className="key-help" open={!apiKey && !serverHasKey}>
        <summary>How to get your free key (2 minutes)</summary>
        <ol>
          <li>Sign in or create a free account at <a href="https://elevenlabs.io" target="_blank" rel="noopener noreferrer">elevenlabs.io</a>.</li>
          <li>Open <a href={ELEVENLABS_KEYS_URL} target="_blank" rel="noopener noreferrer">Developers → API keys</a>.</li>
          <li>Choose <b>Create API key</b> and name it “CapMitra”. Turning on <b>Restrict key</b> with only <b>Speech to Text</b> allowed is safest.</li>
          <li>Copy the key (it's shown once), paste it above and choose <b>Save and test</b>.</li>
        </ol>
        <p className="muted">
          Your key is saved only in this browser on this device and is used only to transcribe your videos. ElevenLabs bills transcription to your own account.
          To revoke it, delete it on the <a href={ELEVENLABS_KEYS_URL} target="_blank" rel="noopener noreferrer">API keys page</a> and choose Remove here.
        </p>
      </details>
    </Section>
  );
}
