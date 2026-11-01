"use client";
/**
 * Full-screen export experience: live progress while rendering, a
 * celebration with a preview of the finished video, or a clear error.
 * Driven by the exporter (hooks/useExport) and `exportView` in the editor.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { live } from "@/lib/livePreview";
import { useEditor } from "./EditorContext";
import { IconCheck, IconDownload, IconShare, IconX } from "@/components/Icons";
import type { ExportStage } from "./hooks/useExport";

const STEPS: { id: ExportStage; label: string; hint: string }[] = [
  { id: "prepare", label: "Getting ready", hint: "Loading fonts, graphics and music" },
  { id: "render", label: "Rendering video", hint: "Drawing every frame with your captions" },
  { id: "finish", label: "Finishing up", hint: "Mixing the sound and closing the file" },
  { id: "save", label: "Saving", hint: "Handing the file to your device" },
];
const ORDER = STEPS.map((s) => s.id);

const TIPS = [
  "Tip: short, punchy captions of 2 to 4 words keep people watching on Reels and Shorts.",
  "Tip: try Shorts in the Finish group to turn a long video into several clips.",
  "Tip: Edit by text removes long pauses and filler words in one go.",
  "Tip: Check spelling in Captions learns your names and brands from your dictionary.",
  "Tip: the Voice enhancer in Audio Studio removes fan and traffic noise.",
  "Everything is rendered on this device. Your video never leaves it.",
];

const fmtTime = (s: number) => (s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
/** Compact clock for the stat tiles: 0:37, 1:08. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60) % 60).padStart(2, "0")}`;

export interface ExportView {
  /** Picture of the video for the export screen. */
  thumb?: string;
  /** Output width / height. */
  ratio: number;
  format: string;
  dims?: string;
  duration: number;
  error?: string;
  retry?: () => void;
}

export function ExportOverlay() {
  const ed = useEditor();
  const view = ed.exportView;
  const { exporter } = ed;
  const open = !!view;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!view) return null;
  const close = () => ed.setExportView(null);
  const state = exporter.exporting ? "working" : view.error ? "error" : exporter.last ? "done" : "working";

  return (
    <div className={`xo xo-${state}`} role="dialog" aria-modal="true" aria-label={state === "done" ? "Export complete" : state === "error" ? "Export failed" : "Exporting"}>
      <div className="xo-bg" aria-hidden="true"><i className="xo-blob a" /><i className="xo-blob b" /><i className="xo-blob c" /></div>
      <header className="xo-top">
        <span className="xo-brand"><img src="/brand/icon-96.png" alt="" width={32} height={32} />CapMitra <em className="wm-badge-edit">EDIT</em></span>
        {state === "working" ? null : <button className="btn icon xo-close" onClick={close} aria-label="Back to editor"><IconX size={18} /></button>}
      </header>
      {state === "working" ? <Working view={view} /> : state === "error" ? <Failed view={view} onClose={close} /> : <Done view={view} onClose={close} />}
    </div>
  );
}

/* ---------- while exporting ---------- */

