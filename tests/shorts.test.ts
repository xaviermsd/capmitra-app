import { describe, expect, it } from "vitest";
import { findHighlights, sentences } from "@/lib/shorts";
import type { Word } from "@/lib/types";

// 4 minutes of speech: sentences of 6 words, 2.4 s each, 0.3 s gap; a few "hook" sentences
function talk(): Word[] {
  const out: Word[] = []; let t = 0; let n = 0;
  for (let s = 0; s < 90; s++) {
    const hook = s === 30 ? "How to grow your channel fast?" : s === 70 ? "The biggest mistake 90% people make." : null;
    const ws = (hook ?? "we talk about the plan today.").split(" ");
    ws.forEach((x) => { out.push({ id: `w${n++}`, text: x, start: t, end: t + 0.35 }); t += 0.4; });
    t += 0.3;
  }
  return out;
}

describe("long video to shorts", () => {
  it("splits sentences on punctuation", () => {
    expect(sentences(talk()).length).toBe(90);
  });
  it("suggests non-overlapping clips within the length limits, hooks first", () => {
    const h = findHighlights(talk(), { minLen: 15, maxLen: 45, count: 4 });
    expect(h.length).toBe(4);
    for (const c of h) { expect(c.end - c.start).toBeGreaterThanOrEqual(15); expect(c.end - c.start).toBeLessThanOrEqual(46); }
    for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) expect(h[i].end <= h[j].start || h[j].end <= h[i].start).toBe(true);
    expect(h[0].title.startsWith("How to") || h[0].title.startsWith("The biggest")).toBe(true);
    expect(h[0].score).toBe(100);
  });
  it("applies the transcript offset", () => {
    const a = findHighlights(talk(), { count: 1 })[0];
    const b = findHighlights(talk(), { count: 1, offset: 2 })[0];
    expect(b.start - a.start).toBeCloseTo(2, 5);
  });
});
