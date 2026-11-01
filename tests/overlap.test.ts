import { describe, expect, it } from "vitest";
import { buildTimeline, transitionAt } from "@/lib/edl";
import { handleTime, handleTimeRaw, LEAD, PREROLL, slotNeeds, slotsFor } from "@/lib/overlap";
import type { Clip, VideoClip } from "@/lib/project";

const v = (id: string, a: number, b: number, extra: Partial<VideoClip> = {}): VideoClip => ({ id, kind: "video", srcStart: a, srcEnd: b, ...extra });
const card = (id: string, d: number): Clip => ({ id, kind: "card", duration: d, background: { kind: "color", color: "#000" } });

describe("handle times", () => {
  it("runs the incoming clip's head and the outgoing clip's tail in step with the cut", () => {
    const a = v("a", 2, 5), b = v("b", 22, 25);
    // outgoing clip after the cut: srcEnd + (t - cut) * speed
    expect(handleTimeRaw(a, "out", 5.2, 5)).toBeCloseTo(5.2);
    // incoming clip before the cut: srcStart - (cut - t) * speed
    expect(handleTimeRaw(b, "in", 4.8, 5)).toBeCloseTo(21.8);
    // at the cut both sides meet their edit points
    expect(handleTimeRaw(a, "out", 5, 5)).toBe(5);
    expect(handleTimeRaw(b, "in", 5, 5)).toBe(22);
  });
  it("follows clip speed", () => {
    const fast = v("f", 10, 20, { speed: 2 });
    expect(handleTimeRaw(fast, "in", 4.75, 5)).toBeCloseTo(9.5);
    expect(handleTimeRaw(fast, "out", 5.25, 5)).toBeCloseTo(20.5);
  });
  it("holds the nearest real frame when a handle runs off the source", () => {
    expect(handleTime(v("b", 0.1, 3), "in", 4.7, 5)).toBe(0);
    expect(handleTime(v("a", 0, 9.98), "out", 5.3, 5, 10)).toBeCloseTo(9.96);
  });
});

describe("player slots", () => {
  it("never gives neighbouring clips from the same video the same player", () => {
    const tl = buildTimeline([v("a", 0, 2), v("b", 10, 12), v("c", 4, 6), card("k", 1), v("d", 20, 22), v("e", 30, 31, { sourceId: "x" }), v("f", 40, 41)]);
    const s = slotsFor(tl.items);
    expect(s).toEqual([0, 1, 0, -1, 1, 0, 0]);
    const same = (i: number, j: number) => {
      const a = tl.items[i]?.clip, b = tl.items[j]?.clip;
      return a?.kind === "video" && b?.kind === "video" && (a.sourceId ?? "main") === (b.sourceId ?? "main");
    };
    for (let i = 1; i < tl.items.length; i++) {
      if (same(i, i - 1)) expect(s[i]).not.toBe(s[i - 1]);
      else if (same(i, i - 2)) expect(s[i]).not.toBe(s[i - 2]);
    }
  });
});

describe("what each player does", () => {
  const tl = buildTimeline([v("a", 0, 5), { ...v("b", 22, 25), transition: { kind: "zoom", duration: 0.5 } }]);

  it("parks the next clip on its first handle frame well before the transition", () => {
    const t = 5 - 0.25 - PREROLL + 0.1;
    const n = slotNeeds(tl, t, true);
    expect(n.map((x) => x.role)).toEqual(["main", "pre"]);
    expect(n[1].play).toBe(false);
    expect(n[1].time).toBeCloseTo(21.75);
    expect(n[0].key).not.toBe(n[1].key);
  });

  it("runs both clips through the whole transition, on real footage", () => {
    for (let t = 4.75; t < 5.25; t += 1 / 60) {
      const tr = transitionAt(tl, t)!;
      const n = slotNeeds(tl, t, true);
      const other = n.find((x) => x.index === (tr.phase === "out" ? tr.to.index : tr.from.index))!;
      expect(other, `t=${t}`).toBeDefined();
      expect(other.play).toBe(true);
      const want = tr.phase === "out" ? 22 - (5 - t) : 5 + (t - 5);
      expect(other.time).toBeCloseTo(want, 9);
      const main = n.find((x) => x.role === "main")!;
      expect(main.play).toBe(true);
      expect(main.key).not.toBe(other.key);
    }
  });

  it("starts the next clip a moment early even on a hard cut, so it is moving at the cut", () => {
    const hard = buildTimeline([v("a", 0, 5), v("b", 22, 25)]);
    const n = slotNeeds(hard, 5 - LEAD / 2, true);
    const nx = n.find((x) => x.index === 1)!;
    expect(nx.role).toBe("in");
    expect(nx.play).toBe(true);
    expect(nx.time).toBeCloseTo(22 - LEAD / 2);
  });

  it("splits of one video played back to back use both players, so the cut never waits on a seek", () => {
    const same = buildTimeline([v("a", 10, 12), v("b", 2, 4)]);
    const before = slotNeeds(same, 1.5, true);
    expect(before.map((x) => x.role)).toEqual(["main", "pre"]);
    expect(new Set(before.map((x) => x.key)).size).toBe(2);
    expect(before[1].time).toBeCloseTo(2 - LEAD);
  });

  it("parks every player while paused", () => {
    for (const x of slotNeeds(tl, 4.9, false)) expect(x.play).toBe(false);
  });
});
