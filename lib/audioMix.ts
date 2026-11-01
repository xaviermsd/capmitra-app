/**
 * Loudness over time, shared by the preview (which sets element volumes every
 * frame) and the export (which renders the mix offline). Keeping one set of
 * formulas means what you hear while editing is what gets exported.
 */
import type { EditTimeline } from "./edl";
import { transitionAt } from "./edl";
import { transitionGain } from "./transitions";
import type { AudioSettings, Music } from "./project";
import type { Word } from "./types";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/* ---------- levels ---------- */

/** Highest peak a generated sound may have, about −1 dBFS. */
export const PEAK_CEILING = 0.89;

/** Peak absolute sample value across channels. */
export function peakOf(channels: ArrayLike<number>[]): number {
  let m = 0;
  for (const d of channels) for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > m) m = v; }
  return m;
}

/** Gain that brings the peak down to `ceiling` (1 when it is already below; never boosts). */
export function peakGain(channels: ArrayLike<number>[], ceiling = PEAK_CEILING): number {
  const p = peakOf(channels);
  return p > ceiling ? ceiling / p : 1;
}

/**
 * Soft limiter for the final mix: unchanged below `knee`, then bends smoothly
 * towards `ceiling`, so original sound + music + sound effects never go past
 * full scale (which would crackle). Stateless, so mixing in windows is safe.
 */
export function softClip(x: number, knee = 0.8, ceiling = 0.98): number {
  const a = Math.abs(x);
  if (a <= knee) return x;
  return Math.sign(x) * (knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee)));
}

/** Input range covered by the limiter curve; louder input is held at the ceiling. */
export const LIMITER_RANGE = 4;

/**
 * softClip as a WaveShaper curve. A WaveShaper reads input in [−1, 1], so feed
 * it the mix scaled by 1 / LIMITER_RANGE; the curve undoes that scaling.
 */
export function limiterCurve(n = 8193): Float32Array {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = softClip(((i / (n - 1)) * 2 - 1) * LIMITER_RANGE);
  return c;
}

/** Gain of the original soundtrack at output time t. */
export function sourceGainAt(t: number, tl: EditTimeline, audio: AudioSettings): number {
  if (audio.muted) return 0;
  let g = audio.volume;
  if (audio.fadeIn > 0) g *= clamp01(t / audio.fadeIn);
  if (audio.fadeOut > 0) g *= clamp01((tl.duration - t) / audio.fadeOut);
  const it = tl.items.find((x) => t >= x.outStart && t < x.outEnd) ?? tl.items[tl.items.length - 1];
  if (!it || it.clip.kind !== "video") return 0; // cards and images are silent
  g *= it.clip.volume ?? 1;
  const tr = transitionAt(tl, t);
  if (tr) g *= transitionGain(tr.kind, t, tr.cut, tr.half); // duck the sound at the cut
  return Math.max(0, g);
}

/**
 * Speech presence 0..1 at time t (1 while a word is spoken, easing to 0 over
 * `release` s around it). `words` must be sorted by start (output time).
 */
export function speechAt(words: Word[], t: number, attack = 0.08, release = 0.35): number {
  let lo = 0;
  let hi = words.length - 1;
  // last word starting before t + attack
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t + attack) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  let best = 0;
  for (const i of [idx, idx + 1]) {
    const w = words[i];
    if (!w) continue;
    if (t >= w.start && t <= w.end) return 1;
    if (t < w.start) best = Math.max(best, 1 - clamp01((w.start - t) / attack));
    else best = Math.max(best, 1 - clamp01((t - w.end) / release));
  }
  return best;
}

/** Where in the music file we are at output time t (null = not playing). */
export function musicTimeAt(t: number, m: Music, musicDuration: number, outDuration: number): number | null {
  if (t < m.start || t >= outDuration) return null;
  const into = t - m.start;
  if (musicDuration <= 0) return into;
  if (into < musicDuration) return into;
  return m.loop ? into % musicDuration : null;
}

/** Music gain at output time t, including fades and ducking under speech. */
export function musicGainAt(t: number, m: Music, outDuration: number, speech: number, musicDuration = Infinity): number {
  if (t < m.start) return 0;
  let g = m.volume;
  if (m.fadeIn > 0) g *= clamp01((t - m.start) / m.fadeIn);
  const end = m.loop ? outDuration : Math.min(outDuration, m.start + musicDuration);
  if (m.fadeOut > 0) g *= clamp01((end - t) / m.fadeOut);
  g *= 1 - clamp01(m.duck) * clamp01(speech);
  return Math.max(0, g);
}
