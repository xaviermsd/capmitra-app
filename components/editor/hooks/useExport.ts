"use client";
/**
 * MP4 / WebM export: prepares fonts, images and music, picks the fast
 * single-pass path for simple projects or the edit-list engine otherwise,
 * and reports progress, cancellation and actionable errors.
 */
import { resolveVoice } from "@/lib/voice/presets";
import { useCallback, useRef, useState } from "react";
import { ensureFontsFor, nearestWeight } from "@/lib/fonts";
import { loadSegmenter } from "@/lib/segment";
import { displayWord } from "@/lib/translit";
import { isTrivial } from "@/lib/edl";
import { preloadAssetImages, preloadLayerImages } from "@/lib/layers";
import { preloadBackgrounds, renderFrame, type Scene } from "@/lib/renderFrame";
import { ensureAssets, decodeAudioAsset, assetFile } from "@/lib/assets";
import { loadWatermark } from "@/lib/watermark";
import { saveSink } from "@/lib/saveSink";
import { publishFrame, resetLive } from "@/lib/livePreview";
import { DEFAULT_AUDIO, DEFAULT_EXPORT, type Clip, type ExportPrefs, type ProjectDoc } from "@/lib/project";
import type { CaptionLine, Word } from "@/lib/types";

export interface ExportInput {
  file: File | null;
  doc: ProjectDoc;
  clips: Clip[];
  /** Output-time captions and words. */
  lines: CaptionLine[];
  outWords: Word[];
  watermark: { corner: import("@/lib/watermark").WatermarkCorner } | null;
  name: string;
  prefs?: ExportPrefs;
  saveToDisk: boolean;
}

export interface LastExport {
  size?: number; secs: number; where: string; watermark?: boolean; detail: string;
  /** Object URL of the finished video (when it was kept in memory), for the success screen's preview and share. */
  url?: string; fileName?: string; mime?: string;
  /** Already written to a file the person chose (so no "Save again" needed). */
  onDisk?: boolean;
}

/** Where an export is: shown as steps on the export screen. */
export type ExportStage = "prepare" | "render" | "finish" | "save";

/** Everything the frames will draw must be loaded first; otherwise canvas silently falls back. */
export async function prepareAssets(doc: ProjectDoc, lines: CaptionLine[], withWatermark: boolean): Promise<void> {
  const style = doc.style;
  const capText = lines.map((l) => l.words.map((w) => displayWord(w, style.script)).join(" ")).join(" ");
  const trText = Object.values(doc.translations ?? {}).map((t) => t.text).join(" ");
  const jobs: [string, number, string][] = [[style.font, style.weight, capText || "abc"]];
  for (const o of Object.values(doc.overrides)) if (o.font) jobs.push([o.font, style.weight, capText]);
  // accent (★ words) and per-row fonts must be loaded too
  const emText = lines.flatMap((l) => l.words.filter((w) => w.emphasis).map((w) => displayWord(w, style.script))).join(" ");
  if (style.accent?.font && emText) jobs.push([style.accent.font, style.accent.weight ?? style.weight, emText]);
  for (const r of style.rows ?? []) if (r.font) jobs.push([r.font, r.weight ?? style.weight, capText || "abc"]);
  if (style.secondary?.enabled && trText) jobs.push([style.secondary.font ?? style.font, style.secondary.weight ?? Math.min(style.weight, 600), trText]);
  for (const l of doc.layers ?? []) {
    const txt = [l.text, l.subtitle, l.speaker ? doc.speakers?.[l.speaker]?.name : ""].filter(Boolean).join(" ");
    if (txt) jobs.push([l.font ?? "Anek Gujarati", l.weight ?? 700, txt]);
  }
  for (const c of doc.clips ?? []) {
    if (c.kind === "card" && (c.title || c.subtitle)) {
      jobs.push([c.font ?? "Anek Gujarati", 800, c.title ?? ""]);
      jobs.push([c.font ?? "Anek Gujarati", 500, c.subtitle ?? ""]);
    }
  }
  for (const [fam, w, text] of jobs) {
    if (!text.trim()) continue;
    const missing = await ensureFontsFor(fam, w, text);
    if (missing.length) {
      throw new Error(`The font “${fam}” (weight ${nearestWeight(fam, w)}) couldn't be loaded for ${missing.join(", ")} text, so it would export in a different font. Check your internet connection and try again.`);
    }
  }
  if (style.accent?.italic && emText) await document.fonts.load(`italic ${nearestWeight(style.accent.font ?? style.font, style.accent.weight ?? style.weight)} 40px "${style.accent.font ?? style.font}"`, emText).catch(() => undefined);
  for (const r of style.rows ?? []) if (r.italic) await document.fonts.load(`italic ${nearestWeight(r.font ?? style.font, r.weight ?? style.weight)} 40px "${r.font ?? style.font}"`, capText || "abc").catch(() => undefined);
  if (style.behindSubject && !(await loadSegmenter())) throw new Error("“Captions behind the person” couldn't start in this browser. Turn it off in Style, or try Chrome or Edge.");
  await document.fonts.ready;
  if (withWatermark) await loadWatermark();
  const clipMedia = (doc.clips ?? []).flatMap((c) => (c.kind === "image" ? [c.assetId] : c.kind === "video" && c.sourceId ? [c.sourceId] : []));
  const missingAssets = await ensureAssets([...(doc.layers ?? []).map((l) => l.assetId), doc.audio?.music?.assetId, ...clipMedia]);
  if (missingAssets.length) throw new Error("Some images, videos or music used in this project are missing from this browser. Re-add them in the Graphics, Edit or Audio panel.");
  const failed = await preloadLayerImages(doc.layers ?? []);
  if (failed.length) throw new Error(`These graphics couldn't be loaded: ${failed.join(", ")}.`);
  const failedClips = await preloadAssetImages((doc.clips ?? []).flatMap((c) => (c.kind === "image" ? [c.assetId] : [])));
  if (failedClips.length) throw new Error("An image clip couldn't be loaded. Replace it in the Edit panel.");
  await preloadBackgrounds((doc.clips ?? []).map((c) => (c.kind === "card" ? c.background : undefined)));
}

