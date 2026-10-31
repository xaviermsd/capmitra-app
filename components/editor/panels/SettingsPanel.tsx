"use client";
/** API keys, transcription defaults, word list, translation key, access, import and about. */
import { useRef } from "react";
import { useEditor } from "../EditorContext";
import { Section, Select, Slider, Toggle } from "@/components/Controls";
import { ApiKeyManager } from "@/components/ApiKeyManager";
import { BackupKeys } from "@/components/BackupKeys";
import { Credit, CREATOR } from "@/components/Credit";
import { IconLogout } from "@/components/Icons";
import { formatExpiry } from "@/lib/watermark";
import { applyRules } from "@/lib/keywords";
import { demoWords } from "@/lib/demo";

export function SettingsPanel() {
  const ed = useEditor();
  const { settings, setSettings, server, file, doc, project, toast, wm, rules } = ed;
  const subInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <ApiKeyManager
        apiKey={settings.apiKey}
        status={settings.keyStatus}
        serverHasKey={server.serverElevenLabs}
        serverReason={server.keyReason ?? null}
        onSave={(k, st) => {
          setSettings({ apiKey: k, keyStatus: st });
          if (file && !doc.words.length && st.ok) {
            toast({ id: "key-ready", kind: "success", title: "Key saved. You're ready!", message: "Your video can be captioned now.", duration: 9000, action: { label: "Caption my video", onClick: () => void ed.transcription.transcribe(file, false) } });
          }
        }}
        onRemove={() => setSettings((s) => {
          // the first backup key becomes the main key
          const [next = "", ...rest] = s.backupKeys ?? [];
          return { ...s, apiKey: next, backupKeys: rest, keyStatus: undefined, activeKey: 0 };
        })}
      />
      <BackupKeys settings={settings} setSettings={setSettings} />
      <Section title="Transcription">
        <Select label="Model" value={settings.model} options={[{ value: "scribe_v2", label: "Scribe v2 (most accurate)" }, { value: "scribe_v1", label: "Scribe v1" }]} onChange={(v) => setSettings({ model: v })} />
        <Toggle label="Caption automatically when a video is opened" value={settings.autoTranscribe} onChange={(v) => setSettings({ autoTranscribe: v })} />
        <Toggle label="Shortcut hints under the player" value={settings.showHints} onChange={(v) => setSettings({ showHints: v })} />
        <div className="row-btns"><button className="btn small" onClick={() => setSettings({ tourDone: false })} disabled={!settings.tourDone}>Show the tour again</button></div>
        {settings.autoTranscribe ? <Toggle label="Ask for language and writing first" value={settings.askBeforeCaptioning} onChange={(v) => setSettings({ askBeforeCaptioning: v })} hint="the Prepare your video step" /> : null}
        <Slider label="Ask before transcribing videos longer than" value={settings.confirmMinutes} min={1} max={60} step={1} unit="min" onChange={(v) => setSettings({ confirmMinutes: v })} />
        <p className="muted">Spoken language and speakers are in the Language panel. Each video is transcribed once; reopening it reuses the saved transcript at no cost. Long videos are sent in parts of up to 10 minutes.</p>
      </Section>
      <Section title="Your word list">
        <label className="field stack">
          <span className="field-label">Automatic fixes<em>one per line, like: કેપમિત્ર = CapMitra</em></span>
          <textarea rows={4} value={settings.rules} onChange={(e) => setSettings({ rules: e.target.value })} placeholder="wrong spelling = right spelling" />
        </label>
        <button className="btn small" disabled={!rules.length || !doc.words.length} onClick={() => {
          const r = applyRules(doc.words, rules);
          project.update((d) => ({ ...d, words: r.words }));
          toast(r.changed ? { kind: "success", title: `Fixed ${r.changed} words` } : { kind: "info", title: "Nothing to fix" });
        }}>Apply to current captions</button>
        <label className="field stack">
          <span className="field-label">Names and brand words<em>helps Scribe spell them right; comma or line separated</em></span>
          <textarea rows={3} value={settings.keyterms} onChange={(e) => setSettings({ keyterms: e.target.value })} placeholder="CapMitra, Harsh, Bandhani" />
        </label>
        <Toggle label="Send these to Scribe" value={settings.useKeyterms} onChange={(v) => setSettings({ useKeyterms: v })} hint="ElevenLabs charges about 20% more per minute" />
      </Section>
      <Section title="Translation (Sarvam AI)">
        <label className="field">
          <span className="field-label">Sarvam API key<em>{server.serverSarvam ? "the server's key is used if empty" : "for translations and the second line"}</em></span>
          <span className="field-input"><input className="txt grow" type="password" autoComplete="off" placeholder={server.serverSarvam ? "Using the server key" : "Paste your key"} value={settings.sarvamKey} onChange={(e) => setSettings({ sarvamKey: e.target.value.trim() })} /></span>
        </label>
        <p className="muted">Get a key at <a href="https://dashboard.sarvam.ai" target="_blank" rel="noopener noreferrer">dashboard.sarvam.ai</a>. It's stored only in this browser.</p>
      </Section>
      {ed.locked ? (
        <Section title="Studio access">
          <p className="muted">You&apos;re signed in with the team passcode on this device. Signing out keeps your projects and API key here.</p>
          <button className="btn small" onClick={async () => { await fetch("/api/login", { method: "DELETE" }).catch(() => {}); window.location.replace("/login"); }}><IconLogout size={15} /> Sign out</button>
        </Section>
      ) : null}
      <Section title="Import and sample">
        <div className="row-btns wrap">
          <button className="btn small" onClick={() => subInput.current?.click()}>Import SRT or VTT</button>
          <input ref={subInput} type="file" accept=".srt,.vtt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void ed.importSubs(f); e.target.value = ""; }} />
          <button className="btn small ghost" onClick={() => { project.update((d) => ({ ...d, words: demoWords() })); ed.playback.play(); }}>Load sample captions</button>
          <button className="btn small danger" onClick={async () => {
            if (await ed.dialog.confirm({ title: "Clear all captions?", message: "The video stays. You can undo with Ctrl+Z.", confirmLabel: "Clear captions", danger: true })) project.update((d) => ({ ...d, words: [], translations: undefined }));
          }}>Clear captions</button>
        </div>
      </Section>
      <Section title="About">
        <div className="about-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/icon-96.png" alt="" width={44} height={44} />
          <div>
            <strong>CapMitra <span className="wm-badge-edit">EDIT</span></strong>
            <Credit />
            <a className="about-link" href={CREATOR.url} target="_blank" rel="noopener noreferrer">Follow on Instagram</a>
          </div>
        </div>
        <p className="muted about-wm">
          Watermark: {wm.unlocked ? <>removed for {wm.name}, {wm.expiresAt ? `until ${formatExpiry(wm.expiresAt)}` : "no expiry"}.</> : <>on. </>}
          {!wm.unlocked ? <button className="linkish" onClick={() => ed.setPanel("export", true)}>How to remove it</button> : null}
        </p>
      </Section>
    </>
  );
}
