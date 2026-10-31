/**
 * Edit-list maths: where each clip sits on the output timeline, and how
 * output time maps to source-video time and back.
 *
 * Transitions are "dip" style (the outgoing clip finishes its effect at the cut,
 * the incoming clip starts from it), so they never overlap clips and the output
 * duration is simply the sum of clip lengths. Preview and export only ever need
 * one source frame at a time.
 *
 * Pure functions: unit-tested in tests/edl.test.ts.
 */
import { isMainVideo, type Clip, type TransitionKind, type VideoClip } from "./project";
import type { Word } from "./types";

export interface Placed {
  clip: Clip;
  index: number;
  outStart: number;
  outEnd: number;
}

export interface EditTimeline {
  items: Placed[];
  duration: number;
}

/** Playback speed of a clip (1 for cards and normal-speed video). */
export const speedOf = (c: Clip) => (c.kind === "video" && c.speed && c.speed > 0 ? c.speed : 1);
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** Length on the output timeline: a 10 s piece of video at 2× lasts 5 s. */
export const clipLength = (c: Clip) => (c.kind === "video" ? Math.max(0, c.srcEnd - c.srcStart) / speedOf(c) : Math.max(0, c.duration));

/** Source time shown `into` seconds after the start of a placed video clip. */
export const srcAt = (c: VideoClip, into: number) => c.srcStart + Math.max(0, into) * speedOf(c);

export function buildTimeline(clips: Clip[]): EditTimeline {
  let t = 0;
  const items: Placed[] = clips.map((clip, index) => {
    const len = clipLength(clip);
    const p = { clip, index, outStart: t, outEnd: t + len };
    t += len;
    return p;
  });
  return { items, duration: t };
}

/** The clip playing at output time t (the last clip at the very end). */
export function itemAt(tl: EditTimeline, t: number): Placed | null {
  if (!tl.items.length) return null;
  if (t <= 0) return tl.items[0];
  for (const it of tl.items) if (t >= it.outStart && t < it.outEnd) return it;
  return t >= tl.duration ? tl.items[tl.items.length - 1] : null;
}

/** Main-video time shown at output time t (null on a card, image or extra video). */
export function outToSrc(tl: EditTimeline, t: number): { item: Placed | null; src: number | null } {
  const item = itemAt(tl, t);
  if (!item || !isMainVideo(item.clip)) return { item, src: null };
  const c = item.clip;
  return { item, src: Math.min(c.srcEnd, srcAt(c, t - item.outStart)) };
}

/** First output time that shows source time `src` (null if it was cut). */
export function srcToOut(tl: EditTimeline, src: number): number | null {
  for (const it of tl.items) {
    if (!isMainVideo(it.clip)) continue;
    if (src >= it.clip.srcStart && src < it.clip.srcEnd) return it.outStart + (src - it.clip.srcStart) / speedOf(it.clip);
  }
  return null;
}

/** Is this the simple case: one video clip and no transitions? */
export function isTrivial(clips: Clip[]): boolean {
  return clips.length === 1 && isMainVideo(clips[0]) && speedOf(clips[0]) === 1 && (!clips[0].transition || clips[0].transition.kind === "none");
}

/**
 * Words on the output timeline. Words in cut-out parts disappear; a word
 * crossing a cut is clipped to the part that remains. If the same source
 * moment is used twice, the second copy gets a suffixed id.
 */
