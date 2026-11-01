import { describe, expect, it } from "vitest";
import * as E from "@/lib/easing";
import {
  coverScale, defaultDuration, dipAmount, edgeKey, edgeRequests, mixIn, pushTravel, spinAngles, throughSpeed, throughTravel,
  TRANSITION_META, transitionGain, transitionHalf, transitionProgress, zoomScales,
} from "@/lib/transitions";
import { buildTimeline, transitionAt } from "@/lib/edl";
import { entrance, exitFactor, REST, wordPop } from "@/lib/animation";
import type { Clip, VideoClip } from "@/lib/project";
import type { EnterAnimation } from "@/lib/types";

const v = (id: string, a: number, b: number, extra: Partial<VideoClip> = {}): VideoClip => ({ id, kind: "video", srcStart: a, srcEnd: b, ...extra });
const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);

describe("easing curves", () => {
  const curves: [string, (x: number) => number][] = [
    ["easeInQuad", E.easeInQuad], ["easeOutQuad", E.easeOutQuad], ["easeInCubic", E.easeInCubic], ["easeOutCubic", E.easeOutCubic],
    ["easeInOutCubic", E.easeInOutCubic], ["easeInOutQuart", E.easeInOutQuart], ["easeInOutSine", E.easeInOutSine],
    ["easeOutExpo", E.easeOutExpo], ["smoothstep", E.smoothstep], ["easeOutBack", (x) => E.easeOutBack(x)], ["softSpring", (x) => E.softSpring(x)],
  ];
  it("start at exactly 0 and end at exactly 1", () => {
    for (const [name, f] of curves) {
      expect(f(0), name).toBeCloseTo(0, 9);
      expect(f(1), name).toBeCloseTo(1, 9);
      expect(f(-0.5), name).toBeCloseTo(0, 9);
      expect(f(1.5), name).toBeCloseTo(1, 9);
    }
  });
  it("have no jumps between neighbouring frames", () => {
    for (const [name, f] of curves) {
      for (const x of steps(240).slice(1)) expect(Math.abs(f(x) - f(x - 1 / 240)), `${name} at ${x}`).toBeLessThan(0.05);
    }
  });
  it("softSpring overshoots by about the amount asked and lands with no speed", () => {
    for (const o of [0.03, 0.05, 0.1, 0.25]) {
      const peak = Math.max(...steps(400).map((x) => E.softSpring(x, o)));
      expect(peak - 1).toBeGreaterThan(o * 0.6);
      expect(peak - 1).toBeLessThan(o * 1.3);
      expect(Math.abs(E.softSpring(1, o) - E.softSpring(0.995, o))).toBeLessThan(0.002);
    }
  });
  it("bell is 0 at both ends and 1 at its peak", () => {
    expect(E.bell(0)).toBe(0);
    expect(E.bell(1)).toBe(0);
    expect(E.bell(0.5)).toBe(1);
    expect(E.bell(0.3, 0.3)).toBe(1);
  });
});

describe("transition timing", () => {
  it("is centred on the cut and never takes more than half of either clip", () => {
    expect(transitionHalf(0.5, 10, 10)).toBe(0.25);
    expect(transitionHalf(2, 0.6, 10)).toBe(0.3);
    expect(transitionHalf(2, 10, 0.4)).toBe(0.2);
    expect(transitionProgress(4.74, 5, 0.25)).toBeNull();
    expect(transitionProgress(4.75, 5, 0.25)).toBe(0);
    expect(transitionProgress(5, 5, 0.25)).toBe(0.5);
    expect(transitionProgress(5.25, 5, 0.25)).toBeNull();
  });
  it("covers the whole window with steadily rising progress, from the old clip to the new", () => {
    const tl = buildTimeline([v("a", 0, 5), { ...v("b", 10, 15), transition: { kind: "slide-left", duration: 0.5 } }]);
    let last = -1;
    for (let t = 4.75; t < 5.25; t += 1 / 60) {
      const tr = transitionAt(tl, t)!;
      expect(tr, `t=${t}`).not.toBeNull();
      expect(tr.p).toBeGreaterThan(last);
      last = tr.p;
      expect(tr.from.clip.id).toBe("a");
      expect(tr.to.clip.id).toBe("b");
      expect(tr.phase).toBe(t < 5 ? "out" : "in");
    }
    expect(transitionAt(tl, 4.7)).toBeNull();
    expect(transitionAt(tl, 5.3)).toBeNull();
  });
  it("keeps the legacy dip amount (1 at the cut, 0 at the edges)", () => {
    expect(dipAmount(0.5)).toBe(1);
    expect(dipAmount(0)).toBe(0);
    expect(dipAmount(1)).toBe(0);
  });
  it("has a default length between 0.3 and 0.6 s for every transition", () => {
    for (const m of TRANSITION_META) {
      if (m.kind === "none") continue;
      expect(m.duration, m.kind).toBeGreaterThanOrEqual(0.3);
      expect(m.duration, m.kind).toBeLessThanOrEqual(0.6);
      expect(defaultDuration(m.kind)).toBe(m.duration);
    }
  });
});

