import { describe, expect, it } from "vitest";
import { chunkRanges, mergeChunkWords, planCuts, quietestPoint, shiftWords } from "@/lib/chunking";
import type { Word } from "@/lib/types";

const w = (id: string, text: string, start: number, end: number): Word => ({ id, text, start, end });

describe("quietestPoint", () => {
  it("finds the silent gap", () => {
    const levels = new Array(1000).fill(0.8);
    for (let i = 600; i < 640; i++) levels[i] = 0;
    const t = quietestPoint(levels, 100, 4, 9, 0.2);
    expect(t).toBeGreaterThanOrEqual(6);
    expect(t).toBeLessThanOrEqual(6.4);
  });
});

describe("planCuts", () => {
  it("keeps short audio in one piece", () => {
    expect(planCuts(9 * 60, null, 100)).toEqual([]);
  });

  it("cuts a 45-minute talk into pieces no longer than 10 minutes", () => {
    const dur = 45 * 60;
    const cuts = planCuts(dur, null, 100);
    const edges = [0, ...cuts, dur];
    for (let i = 1; i < edges.length; i++) {
      const len = edges[i] - edges[i - 1];
      expect(len).toBeLessThanOrEqual(10 * 60 + 1e-6);
      expect(len).toBeGreaterThan(4 * 60); // no tiny last piece
    }
  });

  it("cuts at a quiet moment inside the allowed window", () => {
    const rate = 100;
    const dur = 15 * 60;
    const levels = new Float32Array(dur * rate).fill(0.7);
    const quietAt = 7.5 * 60; // inside the balanced window for a 15-minute file
    for (let i = quietAt * rate; i < (quietAt + 1) * rate; i++) levels[i] = 0;
    const [cut] = planCuts(dur, levels, rate);
    expect(Math.abs(cut - (quietAt + 0.5))).toBeLessThan(0.6);
  });
});

describe("chunkRanges", () => {
  it("overlaps neighbours and keeps the full timeline", () => {
    const r = chunkRanges(1200, [600], 1.5);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ start: 0, end: 601.5, keepFrom: 0, keepTo: 600 });
    expect(r[1]).toMatchObject({ start: 598.5, end: 1200, keepFrom: 600, keepTo: Infinity });
  });
});

describe("mergeChunkWords", () => {
  it("shifts piece times and drops the duplicate heard by both pieces", () => {
    const [a, b] = chunkRanges(20, [10], 1.5);
    const pieceA = [w("a1", "નમસ્તે", 8, 8.6), w("a2", "મિત્રો", 9.7, 10.4), w("a3", "આજે", 10.9, 11.3)];
    // piece B starts at 8.5 s on the original timeline; its own times start at 0
    const pieceB = shiftWords([w("b1", "મિત્રો", 1.25, 1.95), w("b2", "આજે", 2.4, 2.8), w("b3", "વાત", 3, 3.4)], 8.5);
    const out = mergeChunkWords([{ range: b, words: pieceB }, { range: a, words: pieceA }]);
    expect(out.map((x) => x.text)).toEqual(["નમસ્તે", "મિત્રો", "આજે", "વાત"]);
    expect(out[2].start).toBeCloseTo(10.9, 5);
    expect(out[3].start).toBeCloseTo(11.5, 5);
  });

  it("keeps a word that straddles the cut exactly once", () => {
    const [a, b] = chunkRanges(20, [10], 1.5);
    const straddle = w("x", "ગુજરાત", 9.8, 10.3); // midpoint 10.05 → belongs to piece B
    const out = mergeChunkWords([
      { range: a, words: [w("x1", "ગુજરાત", 9.8, 10.3)] },
      { range: b, words: [{ ...straddle, id: "x2" }] },
    ]);
    expect(out).toHaveLength(1);
  });

  it("never returns overlapping or reversed times", () => {
    const [a, b] = chunkRanges(30, [15], 1.5);
    const out = mergeChunkWords([
      { range: a, words: [w("1", "a", 14, 14.9)] },
      { range: b, words: [w("2", "b", 14.95, 15.5), w("3", "c", 15.5, 15.51)] },
    ]);
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].start);
    for (const x of out) expect(x.end).toBeGreaterThan(x.start);
  });
});
