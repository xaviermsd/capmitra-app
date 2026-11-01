"use client";
/**
 * Export with an edit list: cuts, reordering, title cards, transitions,
 * graphics layers and background music, rendered frame by frame on this device.
 *
 *   video  each output frame → source frame (VideoSampleSink) → renderFrame() → encoder
 *   audio  mixed in short windows with OfflineAudioContext (original sound with
 *          clip volumes / fades / transition dips, plus music with fades and
 *          ducking under speech), using the same gain formulas as the preview
 *
 * Audio and video are fed window by window so the muxer never has to hold a
 * whole track in memory. Simple projects (one clip, no music) keep using the
 * faster single-pass path in lib/media.ts.
 */
import { createVoiceProcessor, processVoiceBuffer, type VoiceProcessor } from "./voice/engine";
import {
  ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, CanvasSource, Input, Mp4OutputFormat, Output,
  QUALITY_HIGH, QUALITY_MEDIUM, QUALITY_VERY_HIGH, StreamTarget, VideoSampleSink, WebMOutputFormat,
  getFirstEncodableAudioCodec, getFirstEncodableVideoCodec, type AudioCodec, type VideoCodec,
} from "mediabunny";
import { buildTimeline, speedOf, srcAt, type EditTimeline } from "./edl";
import { timeStretch } from "./timeStretch";
import { breathe } from "./livePreview";
import { outputSize } from "./frame";
import { LIMITER_RANGE, limiterCurve, musicGainAt, musicTimeAt, sourceGainAt, speechAt } from "./audioMix";
import { isMainVideo, type AudioSettings, type Clip, type ExportFormat, type VideoClip } from "./project";
import type { EdgeFrames, SourceFrame } from "./renderFrame";
import { edgeKey, edgeRequests, edgeTime } from "./transitions";
import type { AspectId, Word } from "./types";

type Ctx = OffscreenCanvasRenderingContext2D;

export interface ExportJob {
  /** The main video (captions follow it). */
  file: File | null;
  /** Extra videos added as clips, by asset id. */
  sources?: Map<string, File>;
  clips: Clip[];
  aspect: AspectId;
  /** Short side in px, 0 = source. */
  short: number;
  quality: "medium" | "high" | "very-high";
  /** 0 = same as source (or 30 without video). */
  fps: number;
  format: ExportFormat;
  /** Frame size to use when there is no source video (cards only). */
  fallbackSize?: { w: number; h: number };
  /** Draw output time t onto the canvas (`edges` holds the frames transitions need). */
  render: (ctx: Ctx, W: number, H: number, t: number, src: SourceFrame | null, edges?: EdgeFrames) => void;
  audio: AudioSettings;
  /** Output-time words, for music ducking. */
  speech: Word[];
  /** Decoded music (when the project has music). */
  music?: AudioBuffer | null;
  /** Sound effects: decoded audio placed at output times. */
  sounds?: { start: number; volume: number; buffer: AudioBuffer }[];
  /** Where to write the file as it's made (see lib/saveSink.ts); memory when absent. */
  writable?: WritableStream;
  onProgress?: (p: number) => void;
  /** Called with the canvas after each frame is drawn (live preview). */
  onFrame?: (canvas: OffscreenCanvas, t: number) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  blob: Blob | null;
  width: number;
  height: number;
  fps: number;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec | null;
  mime: string;
}

const RATE = 48000;
const WINDOW = 4; // seconds of audio per mix window

const QUALITY = { medium: QUALITY_MEDIUM, high: QUALITY_HIGH, "very-high": QUALITY_VERY_HIGH };
let LIMITER: Float32Array | null = null;