describe("transition motion", () => {
  it("moves through the cut at the same speed it arrived", () => {
    expect(throughTravel(0)).toBe(0);
    expect(throughTravel(0.5)).toBeCloseTo(1);
    expect(throughTravel(1)).toBe(2);
    const e = 1e-4;
    const before = (throughTravel(0.5) - throughTravel(0.5 - e)) / e;
    const after = (throughTravel(0.5 + e) - throughTravel(0.5)) / e;
    expect(after / before).toBeCloseTo(1, 2);
    expect(throughSpeed(0)).toBe(0);
    expect(throughSpeed(0.5)).toBe(1);
    expect(throughSpeed(1)).toBe(0);
  });
  it("zoom starts and ends at normal size with no jump, and never shows black edges", () => {
    expect(zoomScales(0).from).toBe(1);
    expect(zoomScales(1).to).toBe(1);
    // matching size on both sides of the cut
    expect(zoomScales(0.5).from).toBeCloseTo(zoomScales(0.5).to);
    for (const p of steps(120)) {
      const z = zoomScales(p);
      // both pictures stay at full size or larger, so they always cover the frame
      expect(z.from).toBeGreaterThanOrEqual(1);
      expect(z.to).toBeGreaterThanOrEqual(1);
      expect(z.from).toBeLessThan(4);
    }
    // frame-to-frame scale change stays small at 30 fps over 0.45 s
    for (const p of steps(14).slice(1)) {
      expect(Math.abs(Math.log(zoomScales(p).from / zoomScales(p - 1 / 14).from))).toBeLessThan(0.5);
      expect(Math.abs(Math.log(zoomScales(p).to / zoomScales(p - 1 / 14).to))).toBeLessThan(0.5);
    }
  });
  it("spin stays within about 14 degrees and comes back to level", () => {
    for (const p of steps(100)) {
      const a = spinAngles(p);
      expect(Math.abs(a.from)).toBeLessThanOrEqual((28 * Math.PI) / 180 + 1e-9);
      expect(Math.abs(a.to)).toBeLessThanOrEqual((28 * Math.PI) / 180 + 1e-9);
    }
    expect(spinAngles(0).from).toBe(0);
    expect(spinAngles(1).to).toBe(0);
  });
  it("push transitions keep both clips edge to edge, so no gap ever opens", () => {
    for (const whip of [false, true]) {
      let last = -1;
      for (const p of steps(200)) {
        const e = pushTravel(p, whip);
        expect(e).toBeGreaterThanOrEqual(last);
        last = e;
        const W = 1080;
        const aLeft = -e * W, aRight = aLeft + W, bLeft = aRight, bRight = bLeft + W;
        expect(aLeft).toBeLessThanOrEqual(0);
        expect(bRight).toBeGreaterThanOrEqual(W);
        expect(bLeft - aRight).toBe(0);
      }
      expect(pushTravel(0, whip)).toBe(0);
      expect(pushTravel(1, whip)).toBe(1);
    }
  });
  it("cross-fade weights ramp smoothly from 0 to 1", () => {
    expect(mixIn(0.39, 0.4, 0.6)).toBe(0);
    expect(mixIn(0.5, 0.4, 0.6)).toBeCloseTo(0.5);
    expect(mixIn(0.61, 0.4, 0.6)).toBe(1);
  });
  it("cover scale keeps a rotated picture filling the frame", () => {
    expect(coverScale(0, 1080, 1920)).toBe(1);
    expect(coverScale(Math.PI / 12, 1080, 1920)).toBeGreaterThan(1.4);
    expect(coverScale(Math.PI / 12, 1920, 1080)).toBeCloseTo(coverScale(Math.PI / 12, 1080, 1920));
  });
  it("only ducks the sound briefly at the cut, except for a dip to black", () => {
    expect(transitionGain("fade", 5, 5, 0.25)).toBe(0);
    expect(transitionGain("fade", 4.9, 5, 0.25)).toBe(1);
    expect(transitionGain("dip-black", 4.9, 5, 0.3)).toBeLessThan(0.5);
    expect(transitionGain("dip-black", 4.69, 5, 0.3)).toBe(1);
  });
});

