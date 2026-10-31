"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { Section, Select, Toggle } from "./Controls";
import { useToast } from "./Toaster";
import { IconCheck, IconInstagram, IconLock, IconWhatsApp } from "./Icons";
import { CONTACT, formatExpiry, rememberCode, WATERMARK_SRC, type UnlockStatus, type WatermarkCorner } from "@/lib/watermark";

interface Props {
  status: UnlockStatus;
  onStatus: (s: UnlockStatus) => void;
  keep: boolean;
  onKeep: (v: boolean) => void;
  corner: WatermarkCorner;
  onCorner: (c: WatermarkCorner) => void;
}

const CORNERS: { value: WatermarkCorner; label: string }[] = [
  { value: "br", label: "Bottom right" },
  { value: "bl", label: "Bottom left" },
  { value: "tr", label: "Top right" },
  { value: "tl", label: "Top left" },
];

export function WatermarkPanel({ status, onStatus, keep, onKeep, corner, onCorner }: Props) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const on = !status.unlocked || keep;
  const [who, setWho] = useState("");
  useEffect(() => { try { setWho(localStorage.getItem("acg:wmName") ?? ""); } catch { /* ignore */ } }, []);
  const saveWho = (v: string) => { setWho(v); try { localStorage.setItem("acg:wmName", v); } catch { /* ignore */ } };
  const hasName = who.trim().length >= 2;
  const message = CONTACT.request(who);
  const copyForInstagram = () => {
    void navigator.clipboard?.writeText(message).then(
      () => toast({ id: "wm-copy", kind: "success", title: "Message copied", message: "Instagram opens next. Paste it in the chat with Ctrl + V (or long-press on a phone)." }),
      () => {},
    );
  };

  const redeem = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d.error ?? "That code didn't work.");
        toast({ id: "wm", kind: "error", title: "Code not accepted", message: d.error ?? "Check the code and try again." });
        return;
      }
      rememberCode(code.trim());
      onStatus({ unlocked: true, available: true, name: d.name, expiresAt: d.expiresAt });
      onKeep(false);
      setCode("");
      toast({ id: "wm", kind: "success", title: "Watermark removed", message: `Unlocked for ${d.name}, ${d.expiresAt ? `until ${formatExpiry(d.expiresAt)}` : "with no expiry"}.` });
    } catch {
      setErr("Couldn't reach the server. Check your internet connection.");
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    rememberCode(null);
    await fetch("/api/unlock", { method: "DELETE" }).catch(() => {});
    onStatus({ unlocked: false, available: status.available });
    toast({ id: "wm", kind: "info", title: "Code removed from this device", message: "Exports will include the watermark again." });
  };

  return (
    <Section
      title="Watermark"
      right={<span className={`wm-badge ${on ? "" : "off"}`}>{on ? "On" : "Removed"}</span>}
    >
      <div className="wm-preview">
        <img src={WATERMARK_SRC} alt="Made with CapMitra" width={300} height={57} style={{ width: "min(100%, 300px)", height: "auto" }} />
      </div>

      {status.unlocked ? (
        <>
          <div className="wm-unlocked">
            <IconCheck size={16} />
            <p>
              {status.name === "OWNER" ? (
                <><strong>Unlocked with the master code.</strong> No watermark, no expiry, on this device.</>
              ) : (
                <>
                  <strong>Watermark-free exports unlocked</strong> for {status.name}
                  {status.expiresAt ? <>, until <b>{formatExpiry(status.expiresAt)}</b>.</> : <>, with no expiry.</>}
                </>
              )}
            </p>
          </div>
          <Toggle label="Add the watermark anyway" value={keep} onChange={onKeep} hint="optional" />
          {on ? <Select label="Position" value={corner} options={CORNERS} onChange={onCorner} /> : null}
          <button className="btn small ghost" onClick={() => void forget()}>Remove code from this device</button>
        </>
      ) : (
        <>
          <label className="field wm-locked-row">
            <span className="field-label">Remove watermark<em>needs a code</em></span>
            <span className="field-input"><IconLock size={14} /><input type="checkbox" checked={false} disabled aria-label="Remove watermark (locked)" /></span>
          </label>
          <Select label="Position" value={corner} options={CORNERS} onChange={onCorner} hint="kept inside the safe zone" />

          <div className="wm-guide">
            <strong>How to export without the watermark</strong>
            <ol>
              <li>Message <b>Harsh Prajapati</b> on Instagram or WhatsApp and ask for a watermark-free code.</li>
              <li>You&apos;ll get a personal code like <code>AC-RAVI-…</code>. It usually works for <b>24 hours</b>.</li>
              <li>Paste it below and press <b>Unlock</b>. This device then exports without the watermark until the code expires.</li>
            </ol>
            <label className="wm-name">
              <span>Your name</span>
              <input value={who} onChange={(e) => saveWho(e.target.value.slice(0, 40))} placeholder="e.g. Ravi Patel" autoComplete="name" maxLength={40} />
            </label>
            {hasName ? (
              <div className="row-btns wrap">
                <a className="btn small ig" href={CONTACT.instagram} target="_blank" rel="noopener noreferrer" onClick={copyForInstagram}><IconInstagram size={15} /> Instagram DM</a>
                <a className="btn small wa" href={CONTACT.whatsapp(message)} target="_blank" rel="noopener noreferrer"><IconWhatsApp size={15} /> WhatsApp {CONTACT.whatsappNumber}</a>
              </div>
            ) : (
              <p className="wm-name-hint">Type your name first so Harsh knows who the code is for.</p>
            )}
          </div>

          {status.available ? (
            <form className="wm-redeem" onSubmit={(e) => { e.preventDefault(); void redeem(); }}>
              <input
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr(""); }}
                placeholder="AC-NAME-XXXXX-XXXXXXXX"
                aria-label="Watermark removal code"
                aria-invalid={!!err}
                autoComplete="off"
                spellCheck={false}
              />
              <button className="btn small primary" disabled={!code.trim() || busy}>{busy ? <span className="spinner" aria-hidden="true" /> : null}{busy ? "Checking…" : "Unlock"}</button>
            </form>
          ) : (
            <p className="muted">Code entry isn&apos;t switched on for this server yet.</p>
          )}
          {err ? <p className="wm-err" role="alert">{err}</p> : null}
        </>
      )}
    </Section>
  );
}
