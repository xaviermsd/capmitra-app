/**
 * Long video → shorts: find the strongest moments from the transcript (and
 * the loudness of the soundtrack), as clips of whole sentences.
 *
 * Runs on the device. Everything is in SOURCE video seconds (word time + offset).
 * Scores are heuristics, not an AI's opinion of meaning: complete thoughts,
 * hooks (questions, numbers, "how to", strong words), lively delivery
 * (pace, loudness) and few long pauses. You review and trim every suggestion.
 */
import type { Word } from "./types";

export interface Sentence { start: number; end: number; text: string; words: number }
export interface Highlight {
  id: string;
  start: number;
  end: number;
  score: number;
  /** First words, used as a working title. */
  title: string;
  reasons: string[];
}

const END = /[.!?।॥…]$/;
const HOOKS = [
  // English
  "how to", "why", "what if", "secret", "mistake", "never", "always", "best", "worst", "tip", "trick", "truth", "free", "money", "first time", "you need", "stop",
  // Hindi / Hinglish
  "kaise", "kyun", "kyon", "sach", "galti", "raaz", "zaroor", "कैसे", "क्यों", "सच", "गलती", "राज", "ज़रूर", "सबसे",
  // Gujarati / Gujlish
  "kevi rite", "kem", "saachu", "bhool", "કેવી રીતે", "કેમ", "સાચું", "ભૂલ", "સૌથી", "ખાસ", "જરૂર",
];
const lower = (s: string) => s.toLocaleLowerCase();

/** Split words into sentences: punctuation, a pause of 0.7 s or more, or the start of an imported subtitle cue. */
export function sentences(words: Word[], offset = 0): Sentence[] {
  const out: Sentence[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start + offset, end: cur[cur.length - 1].end + offset, text: cur.map((w) => w.text).join(" "), words: cur.length });
    cur = [];
  };
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (END.test(w.text) || !next || next.start - w.end >= 0.7 || next.breakBefore) flush();
  });
  flush();
  return out;
}

/** Loudness (0..1) of a span from a waveform of peaks at `rate` buckets per second. */
function loudness(peaks: ArrayLike<number> | undefined, rate: number, a: number, b: number): number {
  if (!peaks || !peaks.length) return 0.5;
  const i0 = Math.max(0, Math.floor(a * rate)), i1 = Math.min(peaks.length, Math.ceil(b * rate));
  let s = 0, n = 0;
  for (let i = i0; i < i1; i++) { s += peaks[i]; n++; }
  return n ? s / n : 0;
}

function hookScore(text: string): { s: number; why?: string } {
  const t = lower(text);
  if (/[?？]/.test(text)) return { s: 1, why: "a question" };
  const h = HOOKS.find((k) => t.includes(k));
  if (h) return { s: 0.8, why: `“${h}”` };
  if (/\d/.test(text)) return { s: 0.6, why: "a number" };
  if (/!/.test(text)) return { s: 0.5, why: "an exclamation" };
  return { s: 0 };
}

/**
 * Suggest up to `count` non-overlapping clips of `minLen`..`maxLen` seconds,
 * best first. `peaks`: waveform peaks (0..1) at `rate` per second, optional.
 */
export function findHighlights(words: Word[], opts: { offset?: number; minLen?: number; maxLen?: number; count?: number; peaks?: ArrayLike<number>; rate?: number } = {}): Highlight[] {
  const { offset = 0, minLen = 15, maxLen = 60, count = 6, peaks, rate = 100 } = opts;
  const ss = sentences(words, offset);
  if (!ss.length) return [];
  // overall loudness, to judge each part against the video's own average
  const avgLoud = loudness(peaks, rate, ss[0].start, ss[ss.length - 1].end) || 0.5;
  const sScore = ss.map((s) => {
    const dur = Math.max(0.3, s.end - s.start);
    const pace = s.words / dur; // words per second
    const loud = loudness(peaks, rate, s.start, s.end) / avgLoud;
    const hook = hookScore(s.text);
    return { hook, pace, loud, v: 0.45 * hook.s + 0.25 * Math.min(1, pace / 3) + 0.3 * Math.min(1.5, loud) / 1.5 };
  });

  const cands: Highlight[] = [];
  for (let i = 0; i < ss.length; i++) {
    let j = i;
    while (j + 1 < ss.length && ss[j + 1].end - ss[i].start <= maxLen && ss[j + 1].start - ss[j].end < 2.5) j++;
    // shrink from the end while still long enough, keeping the best-scoring end
    let best: { j: number; v: number } | null = null;
    for (let k = j; k >= i; k--) {
      const len = ss[k].end - ss[i].start;
      if (len < minLen) break;
      const part = sScore.slice(i, k + 1);
      let gaps = 0;
      for (let m = i; m < k; m++) gaps += Math.max(0, ss[m + 1].start - ss[m].end - 0.4);
      const mean = part.reduce((s, x) => s + x.v, 0) / part.length;
      const opener = sScore[i].hook.s * 0.35; // a strong first line keeps viewers
      const closes = END.test(ss[k].text.trim()) ? 0.08 : 0;
      const v = mean + opener + closes - (gaps / len) * 0.8;
      if (!best || v > best.v) best = { j: k, v };
    }
    if (!best) continue;
    const opener = sScore[i].hook.why;
    const later = [...new Set(sScore.slice(i + 1, best.j + 1).map((x) => x.hook.why).filter((w): w is string => !!w && w !== opener))].slice(0, 2);
    const reasons = [opener ? `Opens with ${opener}` : "", later.length ? `Also ${later.join(", ")}` : ""].filter(Boolean);
    if (sScore.slice(i, best.j + 1).some((x) => x.loud > 1.15)) reasons.push("Lively delivery");
    const firstWords = ss[i].text.split(/\s+/).slice(0, 7).join(" ");
    cands.push({ id: `h${i}`, start: Math.max(0, ss[i].start - 0.15), end: ss[best.j].end + 0.3, score: best.v, title: firstWords, reasons: reasons.slice(0, 3) });
  }

  // best first, no overlaps
  cands.sort((a, b) => b.score - a.score);
  const picked: Highlight[] = [];
  for (const c of cands) {
    if (picked.length >= count) break;
    if (picked.some((p) => c.start < p.end && p.start < c.end)) continue;
    picked.push(c);
  }
  const top = picked[0]?.score || 1;
  return picked.map((p) => ({ ...p, score: Math.max(1, Math.round((p.score / top) * 100)) }));
}