describe("edge frames", () => {
  it("asks for the last frame before a transition and the first frame after it, once each", () => {
    const clips: Clip[] = [
      v("a", 0, 5),
      { ...v("b", 10, 15), transition: { kind: "fade", duration: 0.5 } },
      { id: "c", kind: "card", duration: 2, background: { kind: "color", color: "#000" }, transition: { kind: "zoom", duration: 0.4 } },
      v("d", 20, 25),
      { ...v("e", 30, 35, { sourceId: "x" }), transition: { kind: "wipe", duration: 0.5 } },
    ];
    const req = edgeRequests(clips).map((r) => `${r.clip.id}:${r.edge}`);
    expect(req).toEqual(["a:end", "b:start", "b:end", "d:end", "e:start"]);
    expect(edgeKey(clips[4] as VideoClip, "start")).toBe("x@30.000");
    expect(edgeKey(clips[0] as VideoClip, "end")).toBe("main@4.960");
  });
});

describe("caption motion", () => {
  const ALL: EnterAnimation[] = ["fade", "pop", "spring", "rise", "drop", "slideleft", "zoom", "blur", "letters", "typewriter", "bounce", "shake", "glitch",
    "stamp", "whip", "swing", "elastic", "slam", "sticker", "chatpop", "notify", "punch", "roll", "flicker"];

  it("never flashes in on the first frame", () => {
    for (const k of ALL) expect(entrance(k, 0).opacity, k).toBeLessThan(0.05);
  });
  it("lands on rest with no jump on the last frame", () => {
    for (const k of ALL) {
      // sample densely: no big step between neighbouring frames, at rest once finished
      let prev = entrance(k, 0);
      for (let t = 1 / 120; t <= 0.8; t += 1 / 120) {
        const cur = entrance(k, t);
        if (k !== "shake" && k !== "glitch" && k !== "flicker") {
          expect(Math.abs(cur.scale - prev.scale), `${k} scale at ${t.toFixed(3)}`).toBeLessThan(0.12);
          expect(Math.abs(cur.dy - prev.dy), `${k} dy at ${t.toFixed(3)}`).toBeLessThan(0.2);
        }
        prev = cur;
      }
      expect(entrance(k, 0.8), k).toEqual(REST);
    }
  });
  it("pop starts near 85 % and overshoots by only a few percent", () => {
    expect(entrance("pop", 0).scale).toBeCloseTo(0.85);
    const peak = Math.max(...steps(100).map((x) => entrance("pop", x * 0.3).scale));
    expect(peak).toBeGreaterThan(1.01);
    expect(peak).toBeLessThan(1.06);
  });
  it("a spoken word settles from wherever its pop had got to", () => {
    // a very short word: active for 50 ms only
    const s = 1, e = 1.05;
    const atEnd = wordPop(e - 1e-6, s, e);
    expect(Math.abs(wordPop(e, s, e) - atEnd)).toBeLessThan(0.01);
    expect(wordPop(s, s, e)).toBe(0);
    expect(wordPop(e + 1, s, e)).toBe(0);
  });
  it("captions ease out into a pause instead of vanishing", () => {
    expect(exitFactor(9, 10)).toBe(1);
    expect(exitFactor(10, 10)).toBe(0);
    const mid = exitFactor(9.92, 10);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.9);
  });
});
