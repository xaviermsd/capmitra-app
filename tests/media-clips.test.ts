import { describe, expect, it } from "vitest";
import { buildTimeline, insertClip, mapWords, mergeWithNext, trimEdge, isTrivial } from "@/lib/edl";
import type { Clip } from "@/lib/project";
import type { Word } from "@/lib/types";

let n = 0;
const newId = () => `n${n++}`;
const main = (id: string, a: number, b: number): Clip => ({ id, kind: "video", srcStart: a, srcEnd: b });
const extra = (id: string, a: number, b: number): Clip => ({ id, kind: "video", sourceId: "vid1", srcDuration: 30, srcStart: a, srcEnd: b, name: "B-roll" });
const img = (id: string, d: number, asset = "img1"): Clip => ({ id, kind: "image", assetId: asset, duration: d });
const words: Word[] = [{ id: "w1", text: "a", start: 1, end: 2 }, { id: "w2", text: "b", start: 5, end: 6 }] as Word[];

describe("adding media to the timeline", () => {
  it("appends at the end and prepends at the start", () => {
    const base = [main("m", 0, 10)];
    expect(insertClip(base, img("i", 4), "end", 0, newId)).toEqual({ clips: [base[0], img("i", 4)], at: 10 });
    expect(insertClip(base, img("i", 4), "start", 7, newId).clips[0].id).toBe("i");
    expect(insertClip([], img("i", 4), "playhead", 3, newId).clips).toHaveLength(1);
  });
  it("inserts at the playhead by splitting the clip under it", () => {
    const r = insertClip([main("m", 0, 10)], extra("x", 0, 5), "playhead", 4, newId);
    expect(r.at).toBe(4);
    expect(r.clips.map((c) => (c.kind === "video" ? [c.sourceId ?? "main", c.srcStart, c.srcEnd] : null))).toEqual([["main", 0, 4], ["vid1", 0, 5], ["main", 4, 10]]);
    expect(buildTimeline(r.clips).duration).toBe(15);
  });
  it("snaps to the ends instead of splitting right at an edge", () => {
    const r = insertClip([main("m", 0, 10)], img("i", 2), "playhead", 9.99, newId);
    expect(r.clips.map((c) => c.id)).toEqual(["m", "i"]);
  });
});

describe("extra videos and images on the timeline", () => {
  it("image clips last their duration and are silent for captions", () => {
    const tl = buildTimeline([main("m", 0, 4), img("i", 3), main("m2", 4, 8)]);
    expect(tl.duration).toBe(11);
    const out = mapWords(words, 0, tl);
    // the word at 5 to 6 s of the source now plays after the 3 s image
    expect(out.map((w) => [w.id, w.start, w.end])).toEqual([["w1", 1, 2], ["w2", 8, 9]]);
  });
  it("captions never come from an added video, even at the same source times", () => {
    const tl = buildTimeline([extra("x", 0, 10)]);
    expect(mapWords(words, 0, tl)).toEqual([]);
  });
  it("trims an added video against its own length, not the main video's", () => {
    const [c] = trimEdge([extra("x", 0, 10)], "x", "end", 100, 4 /* main video is only 4 s */);
    expect(c.kind === "video" && c.srcEnd).toBe(30);
    const [d] = trimEdge([img("i", 3)], "i", "end", 2, 4);
    expect(d.kind === "image" && d.duration).toBe(5);
  });
  it("joins neighbouring pieces of the same image, but not different sources", () => {
    expect(mergeWithNext([img("a", 2), img("b", 3)], "a")).toEqual([img("a", 5)]);
    const mixed = [main("m", 0, 5), extra("x", 5, 8)];
    expect(mergeWithNext(mixed, "m")).toBe(mixed);
    const two = [img("a", 2), img("b", 3, "img2")];
    expect(mergeWithNext(two, "a")).toBe(two);
  });
  it("an added video alone is not the simple single-pass export case", () => {
    expect(isTrivial([main("m", 0, 5)])).toBe(true);
    expect(isTrivial([extra("x", 0, 5)])).toBe(false);
  });
});
