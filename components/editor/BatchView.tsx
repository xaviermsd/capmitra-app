"use client";
/**
 * Batch captioning: drop many videos, choose one look + language (+ brand kit,
 * translation, smart tools), and caption them one after another with
 * per-video status, errors and retry. Each video becomes a normal project you
 * can open and fine-tune without losing the batch settings; "Export all"
 * renders every finished project with its own edits.
 *
 * Stays mounted while it runs, so closing the window doesn't stop the queue.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { elevenKeys, keyOptions } from "@/lib/settings";
import { useEditor } from "./EditorContext";
import { Section, Select, Toggle } from "@/components/Controls";
import { ProgressIndicator } from "@/components/ui";
import { IconArrowLeft, IconPlay, IconRefresh, IconStack, IconTrash, IconUpload, IconX, IconDownload, IconEdit } from "@/components/Icons";
import { blankRecord } from "./hooks/useProject";
import { withSpeakers } from "./hooks/useTranscription";
import { renderExport } from "./hooks/useExport";
import { TEMPLATES } from "@/lib/templates";
import { PRESETS, TRANSLATION_TARGETS, translationPlan } from "@/lib/languages";
import { applyBrandKit, listKits, getKit, type BrandKit } from "@/lib/brandkit";
import { clipsFromTrim, uid, type ProjectDoc } from "@/lib/project";
import { getProject, getProjectVideo, saveProject, saveProjectVideo, tx, type ProjectRecord } from "@/lib/library";
import { transcribeFile, TranscribeFileError } from "@/lib/transcribeFile";
import { applyRules, autoEmoji, autoKeywords, parseRules } from "@/lib/keywords";
import { deriveProject } from "@/lib/derive";
import { makeMeasure } from "@/lib/measure";
import { mergeTranslations, DEFAULT_SECONDARY } from "@/lib/bilingual";
import { baseWordId } from "@/lib/edl";
import { outputSize } from "@/lib/frame";
import { fetchUnlock } from "@/lib/watermark";
import type { CaptionStyle } from "@/lib/types";

type Status = "queued" | "working" | "done" | "error" | "exporting" | "exported";

interface Item {
  id: string;
  projectId: string;
  fileName: string;
  size: number;
  status: Status;
  stage?: string;
  progress?: number;
  error?: string;
  resumeKey?: string | null;
  words?: number;
}

interface Config {
  look: string; // "current" | template id | "preset:<id>"
  preset: string; // language preset id
  brandKitId: string;
  translateTo: string; // "" = off
  keywords: boolean;
  emoji: boolean;
}

interface BatchRecord { id: string; name: string; created: number; config: Config; items: Item[] }

const DEFAULT_CONFIG: Config = { look: "current", preset: "gu", brandKitId: "", translateTo: "", keywords: false, emoji: false };

async function videoDuration(f: Blob): Promise<number> {
  const u = URL.createObjectURL(f);
  try {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = u;
    await new Promise<void>((res) => { v.onloadedmetadata = () => res(); v.onerror = () => res(); });
    return Number.isFinite(v.duration) ? v.duration : 0;
  } finally {
    URL.revokeObjectURL(u);
  }
}

export function BatchView() {
  const ed = useEditor();
  const { showBatch, setShowBatch, batchSeed, setBatchSeed, settings, toast, presets, server } = ed;
  // the batch loop outlives renders: read the latest settings (e.g. which key works now)
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [batch, setBatch] = useState<BatchRecord | null>(null);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [running, setRunning] = useState(false);
  const files = useRef(new Map<string, File>());
  const stopRef = useRef(false);
  const batchRef = useRef(batch);
  batchRef.current = batch;
  const fileInput = useRef<HTMLInputElement>(null);

  // load the last batch and kits once opened
  const opened = useRef(false);
  useEffect(() => {
    if (!showBatch || opened.current) return;
    opened.current = true;
    void listKits().then(setKits);
    void tx<BatchRecord[]>("batches", "readonly", (s) => s.getAll()).then((all) => {
      const last = all.sort((a, b) => b.created - a.created)[0];
      if (last && !batchRef.current) setBatch({ ...last, items: last.items.map((i) => (i.status === "working" ? { ...i, status: "queued", stage: undefined } : i.status === "exporting" ? { ...i, status: "done" } : i)) });
    }).catch(() => {});
  }, [showBatch]);

  const persist = useCallback((b: BatchRecord) => { void tx("batches", "readwrite", (s) => s.put(b)).catch(() => {}); }, []);
  const update = useCallback((fn: (b: BatchRecord) => BatchRecord) => {
    setBatch((b) => { if (!b) return b; const n = fn(b); batchRef.current = n; persist(n); return n; });
  }, [persist]);
  const setItem = useCallback((id: string, p: Partial<Item>) => update((b) => ({ ...b, items: b.items.map((i) => (i.id === id ? { ...i, ...p } : i)) })), [update]);

  /* ---------- the look for new projects ---------- */
  const styleFor = (cfg: Config): CaptionStyle => {
    if (cfg.look === "current") return structuredClone(ed.doc.style);
    if (cfg.look.startsWith("preset:")) return structuredClone(presets.find((p) => p.id === cfg.look.slice(7)) ?? ed.doc.style);
    return structuredClone(TEMPLATES.find((t) => t.id === cfg.look) ?? ed.doc.style);
  };

  const buildDoc = async (cfg: Config, rec: ProjectRecord): Promise<ProjectRecord> => {
    const preset = PRESETS.find((p) => p.id === cfg.preset) ?? PRESETS[0];
    let doc: ProjectDoc = { ...rec, style: { ...styleFor(cfg), script: preset.script }, frame: ed.doc.frame, exportPrefs: ed.doc.exportPrefs };
    if (cfg.translateTo) doc.style.secondary = { ...(doc.style.secondary ?? DEFAULT_SECONDARY), enabled: true };
    if (cfg.brandKitId) {
      const kit = await getKit(cfg.brandKitId);
      if (kit) doc = applyBrandKit(doc, kit, clipsFromTrim(undefined, 0));
    }
    return { ...rec, ...doc };
  };

  /* ---------- adding files ---------- */
  const addFiles = useCallback(async (list: File[]) => {
    const vids = list.filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name));
    if (!vids.length) return;
    const b: BatchRecord = batchRef.current ?? { id: uid("b"), name: `Batch ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`, created: Date.now(), config: { ...DEFAULT_CONFIG, preset: PRESETS.find((p) => p.transcription === settings.language)?.id ?? "gu" }, items: [] };
    const added: Item[] = [];
    for (const f of vids) {
      const rec = blankRecord();
      rec.name = f.name.replace(/\.[^.]+$/, "");
      rec.videoName = f.name;
      rec.videoSize = f.size;
      rec.batchId = b.id;
      rec.duration = await videoDuration(f);
      const doc = await buildDoc(b.config, rec);
      await saveProject(doc);
      const saved = await saveProjectVideo(rec.id, f);
      if (!saved) toast({ kind: "warning", title: "Browser storage is full", message: `${f.name} will only be kept until you close this tab.` });
      const it: Item = { id: uid("i"), projectId: rec.id, fileName: f.name, size: f.size, status: "queued" };
      files.current.set(it.id, f);
      added.push(it);
    }
    const next = { ...b, items: [...b.items, ...added] };
    batchRef.current = next;
    setBatch(next);
    persist(next);
    toast({ kind: "success", title: `${added.length} video${added.length === 1 ? "" : "s"} added`, message: "Choose the look and language, then start.", duration: 2500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.language, toast, persist, ed.doc]);

  useEffect(() => {
    if (!batchSeed.length) return;
    const seed = batchSeed;
    setBatchSeed([]);
    void addFiles(seed);
  }, [batchSeed, setBatchSeed, addFiles]);

  /* ---------- processing ---------- */
  const fileFor = async (it: Item): Promise<File | null> => files.current.get(it.id) ?? (await getProjectVideo(it.projectId));

  const processItem = async (it: Item, cfg: Config) => {
    const f = await fileFor(it);
    if (!f) throw new TranscribeFileError("The video isn't stored in this browser any more. Remove this item and add the video again.", null);
    const preset = PRESETS.find((p) => p.id === cfg.preset) ?? PRESETS[0];
    const terms = settings.useKeyterms ? settings.keyterms.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) : [];
    const r = await transcribeFile(f, {
      language: preset.transcription, model: settings.model, keyterms: terms, diarize: settings.diarize,
      ...keyOptions(settingsRef.current, ed.setSettings, (m) => toast({ kind: "info", ...m, duration: 6000 })),
      resumeKey: it.resumeKey ?? null,
      onStage: ({ label, progress }) => setItem(it.id, { stage: label, progress }),
    });
    const rec = await getProject(it.projectId);
    if (!rec) throw new Error("The project was deleted.");
    const { words } = applyRules(r.words, parseRules(settings.rules));
    let doc: ProjectRecord = { ...rec, words, language: r.language ?? rec.language, speakers: withSpeakers(words, rec.speakers), updated: Date.now() };
    const aspect = (() => { const o = outputSize(1080, 1920, doc.frame.aspect, 0); return o.w / o.h; })();
    let derived = deriveProject(doc, doc.duration ?? 0, { measure: makeMeasure(doc.style), aspect });
    const srcLines = () => derived.lines.map((l) => ({ ...l, words: l.words.map((w) => ({ ...w, id: baseWordId(w.id) })) }));
    if (cfg.keywords) doc = { ...doc, words: autoKeywords(doc.words, srcLines()) };
    if (cfg.emoji) doc = { ...doc, words: autoEmoji(doc.words, srcLines()) };
    if (cfg.translateTo) {
      const plan = translationPlan(doc.language ?? preset.transcription, cfg.translateTo);
      if (plan && (settings.sarvamKey || server.serverSarvam)) {
        setItem(it.id, { stage: "Translating…", progress: undefined });
        derived = deriveProject(doc, doc.duration ?? 0, { measure: makeMeasure(doc.style), aspect });
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "content-type": "application/json", ...(settings.sarvamKey ? { "x-sarvam-key": settings.sarvamKey } : {}) },
          body: JSON.stringify({ texts: derived.lines.map((l) => l.words.map((w) => w.text).join(" ")), source: plan.source, target: cfg.translateTo, model: plan.model, mode: settings.translateMode }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) doc = { ...doc, translations: mergeTranslations(derived.lines, undefined, (data.translations as string[]).map((text, i) => ({ line: derived.lines[i], text })), cfg.translateTo) };
        else toast({ kind: "warning", title: `${it.fileName}: translation skipped`, message: data.error ?? `HTTP ${res.status}` });
      }
    }
    await saveProject(doc);
    return words.length;
  };

  const run = async () => {
    const b = batchRef.current;
    if (!b || running) return;
    if (!elevenKeys(settings).length && !server.serverElevenLabs) {
      toast({ kind: "warning", title: "Add your ElevenLabs key first", action: { label: "Open Settings", onClick: () => { setShowBatch(false); ed.openKeySetup(); } } });
      return;
    }
    stopRef.current = false;
    setRunning(true);
    try {
      for (;;) {
        if (stopRef.current) break;
        const it = batchRef.current?.items.find((i) => i.status === "queued");
        if (!it) break;
        setItem(it.id, { status: "working", stage: "Starting…", error: undefined });
        try {
          const n = await processItem(it, batchRef.current!.config);
          setItem(it.id, { status: "done", stage: undefined, progress: undefined, words: n, resumeKey: null });
        } catch (e) {
          const err = e as TranscribeFileError;
          setItem(it.id, { status: "error", stage: undefined, error: err.message, resumeKey: err.resumeKey ?? null });
          if (err.status === 401) { toast({ kind: "error", title: "Your ElevenLabs key was refused", message: "The batch stopped. Fix the key in Settings and press Start again." }); break; }
        }
      }
    } finally {
      setRunning(false);
      const done = batchRef.current?.items.filter((i) => i.status === "done").length ?? 0;
      if (!stopRef.current) toast({ kind: "success", title: "Batch finished", message: `${done} of ${batchRef.current?.items.length ?? 0} videos captioned.` });
    }
  };

  const reapply = async () => {
    const b = batchRef.current;
    if (!b) return;
    const ok = await ed.dialog.confirm({ title: "Apply the batch look to every video?", message: "Caption look, script, frame and brand kit are re-applied. Words, cuts and graphics you added stay.", confirmLabel: "Apply to all" });
    if (!ok) return;
    for (const it of b.items) {
      const rec = await getProject(it.projectId);
      if (!rec) continue;
      const preset = PRESETS.find((p) => p.id === b.config.preset) ?? PRESETS[0];
      let doc: ProjectDoc = { ...rec, style: { ...styleFor(b.config), script: preset.script, secondary: rec.style.secondary } };
      if (b.config.brandKitId) { const kit = await getKit(b.config.brandKitId); if (kit) doc = applyBrandKit(doc, kit, rec.clips ?? clipsFromTrim(rec.trim, rec.duration ?? 0)); }
      await saveProject({ ...rec, ...doc, updated: Date.now() });
    }
    toast({ kind: "success", title: "Look applied to every video in the batch" });
  };

  const exportAll = async () => {
    const b = batchRef.current;
    if (!b) return;
    const ready = b.items.filter((i) => i.status === "done" || i.status === "exported");
    if (!ready.length) return;
    if (!window.isSecureContext) return toast({ kind: "error", title: "Export needs a secure address", message: "Open the app at http://localhost:3000 or your https:// link." });
    let dir: FileSystemDirectoryHandle | null = null;
    if ("showDirectoryPicker" in window) {
      try { dir = await (window as unknown as { showDirectoryPicker: (o: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: "readwrite" }); }
      catch (e) { if ((e as Error).name === "AbortError") return; }
    }
    const unlock = await fetchUnlock();
    const withWm = !unlock.unlocked || settings.keepWatermark;
    setRunning(true);
    stopRef.current = false;
    const media = await import("@/lib/media");
    try {
      for (const it of ready) {
        if (stopRef.current) break;
        const rec = await getProject(it.projectId);
        const f = await fileFor(it);
        if (!rec || !f) { setItem(it.id, { status: "error", error: "Project or video missing." }); continue; }
        setItem(it.id, { status: "exporting", stage: "Exporting…", progress: 0 });
        try {
          const aspect = (() => { const o = outputSize(1080, 1920, rec.frame.aspect, 0); return o.w / o.h; })();
          const d = deriveProject(rec, rec.duration ?? (await videoDuration(f)), { measure: makeMeasure(rec.style), aspect });
          const ext = (rec.exportPrefs?.format ?? "mp4") === "webm" ? "webm" : "mp4";
          const fileName = media.exportFileName(rec.name, ext);
          let writable: FileSystemWritableFileStream | null = null;
          if (dir) writable = await (await dir.getFileHandle(fileName, { create: true })).createWritable();
          const r = await renderExport(
            { file: f, doc: rec, clips: d.clips, lines: d.lines, outWords: d.outWords, watermark: withWm ? { corner: settings.wmCorner } : null },
            { writable, onProgress: (p) => setItem(it.id, { progress: p }) },
          );
          if (r.blob) media.downloadBlob(fileName, r.blob); // a chosen file is already saved by renderExport
          setItem(it.id, { status: "exported", stage: undefined, progress: undefined });
        } catch (e) {
          setItem(it.id, { status: "error", stage: undefined, error: `Export failed: ${(e as Error).message}` });
        }
      }
    } finally {
      setRunning(false);
      toast({ kind: "success", title: "Batch export finished", message: dir ? "Saved to the folder you chose." : "Saved to your Downloads folder." });
    }
  };

  if (!showBatch && !running) return null;
  const items = batch?.items ?? [];
  const cfg = batch?.config ?? DEFAULT_CONFIG;
  const setCfg = (p: Partial<Config>) => {
    if (!batchRef.current) { const b: BatchRecord = { id: uid("b"), name: "Batch", created: Date.now(), config: { ...cfg, ...p }, items: [] }; batchRef.current = b; setBatch(b); persist(b); }
    else update((b) => ({ ...b, config: { ...b.config, ...p } }));
  };
  const counts = { done: items.filter((i) => i.status === "done" || i.status === "exported").length, err: items.filter((i) => i.status === "error").length, queued: items.filter((i) => i.status === "queued").length };
  const overall = items.length ? (counts.done + counts.err) / items.length : 0;

  return (
    <div className="batch-page" role="dialog" aria-modal="true" aria-labelledby="batch-title" hidden={!showBatch}>
      <header className="pp-head">
        <button className="btn ghost" onClick={() => setShowBatch(false)} data-tip={running ? "Keeps running in the background" : "Back to the editor"}><IconArrowLeft /> <span className="lbl">Editor</span></button>
        <h1 id="batch-title"><IconStack size={22} /> Batch captions</h1>
        <button className="btn" onClick={() => fileInput.current?.click()}><IconUpload /> Add videos</button>
        <input ref={fileInput} type="file" accept="video/*,.mp4,.mov,.webm,.mkv" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(Array.from(e.target.files)); e.target.value = ""; }} />
      </header>

      <div className="batch-grid">
        <aside className="batch-config">
          <Section title="For every video">
            <Select label="Caption look" value={cfg.look} options={[{ value: "current", label: "Same as the open project" }, ...TEMPLATES.map((t) => ({ value: t.id, label: `Template: ${t.name}` })), ...presets.map((p) => ({ value: `preset:${p.id}`, label: `My preset: ${p.name}` }))]} onChange={(v) => setCfg({ look: v })} />
            <Select label="Language" value={cfg.preset} options={PRESETS.map((p) => ({ value: p.id, label: `${p.label} – ${p.note}` }))} onChange={(v) => setCfg({ preset: v })} />
            <Select label="Brand kit" value={cfg.brandKitId} options={[{ value: "", label: "None" }, ...kits.map((k) => ({ value: k.id, label: k.name }))]} onChange={(v) => setCfg({ brandKitId: v })} />
            <Select label="Second line" value={cfg.translateTo} options={[{ value: "", label: "No translation" }, ...TRANSLATION_TARGETS.map((t) => ({ value: t.code, label: `Translate to ${t.name}` }))]} onChange={(v) => setCfg({ translateTo: v })} hint={cfg.translateTo && !settings.sarvamKey && !server.serverSarvam ? "needs a Sarvam key (Settings)" : undefined} />
            <Toggle label="Highlight keywords" value={cfg.keywords} onChange={(v) => setCfg({ keywords: v })} />
            <Toggle label="Add emoji" value={cfg.emoji} onChange={(v) => setCfg({ emoji: v })} />
            <p className="muted">Applies to videos added from now on. Use “Apply look to all” to update videos already in the batch. Each video is saved as a project you can open and edit on its own.</p>
          </Section>
          <div className="batch-actions">
            {running ? (
              <button className="btn wide" onClick={() => { stopRef.current = true; }}><IconX /> Stop after this video</button>
            ) : (
              <button className="btn primary wide" disabled={!counts.queued} onClick={() => void run()}><IconPlay /> {counts.queued ? `Caption ${counts.queued} video${counts.queued === 1 ? "" : "s"}` : "Nothing queued"}</button>
            )}
            <button className="btn wide" disabled={running || !counts.done} onClick={() => void exportAll()}><IconDownload /> Export all finished</button>
            <button className="btn ghost wide" disabled={running || !items.length} onClick={() => void reapply()}>Apply look to all</button>
          </div>
        </aside>

        <section className="batch-list" aria-live="polite">
          {items.length ? (
            <>
              <ProgressIndicator value={overall} label={`${counts.done} done${counts.err ? `, ${counts.err} need attention` : ""}${counts.queued ? `, ${counts.queued} waiting` : ""}`} />
              <ul>
                {items.map((it) => (
                  <li key={it.id} className={`batch-row ${it.status}`}>
                    <span className={`batch-dot ${it.status}`} aria-hidden="true" />
                    <div className="batch-main">
                      <b>{it.fileName}</b>
                      <em>
                        {it.status === "queued" ? "Waiting" : it.status === "working" || it.status === "exporting" ? it.stage ?? "Working…" : it.status === "done" ? `Captioned · ${it.words ?? 0} words` : it.status === "exported" ? "Exported" : it.error}
                        {` · ${(it.size / 1e6).toFixed(1)} MB`}
                      </em>
                      {(it.status === "working" || it.status === "exporting") ? <ProgressIndicator value={it.progress} /> : null}
                    </div>
                    {it.status === "error" ? <button className="btn small" onClick={() => setItem(it.id, { status: "queued", error: undefined })}><IconRefresh size={14} /> {it.resumeKey ? "Resume" : "Retry"}</button> : null}
                    {it.status === "done" || it.status === "exported" ? <button className="btn small ghost" onClick={() => void ed.openProject(it.projectId)}><IconEdit size={14} /> Open</button> : null}
                    <button className="btn icon small ghost" disabled={it.status === "working" || it.status === "exporting"} aria-label={`Remove ${it.fileName} from the batch`} onClick={() => update((b) => ({ ...b, items: b.items.filter((x) => x.id !== it.id) }))}><IconTrash size={14} /></button>
                  </li>
                ))}
              </ul>
              <button className="btn small ghost" disabled={running} onClick={async () => {
                if (await ed.dialog.confirm({ title: "Start a new batch?", message: "The current list is cleared. Its projects stay in Projects.", confirmLabel: "New batch" })) { files.current.clear(); setBatch(null); batchRef.current = null; }
              }}>New batch</button>
            </>
          ) : (
            <div className="batch-empty" onClick={() => fileInput.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && fileInput.current?.click()}>
              <IconStack size={40} />
              <h2>Drop several videos here</h2>
              <p>They&apos;re captioned one after another with the same look and language. You can keep editing while it runs.</p>
              <button className="btn primary"><IconUpload /> Choose videos</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
