import { describe, expect, it } from "vitest";
import { parseSubtitles, toSRT, toVTT, toWordVTT } from "@/lib/subtitles";
import type { CaptionLine, Word } from "@/lib/types";

const line = (key: string, words: [string, number, number][], extra: Partial<Word> = {}): CaptionLine => {
  const ws = words.map(([text, start, end], i) => ({ id: `${key}${i}`, text, start, end, ...extra }));
  return { id: key, key: `${key}0`, words: ws, start: ws[0].start, end: ws[ws.length - 1].end };
};

describe("export", () => {
  it("writes SRT with a BOM, sorted, non-overlapping cues", () => {
    const srt = toSRT([line("b", [["બીજું", 2, 3]]), line("a", [["પહેલું", 0, 2.5]])]);
    expect(srt.startsWith("﻿1\n00:00:00,000 --> 00:00:01,999\nપહેલું")).toBe(true);
    expect(srt).toContain("2\n00:00:02,000 --> 00:00:03,000\nબીજું");
  });

  it("escapes VTT text and adds speaker voices and translations", () => {
    const l = line("a", [["Tom", 0, 1], ["&", 1, 1.5], ["<Jerry>", 1.5, 2]], { speaker: "speaker_0" });
    const vtt = toVTT([l], 0, { speakers: { speaker_0: { name: "Asha" } }, translations: { a0: { text: "hello", source: "Tom & <Jerry>", lang: "en-IN" } } });
    expect(vtt).toContain("<v Asha>Tom &amp; &lt;Jerry&gt;\nhello");
  });

  it("keeps word stamps inside the cue", () => {
    const vtt = toWordVTT([line("a", [["એક", 0, 0.5], ["બે", 0.6, 1]])], 0.1);
    expect(vtt).toContain("00:00:00.100 --> 00:00:01.100\nએક <00:00:00.700>બે");
  });
});

describe("import", () => {
  it("reads SRT with CRLF, BOM, tags and entities", () => {
    const p = parseSubtitles("﻿1\r\n00:00:01,000 --> 00:00:03,000\r\n<i>નમસ્તે</i> &amp; {\\an8}મિત્રો\r\n\r\n2\r\n00:00:04,500 --> 00:00:05,000\r\nઆવજો\r\n");
    expect(p.format).toBe("srt");
    expect(p.cueCount).toBe(2);
    expect(p.words.map((w) => w.text)).toEqual(["નમસ્તે", "&", "મિત્રો", "આવજો"]);
    expect(p.words[0].start).toBe(1);
    expect(p.words[0].breakBefore).toBe(true);
  });

  it("skips VTT header, NOTE and STYLE blocks and reads voices and short stamps", () => {
    const p = parseSubtitles("WEBVTT - title\n\nNOTE hi\n\nSTYLE\n::cue { color: red }\n\nid-1\n00:01.000 --> 00:02.000 align:start\n<v Ravi>नमस्ते दोस्तों\n");
    expect(p.format).toBe("vtt");
    expect(p.words.map((w) => w.text)).toEqual(["नमस्ते", "दोस्तों"]);
    expect(p.words[0].speaker).toBe("Ravi");
    expect(p.speakers).toEqual(["Ravi"]);
  });

  it("uses karaoke stamps for exact word timing", () => {
    const p = parseSubtitles("WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nએક <00:00:01.250>બે <00:00:02.500>ત્રણ\n");
    expect(p.wordTimed).toBe(true);
    expect(p.words.map((w) => w.start)).toEqual([0, 1.25, 2.5]);
  });

  it("shares time by visible characters, not UTF-16 length", () => {
    // "ક્ષિ" is 1 grapheme cluster but 4 UTF-16 units; "ab" is 2 graphemes
    const p = parseSubtitles("1\n00:00:00,000 --> 00:00:03,000\nક્ષિ ab\n");
    const d0 = p.words[0].end - p.words[0].start;
    const d1 = p.words[1].end - p.words[1].start;
    expect(d1).toBeGreaterThan(d0);
  });

  it("round-trips its own SRT", () => {
    const srt = toSRT([line("a", [["એક", 0, 1]]), line("b", [["બે", 1, 2]])]);
    const p = parseSubtitles(srt);
    expect(p.words.map((w) => [w.text, w.start, w.end])).toEqual([["એક", 0, 0.999], ["બે", 1, 2]]);
  });
});
