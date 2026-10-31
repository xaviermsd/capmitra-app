// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { musicGainAt, musicTimeAt, sourceGainAt, speechAt } from "@/lib/audioMix";
import { buildTimeline } from "@/lib/edl";
import { layerPose, makeLayer } from "@/lib/layers";
import type { Music } from "@/lib/project";

describe("audio mix", () => {
  const tl = buildTimeline([{ id: "a", kind: "video", srcStart: 0, srcEnd: 10, volume: 0.5 }, { id: "c", kind: "card", duration: 2, background: { kind: "color" } }]);
  it("applies clip volume, fades and silent cards", () => {
    const audio = { volume: 1, fadeIn: 1, fadeOut: 0 };
    expect(sourceGainAt(0.5, tl, audio)).toBeCloseTo(0.25);
    expect(sourceGainAt(5, tl, audio)).toBeCloseTo(0.5);
    expect(sourceGainAt(11, tl, audio)).toBe(0);
  });
  it("ducks music under speech and loops it", () => {
    const words = [{ id: "w", text: "x", start: 2, end: 3 }];
    expect(speechAt(words, 2.5)).toBe(1);
    expect(speechAt(words, 5)).toBe(0);
    const m: Music = { assetId: "m", name: "m", volume: 0.8, start: 0, fadeIn: 0, fadeOut: 0, loop: true, duck: 0.75 };
    expect(musicGainAt(2.5, m, 12, 1)).toBeCloseTo(0.2);
    expect(musicGainAt(5, m, 12, 0)).toBeCloseTo(0.8);
    expect(musicTimeAt(7, m, 5, 12)).toBeCloseTo(2);
    expect(musicTimeAt(7, { ...m, loop: false }, 5, 12)).toBeNull();
  });
});

describe("layer motion", () => {
  it("is hidden outside its time, animates in, then settles", () => {
    const l = makeLayer("text", 1, 9 / 16, 60);
    expect(layerPose(l, 0.5, 1080, 1920).opacity).toBe(0);
    const mid = layerPose(l, 1.1, 1080, 1920);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.scale).toBeLessThan(1);
    const settled = layerPose(l, 3, 1080, 1920);
    expect(settled.opacity).toBe(1);
    expect(settled.scale).toBeCloseTo(1);
  });
  it("honours delay and direction", () => {
    const l = { ...makeLayer("headline", 0, 9 / 16, 60), motion: { in: "slide" as const, out: "none" as const, duration: 1, delay: 0.5, easing: "linear" as const, direction: "left" as const } };
    expect(layerPose(l, 0.2, 1000, 1000).opacity).toBe(0);
    expect(layerPose(l, 0.75, 1000, 1000).dx).toBeGreaterThan(0); // slides in from the right, moving left
  });
});

