import { describe, expect, it } from "vitest";
import { LIMITER_RANGE, PEAK_CEILING, limiterCurve, peakGain, peakOf, softClip } from "@/lib/audioMix";

describe("audio levels", () => {
  it("finds the peak across channels", () => {
    expect(peakOf([new Float32Array([0.1, -0.7]), new Float32Array([0.3, 0.2])])).toBeCloseTo(0.7);
  });
  it("only ever turns loud sounds down", () => {
    expect(peakGain([new Float32Array([0.5, -0.4])])).toBe(1);
    const g = peakGain([new Float32Array([1.318, -0.2])]);
    expect(1.318 * g).toBeCloseTo(PEAK_CEILING, 5);
  });
  it("soft clip leaves normal levels alone and never reaches full scale", () => {
    for (const x of [0, 0.25, -0.5, 0.8, -0.8]) expect(softClip(x)).toBe(x);
    for (const x of [0.9, 1, 1.5, 3, 10, -10]) {
      expect(Math.abs(softClip(x))).toBeLessThan(1);
      expect(Math.sign(softClip(x))).toBe(Math.sign(x));
    }
  });
  it("soft clip is smooth and keeps getting louder up to the ceiling", () => {
    let prev = 0;
    for (let x = 0; x <= 3; x += 0.01) { const y = softClip(x); expect(y).toBeGreaterThanOrEqual(prev); expect(y - prev).toBeLessThanOrEqual(0.0101); prev = y; }
  });
  it("limiter curve maps WaveShaper input back to the soft-clipped level", () => {
    const c = limiterCurve(8193);
    const at = (x: number) => c[Math.round(((x / LIMITER_RANGE + 1) / 2) * (c.length - 1))];
    expect(at(0)).toBeCloseTo(0, 6);
    expect(at(0.5)).toBeCloseTo(0.5, 3);
    expect(at(-0.75)).toBeCloseTo(-0.75, 3);
    expect(at(2)).toBeCloseTo(softClip(2), 3);
    expect(Math.max(...c)).toBeLessThan(1);
  });
});