export interface RenderOptions {
  writable?: FileSystemWritableFileStream | null;
  signal?: AbortSignal;
  onProgress?: (p: number) => void;
  onStage?: (s: ExportStage) => void;
  /** Mirror each finished frame to the export screen. */
  livePreview?: boolean;
}

/** Share of the bar for drawing frames; the rest is finalising and saving, so 100 % really means done. */
const RENDER_SHARE = 0.96;

/**
 * Render a project to a video. Returns the blob (null when written to `writable`).
 * With `writable`, the file is committed to disk here, only after the video is
 * fully finalised; on error or cancel the partial file is discarded.
 * Shared by the editor, batch export and Shorts.
 */
export async function renderExport(inp: Omit<ExportInput, "saveToDisk" | "name">, o: RenderOptions = {}): Promise<{ blob: Blob | null; detail: string; ext: string }> {
  const sink = o.writable ? saveSink(o.writable) : null;
  try {
    const r = await renderToTarget(inp, o, sink?.stream);
    o.onStage?.("save");
    o.onProgress?.(0.985);
    await sink?.commit(); // the file exists on disk from here
    return r;
  } catch (e) {
    await sink?.discard();
    throw e;
  }
}

async function renderToTarget(inp: Omit<ExportInput, "saveToDisk" | "name">, o: RenderOptions, stream: WritableStream | undefined): Promise<{ blob: Blob | null; detail: string; ext: string }> {
  const prefs = { ...DEFAULT_EXPORT, ...(inp.prefs ?? inp.doc.exportPrefs ?? {}) };
  const ext = prefs.format === "webm" ? "webm" : "mp4";
  const media = await import("@/lib/media");
  o.onStage?.("prepare");
  await prepareAssets(inp.doc, inp.lines, !!inp.watermark);
  o.onStage?.("render");
  const { buildTimeline } = await import("@/lib/edl");
  const tl = buildTimeline(inp.clips);
  const sceneAt = (W: number, H: number, t: number): Scene => ({
    W, H, t, tl, frame: inp.doc.frame, lines: inp.lines, style: inp.doc.style, overrides: inp.doc.overrides,
    translations: inp.doc.translations, layers: inp.doc.layers, captionZ: inp.doc.captionZ, speakers: inp.doc.speakers,
    watermark: inp.watermark, effects: inp.doc.effects,
  });
  let finishing = false;
  const progress = (p: number) => {
    // frames done: the encoder and muxer are now closing the file
    if (p >= 0.995 && !finishing) { finishing = true; o.onStage?.("finish"); }
    o.onProgress?.(Math.min(p, 1) * RENDER_SHARE);
  };
  const onFrame = o.livePreview ? publishFrame : undefined;
  const audio = { ...DEFAULT_AUDIO, ...(inp.doc.audio ?? {}) };
  const first = inp.clips[0];
  const simple =
    isTrivial(inp.clips) && !!inp.file && prefs.format === "mp4" && !prefs.fps && !audio.music && !inp.doc.sounds?.length &&
    audio.volume === 1 && !audio.fadeIn && !audio.fadeOut && !audio.muted && !resolveVoice(audio.voice) && first?.kind === "video" && (first.volume ?? 1) === 1 && !first.speed;
  if (simple && first.kind === "video") {
    const blob = await media.exportVideo({
      file: inp.file!, frame: inp.doc.frame, trim: { start: first.srcStart, end: Number.isFinite(first.srcEnd) ? first.srcEnd : null },
      short: prefs.short, quality: prefs.quality, writable: stream, signal: o.signal, onProgress: progress, onFrame,
      render: (ctx, W, H, t, src) => { renderFrame(ctx, sceneAt(W, H, t), src); },
    });
    if (!finishing) o.onStage?.("finish");
    return { blob, detail: "MP4", ext };
  }
  const { exportEdited } = await import("@/lib/exportEngine");
  // extra videos added as clips
  const sources = new Map<string, File>();
  for (const c of inp.clips) {
    if (c.kind !== "video" || !c.sourceId || sources.has(c.sourceId)) continue;
    const f = await assetFile(c.sourceId);
    if (!f) throw new Error(`The video “${c.name ?? "clip"}” is missing from this browser. Add it again in the Edit panel.`);
    sources.set(c.sourceId, f);
  }
  const music = audio.music ? await decodeAudioAsset(audio.music.assetId) : null;
  const sounds = await Promise.all((inp.doc.sounds ?? []).map(async (x) => ({ start: x.start, volume: x.volume, buffer: await decodeAudioAsset(x.assetId) })));
  const r = await exportEdited({
    file: inp.file, sources, clips: inp.clips, aspect: inp.doc.frame.aspect, short: prefs.short, quality: prefs.quality, fps: prefs.fps,
    format: prefs.format, render: (ctx, W, H, t, src) => { renderFrame(ctx, sceneAt(W, H, t), src); },
    audio, speech: inp.outWords, music, sounds, writable: stream, onProgress: progress, onFrame, signal: o.signal,
    fallbackSize: inp.doc.frame.aspect === "16:9" ? { w: 1920, h: 1080 } : inp.doc.frame.aspect === "1:1" ? { w: 1080, h: 1080 } : { w: 1080, h: 1920 },
  });
  if (!finishing) o.onStage?.("finish");
  return { blob: r.blob, detail: `${r.width}×${r.height}, ${r.fps} fps, ${r.videoCodec.toUpperCase()}${r.audioCodec ? ` + ${r.audioCodec.toUpperCase()}` : ""}`, ext };
}

