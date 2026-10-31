"use client";

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  StreamTarget,
  WavOutputFormat,
  OggOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type VideoSample,
  type AudioSample,
} from "mediabunny";
import { outputSize } from "./frame";
import { breathe } from "./livePreview";
import type { SourceFrame } from "./renderFrame";
import type { FrameSettings, Trim } from "./types";

export interface Waveform {
  /** Peak level 0..1 per bucket. */
  peaks: Float32Array;
  /** Buckets per second. */
  rate: number;
}

export interface AudioAnalysis {
  /** Mono soundtrack for transcription (Opus/Ogg, or 16 kHz WAV when Opus can't be encoded). */
  blob: Blob;
  name: string;
  kind: "opus" | "wav";
  /** Approximate upload size per second of audio. */
  bytesPerSec: number;
  /** Seconds. */
  duration: number;
  waveform: Waveform | null;
}

const WAVE_RATE = 100; // buckets per second

/** Collects peak levels from decoded samples as they stream past. */
class PeakTap {
  private peaks: number[] = [];
  private max = 1e-6;
  constructor(private rate = WAVE_RATE) {}
  add(sample: AudioSample) {
    const sr = sample.sampleRate;
    const frames = sample.numberOfFrames;
    const ch = sample.numberOfChannels;
    const buf = new Float32Array(frames);
    const t0 = sample.timestamp;
    for (let c = 0; c < ch; c++) {
      try {
        sample.copyTo(buf, { planeIndex: c, format: "f32-planar" });
      } catch {
        continue;
      }
      for (let i = 0; i < frames; i++) {
        const b = Math.floor((t0 + i / sr) * this.rate);
        if (b < 0) continue;
        const v = Math.abs(buf[i]);
        if (this.peaks[b] === undefined || v > this.peaks[b]) this.peaks[b] = v;
        if (v > this.max) this.max = v;
      }
    }
  }
  result(): Waveform | null {
    if (!this.peaks.length) return null;
    const out = new Float32Array(this.peaks.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.sqrt((this.peaks[i] ?? 0) / this.max);
    return { peaks: out, rate: this.rate };
  }
}

async function convertAudio(
  file: Blob,
  kind: "opus" | "wav",
  opts: { onProgress?: (p: number) => void; tap?: PeakTap; trim?: { start: number; end: number }; bitrate?: number } = {},
): Promise<Blob> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const target = new BufferTarget();
  const output = new Output({ format: kind === "opus" ? new OggOutputFormat() : new WavOutputFormat(), target });
  const tap = opts.tap;
  const conversion = await Conversion.init({
    input,
    output,
    video: { discard: true },
    trim: opts.trim,
    audio:
      kind === "opus"
        ? { numberOfChannels: 1, sampleRate: 48000, codec: "opus", bitrate: opts.bitrate ?? 48000, forceTranscode: true, ...(tap ? { process: (s: AudioSample) => (tap.add(s), s) } : {}) }
        : { numberOfChannels: 1, sampleRate: 16000, codec: "pcm-s16", forceTranscode: true, ...(tap ? { process: (s: AudioSample) => (tap.add(s), s) } : {}) },
    showWarnings: false,
  });
  if (!conversion.isValid) {
    throw new Error("Could not read audio from this video: " + conversion.discardedTracks.map((d) => d.reason).join(", "));
  }
  conversion.onProgress = (p) => opts.onProgress?.(p);
  await conversion.execute();
  return new Blob([target.buffer!], { type: kind === "opus" ? "audio/ogg" : "audio/wav" });
}

async function blobDuration(b: Blob): Promise<number> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(b) });
  try {
    return await input.computeDuration();
  } catch {
    return 0;
  }
}

/* One decode per video, shared by the waveform and transcription. */
const analyses = new WeakMap<Blob, Promise<AudioAnalysis>>();
const progressListeners = new WeakMap<Blob, Set<(p: number) => void>>();

/**
 * Decode the soundtrack once, entirely in the browser: produces the small
 * mono file sent for transcription AND the waveform peaks. The video never
 * leaves your computer. Calls made while a decode is running share it.
 */
