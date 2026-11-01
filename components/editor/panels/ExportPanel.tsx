"use client";
/** Video export (format, resolution, frame rate, quality), subtitles and project files. */
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../EditorContext";
import { Section, Select, Toggle } from "@/components/Controls";
import { BrandArt, ProgressIndicator } from "@/components/ui";
import { IconDownload } from "@/components/Icons";
import { WatermarkPanel } from "@/components/WatermarkPanel";
import { fetchUnlock } from "@/lib/watermark";
import { outputSize, platformById } from "@/lib/frame";
import { DEFAULT_EXPORT, migrate, serialiseClips, type ExportPrefs } from "@/lib/project";
import { download, toPlainText, toSRT, toVTT, toWordVTT } from "@/lib/subtitles";
import { displayWord } from "@/lib/translit";
import type { ProjectFile } from "@/lib/types";

function friendlyError(e: Error): string {
  const m = e.message || String(e);
  if (/QuotaExceeded|out of memory|allocation/i.test(m)) return "The browser ran out of memory. Turn on “Stream straight to a file”, choose a lower resolution, or close other tabs.";
  if (/encode|codec|VideoEncoder|not supported/i.test(m)) return `${m} Try the other format, a lower resolution, or Chrome/Edge on a computer.`;
  return m;
}

