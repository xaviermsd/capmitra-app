import { describe, expect, it } from "vitest";
import * as E from "@/lib/easing";
import {
  coverScale, covers, defaultDuration, dipAmount, FLASH_HOLD, TRANSITION_META, transitionGain, transitionHalf, transitionLayout, transitionProgress, ZOOM_PUNCH,
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
  const SIZES: [number, number][] = [[1080, 1920], [1920, 1080], [1080, 1080], [1080, 1350]];
  /** Corners, edge points and the centre of the frame. */
  const probes = (W: number, H: number) => {
    const out: [number, number][] = [];
    for (const fx of [0, 0.02, 0.25, 0.5, 0.75, 0.98, 1]) for (const fy of [0, 0.02, 0.25, 0.5, 0.75, 0.98, 1]) out.push([fx * W, fy * H]);
    return out;
  };
  const kinds = TRANSITION_META.map((m) => m.kind).filter((k) => k !== "none");

  it("never leaves an edge or corner of the frame uncovered (no black), at any progress or frame shape", () => {
    for (const kind of kinds) {
      for (const [W, H] of SIZES) {
        for (const p of steps(240)) {
          const l = transitionLayout(kind, p, W, H, p);
          for (const [x, y] of probes(W, H)) {
            if (!covers(l, W, H, x, y)) throw new Error(`${kind} ${W}x${H} p=${p.toFixed(3)} uncovered at ${x.toFixed(0)},${y.toFixed(0)}`);
          }
        }
      }
    }
  });

  it("only the dips and the black flash go to black, and they go all the way", () => {
    for (const kind of kinds) {
      const peak = Math.max(...steps(200).map((p) => {
        const w = transitionLayout(kind, p, 1080, 1920).wash;
        return w && w.color === "#000000" ? w.alpha : 0;
      }));
      if (kind === "dip-black" || kind === "flash-black") expect(peak, kind).toBe(1);
      else expect(peak, kind).toBe(0);
    }
  });

  it("flash holds a pure white frame across the cut and clears completely", () => {
    const at = (p: number) => transitionLayout("dip-white", p, 1080, 1920).wash!;
    expect(at(0).alpha).toBe(0);
    expect(at(1).alpha).toBe(0);
    for (const p of [FLASH_HOLD[0], 0.45, 0.5, 0.55, FLASH_HOLD[1]]) {
      expect(at(p).alpha).toBe(1);
      expect(at(p).color).toBe("#FFFFFF");
    }
    // the hold lasts one or two frames at 30 fps for the default length
    const hold = (FLASH_HOLD[1] - FLASH_HOLD[0]) * defaultDuration("dip-white");
    expect(hold).toBeGreaterThan(1 / 30);
    expect(hold).toBeLessThan(2.2 / 30);
  });

  it("zoom punches in to about 2.2x and lands back at normal size, never below it", () => {
    const sc = (p: number) => transitionLayout("zoom", p, 1080, 1920).layers.map((l) => l.scale);
    expect(sc(0)).toEqual([1]);
    expect(sc(1)).toEqual([1]);
    expect(Math.max(...sc(0.49))).toBeGreaterThan(1.8);
    expect(Math.max(...sc(0.51))).toBeGreaterThan(1.8);
    for (const p of steps(200)) for (const s of sc(p)) {
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(ZOOM_PUNCH + 1e-9);
    }
    // blur is strongest at the cut
    const blurAt = (p: number) => transitionLayout("zoom", p, 1080, 1920).blur;
    expect(blurAt(0.5)).toBeGreaterThan(blurAt(0.3));
    expect(blurAt(0.5)).toBeGreaterThan(blurAt(0.7));
  });

  it("spin turns a full 90 degrees each side, always at the exact cover scale", () => {
    for (const [W, H] of SIZES) {
      let maxRot = 0;
      for (const p of steps(300)) {
        for (const l of transitionLayout("spin", p, W, H).layers) {
          maxRot = Math.max(maxRot, Math.abs(l.rot));
          expect(l.scale).toBeCloseTo(coverScale(l.rot, W, H), 9);
        }
      }
      expect(maxRot).toBeGreaterThan((85 * Math.PI) / 180);
    }
    const first = transitionLayout("spin", 0, 1080, 1920).layers[0];
    const last = transitionLayout("spin", 1, 1080, 1920).layers[0];
    expect(Math.abs(first.rot) + Math.abs(last.rot)).toBe(0);
    expect([first.scale, last.scale]).toEqual([1, 1]);
  });

  it("cover scale is the exact minimum: every rotated corner reaches the frame, and no less would", () => {
    for (const [W, H] of SIZES) {
      for (let deg = 0; deg <= 90; deg += 1) {
        const a = (deg * Math.PI) / 180;
        const s = coverScale(a, W, H);
        const l = { layers: [{ who: "from" as const, scale: s, rot: a, dx: 0, dy: 0, alpha: 1 }], motionBlur: 0, horiz: true, blur: 0, bright: 1, wash: null };
        for (const [x, y] of probes(W, H)) expect(covers(l, W, H, x, y), `${W}x${H} ${deg}deg`).toBe(true);
        if (deg > 0) {
          const less = { ...l, layers: [{ ...l.layers[0], scale: s * 0.99 }] };
          expect(probes(W, H).every(([x, y]) => covers(less, W, H, x, y)), `${W}x${H} ${deg}deg at 0.99x`).toBe(false);
        }
      }
    }
    // worst case for a 9:16 frame is about 2.04
    const worst = Math.max(...Array.from({ length: 91 }, (_, d) => coverScale((d * Math.PI) / 180, 1080, 1920)));
    expect(worst).toBeGreaterThan(2.0);
    expect(worst).toBeLessThan(2.1);
  });

  it("push transitions travel edge to edge in all four directions, with no gap or overlap", () => {
    const dirs = { "slide-left": [-1, 0], "slide-right": [1, 0], "slide-up": [0, -1], "slide-down": [0, 1], whip: [-1, 0] } as const;
    for (const [kind, [sx, sy]] of Object.entries(dirs)) {
      const W = 1080, H = 1920;
      let last = -1;
      for (const p of steps(200)) {
        const [a, b] = transitionLayout(kind as keyof typeof dirs, p, W, H).layers;
        const travel = sx ? a.dx / (sx * W) : a.dy / (sy * H);
        expect(travel, kind).toBeGreaterThanOrEqual(last - 1e-12);
        last = travel;
        // the incoming picture sits exactly one frame behind the outgoing one
        expect(sx ? a.dx - b.dx : a.dy - b.dy, kind).toBeCloseTo(sx ? sx * W : sy * H, 9);
      }
      expect(last, kind).toBeCloseTo(1, 9);
    }
    // the motion blur is strongest mid-push and gone at both ends
    const mb = (p: number) => transitionLayout("slide-left", p, 1080, 1920).motionBlur;
    expect(mb(0)).toBeLessThan(1);
    expect(mb(1)).toBeLessThan(1);
    expect(mb(0.5)).toBeGreaterThan(150);
    expect(transitionLayout("whip", 0.5, 1080, 1920).motionBlur).toBeGreaterThan(mb(0.5) * 2);
  });

  it("glitch flickers between both clips for two or three frames at the cut", () => {
    const fps = 30, dur = defaultDuration("glitch"), cut = 5;
    const seq: string[] = [];
    for (let f = Math.ceil((cut - dur / 2) * fps); f < (cut + dur / 2) * fps; f++) {
      const t = f / fps;
      seq.push(transitionLayout("glitch", (t - (cut - dur / 2)) / dur, 1080, 1920, t).layers[0].who);
    }
    expect(seq[0]).toBe("from");
    expect(seq[seq.length - 1]).toBe("to");
    let swaps = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) swaps++;
    expect(swaps).toBeGreaterThanOrEqual(2);
  });

  it("only ducks the sound briefly at the cut, except for a dip to black", () => {
    expect(transitionGain("fade", 5, 5, 0.25)).toBe(0);
    expect(transitionGain("fade", 4.9, 5, 0.25)).toBe(1);
    expect(transitionGain("dip-black", 4.9, 5, 0.3)).toBeLessThan(0.5);
    expect(transitionGain("dip-black", 4.69, 5, 0.3)).toBe(1);
  });

  it("keeps old projects working: every original transition id still exists", () => {
    for (const k of ["none", "fade", "dip-black", "dip-white", "zoom", "slide-left", "slide-up", "wipe", "blur", "spin", "glitch", "whip"] as const) {
      expect(TRANSITION_META.some((m) => m.kind === k), k).toBe(true);
    }
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
