/**
 * Runs a transcription from the browser: one upload for short videos, or
 * several overlapping pieces for long ones (see lib/chunking.ts), with
 * retries for temporary failures and a per-piece cache so "Try again"
 * resumes where it stopped instead of paying for finished pieces twice.
 *
 * Browser-free: the audio cutting, the upload and the cache are passed in,
 * so this file is unit-tested with fakes.
 */
import { chunkRanges, maxSecondsForBytes, mergeChunkWords, planCuts, shiftWords, type ChunkRange } from "./chunking";
import type { Word } from "./types";

/** Vercel rejects request bodies over 4.5 MB; leave room for the form fields. */
export const MAX_UPLOAD_BYTES = 4_000_000;
/** Pieces are at most this long even when the audio is tiny (provider-friendly). */
export const MAX_PIECE_SEC = 10 * 60;

export class TranscribeError extends Error {
  constructor(message: string, public status = 0, public code?: string) {
    super(message);
    this.name = "TranscribeError";
  }
  /** Worth trying again automatically? (server busy, rate limit, network) */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface SourceAudio {
  blob: Blob;
  name: string;
  duration: number;
  bytesPerSec: number;
  waveform: { peaks: ArrayLike<number>; rate: number } | null;
}

export interface TranscribeResult {
  words: Word[];
  language?: string;
  parts: number;
  /** Pieces that came from the cache (no credits spent). */
  reused: number;
}

export interface TranscribeDeps {
  /** Upload one piece and return its words (times relative to the piece). */
  send: (blob: Blob, name: string) => Promise<{ words: Word[]; language?: string }>;
  /** Cut [start, end) out of the source audio. `offset` = where the piece's time 0 sits on the original timeline. */
  cut: (start: number, end: number) => Promise<{ blob: Blob; name: string; offset: number }>;
  cacheGet?: (key: string) => Promise<Word[] | null>;
  cacheSet?: (key: string, words: Word[]) => Promise<void>;
  onProgress?: (s: { part: number; parts: number; attempt: number; phase: "cutting" | "uploading" | "done" }) => void;
  /** Wait between retries (overridable in tests). */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  maxBytes?: number;
  retries?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withRetry<T>(fn: (attempt: number) => Promise<T>, deps: TranscribeDeps): Promise<T> {
  const retries = deps.retries ?? 2;
  const sleep = deps.sleep ?? realSleep;
  for (let attempt = 1; ; attempt++) {
    if (deps.signal?.aborted) throw new TranscribeError("Cancelled.", 0, "aborted");
    try {
      return await fn(attempt);
    } catch (e) {
      // keep the status of errors from elsewhere (e.g. every key used up), so they aren't mistaken for network trouble
      const x = e as { message?: string; status?: unknown; code?: unknown } | null;
      const err = e instanceof TranscribeError ? e
        : new TranscribeError(x?.message || "Network error", typeof x?.status === "number" ? x.status : 0, typeof x?.code === "string" ? x.code : "network");
      if (err.code === "aborted" || !err.retryable || attempt > retries) throw err;
      await sleep(attempt === 1 ? 1500 : 4000 * attempt);
    }
  }
}

/** How the audio will be split (exposed for the UI and tests). */
export function planPieces(src: Pick<SourceAudio, "duration" | "bytesPerSec" | "blob" | "waveform">, maxBytes = MAX_UPLOAD_BYTES): ChunkRange[] | null {
  const fits = src.blob.size <= maxBytes && src.duration <= MAX_PIECE_SEC + 30;
  if (fits || !(src.duration > 0)) return null;
  const maxSec = Math.min(MAX_PIECE_SEC, maxSecondsForBytes(src.bytesPerSec * 1.08, maxBytes));
  const minSec = Math.min(8 * 60, Math.floor(maxSec * 0.8));
  const levels = src.waveform?.peaks ?? null;
  const cuts = planCuts(src.duration, levels, src.waveform?.rate ?? 100, { maxSec, minSec });
  return chunkRanges(src.duration, cuts);
}

export async function runTranscription(src: SourceAudio, cacheKey: string, deps: TranscribeDeps): Promise<TranscribeResult> {
  const maxBytes = deps.maxBytes ?? MAX_UPLOAD_BYTES;
  const pieces = planPieces(src, maxBytes);

  if (!pieces) {
    deps.onProgress?.({ part: 1, parts: 1, attempt: 1, phase: "uploading" });
    const r = await withRetry((attempt) => {
      deps.onProgress?.({ part: 1, parts: 1, attempt, phase: "uploading" });
      return deps.send(src.blob, src.name);
    }, deps);
    deps.onProgress?.({ part: 1, parts: 1, attempt: 1, phase: "done" });
    return { words: r.words, language: r.language, parts: 1, reused: 0 };
  }

  const done: { range: ChunkRange; words: Word[] }[] = [];
  let language: string | undefined;
  let reused = 0;
  for (const range of pieces) {
    const key = `${cacheKey}|piece|${range.start.toFixed(2)}-${range.end.toFixed(2)}`;
    const part = range.index + 1;
    const cached = await deps.cacheGet?.(key).catch(() => null);
    if (cached) {
      done.push({ range, words: cached });
      reused++;
      continue;
    }
    deps.onProgress?.({ part, parts: pieces.length, attempt: 1, phase: "cutting" });
    const piece = await deps.cut(range.start, range.end);
    if (piece.blob.size > maxBytes) {
      throw new TranscribeError(`Part ${part} is ${(piece.blob.size / 1e6).toFixed(1)} MB, over the ${(maxBytes / 1e6).toFixed(1)} MB upload limit.`, 413, "too_large");
    }
    const r = await withRetry((attempt) => {
      deps.onProgress?.({ part, parts: pieces.length, attempt, phase: "uploading" });
      return deps.send(piece.blob, piece.name);
    }, deps);
    language ??= r.language;
    // ids must stay unique after merging
    const words = shiftWords(r.words, piece.offset).map((w, i) => ({ ...w, id: `p${range.index}_${i}_${w.id}` }));
    await deps.cacheSet?.(key, words).catch(() => {});
    done.push({ range, words });
  }
  deps.onProgress?.({ part: pieces.length, parts: pieces.length, attempt: 1, phase: "done" });
  return { words: mergeChunkWords(done), language, parts: pieces.length, reused };
}

/** Default uploader: POST /api/transcribe. */
export function httpSender(opts: { language: string; model: string; apiKey?: string; keyterms?: string[]; diarize?: boolean; signal?: AbortSignal }) {
  return async (blob: Blob, name: string): Promise<{ words: Word[]; language?: string }> => {
    const fd = new FormData();
    fd.append("audio", blob, name);
    fd.append("language", opts.language);
    fd.append("model", opts.model);
    if (opts.diarize) fd.append("diarize", "true");
    if (opts.keyterms?.length) fd.append("keyterms", JSON.stringify(opts.keyterms));
    let res: Response;
    try {
      res = await fetch("/api/transcribe", {
        method: "POST",
        body: fd,
        headers: opts.apiKey ? { "x-elevenlabs-key": opts.apiKey } : undefined,
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new TranscribeError("Cancelled.", 0, "aborted");
      throw new TranscribeError("Couldn't reach the server. Check your internet connection.", 0, "network");
    }
    const data = (await res.json().catch(() => ({ error: res.status === 413 ? "The audio is too large to upload." : `Server returned ${res.status}` }))) as {
      error?: string; code?: string; words?: Word[]; language?: string;
    };
    if (!res.ok) throw new TranscribeError(data.error ?? `HTTP ${res.status}`, res.status, data.code);
    return { words: data.words ?? [], language: data.language };
  };
}
