/**
 * Edit the video by editing its transcript.
 *
 * Everything here works on the OUTPUT timeline (words as they play after
 * earlier cuts). A cut is a range of output time; applying cuts ripple-deletes
 * them from the edit list and shifts graphics, effects and sounds with the
 * picture, so everything stays in sync. Captions follow automatically because
 * they are mapped through the edit list.
 */
import { rippleDelete } from "./edl";
import type { Clip, ProjectDoc } from "./project";
import type { Word } from "./types";

export type CutKind = "words" | "pause" | "filler";

export interface Cut {
  id: string;
  kind: CutKind;
  /** Output-time range to remove. */
  from: number;
  to: number;
  /** Words covered (output-word indices), for highlighting. */
  words?: number[];
  label: string;
}

/** How much silence to keep on each side when a pause is shortened. */
export const PAUSE_KEEP = 0.12;

/** Common filler words, matched on the whole word (case-insensitive). Suggestions only: you review them. */
const FILLERS = [
  // English
  "um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "ahh", "hmm", "hm", "mm", "mmm",
  // Hindi / Hinglish
  "अं", "उम्म", "हम्म", "अ", "matlab", "मतलब", "basically", "actually", "acha", "achha", "अच्छा",
  // Gujarati / Gujlish
  "હં", "અં", "અ", "એટલે", "etle", "હમ્મ",
];
const FILLER_PHRASES = [["you", "know"], ["i", "mean"], ["एटले", "के"], ["એટલે", "કે"], ["etle", "ke"], ["matlab", "ki"]];

const clean = (s: string) => s.toLowerCase().replace(/[.,!?।॥:;…"'“”‘’()-]+/g, "").trim();

/** Long pauses between words, shortened to PAUSE_KEEP each side. */
export function findPauses(words: Word[], minGap = 0.6): Cut[] {
  const out: Cut[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i], b = words[i + 1];
    const gap = b.start - a.end;
    if (gap >= minGap) {
      out.push({ id: `p${i}`, kind: "pause", from: a.end + PAUSE_KEEP, to: b.start - PAUSE_KEEP, label: `${gap.toFixed(1)} s pause` });
    }
  }
  return out;
}

/** Filler words and short filler phrases. */
export function findFillers(words: Word[]): Cut[] {
  const out: Cut[] = [];
  const set = new Set(FILLERS.map(clean));
  for (let i = 0; i < words.length; i++) {
    const phrase = FILLER_PHRASES.find((p) => p.every((w, k) => clean(words[i + k]?.text ?? "") === clean(w)));
    if (phrase) {
      const idx = phrase.map((_, k) => i + k);
      out.push({ id: `f${i}`, kind: "filler", ...wordSpan(words, idx), words: idx, label: idx.map((k) => words[k].text).join(" ") });
      i += phrase.length - 1;
      continue;
    }
    if (set.has(clean(words[i].text))) out.push({ id: `f${i}`, kind: "filler", ...wordSpan(words, [i]), words: [i], label: words[i].text });
  }
  return out;
}

/**
 * Output range to remove for a run of words: from the first word's start up to
 * the next kept word, keeping a short natural gap, so no half-syllables remain.
 */
export function wordSpan(words: Word[], idx: number[]): { from: number; to: number } {
  const first = Math.min(...idx), last = Math.max(...idx);
  const prev = words[first - 1], next = words[last + 1];
  const from = prev ? Math.max(prev.end, words[first].start - 0.03) : Math.max(0, words[first].start - 0.03);
  let to = next ? Math.min(next.start, words[last].end + 0.05) : words[last].end + 0.05;
  // swallow a short gap after the cut so the edit doesn't leave a hole
  if (next && next.start - to < 0.25) to = Math.max(to, next.start - 0.04);
  return { from, to: Math.max(from + 0.05, to) };
}

/** Group selected word indices into runs of neighbours (one cut per run). */
export function cutsFromWords(words: Word[], selected: number[]): Cut[] {
  const s = [...new Set(selected)].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const i of s) {
    const r = runs[runs.length - 1];
    if (r && i === r[r.length - 1] + 1) r.push(i);
    else runs.push([i]);
  }
  return runs.map((r) => ({ id: `w${r[0]}`, kind: "words" as const, ...wordSpan(words, r), words: r, label: r.map((i) => words[i].text).join(" ") }));
}

/** Merge overlapping ranges (cuts may touch each other). */
export function mergeRanges(cuts: { from: number; to: number }[]): { from: number; to: number }[] {
  const s = [...cuts].filter((c) => c.to - c.from > 0.02).sort((a, b) => a.from - b.from);
  const out: { from: number; to: number }[] = [];
  for (const c of s) {
    const last = out[out.length - 1];
    if (last && c.from <= last.to + 0.01) last.to = Math.max(last.to, c.to);
    else out.push({ ...c });
  }
  return out;
}

/** Map an output time through removed ranges (sorted). */
function shiftTime(t: number, ranges: { from: number; to: number }[]): number {
  let d = 0;
  for (const r of ranges) {
    if (t >= r.to) d += r.to - r.from;
    else if (t > r.from) return r.from - d; // inside a cut: snap to the cut point
  }
  return t - d;
}

/**
 * Apply cuts to the project in one step: ripple-delete from the edit list
 * (last first, so earlier times stay valid) and move graphics, effects and
 * sounds with the picture. Items entirely inside a cut are removed.
 */
export function applyCuts(doc: ProjectDoc, clips: Clip[], cuts: { from: number; to: number }[], newId: () => string): Pick<ProjectDoc, "clips" | "layers" | "effects" | "sounds"> {
  const ranges = mergeRanges(cuts);
  let next = clips;
  for (const r of [...ranges].reverse()) next = rippleDelete(next, r.from, r.to, newId);
  const span = <T extends { start: number; end: number }>(x: T): T | null => {
    const s = shiftTime(x.start, ranges), e = shiftTime(x.end, ranges);
    return e - s < 0.05 ? null : { ...x, start: s, end: e };
  };
  return {
    clips: next,
    layers: doc.layers?.map(span).filter((x): x is NonNullable<typeof x> => !!x),
    effects: doc.effects?.map(span).filter((x): x is NonNullable<typeof x> => !!x),
    sounds: doc.sounds?.flatMap((s) => {
      const inside = ranges.some((r) => s.start >= r.from && s.start < r.to);
      return inside ? [] : [{ ...s, start: shiftTime(s.start, ranges) }];
    }),
  };
}

/** Total seconds removed by a set of cuts. */
export const cutSeconds = (cuts: { from: number; to: number }[]) => mergeRanges(cuts).reduce((s, r) => s + (r.to - r.from), 0);
