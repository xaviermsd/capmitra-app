"use client";
/* eslint-disable @next/next/no-img-element */
/** Start screen: drop a video, pick a language, continue a recent project, or start a batch. */
import { useEditor } from "./EditorContext";
import { Credit } from "@/components/Credit";
import { IconFolder, IconStack, IconUpload, IconBrand } from "@/components/Icons";
import { PRESETS, languageByCode } from "@/lib/languages";
import { demoWords } from "@/lib/demo";

export function Dashboard() {
  const ed = useEditor();
  const { settings, setSettings, project } = ed;
  const lang = languageByCode(settings.language)?.code ?? settings.language;
  const presetOn = (p: (typeof PRESETS)[number]) => (languageByCode(p.transcription)?.code ?? p.transcription) === lang && (project.doc.style.script ?? "native").replace("gujlish", "casual") === p.script;

  return (
    <div className="dash">
      <div className="dash-hero">
        <div className="drop" onClick={() => ed.fileInput.current?.click()} role="button" tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && ed.fileInput.current?.click()} aria-label="Choose a video to caption">
          <img src="/brand/icon-192.png" alt="" width={72} height={72} className="drop-icon" draggable={false} />
          <h2>Drop your video here</h2>
          <p>Word-timed captions in Gujarati, Hindi, English and more. Only the sound is sent for transcription; the video stays on this device.</p>
          <div className="row-btns center">
            <button className="btn primary" onClick={(e) => { e.stopPropagation(); ed.fileInput.current?.click(); }}><IconUpload /> Choose video</button>
            <button className="btn ghost" onClick={(e) => { e.stopPropagation(); project.update((d) => ({ ...d, words: demoWords() })); ed.playback.play(); }}>Try a sample</button>
          </div>
          <small>MP4, MOV or WebM · several files start a batch · Chrome or Edge recommended</small>
        </div>
        <div className="dash-lang" role="group" aria-label="Language of your video">
          <span>Captions in</span>
          {PRESETS.map((p) => (
            <button key={p.id} className={`pchip ${presetOn(p) ? "on" : ""}`} aria-pressed={presetOn(p)} title={p.note}
              onClick={() => { setSettings({ language: p.transcription }); project.update((d) => ({ ...d, style: { ...d.style, script: p.script } }), { history: false }); }}>{p.label}</button>
          ))}
        </div>
        {ed.needsKey ? (
          <button className="key-nudge" onClick={ed.openKeySetup}>
            <span aria-hidden="true">🔑</span>
            <span><b>Before your first video:</b> add your free ElevenLabs key (2 minutes)</span>
            <em>Set up →</em>
          </button>
        ) : null}
      </div>

      <div className="dash-cards">
        <button className="dash-card" onClick={() => ed.setShowBatch(true)}><IconStack size={22} /><b>Batch captions</b><span>Many videos, one style, one click</span></button>
        <button className="dash-card" onClick={() => ed.setShowProjects(true)}><IconFolder size={22} /><b>All projects</b><span>Open, rename, back up</span></button>
        <button className="dash-card" onClick={() => ed.setPanel("brand", true)}><IconBrand size={22} /><b>Brand kit</b><span>Logo, fonts, colours, intro &amp; outro</span></button>
      </div>

      {ed.recent.length ? (
        <div className="recent">
          <div className="recent-head">
            <h3>Continue where you left off</h3>
            <button className="btn small ghost" onClick={() => ed.setShowProjects(true)}>All projects</button>
          </div>
          <div className="recent-grid">
            {ed.recent.map((p) => (
              <button key={p.id} className="recent-card" onClick={() => void ed.openProject(p.id)}>
                <span className="recent-thumb">{p.thumb ? <img src={p.thumb} alt="" /> : <IconFolder size={22} />}</span>
                <span className="recent-name">{p.name}</span>
                <span className="recent-meta">{p.words.length} words{p.clips && p.clips.length > 1 ? ` · ${p.clips.length} clips` : ""}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol className="how">
          <li><b>1</b><span><strong>Choose a video</strong>From your phone or computer</span></li>
          <li><b>2</b><span><strong>Captions appear</strong>Word-timed, in your language</span></li>
          <li><b>3</b><span><strong>Edit &amp; export</strong>Cuts, graphics, music, MP4 or SRT</span></li>
        </ol>
      )}
      <Credit className="welcome-credit" />
    </div>
  );
}
