"use client";
/**
 * Transcribe one video file end to end (used by the editor and by batches):
 * saved-transcript lookup → local audio extraction → one upload or several
 * overlapping pieces with retries → merged words → saved for next time.
 */
import { cacheTranscript, cacheWords, fingerprint, getCachedTranscript, getCachedWords } from "./library";
import { languageByCode, AUTO } from "./languages";
import type { Word } from "./types";
import { createKeyPool, type KeyProblem } from "./keyPool";
import type { Waveform } from "./media";

export interface TranscribeFileOptions {
  /** Settings language (may be an older code). */
  language: string;
  model: string;
  apiKey?: string;
  /** Several keys: when one runs out of credits or is refused, the next one is used. Overrides apiKey. */
  apiKeys?: string[];
  /** Which of apiKeys to start with (the one that worked last time). */
  keyStart?: number;
  /** A key ran out or was refused and the next one took over. */
  onKeySwitch?: (info: { from: number; to: number; problem: KeyProblem }) => void;
  /** A key (index in apiKeys) ran out of credits or was refused. */
  onKeyProblem?: (info: { index: number; problem: KeyProblem }) => void;
  /** This key (index in apiKeys) worked; remember it for next time. */
  onKeyWorked?: (index: number) => void;
  keyterms?: string[];
  diarize?: boolean;
  /** Ignore the saved transcript and transcribe again. */
  force?: boolean;
  /** Continue a run that failed part-way (re-uses finished pieces). */
  resumeKey?: string | null;
  /** Known duration (s) when audio analysis isn't possible. */
  durationHint?: number;
  onStage?: (s: { label: string; detail?: string; progress?: number }) => void;
  onWaveform?: (w: Waveform) => void;
  signal?: AbortSignal;
}

export interface TranscribeFileResult {
  words: Word[];
  language?: string;
  parts: number;
  reused: number;
  fromCache: boolean;
}

/** Error that remembers how to resume. */
export class TranscribeFileError extends Error {
  constructor(message: string, public resumeKey: string | null, public status = 0) {
    super(message);
  }
}

export function scribeCode(lang: string): string {
  if (lang === AUTO) return AUTO;
  return languageByCode(lang)?.code ?? lang;
}

export async function transcribeFile(f: File, o: TranscribeFileOptions): Promise<TranscribeFileResult> {
  const lang = scribeCode(o.language);
  if (!o.force && !o.resumeKey) {
    const cached = await getCachedTranscript(f, o.language);
    if (cached) return { words: cached, language: lang === AUTO ? undefined : lang, parts: 1, reused: 1, fromCache: true };
  }
  const stage = o.onStage ?? (() => {});
  stage({ label: "Preparing video…", detail: "Extracting the soundtrack on this device", progress: 0 });
  const media = await import("./media");
  const { runTranscription, httpSender, planPieces, TranscribeError } = await import("./transcribeClient");
  let analysis: Awaited<ReturnType<typeof media.analyzeAudio>> | null = null;
  try {
    analysis = await media.analyzeAudio(f, (p) => stage({ label: "Preparing video…", detail: "Extracting the soundtrack on this device", progress: p }));
    if (analysis.waveform) o.onWaveform?.(analysis.waveform);
  } catch (err) {
    console.warn("Local audio extraction failed, uploading original file", err);
  }
  const dur = analysis?.duration || o.durationHint || 0;
  if (!analysis && f.size > 4_000_000 && typeof location !== "undefined" && !/^(localhost|127\.)/.test(location.hostname)) {
    throw new TranscribeFileError("This browser couldn't extract the soundtrack, and the video is too large to upload. Try Chrome or Edge, or convert the video to MP4 (H.264).", null, 413);
  }
  const keys = (o.apiKeys ?? []).filter(Boolean);
  const sendWith = (apiKey?: string) => httpSender({ language: lang, model: o.model, apiKey, keyterms: o.keyterms, diarize: o.diarize, signal: o.signal });
  let send = sendWith(o.apiKey);
  if (keys.length) {
    const pool = createKeyPool(keys, { start: o.keyStart, onSwitch: o.onKeySwitch, onWorked: o.onKeyWorked, onProblem: ({ index, problem }) => o.onKeyProblem?.({ index, problem }) });
    send = (blob, name) => pool.run((k) => sendWith(k)(blob, name));
  }
  const src = analysis
    ? { blob: analysis.blob, name: analysis.name, duration: analysis.duration || dur, bytesPerSec: analysis.bytesPerSec, waveform: analysis.waveform }
    : { blob: f as Blob, name: f.name, duration: dur, bytesPerSec: f.size / Math.max(1, dur || 1), waveform: null };
  const pieces = planPieces(src);
  const parts = pieces?.length ?? 1;
  const runKey = o.resumeKey ?? (parts > 1 ? `${fingerprint(f)}|${o.language}|${o.model}${o.force ? `|${Date.now()}` : ""}` : null);
  stage({ label: parts > 1 ? `Transcribing part 1 of ${parts}…` : "Generating captions…", detail: "Waiting for ElevenLabs Scribe" });
  try {
    const result = await runTranscription(src, runKey ?? `${fingerprint(f)}|${o.language}`, {
      send,
      cut: (a, b) => {
        if (!analysis) throw new TranscribeError("Can't split this video into parts in this browser.", 0, "no_split");
        return media.cutAudio(analysis, a, b);
      },
      cacheGet: runKey ? getCachedWords : undefined,
      cacheSet: runKey ? cacheWords : undefined,
      signal: o.signal,
      onProgress: ({ part, parts: n, attempt, phase }) => {
        if (n < 2 || phase === "done") return;
        stage({
          label: `Transcribing part ${part} of ${n}${attempt > 1 ? ` (retry ${attempt - 1})` : ""}…`,
          detail: phase === "cutting" ? "Preparing this part on your device" : "Waiting for ElevenLabs Scribe",
          progress: (part - 1) / n,
        });
      },
    });
    const words = result.words.map((w, i) => ({ ...w, id: `t${Date.now().toString(36)}${i}` }));
    if (!words.length) throw new TranscribeFileError("No speech was found in this video.", null);
    void cacheTranscript(f, o.language, words);
    const detected = result.language ? languageByCode(result.language)?.code ?? result.language : undefined;
    return { words, language: lang === AUTO ? detected : lang, parts: result.parts, reused: result.reused, fromCache: false };
  } catch (e) {
    if (e instanceof TranscribeFileError) throw e;
    const status = (e as { status?: number }).status ?? 0;
    throw new TranscribeFileError((e as Error).message, runKey, status);
  }
}
