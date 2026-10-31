import { describe, expect, it } from "vitest";
import { buildTimeline, canMerge, mapWords, mergeWithNext, moveClip, outToSrc, removeClip, rippleDelete, splitAt, srcToOut, transitionAt, trimEdge } from "@/lib/edl";
import { clipsFromTrim, effectiveClips, migrate, reviveClips, serialiseClips, type Clip } from "@/lib/project";
import type { Word } from "@/lib/types";

let n = 0;
const id = () => `n${n++}`;
const v = (cid: string, a: number, b: number): Clip => ({ id: cid, kind: "video", srcStart: a, srcEnd: b });
const card = (cid: string, d: number): Clip => ({ id: cid, kind: "card", duration: d, background: { kind: "color", color: "#000" } });
const w = (wid: string, s: number, e: number): Word => ({ id: wid, text: wid, start: s, end: e });

describe("timeline layout", () => {
  it("places clips back to back", () => {
    const tl = buildTimeline([card("intro", 2), v("a", 10, 15), v("b", 30, 33)]);
    expect(tl.duration).toBe(10);
    expect(tl.items.map((i) => [i.outStart, i.outEnd])).toEqual([[0, 2], [2, 7], [7, 10]]);
  });

  it("maps output time to source time and back", () => {
    const tl = buildTimeline([card("intro", 2), v("a", 10, 15), v("b", 30, 33)]);
    expect(outToSrc(tl, 1).src).toBeNull();
    expect(outToSrc(tl, 3).src).toBe(11);
    expect(outToSrc(tl, 8).src).toBe(31);
    expect(srcToOut(tl, 31)).toBe(8);
    expect(srcToOut(tl, 20)).toBeNull(); // cut out
  });
});

describe("captions follow the edit", () => {
  it("drops words in cut parts and shifts the rest", () => {
    const tl = buildTimeline([v("a", 0, 5), v("b", 10, 20)]);
    const out = mapWords([w("x", 1, 1.5), w("cut", 6, 7), w("y", 11, 11.5)], 0, tl);
    expect(out.map((o) => o.id)).toEqual(["x", "y"]);
    expect(out[1].start).toBe(6);
  });

  it("applies the caption offset and clips words crossing a cut", () => {
    const tl = buildTimeline([v("a", 0, 5)]);
    const out = mapWords([w("edge", 4.5, 5.5)], 0.2, tl);
    expect(out[0].start).toBeCloseTo(4.7);
    expect(out[0].end).toBe(5);
  });

  it("gives a repeated source word a distinct id", () => {
    const tl = buildTimeline([v("a", 0, 2), v("b", 0, 2)]);
    const out = mapWords([w("x", 1, 1.2)], 0, tl);
    expect(out.map((o) => o.id)).toEqual(["x", "x~1"]);
  });
});

describe("editing operations", () => {
  it("splits, then merges back", () => {
    const clips = [v("a", 0, 10)];
    const s = splitAt(clips, 4, id);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ srcStart: 0, srcEnd: 4 });
    expect(s[1]).toMatchObject({ srcStart: 4, srcEnd: 10 });
    expect(canMerge(s, s[0].id)).toBe(true);
    expect(mergeWithNext(s, s[0].id)).toEqual([{ ...clips[0] }]);
  });

  it("won't split right at an edge", () => {
    const clips = [v("a", 0, 10)];
    expect(splitAt(clips, 0.01, id)).toBe(clips);
  });

  it("ripple-deletes a range across clips", () => {
    const out = rippleDelete([v("a", 0, 10), v("b", 20, 30)], 8, 12, id);
    const tl = buildTimeline(out);
    expect(tl.duration).toBeCloseTo(16);
    expect(out.map((c) => (c.kind === "video" ? [c.srcStart, c.srcEnd] : null))).toEqual([[0, 8], [22, 30]]);
  });

  it("trims within the source and keeps a minimum length", () => {
    const clips = [v("a", 2, 8)];
    expect(trimEdge(clips, "a", "start", -5, 60)[0]).toMatchObject({ srcStart: 0 });
    expect(trimEdge(clips, "a", "end", 100, 60)[0]).toMatchObject({ srcEnd: 60 });
    expect(trimEdge(clips, "a", "end", -100, 60)[0]).toMatchObject({ srcEnd: 2.1 });
  });

  it("moves and removes clips, never the last one", () => {
    const clips = [v("a", 0, 1), v("b", 1, 2), v("c", 2, 3)];
    expect(moveClip(clips, "c", 0).map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(removeClip(clips, "b").map((c) => c.id)).toEqual(["a", "c"]);
    expect(removeClip([clips[0]], "a")).toHaveLength(1);
  });
});

describe("transitions", () => {
  it("dips out of the old clip and into the new one", () => {
    const tl = buildTimeline([v("a", 0, 5), { ...v("b", 10, 15), transition: { kind: "fade", duration: 1 } }]);
    expect(transitionAt(tl, 3)).toBeNull();
    const before = transitionAt(tl, 4.75)!;
    expect(before.phase).toBe("out");
    expect(before.amount).toBeGreaterThan(0.4);
    const atCut = transitionAt(tl, 5)!;
    expect(atCut.phase).toBe("in");
    expect(atCut.amount).toBeCloseTo(1);
    expect(transitionAt(tl, 5.6)).toBeNull();
  });
});

describe("project migration", () => {
  it("turns a legacy trim into one clip and closes open ends", () => {
    expect(clipsFromTrim({ start: 2, end: null }, 30)).toEqual([{ id: "c-main", kind: "video", srcStart: 2, srcEnd: 30 }]);
    const open = effectiveClips({ trim: { start: 0, end: null } }, 0);
    expect(open[0]).toMatchObject({ srcEnd: Infinity });
    expect(effectiveClips({ clips: open }, 12)[0]).toMatchObject({ srcEnd: 12 });
  });

  it("round-trips open-ended clips through JSON", () => {
    const clips: Clip[] = [v("a", 0, Infinity)];
    const back = reviveClips(JSON.parse(JSON.stringify(serialiseClips(clips))));
    expect(back![0]).toMatchObject({ srcEnd: Infinity });
  });

  it("renames the old Gujlish setting", () => {
    const m = migrate({ style: { script: "gujlish" } as unknown as import("@/lib/types").CaptionStyle });
    expect(m.style!.script).toBe("casual");
  });
});
