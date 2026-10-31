/**
 * Re-sync: move the words someone has already edited onto fresh timings from a
 * new transcript of the same audio. Text, ★ emphasis, emoji, line breaks,
 * speakers and spellings all stay; only start and end change.
 *
 * Words are matched in order by their normalised text, looking a short way
 * ahead in the new transcript so a few changed or missing words don't derail
 * the rest. Words with no match get times spread between their matched
 * neighbours.
 */
import type { Word } from "./types";

const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");

/** How far ahead (in new words) to look for a match. */
const LOOKAHEAD = 12;

export interface ResyncResult { words: Word[]; matched: number; total: number }

export function resyncWords(edited: Word[], fresh: Word[]): ResyncResult {
  const out = edited.map((w) => ({ ...w }));
  const hit: boolean[] = new Array(out.length).fill(false);
  let j = 0;
  for (let i = 0; i < out.length && j < fresh.length; i++) {
    const key = norm(out[i].text);
    if (!key) continue;
    for (let k = j; k < Math.min(fresh.length, j + LOOKAHEAD); k++) {
      if (norm(fresh[k].text) === key) {
        out[i].start = fresh[k].start;
        out[i].end = fresh[k].end;
        hit[i] = true;
        j = k + 1;
        break;
      }
    }
  }
  // spread unmatched words evenly between the matched words around them
  let i = 0;
  while (i < out.length) {
    if (hit[i]) { i++; continue; }
    let e = i;
    while (e < out.length && !hit[e]) e++;
    const from = i > 0 ? out[i - 1].end : Math.min(edited[i].start, fresh[0]?.start ?? edited[i].start);
    const to = e < out.length ? out[e].start : Math.max(from, edited[e - 1].end, fresh[fresh.length - 1]?.end ?? 0);
    const n = e - i;
    const step = Math.max(0, to - from) / n;
    for (let k = 0; k < n; k++) {
      out[i + k].start = from + step * k;
      out[i + k].end = from + step * (k + 1);
    }
    i = e;
  }
  return { words: out, matched: hit.filter(Boolean).length, total: out.length };
}
