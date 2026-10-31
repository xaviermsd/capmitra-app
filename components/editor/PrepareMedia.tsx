"use client";
/**
 * "Prepare your video": shown when a new video is opened, before it is captioned.
 * One screen to pick what is spoken and how the captions should be written,
 * so the first transcript comes back right instead of being fixed afterwards.
 */
import { useEffect, useRef } from "react";
import { useEditor } from "./EditorContext";
import { Toggle } from "@/components/Controls";
import { IconMic, IconX } from "@/components/Icons";
import { AUTO, LANGUAGES, languageByCode, normaliseScript, scriptOptions } from "@/lib/languages";

const TIER: Record<string, string> = { excellent: "Excellent accuracy", high: "High accuracy", good: "Good accuracy", moderate: "Moderate accuracy" };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function PrepareMedia() {
  const ed = useEditor();
  const { prepareFile: f, setPrepareFile, settings, setSettings, project, doc, videoUrl, transcription } = ed;
  const goRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!f) return;
    goRef.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPrepareFile(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [f, setPrepareFile]);

  if (!f) return null;
  const spoken = settings.language;
  const lang = languageByCode(spoken);
  const script = normaliseScript(doc.style.script);
  const opts = spoken === AUTO ? [] : scriptOptions(spoken);
  const dur = ed.videoRef.current?.duration || ed.videoDuration;
  const india = LANGUAGES.filter((l) => l.group === "india");
  const world = LANGUAGES.filter((l) => l.group === "world");
  const setScript = (v: (typeof opts)[number]["value"]) => project.update((d) => ({ ...d, style: { ...d.style, script: v } }), { history: false });
  const go = () => { setPrepareFile(null); void transcription.transcribe(f); };

  return (
    <div className="modal-veil prep-veil" onPointerDown={(e) => { if (e.target === e.currentTarget) setPrepareFile(null); }}>
      <div className="dialog prep" role="dialog" aria-modal="true" aria-labelledby="prep-title">
        <header className="prep-head">
          <div>
            <h2 id="prep-title">Prepare your video</h2>
            <p className="muted">{f.name}{dur ? ` · ${clock(dur)}` : ""}</p>
          </div>
          <button className="btn ghost icon" aria-label="Close" onClick={() => setPrepareFile(null)}><IconX size={18} /></button>
        </header>

        <div className="prep-body">
          <div className="prep-video">
            {videoUrl ? <video src={videoUrl} controls playsInline preload="metadata" /> : null}
          </div>
          <div className="prep-opts">
            <label className="prep-label" htmlFor="prep-lang">What language is spoken?</label>
            <select id="prep-lang" value={lang?.code ?? spoken} onChange={(e) => setSettings({ language: e.target.value })}>
              <option value={AUTO}>Detect automatically</option>
              <optgroup label="Indian languages">{india.map((l) => <option key={l.code} value={l.code}>{l.name} · {l.native}</option>)}</optgroup>
              <optgroup label="Other languages">{world.map((l) => <option key={l.code} value={l.code}>{l.name} · {l.native}</option>)}</optgroup>
            </select>
            <p className="muted">{spoken === AUTO ? "Detects the language by itself. Pick one if it gets it wrong, or to write in English letters." : lang ? `${TIER[lang.tier] ?? ""}. Mixed speech (with English words) is fine.` : ""}</p>

            <div className="prep-label">Write captions in</div>
            {opts.length > 1 ? (
              <div className="choice-list" role="radiogroup" aria-label="Writing system">
                {opts.map((o) => (
                  <button key={o.value} role="radio" aria-checked={script === o.value} className={`choice ${script === o.value ? "on" : ""}`} onClick={() => setScript(o.value)}>
                    <b>{o.label}</b>
                    {o.hint ? <em>{o.hint}</em> : null}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">{spoken === AUTO ? "Its own script. Choose Gujarati or Hindi above to write in English letters (Gujlish / Hinglish)." : `${lang?.native ?? "Its own"} script, as spoken.`} You can add an English translation line later in Language.</p>
            )}

            <Toggle label="Tell speakers apart" value={settings.diarize} onChange={(v) => setSettings({ diarize: v })} hint="interviews and podcasts" />
          </div>
        </div>

        <footer className="prep-foot">
          <label className="prep-skip"><input type="checkbox" checked={!settings.askBeforeCaptioning} onChange={(e) => setSettings({ askBeforeCaptioning: !e.target.checked })} /> Don&apos;t ask again</label>
          <button className="btn ghost" onClick={() => setPrepareFile(null)}>Not now</button>
          <button ref={goRef} className="btn export" onClick={go}><IconMic size={16} /> Generate captions</button>
        </footer>
      </div>
    </div>
  );
}
