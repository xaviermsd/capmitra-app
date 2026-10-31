import { describe, expect, it } from "vitest";
import { applyCuts, cutsFromWords, findFillers, findPauses, mergeRanges } from "@/lib/textEdit";
import { buildTimeline } from "@/lib/edl";
import type { Clip, ProjectDoc } from "@/lib/project";
import type { Word } from "@/lib/types";

const w = (text: string, start: number, end: number, i: number): Word => ({ id: `w${i}`, text, start, end });
const words: Word[] = [
  w("So", 0, 0.3, 0), w("um", 0.4, 0.6, 1), w("today", 0.7, 1.1, 2), w("we", 1.2, 1.4, 3),
  w("talk", 3.0, 3.4, 4), w("you", 3.5, 3.6, 5), w("know", 3.6, 3.9, 6), w("about", 4.0, 4.4, 7), w("captions", 4.5, 5.2, 8),
];
const clips: Clip[] = [{ kind: "video", id: "c1", srcStart: 0, srcEnd: 6 } as Clip];
const id = (() => { let n = 0; return () => `n${n++}`; })();

describe("edit by text", () => {
  it("finds long pauses and keeps a little breath", () => {
    const p = findPauses(words, 0.6);
    expect(p).toHaveLength(1);
    expect(p[0].from).toBeCloseTo(1.52, 2);
    expect(p[0].to).toBeCloseTo(2.88, 2);
  });
  it("finds filler words and phrases", () => {
    const f = findFillers(words);
    expect(f.map((x) => x.label)).toEqual(["um", "you know"]);
  });
  it("groups neighbouring selected words into one cut", () => {
    const c = cutsFromWords(words, [5, 6, 1]);
    expect(c).toHaveLength(2);
    expect(c[1].words).toEqual([5, 6]);
  });
  it("applies cuts, shortens the video and moves graphics, effects and sounds", () => {
    const doc = {
      layers: [{ id: "l1", start: 4.0, end: 5.0 }, { id: "l2", start: 1.6, end: 2.5 }],
      effects: [{ id: "e1", start: 4.5, end: 4.8 }],
      sounds: [{ id: "s1", start: 4.2, duration: 0.5 }, { id: "s2", start: 2.0, duration: 0.5 }],
    } as unknown as ProjectDoc;
    const cuts = [...findPauses(words, 0.6), ...cutsFromWords(words, [1])];
    const removed = mergeRanges(cuts).reduce((s, r) => s + r.to - r.from, 0);
    const r = applyCuts(doc, clips, cuts, id);
    expect(buildTimeline(r.clips!).duration).toBeCloseTo(6 - removed, 2);
    expect(r.layers!.map((l) => l.id)).toEqual(["l1"]); // l2 sat inside the pause
    expect(r.layers![0].start).toBeCloseTo(4.0 - removed, 2);
    expect(r.effects![0].start).toBeCloseTo(4.5 - removed, 2);
    expect(r.sounds!.map((s) => s.id)).toEqual(["s1"]);
  });
});
