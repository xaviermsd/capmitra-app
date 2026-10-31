import { describe, expect, it } from "vitest";
import { buildTimeline, canMerge, mapWords, mergeWithNext, outToSrc, splitAt, srcToOut, trimEdge } from "@/lib/edl";
import { stretchChannels } from "@/lib/timeStretch";
import type { Clip } from "@/lib/project";

const v = (id: string, a: number, b: number, speed?: number): Clip => ({ id, kind: "video", srcStart: a, srcEnd: b, speed });

describe("clip speed", () => {
  it("shortens a sped-up clip and maps time both ways", () => {
    const tl = buildTimeline([v("a", 0, 10, 2), v("b", 10, 14)]);
    expect(tl.duration).toBe(9);
    expect(outToSrc(tl, 2).src).toBe(4);
    expect(srcToOut(tl, 4)).toBe(2);
    expect(outToSrc(tl, 6).src).toBe(11);
  });
  it("moves captions with the speed", () => {
    const tl = buildTimeline([v("a", 0, 10, 0.5)]);
    const [w] = mapWords([{ id: "w", text: "hi", start: 2, end: 3 }], 0, tl);
    expect(w.start).toBe(4);
    expect(w.end).toBe(6);
  });
  it("splits at the right source moment and joins back", () => {
    const n = splitAt([v("a", 0, 10, 2)], 2, () => "b");
    expect(n.map((c) => (c.kind === "video" ? [c.srcStart, c.srcEnd, c.speed] : null))).toEqual([[0, 4, 2], [4, 10, 2]]);
    expect(canMerge(n, "a")).toBe(true);
    expect(mergeWithNext(n, "a")).toEqual([v("a", 0, 10, 2)]);
    // different speeds don't join
    const m = [v("a", 0, 4, 2), v("b", 4, 10)];
    expect(canMerge(m, "a")).toBe(false);
  });
  it("trims by timeline seconds", () => {
    const n = trimEdge([v("a", 0, 10, 2)], "a", "end", -1, 10);
    expect(n[0].kind === "video" && n[0].srcEnd).toBe(8);
  });
});

describe("time stretch", () => {
  const sine = (hz: number, secs: number, rate = 48000) => {
    const d = new Float32Array(Math.round(secs * rate));
    for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * hz * i) / rate) * 0.5;
    return d;
  };
  const crossings = (d: Float32Array) => { let n = 0; for (let i = 1; i < d.length; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) n++; return n; };
  for (const speed of [2, 0.5, 1.5]) {
    it(`keeps the pitch at ${speed}×`, () => {
      const [out] = stretchChannels([sine(220, 2)], speed);
      expect(out.length).toBe(Math.round(96000 / speed));
      const hz = crossings(out.subarray(2000, out.length - 2000)) / 2 / ((out.length - 4000) / 48000);
      expect(Math.abs(hz - 220)).toBeLessThan(6);
      let peak = 0; for (const x of out) peak = Math.max(peak, Math.abs(x));
      expect(peak).toBeLessThan(0.6);
      expect(peak).toBeGreaterThan(0.4);
    });
  }
});

describe("split through a word", () => {
  it("keeps the word once, across the cut", () => {
    const n = splitAt([v("a", 0, 10)], 3.5, () => "b");
    const out = mapWords([{ id: "w1", text: "one", start: 3, end: 4 }, { id: "w2", text: "two", start: 4.2, end: 5 }], 0, buildTimeline(n));
    expect(out.map((w) => [w.id, w.start, w.end])).toEqual([["w1", 3, 4], ["w2", 4.2, 5]]);
  });
});
