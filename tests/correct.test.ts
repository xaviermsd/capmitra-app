import { describe, expect, it } from "vitest";
import { applySuggestions, suggestCorrections } from "@/lib/correct";
import type { Word } from "@/lib/types";

const ws = (texts: string[], gaps: number[] = []) => {
  let t = 0;
  return texts.map((text, i) => { const w: Word = { id: `w${i}`, text, start: t, end: t + 0.3 }; t += 0.4 + (gaps[i] ?? 0); return w; });
};

describe("caption correction", () => {
  it("uses the dictionary first, including multi-word entries, and keeps punctuation", () => {
    const words = ws(["welcome", "to", "cap", "mitra,", "Harsh"]);
    const s = suggestCorrections(words, [["cap mitra", "CapMitra"], ["harsh", "Harsh Prajapati"]]);
    expect(s.map((x) => [x.from, x.to, x.why])).toEqual([["cap mitra,", "CapMitra,", "dictionary"], ["Harsh", "Harsh Prajapati", "dictionary"]]);
  });
  it("suggests built-in fixes and doubled words", () => {
    const words = ws(["મીત્રો", "plz", "the", "the", "vedio."]);
    const s = suggestCorrections(words, []);
    expect(s.map((x) => x.to)).toEqual(["મિત્રો", "please", "the", "video."]);
  });
  it("adds sentence ends after long pauses only when asked", () => {
    const words = ws(["आज", "हम", "बात", "करेंगे"], [0, 0, 0, 0]);
    words[1].end = 0.5; words[2].start = 1.6; words[2].end = 1.9; words[3].start = 2.0; words[3].end = 2.3;
    expect(suggestCorrections(words, []).length).toBe(0);
    expect(suggestCorrections(words, [], { punctuation: true }).map((x) => x.to)).toEqual(["हम।", "करेंगे।"]);
  });
  it("keeps timings when applying, merging two words into one", () => {
    const words = ws(["cap", "mitra", "rocks"]);
    const s = suggestCorrections(words, [["cap mitra", "CapMitra"]]);
    const out = applySuggestions(words, s);
    expect(out.map((w) => w.text)).toEqual(["CapMitra", "rocks"]);
    expect(out[0].start).toBe(words[0].start);
    expect(out[0].end).toBe(words[1].end);
    expect(out[0].id).toBe("w0");
  });
});
