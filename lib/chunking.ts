/**
 * Long-video transcription in pieces.
 *
 * Hosting limits (Vercel accepts request bodies up to ~4.5 MB) mean a long
 * soundtrack can't be uploaded in one go. We cut it into pieces of about
 * 8–10 minutes, at the quietest moment we can find so words are not cut in
 * half, transcribe each piece, then stitch the words back together on the
 * original timeline.
 *
 * Each piece overlaps its neighbours by OVERLAP seconds. When merging, a word
 * belongs to the piece whose "keep" range contains its midpoint; duplicates
 * that both pieces heard at the boundary are removed.
 *
 * Pure functions, no browser APIs: unit-tested in tests/chunking.test.ts.
 */
import type { Word } from "./types";

export interface ChunkPlanOptions {
  /** Preferred shortest piece (s). */
  minSec: number;
  /** Longest piece allowed (s). */
  maxSec: number;
  /** Seconds of audio shared with the neighbouring piece on each side. */
  overlap: number;
  /** Length of the window used to find a quiet moment (s). */
  quietWindow: number;
}

export const DEFAULT_CHUNKING: ChunkPlanOptions = { minSec: 8 * 60, maxSec: 10 * 60, overlap: 1.5, quietWindow: 0.4 };

export interface ChunkRange {
  index: number;
  /** Audio sent for this piece (s, on the original timeline). */
  start: number;
  end: number;
  /** Words whose midpoint falls in [keepFrom, keepTo) are kept from this piece. */
  keepFrom: number;
  keepTo: number;
}

/**
 * Find the quietest moment in [from, to) of a loudness envelope.
 * `levels` has `rate` values per second (e.g. waveform peaks, 100/s).
 * Returns the centre of the quietest window, in seconds.
 */
export function quietestPoint(levels: ArrayLike<number>, rate: number, from: number, to: number, window = 0.4): number {
  const w = Math.max(1, Math.round(window * rate));
  const a = Math.max(0, Math.floor(from * rate));
  const b = Math.min(levels.length, Math.ceil(to * rate));
  if (b - a < w) return (from + to) / 2;
  let sum = 0;
  for (let i = a; i < a + w; i++) sum += levels[i];
  let best = sum;
  let bestAt = a;
  for (let i = a + 1; i + w <= b; i++) {
    sum += levels[i + w - 1] - levels[i - 1];
    // "<" keeps the earliest of equally quiet spots; tiny tolerance for float drift
    if (sum < best - 1e-9) {
      best = sum;
      bestAt = i;
    }
  }
  return (bestAt + w / 2) / rate;
}

/** Cut points (s) between pieces. Empty when the whole thing fits in one piece. */
export function planCuts(duration: number, levels: ArrayLike<number> | null, rate: number, opts: Partial<ChunkPlanOptions> = {}): number[] {
  const o = { ...DEFAULT_CHUNKING, ...opts };
  if (o.minSec > o.maxSec) o.minSec = o.maxSec;
  const cuts: number[] = [];
  let start = 0;
  while (duration - start > o.maxSec) {
    // never leave a tiny last piece: if the rest is shorter than max + min, cut nearer the middle
    const rest = duration - start;
    let from = start + o.minSec;
    let to = start + o.maxSec;
    if (rest < o.maxSec + o.minSec) {
      from = start + Math.max(rest / 2 - 30, rest - o.maxSec);
      to = start + Math.min(rest / 2 + 30, o.maxSec);
    }
    const cut = levels && levels.length ? quietestPoint(levels, rate, from, to, o.quietWindow) : (from + to) / 2;
    cuts.push(cut);
    start = cut;
  }
  return cuts;
}

/** Turn cut points into overlapping audio ranges. */
export function chunkRanges(duration: number, cuts: number[], overlap = DEFAULT_CHUNKING.overlap): ChunkRange[] {
  const edges = [0, ...cuts, duration];
  const out: ChunkRange[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const keepFrom = edges[i];
    const keepTo = edges[i + 1];
    out.push({
      index: i,
      start: Math.max(0, keepFrom - (i > 0 ? overlap : 0)),
      end: Math.min(duration, keepTo + (i < edges.length - 2 ? overlap : 0)),
      keepFrom,
      keepTo: i === edges.length - 2 ? Infinity : keepTo,
    });
  }
  return out;
}

/** Word times from a piece are relative to the piece; move them onto the original timeline. */
export function shiftWords<T extends { start: number; end: number }>(words: T[], by: number): T[] {
  return words.map((w) => ({ ...w, start: w.start + by, end: w.end + by }));
}

const norm = (s: string) => s.normalize("NFC").replace(/[\s.,!?।॥"'“”‘’:;()\-–—]/g, "").toLowerCase();

/**
 * Merge the words of every piece (already on the original timeline).
 * Keeps each word once, in time order.
 */
export function mergeChunkWords<W extends Word>(pieces: { range: ChunkRange; words: W[] }[]): W[] {
  const out: W[] = [];
  const sorted = pieces.slice().sort((a, b) => a.range.index - b.range.index);
  for (const { range, words } of sorted) {
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid < range.keepFrom || mid >= range.keepTo) continue;
      const prev = out[out.length - 1];
      // the same word heard by both pieces right at the cut: keep the first
      if (prev && norm(prev.text) === norm(w.text) && w.start < prev.end + 0.15 && Math.abs(w.start - prev.start) < 0.6) continue;
      out.push(w);
    }
  }
  out.sort((a, b) => a.start - b.start);
  // keep times sane: no word may start before the previous one ends by more than a hair
  for (let i = 1; i < out.length; i++) {
    if (out[i].start < out[i - 1].start) out[i] = { ...out[i], start: out[i - 1].start };
    if (out[i].end < out[i].start + 0.03) out[i] = { ...out[i], end: out[i].start + 0.03 };
  }
  return out;
}

/** Largest piece length (s) whose upload stays under `maxBytes` at `bytesPerSec`. */
export function maxSecondsForBytes(bytesPerSec: number, maxBytes = 4_000_000): number {
  return Math.max(30, Math.floor(maxBytes / Math.max(1, bytesPerSec)));
}
