import { splitClusters } from "./animation";
import type { CaptionLine, CaptionStyle, Word } from "./types";

/** Sentence-ending punctuation, including the Indic danda. */
const SENTENCE_END = /[.!?।॥]["')\]]*$/;

/** Options for measuring text so captions are split by how wide they really are. */
export interface GroupingOptions {
  /** Width of `text` in em (1 em = the caption font size). */
  measure?: (text: string) => number;
  /** Frame width ÷ height (e.g. 9/16). Defaults to 9:16. */
  aspect?: number;
}

/** Fallback width estimate in em: visible characters (graphemes) × an average advance. */
export function estimateEm(text: string): number {
  let em = 0;
  for (const g of splitClusters(text)) {
    if (/^\s$/.test(g)) em += 0.28;
    else if (/[\u0A80-\u0AFF\u0900-\u097F\u0980-\u0DFF]/.test(g)) em += 0.62; // Indic clusters are wide
    else if (/[\u3040-\u9FFF\uAC00-\uD7AF]/.test(g)) em += 1; // CJK
    else if (/[A-Z0-9]/.test(g)) em += 0.62;
    else em += 0.52;
  }
  return em;
}

/**
 * Split a flat list of timed words into captions.
 *
 * Close a caption when it reaches the word limit, when the speaker pauses or
 * changes, after a sentence ends, or when the text would no longer fit in the allowed rows. Width is
 * measured with the real font when `opts.measure` is given; otherwise it is
 * estimated from visible characters, never from UTF-16 length (which counts
 * every Gujarati/Hindi vowel sign and virama as a letter).
 */
export function groupWords(
  words: Word[],
  style: Pick<CaptionStyle, "maxWords" | "maxRows" | "breakOnPause" | "minDuration"> & Partial<Pick<CaptionStyle, "maxWidthPct" | "sizeVh" | "wordGap">>,
  opts: GroupingOptions = {},
): CaptionLine[] {
  const lines: CaptionLine[] = [];
  const maxWords = Math.max(1, style.maxWords);
  const rows = Math.max(1, style.maxRows);
  const aspect = opts.aspect ?? 9 / 16;
  const measure = opts.measure ?? estimateEm;
  // usable row width in em = (frame width × maxWidth%) / font size
  const rowEm = ((style.maxWidthPct ?? 86) / 100) * aspect / ((style.sizeVh ?? 6) / 100);
  const gapEm = style.wordGap ?? 0.28;
  let cur: Word[] = [];

  const flush = () => {
    if (!cur.length) return;
    lines.push({
      id: `line-${lines.length}`,
      key: cur[0].id,
      words: cur,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
    });
    cur = [];
  };

  /** Rows needed to lay out these words (greedy, like the renderer). */
  const rowsFor = (ws: Word[]) => {
    let n = 1;
    let w = 0;
    for (const x of ws) {
      const ew = measure(x.text);
      if (x.lineBreak && w > 0) { n++; w = ew; continue; }
      const add = w > 0 ? gapEm + ew : ew;
      if (w > 0 && w + add > rowEm) { n++; w = ew; } else w += add;
    }
    return n;
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    if (w.breakBefore) {
      flush();
    } else if (cur.length) {
      if (
        (prev && w.start - prev.end > style.breakOnPause) ||
        cur.length >= maxWords ||
        (prev && (prev.speaker ?? "") !== (w.speaker ?? "")) ||
        rowsFor([...cur, w]) > rows
      ) {
        flush();
      }
    }
    cur.push(w);
    if (SENTENCE_END.test(w.text)) flush();
  }
  flush();

  // stretch short captions up to minDuration without overlapping the next one
  if (style.minDuration > 0) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const next = lines[i + 1];
      let end = Math.max(l.end, l.start + style.minDuration);
      if (next) end = Math.min(end, next.start - 0.01);
      l.end = Math.max(l.end, end);
    }
  }
  return lines;
}

/** How long a caption lingers after its last word ends (s). */
export const LINGER = 0.22;

/** Index of the caption visible at time t, or -1. Prefers the latest one. */
export function lineAt(lines: CaptionLine[], t: number): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    const next = lines[i + 1];
    const tail = next ? Math.min(LINGER, Math.max(0, next.start - l.end)) : LINGER;
    if (t >= l.start && t < l.end + tail) return i;
  }
  return -1;
}

export type WordState = "upcoming" | "active" | "spoken";

export function wordState(w: Word, t: number): WordState {
  if (t < w.start) return "upcoming";
  if (t < w.end) return "active";
  return "spoken";
}

/** Words of a caption that are on screen at time t for a reveal mode. */
export function shownWords(words: Word[], t: number, reveal: CaptionStyle["reveal"]): Word[] {
  if (reveal !== "build" && reveal !== "solo") return words;
  let n = 0;
  while (n < words.length && words[n].start <= t) n++;
  n = Math.max(1, n);
  return reveal === "solo" ? words.slice(n - 1, n) : words.slice(0, n);
}