export function useExport() {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState<ExportStage>("prepare");
  const [startedAt, setStartedAt] = useState(0);
  const [last, setLastState] = useState<LastExport | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  /** Replace the finished export (frees the previous preview's memory). */
  const setLast = useCallback((l: LastExport | null) => setLastState((old) => { if (old?.url && old.url !== l?.url) URL.revokeObjectURL(old.url); return l; }), []);

  const run = useCallback(async (inp: ExportInput, onProgress: (p: number) => void): Promise<LastExport | null> => {
    const prefs = { ...DEFAULT_EXPORT, ...(inp.prefs ?? inp.doc.exportPrefs ?? {}) };
    const media = await import("@/lib/media");
    const ext = prefs.format === "webm" ? "webm" : "mp4";
    const fileName = media.exportFileName(inp.name, ext);
    let writable: FileSystemWritableFileStream | null = null;
    let handle = null as { getFile?: () => Promise<File> } | null;
    if (inp.saveToDisk && media.canSaveToDisk()) {
      try {
        const w = window as unknown as { showSaveFilePicker: (o: unknown) => Promise<{ createWritable: () => Promise<FileSystemWritableFileStream> }> };
        const h = await w.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: ext.toUpperCase() + " video", accept: { [`video/${ext}`]: [`.${ext}`] } }],
        });
        handle = h as unknown as { getFile?: () => Promise<File> };
        writable = await h.createWritable();
      } catch (e) {
        if ((e as Error).name === "AbortError") return null;
      }
    }
    setLast(null);
    setStage("prepare");
    setStartedAt(Date.now());
    setExporting(true);
    setProgress(0);
    const ac = new AbortController();
    abortRef.current = ac;
    const t0 = performance.now();
    try {
      resetLive();
      const report = (p: number) => { setProgress(p); onProgress(p); };
      // renderExport commits the chosen file itself, only once the video is complete
      const { blob, detail } = await renderExport(inp, { writable, signal: ac.signal, onStage: setStage, onProgress: report, livePreview: true });
      setStage("save");
      if (blob) media.downloadBlob(fileName, blob);
      // the saved file itself, for the success screen's preview and Share (read lazily, not copied into memory)
      let saved: Blob | null = blob;
      if (!saved && handle?.getFile) { try { saved = await handle.getFile(); } catch { saved = null; } }
      report(1);
      const res: LastExport = {
        size: saved?.size, secs: Math.round((performance.now() - t0) / 1000), where: blob ? "your Downloads folder" : "the file you chose", watermark: !!inp.watermark, detail,
        url: saved ? URL.createObjectURL(saved) : undefined, fileName, mime: saved?.type || `video/${ext}`, onDisk: !blob,
      };
      setLast(res);
      return res;
    } catch (e) {
      if (ac.signal.aborted || (e as Error).name === "AbortError") throw new DOMException("Export cancelled", "AbortError");
      throw e;
    } finally {
      setExporting(false);
      setProgress(null);
      resetLive();
      abortRef.current = null;
    }
  }, [setLast]);

  return { run, cancel, exporting, progress, stage, startedAt, last, setLast };
}
