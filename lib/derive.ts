/**
 * From a project document to what gets drawn: clips, the edit timeline,
 * words and captions on the output timeline. Used by the editor, batch
 * processing and batch export, so they all agree.
 */
import { buildTimeline, mapWords, type EditTimeline } from "./edl";
import { groupWords } from "./grouping";
import { effectiveClips, type Clip, type ProjectDoc } from "./project";
import type { CaptionLine, Word } from "./types";

export interface Derived {
  clips: Clip[];
  tl: EditTimeline;
  outWords: Word[];
  lines: CaptionLine[];
}

export function deriveProject(doc: ProjectDoc, srcDuration: number, opts: { measure?: (t: string) => number; aspect?: number } = {}): Derived {
  const lastWordEnd = doc.words.length ? doc.words[doc.words.length - 1].end + doc.offset : 0;
  const clips = effectiveClips(doc, srcDuration > 0 ? srcDuration : Math.max(1, lastWordEnd + 1));
  const tl = buildTimeline(clips);
  const outWords = mapWords(doc.words, doc.offset, tl);
  const lines = groupWords(outWords, doc.style, opts);
  for (let i = 0; i < lines.length; i++) {
    const ext = doc.overrides[lines[i].key]?.extend;
    if (ext) lines[i].end = Math.min(lines[i].end + ext, lines[i + 1] ? lines[i + 1].start - 0.01 : lines[i].end + ext);
  }
  return { clips, tl, outWords, lines };
}
