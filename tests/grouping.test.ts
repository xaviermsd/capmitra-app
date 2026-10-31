import { describe, expect, it } from "vitest";
import { estimateEm, groupWords } from "@/lib/grouping";
import type { Word } from "@/lib/types";

const style = { maxWords: 10, maxRows: 1, breakOnPause: 1, minDuration: 0, maxWidthPct: 86, sizeVh: 6, wordGap: 0.28 };
const words = (texts: string[], extra: Partial<Word>[] = []): Word[] => texts.map((text, i) => ({ id: `w${i}`, text, start: i * 0.3, end: i * 0.3 + 0.25, ...(extra[i] ?? {}) }));

describe("width-aware grouping", () => {
  it("counts Gujarati clusters, not UTF-16 units", () => {
    // 4 graphemes vs 12 UTF-16 units
    expect(estimateEm("સ્ત્રી")).toBeLessThan(estimateEm("abcdefghijkl"));
  });

  it("breaks when the measured text no longer fits the row", () => {
    const measure = (t: string) => t.length; // 1 em per character
    const lines = groupWords(words(["aaaa", "bbbb", "cccc"]), style, { measure, aspect: 9 / 16 });
    // row ≈ 8 em: "aaaa bbbb" (8.28) doesn't fit
    expect(lines.map((l) => l.words.length)).toEqual([1, 1, 1]);
    const wide = groupWords(words(["aaaa", "bbbb", "cccc"]), style, { measure, aspect: 16 / 9 });
    expect(wide).toHaveLength(1);
  });

  it("starts a new caption when the speaker changes", () => {
    const lines = groupWords(words(["a", "b", "c"], [{ speaker: "s0" }, { speaker: "s0" }, { speaker: "s1" }]), { ...style, maxRows: 2 });
    expect(lines.map((l) => l.words.map((w) => w.text).join(""))).toEqual(["ab", "c"]);
  });

  it("respects manual row breaks when counting rows", () => {
    const lines = groupWords(words(["a", "b"], [{}, { lineBreak: true }]), style);
    expect(lines).toHaveLength(2);
    const two = groupWords(words(["a", "b"], [{}, { lineBreak: true }]), { ...style, maxRows: 2 });
    expect(two).toHaveLength(1);
  });

  it("still closes captions at sentence ends (including the danda)", () => {
    const lines = groupWords(words(["હા।", "ના"]), { ...style, maxRows: 2 });
    expect(lines).toHaveLength(2);
  });
});