export function analyzeAudio(file: File, onProgress?: (p: number) => void): Promise<AudioAnalysis> {
  if (onProgress) {
    let set = progressListeners.get(file);
    if (!set) progressListeners.set(file, (set = new Set()));
    set.add(onProgress);
  }
  let job = analyses.get(file);
  if (!job) {
    const report = (p: number) => progressListeners.get(file)?.forEach((fn) => fn(p));
    job = (async () => {
      let kind: "opus" | "wav" = "opus";
      let tap = new PeakTap();
      let blob: Blob;
      try {
        blob = await convertAudio(file, "opus", { onProgress: report, tap });
      } catch {
        kind = "wav";
        tap = new PeakTap();
        blob = await convertAudio(file, "wav", { onProgress: report, tap });
      }
      const waveform = tap.result();
      const duration = (await blobDuration(blob)) || (waveform ? waveform.peaks.length / waveform.rate : 0);
      return {
        blob,
        kind,
        name: kind === "opus" ? "audio.ogg" : "audio.wav",
        duration,
        bytesPerSec: duration > 0 ? blob.size / duration : kind === "opus" ? 6000 : 32000,
        waveform,
      };
    })();
    analyses.set(file, job);
    job.catch(() => analyses.delete(file)).finally(() => progressListeners.delete(file));
  }
  return job;
}

/** Soundtrack for transcription (shares the decode with the waveform). */
export async function extractAudio(file: File, onProgress?: (p: number) => void): Promise<{ blob: Blob; name: string }> {
  const a = await analyzeAudio(file, onProgress);
  return { blob: a.blob, name: a.name };
}

/** Audio peaks for drawing a waveform on the timeline (100 buckets per second). */
export async function computeWaveform(file: File): Promise<Waveform | null> {
  try {
    return (await analyzeAudio(file)).waveform;
  } catch (e) {
    console.warn("waveform failed", e);
    return null;
  }
}

/**
 * Cut [start, end) out of an extracted soundtrack, re-encoded small enough to upload.
 * Returns the piece and how far its time 0 is from the start of the original
 * (normally `start`; checked rather than assumed).
 */
export async function cutAudio(a: AudioAnalysis, start: number, end: number): Promise<{ blob: Blob; name: string; offset: number }> {
  const blob = await convertAudio(a.blob, a.kind, { trim: { start, end }, bitrate: 40000 });
  const d = await blobDuration(blob);
  // If the piece kept the original timestamps its duration would be ~end, not ~end-start.
  const offset = d > 0 && Math.abs(d - end) < Math.abs(d - (end - start)) ? 0 : start;
  return { blob, name: a.name, offset };
}

export type ExportQuality = "medium" | "high" | "very-high";

export interface ExportOptions {
  file: File;
  frame: FrameSettings;
  /** The part of the source to export (one clip). */
  trim: Trim;
  /** Short side of the output in px, or 0 for source resolution. */
  short: number;
  quality: ExportQuality;
  /** Draw output time t (0 = trim start) with the source frame. */
  render: (ctx: OffscreenCanvasRenderingContext2D, W: number, H: number, t: number, src: SourceFrame) => void;
  /** Where to write: a file on disk (see lib/saveSink.ts) or memory. */
  writable?: WritableStream;
  onProgress?: (p: number) => void;
  /** Called with the canvas after each frame is drawn (live preview). */
  onFrame?: (canvas: OffscreenCanvas, t: number) => void;
  signal?: AbortSignal;
}

/** Can this browser save straight to disk (Chrome/Edge desktop)? */
export const canSaveToDisk = () => typeof window !== "undefined" && "showSaveFilePicker" in window;

export async function pickSaveFile(name: string): Promise<FileSystemWritableFileStream | null> {
  if (!canSaveToDisk()) return null;
  const w = window as unknown as {
    showSaveFilePicker: (o: unknown) => Promise<{ createWritable: () => Promise<FileSystemWritableFileStream> }>;
  };
  const h = await w.showSaveFilePicker({
    suggestedName: name,
    types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
  });
  return h.createWritable();
}