export async function exportEdited(job: ExportJob): Promise<ExportResult> {
  const tl: EditTimeline = buildTimeline(job.clips);
  if (tl.duration <= 0) throw new Error("There's nothing to export: the timeline is empty.");
  const needsMain = job.clips.some(isMainVideo);
  if (needsMain && !job.file) throw new Error("Open the video first to export it.");

  // one decoder set per video file: the main video plus every extra video used by a clip
  interface Source { input: Input; vTrack: Awaited<ReturnType<Input["getPrimaryVideoTrack"]>>; aTrack: Awaited<ReturnType<Input["getPrimaryAudioTrack"]>>; videoSink: VideoSampleSink | null; audioSink: AudioBufferSink | null }
  const openSource = async (f: File, label: string): Promise<Source> => {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(f) });
    const vTrack = await input.getPrimaryVideoTrack();
    if (!vTrack) throw new Error(`${label} has no video track.`);
    const aTrack = await input.getPrimaryAudioTrack();
    return { input, vTrack, aTrack, videoSink: new VideoSampleSink(vTrack), audioSink: aTrack ? new AudioBufferSink(aTrack) : null };
  };
  const main = job.file && needsMain ? await openSource(job.file, "This file") : null;
  const extras = new Map<string, Source>();
  for (const c of job.clips) {
    if (c.kind !== "video" || !c.sourceId || extras.has(c.sourceId)) continue;
    const f = job.sources?.get(c.sourceId);
    if (!f) throw new Error(`The video “${c.name ?? "clip"}” is missing from this browser. Add it again.`);
    extras.set(c.sourceId, await openSource(f, c.name ?? "An added video"));
  }
  const sourceFor = (c: VideoClip): Source | null => (c.sourceId ? extras.get(c.sourceId) ?? null : main);
  const sizeFrom = main ?? extras.values().next().value ?? null;
  const vTrack = sizeFrom?.vTrack ?? null;

  const srcW = vTrack?.displayWidth ?? job.fallbackSize?.w ?? 1080;
  const srcH = vTrack?.displayHeight ?? job.fallbackSize?.h ?? 1920;
  const { w: W, h: H } = outputSize(srcW, srcH, job.aspect, job.short);

  let fps = job.fps;
  if (!fps && vTrack) {
    try { fps = (await vTrack.computePacketStats(120)).averagePacketRate; } catch { fps = 30; }
  }
  fps = Math.max(12, Math.min(60, Math.round(fps || 30)));

  const videoCandidates: VideoCodec[] = job.format === "webm" ? ["vp9", "av1", "vp8"] : ["avc", "hevc", "vp9", "av1"];
  const videoCodec = await getFirstEncodableVideoCodec(videoCandidates, { width: W, height: H });
  if (!videoCodec) throw new Error(`This browser can't encode ${job.format.toUpperCase()} video at ${W}×${H}. Try a lower resolution, the other format, or Chrome/Edge.`);
  const anyAudioTrack = !!main?.aTrack || [...extras.values()].some((s) => !!s.aTrack);
  const needAudio = anyAudioTrack || !!job.music || !!job.sounds?.length;
  const audioCodec = needAudio ? await getFirstEncodableAudioCodec(job.format === "webm" ? ["opus"] : ["aac", "opus"]) : null;
  if (needAudio && !audioCodec) throw new Error("This browser can't encode audio for this format. Try Chrome or Edge.");

  const target = job.writable ? new StreamTarget(job.writable, { chunked: true }) : new BufferTarget();
  const format = job.format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: job.writable ? false : "in-memory" });
  const output = new Output({ format, target });

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d")!;
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, quality: QUALITY[job.quality], keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });
  const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, quality: QUALITY_HIGH }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  const abort = () => void output.cancel().catch(() => {});
  job.signal?.addEventListener("abort", abort);
  const checkAbort = () => { if (job.signal?.aborted) throw new DOMException("Export cancelled", "AbortError"); };

  await output.start();

  const sinks = { video: (c: VideoClip) => sourceFor(c)?.videoSink ?? null, audio: (c: VideoClip) => sourceFor(c)?.audioSink ?? null };
  let mid: OffscreenCanvas | null = null;
  let midCtx: OffscreenCanvasRenderingContext2D | null = null;

  // first / last frames of the clips on either side of each transition, decoded once
  const edgeFrames = new Map<string, SourceFrame>();
  for (const req of edgeRequests(job.clips)) {
    checkAbort();
    const sink = sinks.video(req.clip);
    if (!sink) continue;
    const track = sourceFor(req.clip)?.vTrack;
    const dur = track ? await track.computeDuration().catch(() => Infinity) : Infinity;
    const sample = await sink.getSample(Math.max(0, Math.min(edgeTime(req.clip, req.edge), dur - 0.04))).catch(() => null);
    if (!sample) continue;
    // kept at no more than the output size: these only ever fill the frame
    const k = Math.min(1, Math.max(W, H) / Math.max(sample.displayWidth, sample.displayHeight));
    const ew = Math.max(1, Math.round(sample.displayWidth * k)), eh = Math.max(1, Math.round(sample.displayHeight * k));
    const c = new OffscreenCanvas(ew, eh);
    sample.drawWithFit(c.getContext("2d")!, { fit: "fill" });
    sample.close();
    edgeFrames.set(edgeKey(req.clip, req.edge), { image: c, w: ew, h: eh });
  }
  const edges: EdgeFrames = (clip, edge) => edgeFrames.get(edgeKey(clip, edge)) ?? null;

  const totalFrames = Math.max(1, Math.round(tl.duration * fps));
  let frame = 0;
  // voice enhancer runs on the original sound, continuously across mix windows
  const voice = anyAudioTrack ? await createVoiceProcessor(job.audio.voice) : null;

  try {
    for (let w0 = 0; w0 < tl.duration - 1e-6; w0 += WINDOW) {
      const w1 = Math.min(tl.duration, w0 + WINDOW);
      checkAbort();
      // ---- audio for [w0, w1)
      if (audioSource) {
        const buf = await mixWindow(w0, w1, tl, job, anyAudioTrack ? sinks.audio : null, voice);
        await audioSource.add(buf);
      }
      // ---- video frames whose time falls in [w0, w1)
      const first = Math.ceil(w0 * fps - 1e-6);
      const last = Math.min(totalFrames, Math.ceil(w1 * fps - 1e-6));
      // group consecutive frames by clip so source frames are fetched in order
      let n = first;
      while (n < last) {
        const t = n / fps;
        const it = tl.items.find((x) => t >= x.outStart - 1e-9 && t < x.outEnd - 1e-9) ?? tl.items[tl.items.length - 1];
        let end = n;
        while (end < last && (end / fps) < it.outEnd - 1e-9) end++;
        if (end === n) end = n + 1;
        const videoSink = it.clip.kind === "video" ? sinks.video(it.clip) : null;
        if (it.clip.kind === "video" && videoSink) {
          const clip = it.clip;
          const times: number[] = [];
          for (let k = n; k < end; k++) times.push(Math.min(clip.srcEnd - 1e-3, srcAt(clip, k / fps - it.outStart)));
          let k = n;
          for await (const sample of videoSink.samplesAtTimestamps(times)) {
            checkAbort();
            let src: SourceFrame | null = null;
            if (sample) {
              const dw = sample.displayWidth;
              const dh = sample.displayHeight;
              if (!mid || mid.width !== dw || mid.height !== dh) { mid = new OffscreenCanvas(dw, dh); midCtx = mid.getContext("2d")!; }
              sample.drawWithFit(midCtx!, { fit: "fill" });
              sample.close();
              src = { image: mid, w: dw, h: dh };
            }
            ctx.clearRect(0, 0, W, H);
            job.render(ctx, W, H, k / fps, src, edges);
            job.onFrame?.(canvas, k / fps);
            await videoSource.add(k / fps, 1 / fps);
            await breathe();
            k++;
            frame++;
            if (frame % 5 === 0) job.onProgress?.(frame / totalFrames);
          }
        } else {
          for (let k = n; k < end; k++) {
            checkAbort();
            ctx.clearRect(0, 0, W, H);
            job.render(ctx, W, H, k / fps, null, edges);
            job.onFrame?.(canvas, k / fps);
            await videoSource.add(k / fps, 1 / fps);
            await breathe();
            frame++;
            if (frame % 5 === 0) job.onProgress?.(frame / totalFrames);
          }
        }
        n = end;
      }
    }
    checkAbort();
    videoSource.close();
    audioSource?.close();
    await output.finalize();
    job.onProgress?.(1);
  } catch (e) {
    if (output.state !== "canceled" && output.state !== "finalized") await output.cancel().catch(() => {});
    throw e;
  } finally {
    job.signal?.removeEventListener("abort", abort);
  }

  const mime = job.format === "webm" ? "video/webm" : "video/mp4";
  const blob = target instanceof BufferTarget ? new Blob([target.buffer!], { type: mime }) : null;
  return { blob, width: W, height: H, fps, videoCodec, audioCodec, mime };
}