export function ExportPanel() {
  const ed = useEditor();
  const { doc, project, file, lines, srcDims, tl, exporter, wm, setWm, settings, setSettings, toast, name } = ed;
  const prefs: ExportPrefs = { ...DEFAULT_EXPORT, ...(doc.exportPrefs ?? {}) };
  const setPrefs = (p: Partial<ExportPrefs>) => project.update((d) => ({ ...d, exportPrefs: { ...DEFAULT_EXPORT, ...(d.exportPrefs ?? {}), ...p } }));
  // off by default: Export opens the branded screen straight away and you choose where to save at the end.
  // On, Chrome asks for the file first and streams into it (only needed for very long videos).
  const [saveToDisk, setSaveToDisk] = useState(false);
  const [canDisk, setCanDisk] = useState(false);
  const [webm, setWebm] = useState<boolean | null>(null);
  const [subsBilingual, setSubsBilingual] = useState(true);
  const projInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setCanDisk("showSaveFilePicker" in window);
    void import("mediabunny").then((m) => m.canEncodeVideo("vp9", { width: 1280, height: 720 })).then(setWebm).catch(() => setWebm(false));
  }, []);

  const outDims = srcDims.w ? outputSize(srcDims.w, srcDims.h, doc.frame.aspect, prefs.short) : null;
  const hasTranslations = Object.keys(doc.translations ?? {}).length > 0;
  const textOf = (w: Parameters<typeof displayWord>[0]) => displayWord(w, doc.style.script);
  const subOpts = { text: textOf, translations: subsBilingual && hasTranslations ? doc.translations : undefined, speakers: doc.speakers };

  /** A small still of the current frame for the export screen. */
  const snapshot = (): string | undefined => {
    try {
      const c = document.querySelector<HTMLCanvasElement>(".stage canvas");
      if (!c || !c.width) return undefined;
      const k = Math.min(1, 720 / Math.max(c.width, c.height));
      const t = document.createElement("canvas");
      t.width = Math.round(c.width * k); t.height = Math.round(c.height * k);
      t.getContext("2d")!.drawImage(c, 0, 0, t.width, t.height);
      return t.toDataURL("image/jpeg", 0.82);
    } catch { return undefined; }
  };

  const run = async () => {
    if (!window.isSecureContext) return toast({ kind: "error", title: "Export needs a secure address", message: "Open the app at http://localhost:3000 (or your https:// link) to export video." });
    if (!ed.canExport || exporter.exporting) return;
    ed.playback.pause();
    const unlock = await fetchUnlock();
    setWm(unlock);
    const withWm = !unlock.unlocked || settings.keepWatermark;
    if (wm.unlocked && !unlock.unlocked) toast({ kind: "warning", title: "Watermark code expired", message: "This export will include the watermark. Ask Harsh for a new code in Export → Watermark." });
    const dims = outDims ? `${outDims.w}×${outDims.h}` : undefined;
    const view = { thumb: snapshot(), ratio: outDims ? outDims.w / outDims.h : 9 / 16, format: prefs.format.toUpperCase(), dims, duration: tl.duration };
    ed.setExportView(view);
    try {
      const res = await exporter.run(
        { file, doc, clips: ed.clips, lines, outWords: ed.outWords, watermark: withWm ? { corner: settings.wmCorner } : null, name, saveToDisk: saveToDisk && canDisk, prefs },
        () => {},
      );
      if (!res) ed.setExportView(null); // save dialog cancelled
    } catch (e) {
      if ((e as Error).name === "AbortError") { ed.setExportView(null); toast({ kind: "info", title: "Export cancelled", duration: 2000 }); }
      else ed.setExportView({ ...view, error: friendlyError(e as Error), retry: () => { ed.setExportView(null); void run(); } });
    }
  };

  const saveProjectFile = () => {
    const p: ProjectFile & Record<string, unknown> = { app: "capmitra", version: 2, ...doc, clips: serialiseClips(doc.clips), videoName: ed.meta.videoName };
    download(`${name}.capmitra.json`, JSON.stringify(p, null, 2), "application/json");
    toast({ kind: "success", title: "Project file saved", message: "Open it on any computer with “Open project file”. Images and music stay on this device." });
  };

  const showWm = !wm.unlocked || settings.keepWatermark;
  const last = exporter.last;

  return (
    <>
      <Section title="Video">
        <Select label="Format" value={prefs.format} options={[{ value: "mp4", label: "MP4 (H.264 / HEVC), plays everywhere" }, { value: "webm", label: `WebM (VP9)${webm === false ? ", not supported here" : ""}` }]} onChange={(v) => setPrefs({ format: v })} />
        <Select label="Resolution" value={prefs.short} options={[
          { value: 0, label: "Same as original" }, { value: 2160, label: "4K (2160p)" }, { value: 1440, label: "1440p" },
          { value: 1080, label: "1080p (Reels, Shorts)" }, { value: 720, label: "720p" }, { value: 480, label: "480p" },
        ]} onChange={(v) => setPrefs({ short: v })} hint="never upscales beyond the source" />
        <Select label="Frame rate" value={prefs.fps} options={[{ value: 0, label: "Same as original" }, { value: 24, label: "24 fps (film)" }, { value: 25, label: "25 fps" }, { value: 30, label: "30 fps" }, { value: 50, label: "50 fps" }, { value: 60, label: "60 fps" }]} onChange={(v) => setPrefs({ fps: v })} />
        <Select label="Quality" value={prefs.quality} options={[{ value: "medium", label: "Medium (smaller file)" }, { value: "high", label: "High" }, { value: "very-high", label: "Very high" }]} onChange={(v) => setPrefs({ quality: v })} />
        {canDisk ? <Toggle label="Stream straight to a file" value={saveToDisk} onChange={setSaveToDisk} hint="only for very long videos; asks where to save before exporting" /> : null}
        <p className="muted">
          {outDims ? `${outDims.w}×${outDims.h}, ${platformById(doc.frame.platform).label}, ${tl.duration.toFixed(1)} s. ` : ""}
          Rendered on this device{doc.audio?.music ? " with your music" : ""}.
          {showWm ? (wm.unlocked ? " Includes your watermark." : " Includes the CapMitra watermark (see Watermark below).") : " No watermark."}
        </p>
        {exporter.exporting ? (
          <div className="export-progress">
            <ProgressIndicator value={exporter.progress ?? 0} label={`Exporting ${prefs.format.toUpperCase()}… ${Math.floor((exporter.progress ?? 0) * 100)}%`} />
            <button className="btn small" onClick={() => ed.setExportView(ed.exportView ?? { ratio: outDims ? outDims.w / outDims.h : 9 / 16, format: prefs.format.toUpperCase(), duration: tl.duration })}>Show progress</button>
          </div>
        ) : (
          <button className="btn export wide" disabled={!ed.canExport} onClick={() => void run()}>
            <IconDownload /> Export {prefs.format.toUpperCase()}
          </button>
        )}
        {!ed.canExport && !exporter.exporting ? <p className="muted">{ed.isEmpty ? "Add a video, captions or a title card first. Then you can export." : `Open this project's video first (${ed.meta.videoName || "the original file"}).`}</p> : null}
        {last && !exporter.exporting ? (
          <div className="done-card">
            <BrandArt kind="done" size={70} />
            <div>
              <strong>Export complete</strong> <button className="linkish" onClick={() => ed.setExportView({ ratio: outDims ? outDims.w / outDims.h : 9 / 16, format: prefs.format.toUpperCase(), duration: tl.duration })}>View</button>
              <p>{last.size ? `${(last.size / 1e6).toFixed(1)} MB` : "Saved"} in {last.secs} s, in {last.where}. {last.detail}</p>
              {last.watermark && !wm.unlocked ? <p className="wm-done">Want it without the watermark? <button className="linkish" onClick={() => document.querySelector(".wm-guide")?.scrollIntoView({ behavior: "smooth", block: "center" })}>See how to get a free code</button>.</p> : null}
            </div>
          </div>
        ) : null}
      </Section>

      <WatermarkPanel status={wm} onStatus={setWm} keep={settings.keepWatermark} onKeep={(v) => setSettings({ keepWatermark: v })} corner={settings.wmCorner} onCorner={(c) => setSettings({ wmCorner: c })} />

      <Section title="Subtitle files">
        {hasTranslations ? <Toggle label="Include the translation line" value={subsBilingual} onChange={setSubsBilingual} /> : null}
        <div className="row-btns wrap">
          <button className="btn small" disabled={!lines.length} onClick={() => { download(`${name}.srt`, toSRT(lines, 0, subOpts)); toast({ kind: "success", title: "SRT downloaded", duration: 2200 }); }}>SRT</button>
          <button className="btn small" disabled={!lines.length} onClick={() => { download(`${name}.vtt`, toVTT(lines, 0, subOpts), "text/vtt"); toast({ kind: "success", title: "VTT downloaded", duration: 2200 }); }}>VTT</button>
          <button className="btn small" disabled={!lines.length} onClick={() => { download(`${name}.words.vtt`, toWordVTT(lines, 0, subOpts), "text/vtt"); toast({ kind: "success", title: "Word-timed VTT downloaded", duration: 2200 }); }}>VTT with word timing</button>
          <button className="btn small" disabled={!lines.length} onClick={() => { download(`${name}.txt`, toPlainText(lines, subOpts)); toast({ kind: "success", title: "Text downloaded", duration: 2200 }); }}>Plain text</button>
        </div>
        <p className="muted">Timed to the edited video, written the way captions are shown ({doc.style.script && doc.style.script !== "native" ? "English letters" : "original script"}). UTF-8; SRT includes a byte-order mark for Windows apps.</p>
      </Section>

      <Section title="Project file">
        <div className="row-btns wrap">
          <button className="btn small" disabled={!doc.words.length && !doc.layers?.length} onClick={saveProjectFile}>Save project file</button>
          <button className="btn small ghost" onClick={() => projInput.current?.click()}>Open project file</button>
          <input ref={projInput} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void ed.openProjectFile(f); e.target.value = ""; }} />
        </div>
        <p className="muted">A small .json with captions, edits, graphics and styling, to move work to another computer or teammate.</p>
      </Section>
    </>
  );
}

export { migrate };