export function mapWords(words: Word[], offset: number, tl: EditTimeline): Word[] {
  const out: Word[] = [];
  const seen = new Set<string>();
  for (const it of tl.items) {
    if (!isMainVideo(it.clip)) continue; // captions belong to the main video
    const c = it.clip;
    for (const w of words) {
      const s = w.start + offset;
      const e = w.end + offset;
      if (e <= c.srcStart || s >= c.srcEnd) continue;
      const cs = Math.max(s, c.srcStart);
      const ce = Math.min(e, c.srcEnd);
      if (ce - cs < 0.02) continue;
      const id = seen.has(w.id) ? `${w.id}~${it.index}` : w.id;
      seen.add(w.id);
      const k = speedOf(c);
      const start = it.outStart + (cs - c.srcStart) / k, end = it.outStart + (ce - c.srcStart) / k;
      // a word cut in two by a split (the clips still play on from each other):
      // keep it as one word across the cut instead of showing it twice
      const prev = out[out.length - 1];
      if (prev && seen.has(w.id) && baseWordId(prev.id) === w.id && Math.abs(prev.end - start) < 0.02) { prev.end = end; continue; }
      out.push({ ...w, id, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Strip the "~n" suffix added for repeated source words. */
export const baseWordId = (id: string) => id.replace(/~\d+$/, "");

/* ---------- editing operations (return new clip arrays) ---------- */

/** Split the clip under output time t into two. */
export function splitAt(clips: Clip[], t: number, newId: () => string): Clip[] {
  const tl = buildTimeline(clips);
  const it = itemAt(tl, t);
  if (!it) return clips;
  const at = t - it.outStart;
  if (at < 0.05 || it.outEnd - t < 0.05) return clips; // too close to an edge
  const c = it.clip;
  let a: Clip;
  let b: Clip;
  if (c.kind === "video") {
    const cut = srcAt(c, at);
    a = { ...c, srcEnd: cut };
    b = { ...c, id: newId(), srcStart: cut, transition: undefined };
  } else {
    a = { ...c, duration: at };
    b = { ...c, id: newId(), duration: c.duration - at, transition: undefined };
  }
  return [...clips.slice(0, it.index), a, b, ...clips.slice(it.index + 1)];
}

export function removeClip(clips: Clip[], id: string): Clip[] {
  const next = clips.filter((c) => c.id !== id);
  return next.length ? next : clips; // never delete the last clip
}

export function moveClip(clips: Clip[], id: string, toIndex: number): Clip[] {
  const from = clips.findIndex((c) => c.id === id);
  if (from < 0) return clips;
  const next = clips.slice();
  const [c] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, c);
  return next;
}

/**
 * Drag a clip edge. `delta` is in seconds (positive = later). A video clip can't
 * reach past its source bounds [0, srcDuration]; every clip stays ≥ 0.1 s.
 */
export function trimEdge(clips: Clip[], id: string, edge: "start" | "end", delta: number, srcDuration: number): Clip[] {
  return clips.map((c) => {
    if (c.id !== id) return c;
    if (c.kind !== "video") {
      return edge === "end" ? { ...c, duration: Math.max(0.1, c.duration + delta) } : { ...c, duration: Math.max(0.1, c.duration - delta) };
    }
    const own = c.sourceId ? c.srcDuration ?? Infinity : srcDuration;
    const max = own > 0 ? own : Infinity;
    const d = delta * speedOf(c); // the edge moves on the timeline; the source moves faster on a sped-up clip
    if (edge === "start") return { ...c, srcStart: Math.min(c.srcEnd - 0.1, Math.max(0, c.srcStart + d)) };
    return { ...c, srcEnd: Math.max(c.srcStart + 0.1, Math.min(max, c.srcEnd + d)) };
  });
}

/** Join a clip with the next one when they are continuous in the source (undo a split). */
export function mergeWithNext(clips: Clip[], id: string): Clip[] {
  const i = clips.findIndex((c) => c.id === id);
  const a = clips[i];
  const b = clips[i + 1];
  if (!a || !b) return clips;
  if (a.kind === "video" && b.kind === "video" && a.sourceId === b.sourceId && Math.abs(a.srcEnd - b.srcStart) < 0.02 && speedOf(a) === speedOf(b)) {
    return [...clips.slice(0, i), { ...a, srcEnd: b.srcEnd }, ...clips.slice(i + 2)];
  }
  if (a.kind === "card" && b.kind === "card") return [...clips.slice(0, i), { ...a, duration: a.duration + b.duration }, ...clips.slice(i + 2)];
  if (a.kind === "image" && b.kind === "image" && a.assetId === b.assetId) return [...clips.slice(0, i), { ...a, duration: a.duration + b.duration }, ...clips.slice(i + 2)];
  return clips;
}

export const canMerge = (clips: Clip[], id: string) => mergeWithNext(clips, id) !== clips;

/** Remove [from, to) of the output timeline (ripple delete), splitting clips as needed. */
export function rippleDelete(clips: Clip[], from: number, to: number, newId: () => string): Clip[] {
  if (to - from < 0.05) return clips;
  let next = splitAt(clips, to, newId);
  next = splitAt(next, from, newId);
  const tl = buildTimeline(next);
  const keep = tl.items.filter((it) => it.outEnd <= from + 0.001 || it.outStart >= to - 0.001).map((it) => it.clip);
  return keep.length ? keep : clips;
}

/* ---------- transitions ---------- */

export interface TransitionState {
  kind: TransitionKind;
  /** 0 = no effect, 1 = full effect (e.g. fully black for "fade"). */
  amount: number;
  /** "out" while leaving a clip, "in" while entering. */
  phase: "out" | "in";
}

const ease = (x: number) => x * x * (3 - 2 * x); // smoothstep

/** Transition effect active at output time t, if any. */
export function transitionAt(tl: EditTimeline, t: number): TransitionState | null {
  for (let i = 0; i < tl.items.length; i++) {
    const it = tl.items[i];
    const tr = it.clip.transition;
    if (!tr || tr.kind === "none" || tr.duration <= 0) continue;
    const len = it.outEnd - it.outStart;
    const half = Math.min(tr.duration / 2, len / 2);
    const b = it.outStart;
    if (t >= b && t < b + half) return { kind: tr.kind, amount: ease(1 - (t - b) / half), phase: "in" };
    const prev = tl.items[i - 1];
    if (prev) {
      const ph = Math.min(half, (prev.outEnd - prev.outStart) / 2);
      if (t >= b - ph && t < b) return { kind: tr.kind, amount: ease((t - (b - ph)) / ph), phase: "out" };
    }
  }
  return null;
}

export function firstVideoClip(clips: Clip[]): VideoClip | undefined {
  return clips.find((c): c is VideoClip => c.kind === "video");
}

/* ---------- adding media ---------- */

export type InsertWhere = "start" | "playhead" | "end";

/**
 * Put a new clip on the timeline: at the start, at the end, or at output time
 * `t` (the clip under the playhead is split so the new one sits between the halves).
 * Returns the new clip list and the output time where the clip begins.
 */
export function insertClip(clips: Clip[], clip: Clip, where: InsertWhere, t: number, newId: () => string): { clips: Clip[]; at: number } {
  if (!clips.length || where === "start") return { clips: [clip, ...clips], at: 0 };
  const tl = buildTimeline(clips);
  if (where === "end" || t >= tl.duration - 0.05) return { clips: [...clips, clip], at: tl.duration };
  if (t <= 0.05) return { clips: [clip, ...clips], at: 0 };
  const next = splitAt(clips, t, newId);
  const t2 = buildTimeline(next);
  let idx = t2.items.findIndex((it) => it.outStart >= t - 1e-3);
  if (idx < 0) idx = next.length;
  return { clips: [...next.slice(0, idx), clip, ...next.slice(idx)], at: t2.items[idx]?.outStart ?? t2.duration };
}