function Working({ view }: { view: ExportView }) {
  const { exporter } = useEditor();
  const p = exporter.progress ?? 0;
  // 100 is only reached once the file is saved; until then the screen never claims to be done
  const pct = Math.min(99, Math.floor(p * 100));
  const [now, setNow] = useState(Date.now());
  const [tip, setTip] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 6000); return () => clearInterval(t); }, []);
  const elapsed = exporter.startedAt ? (now - exporter.startedAt) / 1000 : 0;
  const left = p > 0.04 && p < 1 ? (elapsed * (1 - p)) / p : null;
  const at = ORDER.indexOf(exporter.stage);
  const step = STEPS[at] ?? STEPS[0];

  return (
    <main className="xo-main">
      <Preview view={view} working stage={exporter.stage} />
      <section className="xo-info" aria-live="polite">
        <div className="xo-head">
          <div className="xo-pct" aria-label={`${pct} percent`}><b>{pct}</b><span>%</span></div>
          <div className="xo-now">
            <strong><i className="xo-dot" aria-hidden="true" />{step.label}</strong>
            <em>{step.hint}</em>
          </div>
        </div>
        <div className="xo-bar" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${Math.max(3, p * 100)}%` }} />
        </div>
        <ol className="xo-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className={i < at ? "done" : i === at ? "on" : ""}>
              <span className="xo-step-ico" aria-hidden="true">{i < at ? <IconCheck size={12} /> : i + 1}</span><span className="xo-step-label">{s.label}</span>
            </li>
          ))}
        </ol>
        <dl className="xo-stats">
          <div><dt>Elapsed</dt><dd>{clock(elapsed)}</dd></div>
          <div><dt>Time left</dt><dd>{left === null ? "…" : `~${clock(left)}`}</dd></div>
          <div><dt>{view.format}</dt><dd>{view.dims ?? clock(view.duration)}</dd></div>
        </dl>
        <p className="xo-tip" key={tip}>{TIPS[tip]}</p>
        <div className="xo-cancel-row">
          <button className="btn xo-cancel" onClick={exporter.cancel}>Cancel export</button>
          <p className="xo-keep">Keep this tab open until it finishes.</p>
        </div>
      </section>
    </main>
  );
}

/**
 * The video card. While exporting it shows the frames the exporter is drawing,
 * as they are drawn (copied from the export canvas, so nothing is rendered twice);
 * when done it plays the finished file.
 */
function Preview({ view, working, src, stage }: { view: ExportView; working?: boolean; src?: string; stage?: ExportStage }) {
  const style = { ["--r" as string]: String(view.ratio) } as React.CSSProperties;
  return (
    <div className="xo-preview">
      <div className={`xo-frame ${working ? "live" : ""}`} style={style}>
        {src ? (
          <video src={src} controls playsInline autoPlay muted loop />
        ) : view.thumb ? <img src={view.thumb} alt="" /> : <div className="xo-blank" />}
        {working ? <LiveFrames duration={view.duration} stage={stage ?? "prepare"} /> : null}
      </div>
    </div>
  );
}

function LiveFrames({ duration, stage }: { duration: number; stage: ExportStage }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState(0);
  const [hasFrame, setHasFrame] = useState(false);
  useEffect(() => {
    let raf = 0, seen = -1, lastT = -1;
    const hasFrameRef = { current: false };
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = cv.current;
      if (!c || !live.src || live.n === seen) return;
      seen = live.n;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const g = c.getContext("2d");
      if (!g) return;
      g.imageSmoothingQuality = "medium";
      g.drawImage(live.src, 0, 0, w, h);
      if (!hasFrameRef.current) { hasFrameRef.current = true; setHasFrame(true); }
      if (Math.abs(live.t - lastT) >= 0.1) { lastT = live.t; setT(live.t); }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  const label = stage === "prepare" ? "Getting ready" : stage === "render" ? "Rendering" : stage === "finish" ? "Finishing" : "Saving";
  return (
    <>
      <canvas ref={cv} className={`xo-live ${hasFrame ? "on" : ""}`} aria-hidden="true" />
      {!hasFrame ? <div className="xo-shimmer" aria-hidden="true" /> : null}
      <span className="xo-chip"><i aria-hidden="true" />{label}{hasFrame && duration ? <b>{clock(t)} / {clock(duration)}</b> : null}</span>
      <span className="xo-playhead" aria-hidden="true"><span style={{ width: `${duration ? Math.min(100, (t / duration) * 100) : 0}%` }} /></span>
    </>
  );
}

/* ---------- finished ---------- */

function Done({ view, onClose }: { view: ExportView; onClose: () => void }) {
  const { exporter, wm, setPanel } = useEditor();
  const last = exporter.last!;
  const [shareFile, setShareFile] = useState<File | null>(null);
  useEffect(() => {
    if (!last.url || !("canShare" in navigator)) return;
    let live = true;
    void fetch(last.url).then((r) => r.blob()).then((b) => {
      const f = new File([b], last.fileName ?? "video.mp4", { type: last.mime ?? b.type });
      let ok = false;
      try { ok = navigator.canShare({ files: [f] }); } catch { ok = false; }
      if (live && ok) setShareFile(f);
    }).catch(() => {});
    return () => { live = false; };
  }, [last.url, last.fileName, last.mime]);
  const canShare = !!shareFile;

  const share = async () => {
    if (!shareFile) return;
    try { await navigator.share({ files: [shareFile], title: "Made with CapMitra" }); } catch { /* cancelled */ }
  };
  const canPick = typeof window !== "undefined" && "showSaveFilePicker" in window;
  const [savedTo, setSavedTo] = useState<string | null>(null);
  /** Choose a folder now that the video is ready (this click is the gesture Chrome needs). */
  const saveTo = async () => {
    if (!last.url) return;
    const ext = (last.fileName ?? "video.mp4").split(".").pop() ?? "mp4";
    try {
      const w = window as unknown as { showSaveFilePicker: (o: unknown) => Promise<{ name: string; createWritable: () => Promise<FileSystemWritableFileStream> }> };
      const h = await w.showSaveFilePicker({ suggestedName: last.fileName, types: [{ description: ext.toUpperCase() + " video", accept: { [last.mime || `video/${ext}`]: [`.${ext}`] } }] });
      const out = await h.createWritable();
      const blob = await (await fetch(last.url)).blob();
      await out.write(blob);
      await out.close();
      setSavedTo(h.name);
    } catch { /* cancelled */ }
  };
  const saveAgain = () => {
    if (!last.url) return;
    const a = document.createElement("a");
    a.href = last.url; a.download = last.fileName ?? "video.mp4";
    document.body.appendChild(a); a.click(); a.remove();
  };

  return (
    <main className="xo-main">
      <Confetti />
      <Preview view={view} src={last.url} />
      <section className="xo-info xo-done-info">
        <div className="xo-done-head">
        <div className="xo-badge" aria-hidden="true">
          <svg viewBox="0 0 120 120" width="88" height="88">
            {/* everything shares one centre (60, 60) so the ring, disc and tick line up */}
            <circle className="xo-badge-ring" cx="60" cy="60" r="54" fill="none" stroke="#080808" strokeWidth="5" strokeLinecap="round" pathLength={120} strokeDasharray="3 7" />
            <circle cx="62.5" cy="62.5" r="38" fill="#080808" />
            <circle cx="60" cy="60" r="38" fill="#D6FF36" stroke="#080808" strokeWidth="4" />
            <path className="xo-badge-tick" d="M43.5 61 L55 72.5 L77 48.5" fill="none" stroke="#080808" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <h2 className="xo-title">Your video is <span>ready!</span></h2>
          <p className="xo-sub">
            {savedTo ? <>Also saved as <b>{savedTo}</b> · </> : null}Saved to {last.where} · {last.size ? `${(last.size / 1e6).toFixed(1)} MB · ` : ""}made in {fmtTime(last.secs)}
          </p>
          <p className="xo-detail">{last.detail}</p>
        </div>
        </div>
        <div className="xo-actions">
          {canShare ? <button className="btn export xo-primary" onClick={() => void share()}><IconShare size={18} /> Share video</button> : null}
          {last.url && canPick ? <button className={`btn ${canShare ? "xo-ghost" : "export xo-primary"}`} onClick={() => void saveTo()}><IconDownload size={17} /> {savedTo ? "Save another copy" : "Save to a folder…"}</button> : null}
          {last.url && !canPick ? <button className={`btn ${canShare ? "xo-ghost" : "export xo-primary"}`} onClick={saveAgain}><IconDownload size={17} /> {last.onDisk ? "Save a copy" : "Download again"}</button> : null}
          <button className="btn xo-ghost" onClick={onClose}>Back to editor</button>
        </div>
        {last.watermark && !wm.unlocked ? (
          <p className="xo-wm">Want it without the watermark? <button className="linkish" onClick={() => { onClose(); setPanel("export"); setTimeout(() => document.querySelector(".wm-guide")?.scrollIntoView({ behavior: "smooth", block: "center" }), 400); }}>Get a free code</button></p>
        ) : null}
      </section>
    </main>
  );
}

/** Branded confetti: lime, ink, and the timeline's pastel track colours, bursting once. */
function Confetti() {
  const pieces = useMemo(() => {
    const colours = ["#D6FF36", "#080808", "#C9B8FF", "#8ED8F8", "#FFD166", "#FFA8A8", "#D6FF36"];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 46 }, (_, i) => ({
      left: rnd() * 100, delay: rnd() * 0.5, dur: 2.2 + rnd() * 1.6, rot: rnd() * 720 - 360, drift: rnd() * 160 - 80,
      color: colours[i % colours.length], shape: i % 3, size: 8 + rnd() * 9,
    }));
  }, []);
  return (
    <div className="xo-confetti" aria-hidden="true">
      {pieces.map((c, i) => (
        <i key={i} className={`s${c.shape}`} style={{ left: `${c.left}%`, width: c.size, height: c.shape === 1 ? c.size : c.size * 0.45, background: c.color, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`, ["--rot" as string]: `${c.rot}deg`, ["--drift" as string]: `${c.drift}px` } as React.CSSProperties} />
      ))}
    </div>
  );
}

/* ---------- failed ---------- */

function Failed({ view, onClose }: { view: ExportView; onClose: () => void }) {
  return (
    <main className="xo-main xo-fail">
      <section className="xo-info">
        <div className="xo-badge fail" aria-hidden="true">
          <svg viewBox="0 0 120 120" width="88" height="88">
            <circle cx="64" cy="64" r="38" fill="#080808" />
            <circle cx="60" cy="60" r="38" fill="#fff" stroke="#080808" strokeWidth="4" />
            <path d="M60 40v26M60 78v2" stroke="#D92D20" strokeWidth="9" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="xo-title">The export didn&apos;t finish</h2>
        <p className="xo-sub">{view.error}</p>
        <div className="xo-actions">
          {view.retry ? <button className="btn export xo-primary" onClick={view.retry}>Try again</button> : null}
          <button className="btn xo-ghost" onClick={onClose}>Back to editor</button>
        </div>
      </section>
    </main>
  );
}