/** Gain automation curve over [a, b), sampled every 10 ms. */
function curve(a: number, b: number, g: (t: number) => number): Float32Array {
  const n = Math.max(2, Math.ceil((b - a) * 100) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = g(Math.min(b - 1e-4, a + ((b - a) * i) / (n - 1)));
  return out;
}

type SinkFor = (c: VideoClip) => AudioBufferSink | null;

async function mixWindow(a: number, b: number, tl: EditTimeline, job: ExportJob, sink: SinkFor | null, voice: VoiceProcessor | null): Promise<AudioBuffer> {
  const len = Math.max(1, Math.round((b - a) * RATE));
  const ctx = new OfflineAudioContext(2, len, RATE);
  // everything below goes through a soft limiter, so stacked sounds can't clip
  const pre = ctx.createGain();
  pre.gain.value = 1 / LIMITER_RANGE;
  const limiter = ctx.createWaveShaper();
  limiter.curve = (LIMITER ??= limiterCurve()) as Float32Array<ArrayBuffer>;
  limiter.oversample = "none";
  pre.connect(limiter).connect(ctx.destination);
  const out: AudioNode = pre;

  // original sound
  if (sink) {
    const gain = ctx.createGain();
    gain.gain.setValueCurveAtTime(curve(a, b, (t) => sourceGainAt(t, tl, job.audio)), 0, b - a);
    gain.connect(out);
    if (voice) {
      // render the original sound on its own, run the voice enhancer, then mix it in like before
      const raw = new OfflineAudioContext(2, len, RATE);
      await scheduleSource(raw, raw.destination, a, b, tl, sink);
      const clean = processVoiceBuffer(voice, await raw.startRendering());
      const node = ctx.createBufferSource();
      node.buffer = clean;
      node.connect(gain);
      node.start(0);
    } else await scheduleSource(ctx, gain, a, b, tl, sink);
  }

  // background music
  const m = job.audio.music;
  if (job.music && m) {
    const mDur = job.music.duration;
    const gain = ctx.createGain();
    gain.gain.setValueCurveAtTime(curve(a, b, (t) => musicGainAt(t, m, tl.duration, speechAt(job.speech, t), mDur)), 0, b - a);
    gain.connect(out);
    let t = a;
    while (t < b - 1e-4) {
      const mt = musicTimeAt(t, m, mDur, tl.duration);
      if (mt === null) {
        if (t < m.start) { t = Math.min(b, m.start); continue; }
        break;
      }
      const span = Math.min(b - t, mDur - mt);
      if (span <= 1e-4) break;
      const node = ctx.createBufferSource();
      node.buffer = job.music;
      node.connect(gain);
      node.start(t - a, mt, span);
      t += span;
    }
  }

  // sound effects
  for (const snd of job.sounds ?? []) {
    const end = snd.start + snd.buffer.duration;
    if (end <= a || snd.start >= b) continue;
    const node = ctx.createBufferSource();
    node.buffer = snd.buffer;
    const g = ctx.createGain();
    g.gain.value = Math.min(2, snd.volume);
    node.connect(g).connect(out);
    const offset = Math.max(0, a - snd.start);
    node.start(Math.max(0, snd.start - a), offset, Math.min(snd.buffer.duration - offset, b - Math.max(a, snd.start)));
  }

  return ctx.startRendering();
}

/** Place the original sound for [a, b) into `dest` of `ctx`. */
async function scheduleSource(ctx: BaseAudioContext, dest: AudioNode, a: number, b: number, tl: EditTimeline, sinkFor: SinkFor): Promise<void> {
  for (const it of tl.items) {
    if (it.clip.kind !== "video" || it.outEnd <= a || it.outStart >= b) continue;
    const c = it.clip;
    const sink = sinkFor(c);
    if (!sink) continue; // this video has no sound
    const k = speedOf(c);
    const segA = Math.max(a, it.outStart);
    const segB = Math.min(b, it.outEnd);
    const srcA = srcAt(c, segA - it.outStart);
    const srcB = Math.min(c.srcEnd, srcAt(c, segB - it.outStart));
    if (k !== 1) {
      // changed speed: gather the source audio, then stretch it to the new length keeping the pitch
      const raw = await gatherSource(sink, srcA, srcB, 2);
      if (!raw) continue;
      const node = ctx.createBufferSource();
      node.buffer = timeStretch(raw, k, ctx);
      node.connect(dest);
      node.start(segA - a, 0, segB - segA);
      continue;
    }
    for await (const wb of sink.buffers(Math.max(0, srcA - 0.05), srcB)) {
      const node = ctx.createBufferSource();
      node.buffer = wb.buffer;
      // where this buffer's start lands on the output timeline, relative to the window
      let when = it.outStart + (wb.timestamp - c.srcStart) - a;
      let offset = 0;
      if (wb.timestamp < srcA) { offset = srcA - wb.timestamp; when += offset; }
      const dur = Math.min(wb.duration - offset, srcB - Math.max(srcA, wb.timestamp));
      if (dur <= 0) continue;
      node.connect(dest);
      node.start(Math.max(0, when), offset, dur);
    }
  }
}

/** The source sound between srcA and srcB as one buffer at the mix rate. */
async function gatherSource(sink: AudioBufferSink, srcA: number, srcB: number, channels: number): Promise<AudioBuffer | null> {
  const len = Math.round((srcB - srcA) * RATE);
  if (len < 16) return null;
  const off = new OfflineAudioContext(Math.max(1, channels), len, RATE);
  for await (const wb of sink.buffers(Math.max(0, srcA - 0.05), srcB)) {
    const node = off.createBufferSource();
    node.buffer = wb.buffer;
    let when = wb.timestamp - srcA;
    let offset = 0;
    if (when < 0) { offset = -when; when = 0; }
    const dur = Math.min(wb.duration - offset, srcB - srcA - when);
    if (dur <= 0) continue;
    node.connect(off.destination);
    node.start(when, offset, dur);
  }
  return off.startRendering();
}