/**
 * Burn the captions into the video, in the chosen frame shape, and return an
 * MP4 (or write it to the chosen file). Rendered on this device with WebCodecs.
 */
export async function exportVideo(opts: ExportOptions): Promise<Blob | null> {
  const { file, frame, trim } = opts;
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("This file has no video track.");
  const srcW = track.displayWidth;
  const srcH = track.displayHeight;
  const { w: outW, h: outH } = outputSize(srcW, srcH, frame.aspect, opts.short);

  const out = new OffscreenCanvas(outW, outH);
  const ctx = out.getContext("2d")!;
  let mid: OffscreenCanvas | null = null;
  let midCtx: OffscreenCanvasRenderingContext2D | null = null;

  const quality = opts.quality === "medium" ? QUALITY_MEDIUM : opts.quality === "very-high" ? QUALITY_VERY_HIGH : QUALITY_HIGH;
  const videoCodec = (await getFirstEncodableVideoCodec(["avc", "hevc", "vp9", "av1"], { width: outW, height: outH })) ?? "avc";
  const audioCodec = (await getFirstEncodableAudioCodec(["aac", "opus"])) ?? "aac";

  const target = opts.writable ? new StreamTarget(opts.writable, { chunked: true }) : new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: opts.writable ? false : "in-memory" }), target });

  const trimStart = Math.max(0, trim.start || 0);
  const trimEnd = trim.end && trim.end > trimStart ? trim.end : undefined;
  let firstTs: number | null = null;

  const conversion = await Conversion.init({
    input,
    output,
    trim: trimStart > 0 || trimEnd ? { start: trimStart, end: trimEnd } : undefined,
    video: {
      codec: videoCodec,
      bitrate: quality,
      forceTranscode: true,
      processedWidth: outW,
      processedHeight: outH,
      process: async (sample: VideoSample) => {
        await breathe(); // let the page paint and respond while exporting
        // 1) the frame upright (handles phone rotation metadata)
        const dw = sample.displayWidth;
        const dh = sample.displayHeight;
        if (!mid || mid.width !== dw || mid.height !== dh) {
          mid = new OffscreenCanvas(dw, dh);
          midCtx = mid.getContext("2d")!;
        }
        sample.drawWithFit(midCtx!, { fit: "fill" });
        // 2) the whole picture (frame shape, captions, layers, watermark) on the output timeline
        if (firstTs === null) firstTs = sample.timestamp;
        const shifted = trimStart > 0 && firstTs < trimStart - 0.5; // output timestamps restart at 0 after trimming
        const videoTime = sample.timestamp + (shifted ? trimStart : 0);
        ctx.clearRect(0, 0, outW, outH);
        const t = Math.max(0, videoTime - trimStart);
        opts.render(ctx, outW, outH, t, { image: mid!, w: dw, h: dh });
        opts.onFrame?.(out, t);
        return out;
      },
    },
    audio: { codec: audioCodec, bitrate: QUALITY_HIGH },
    showWarnings: false,
  });
  if (!conversion.isValid) {
    throw new Error("Export not possible in this browser: " + conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join(", "));
  }
  conversion.onProgress = (p) => opts.onProgress?.(p);
  opts.signal?.addEventListener("abort", () => void conversion.cancel());
  await conversion.execute();
  if (target instanceof BufferTarget) return new Blob([target.buffer!], { type: "video/mp4" });
  return null;
}

/** Save a finished export through the browser's download. */
/** "clip-captioned (2)-captioned" → "clip-captioned.mp4": never stacks the suffix on re-exports. */
export function exportFileName(name: string, ext: string): string {
  let base = (name || "video").trim();
  let prev = "";
  while (prev !== base) { prev = base; base = base.replace(/(?:[-_ ]captioned)(?:\s*\(\d+\))?$/i, "").trim(); }
  return `${base || "video"}-captioned.${ext}`;
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
