/**
 * Caption correction: suggestions to accept or reject, never applied silently.
 *
 * Sources, in order:
 *   1. Your dictionary (Settings → spelling fixes, "wrong = right", shared by every project)
 *   2. Built-in fixes for common speech-to-text slips in Gujarati, Hindi and Hinglish
 *   3. Tidy-ups: stray spaces, doubled words, punctuation spacing, sentence-end marks
 *
 * Only a word's text changes. Its id, start and end stay, so timings,
 * highlights and animations are kept.
 */
import type { Word } from "./types";

export interface Suggestion {
  id: string;
  /** Index of the first word in `words`. */
  index: number;
  /** How many words the fix replaces (1, or 2 for doubled/merged words). */
  span: number;
  from: string;
  to: string;
  why: "dictionary" | "common" | "doubled" | "spacing" | "punctuation";
}

const WHY_LABEL: Record<Suggestion["why"], string> = {
  dictionary: "Your dictionary",
  common: "Common fix",
  doubled: "Repeated word",
  spacing: "Spacing",
  punctuation: "Punctuation",
};
export const whyLabel = (w: Suggestion["why"]) => WHY_LABEL[w];

/**
 * Built-in fixes: frequent mis-hearings and spelling variants. Kept short and
 * conservative; whole-word matches only. Add your own in the dictionary.
 */
const COMMON: [string, string][] = [
  // Gujarati
  ["છે.છે", "છે"], ["નમસતે", "નમસ્તે"], ["મીત્રો", "મિત્રો"], ["ગુજરાતિ", "ગુજરાતી"], ["ધન્યવાદ્", "ધન્યવાદ"],
  ["વીડીયો", "વિડિયો"], ["વિડીયો", "વિડિયો"], ["વીડિયો", "વિડિયો"], ["સબસ્ક્રાઈબ", "સબ્સ્ક્રાઇબ"], ["લાઈક", "લાઇક"],
  ["ચેનલ્", "ચેનલ"], ["કરીસુ", "કરીશું"], ["કરીશુ", "કરીશું"],
  // Hindi
  ["नमस्ते.", "नमस्ते"], ["दोस्तो", "दोस्तों"], ["धन्यबाद", "धन्यवाद"], ["वीडियो.", "वीडियो"], ["सब्सक्राईब", "सब्सक्राइब"],
  ["लाईक", "लाइक"], ["चैनल्", "चैनल"],
  // Hinglish / Gujlish (Roman)
  ["namaskar", "namaskaar"], ["dosto", "doston"], ["subcribe", "subscribe"], ["subscibe", "subscribe"], ["vedio", "video"],
  ["vidoe", "video"], ["chanel", "channel"], ["thnks", "thanks"], ["plz", "please"], ["pls", "please"],
  ["whatsapp", "WhatsApp"], ["youtube", "YouTube"], ["instagram", "Instagram"], ["facebook", "Facebook"],
];

const PUNCT_END = /[.!?।॥…]$/;
const strip = (s: string) => s.replace(/^[\s"'“”‘’(]+|[\s"'“”‘’),.!?।॥:;…]+$/g, "");
const lower = (s: string) => s.toLocaleLowerCase();

function rulesMap(rules: [string, string][]) {
  const m = new Map<string, string>();
  for (const [a, b] of rules) if (a.trim()) m.set(lower(a.trim()), b.trim());
  return m;
}

/** Keep the word's surrounding punctuation when replacing its core. */
function swapCore(text: string, core: string, to: string) {
  const i = text.indexOf(core);
  return i < 0 ? to : text.slice(0, i) + to + text.slice(i + core.length);
}

/**
 * Suggestions for a transcript. `dictionary` = the user's "wrong = right" rules
 * (multi-word entries allowed, e.g. "cap mitra = CapMitra").
 */
export function suggestCorrections(words: Word[], dictionary: [string, string][], opts: { punctuation?: boolean } = {}): Suggestion[] {
  const out: Suggestion[] = [];
  const dict = rulesMap(dictionary);
  const common = rulesMap(COMMON);
  const multi = [...dict.entries()].filter(([k]) => k.includes(" ")).map(([k, v]) => [k.split(/\s+/), v] as const);
  const taken = new Set<number>();
  const add = (s: Omit<Suggestion, "id">) => {
    for (let k = 0; k < s.span; k++) if (taken.has(s.index + k)) return;
    for (let k = 0; k < s.span; k++) taken.add(s.index + k);
    out.push({ ...s, id: `${s.why}-${s.index}` });
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // 1. dictionary: multi-word entries first ("cap mitra" → "CapMitra")
    for (const [parts, to] of multi) {
      if (parts.every((p, k) => words[i + k] && lower(strip(words[i + k].text)) === p)) {
        const from = parts.map((_, k) => words[i + k].text).join(" ");
        const last = words[i + parts.length - 1].text;
        const tail = last.match(/[,.!?।॥:;…]+$/)?.[0] ?? "";
        add({ index: i, span: parts.length, from, to: to + tail, why: "dictionary" });
      }
    }
    const core = strip(w.text);
    if (!core) continue;
    const d = dict.get(lower(core));
    if (d !== undefined && d !== core) { add({ index: i, span: 1, from: w.text, to: swapCore(w.text, core, d), why: "dictionary" }); continue; }
    // 2. built-in fixes
    const c = common.get(lower(core));
    if (c !== undefined && c !== core) { add({ index: i, span: 1, from: w.text, to: swapCore(w.text, core, c), why: "common" }); continue; }
    // 3. tidy-ups
    const next = words[i + 1];
    if (next && lower(strip(next.text)) === lower(core) && core.length > 1 && !/^\d+$/.test(core) && next.start - w.end < 0.6) {
      add({ index: i, span: 2, from: `${w.text} ${next.text}`, to: next.text, why: "doubled" });
      continue;
    }
    const spaced = w.text.replace(/\s{2,}/g, " ").replace(/\s+([,.!?।॥:;])/g, "$1").trim();
    if (spaced !== w.text) { add({ index: i, span: 1, from: w.text, to: spaced, why: "spacing" }); continue; }
  }

  // sentence-end marks: a long pause after a word with no punctuation
  if (opts.punctuation) {
    for (let i = 0; i < words.length; i++) {
      const w = words[i], next = words[i + 1];
      const gap = next ? next.start - w.end : Infinity;
      if (taken.has(i) || PUNCT_END.test(w.text) || /[,:;]$/.test(w.text)) continue;
      if (gap >= 0.8 || (!next && words.length > 3)) {
        const mark = /[ऀ-ॿ]/.test(w.text) ? "।" : ".";
        add({ index: i, span: 1, from: w.text, to: w.text + mark, why: "punctuation" });
      }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Apply accepted suggestions to SOURCE words. `words` here are the project's
 * own words (the suggestion indices must refer to the same array).
 * A two-word fix keeps the first word's start and the last word's end.
 */
export function applySuggestions(words: Word[], accepted: Suggestion[]): Word[] {
  const byIndex = new Map(accepted.map((s) => [s.index, s]));
  const out: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    const s = byIndex.get(i);
    if (!s) { out.push(words[i]); continue; }
    const last = words[i + s.span - 1];
    out.push({ ...words[i], text: s.to, end: last.end, roman: undefined });
    i += s.span - 1;
  }
  return out;
}
