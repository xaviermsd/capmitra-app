"use client";
/**
 * More ElevenLabs keys for this device. Captioning uses one key at a time;
 * when it runs out of credits or is refused, the next key takes over
 * (lib/keyPool.ts). Keys stay in this browser and are only ever shown masked.
 */
import { useState } from "react";
import { Section } from "./Controls";
import { useDialog } from "./Dialog";
import { useToast } from "./Toaster";
import { IconTrash } from "./Icons";
import { checkKey, looksLikeKey, mask } from "./ApiKeyManager";
import { elevenKeys, type Settings } from "@/lib/settings";

const day = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function BackupKeys({ settings, setSettings }: { settings: Settings; setSettings: (f: (s: Settings) => Settings) => void }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const dialog = useDialog();
  const keys = elevenKeys(settings);
  const active = Math.min(settings.activeKey ?? 0, Math.max(0, keys.length - 1));
  const backups = settings.backupKeys ?? [];

  const add = async () => {
    const key = draft.trim();
    setError("");
    if (!looksLikeKey(key)) { setError("That doesn't look like an ElevenLabs key. New keys start with “sk_”."); return; }
    if (keys.includes(key)) { setError("This key is already saved."); return; }
    setBusy(true);
    const st = await checkKey(key);
    setBusy(false);
    if (!st.ok && st.note === "ElevenLabs didn't accept this key") { setError("ElevenLabs didn't accept this key. Check you copied all of it."); return; }
    setSettings((s) => ({ ...s, backupKeys: [...(s.backupKeys ?? []), key] }));
    setDraft("");
    toast(st.ok ? { kind: "success", title: "Backup key added", message: `It's used when the keys before it run out.${st.note ? ` (${st.note})` : ""}` } : { kind: "warning", title: "Backup key added, but not verified", message: st.note });
  };

  const remove = async (key: string) => {
    const ok = await dialog.confirm({ title: "Remove this backup key?", message: `CapMitra forgets key ${mask(key)} on this device.`, confirmLabel: "Remove", danger: true });
    if (!ok) return;
    setSettings((s) => {
      const before = elevenKeys(s);
      const inUse = before[Math.min(s.activeKey ?? 0, before.length - 1)];
      const next = { ...s, backupKeys: (s.backupKeys ?? []).filter((k) => k !== key) };
      const after = elevenKeys(next);
      return { ...next, activeKey: Math.max(0, after.indexOf(inUse)) };
    });
  };

  const useFirst = (index: number) => setSettings((s) => ({ ...s, activeKey: index }));

  return (
    <Section title={`More ElevenLabs keys${backups.length ? ` (${backups.length})` : ""}`}>
      <p className="muted">When the key in use runs out of credits or is refused, captioning carries on with the next one, even in the middle of a long video. Keys are stored only in this browser.</p>
      {keys.length > 1 ? (
        <ul className="kit-list key-list">
          {keys.map((k, i) => {
            const note = settings.keyNotes?.[k.slice(-6)];
            const isMain = k === settings.apiKey;
            return (
              <li key={k} className={`kit-row ${i === active ? "on" : ""}`}>
                <span className="kit-name">
                  <b><code>{mask(k)}</code> {isMain ? "· main" : ""}</b>
                  <em>{i === active ? "In use now" : note ? (note.problem === "quota" ? `Out of credits on ${day(note.at)}` : `Refused on ${day(note.at)}`) : "Ready"}{note && i === active ? ` (was ${note.problem === "quota" ? "out of credits" : "refused"} on ${day(note.at)})` : ""}</em>
                </span>
                {i !== active ? <button className="btn small ghost" onClick={() => useFirst(i)} data-tip="Start with this key next time">Use first</button> : null}
                {!isMain ? <button className="btn icon small ghost" onClick={() => void remove(k)} aria-label={`Remove key ${mask(k)}`}><IconTrash size={14} /></button> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {settings.apiKey ? (
        <>
          <label className="field stack">
            <span className="field-label">Add a key</span>
            <span className="field-input">
              <input className="txt grow" type="password" autoComplete="off" placeholder="sk_…" value={draft} onChange={(e) => { setDraft(e.target.value); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} aria-label="New ElevenLabs key" />
              <button className="btn small primary" disabled={busy || !draft.trim()} onClick={() => void add()}>{busy ? "Checking…" : "Check and add"}</button>
            </span>
          </label>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
        </>
      ) : <p className="muted">Add your main key above first.</p>}
    </Section>
  );
}
