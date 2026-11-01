/**
 * Easing curves shared by transitions, caption entrances and graphics, so all
 * motion in the editor speaks the same language. Every curve maps 0 -> 0 and
 * 1 -> 1 exactly (no jump on the first or last frame) and is clamped outside
 * [0, 1].
 */

export const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export const linear = (x: number) => clamp01(x);

export const easeInQuad = (x: number) => { x = clamp01(x); return x * x; };
export const easeOutQuad = (x: number) => { x = clamp01(x); return 1 - (1 - x) * (1 - x); };
export const easeInCubic = (x: number) => { x = clamp01(x); return x * x * x; };
export const easeOutCubic = (x: number) => { x = clamp01(x); return 1 - Math.pow(1 - x, 3); };
export const easeInOutCubic = (x: number) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const easeInOutQuart = (x: number) => { x = clamp01(x); return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2; };
export const easeInOutSine = (x: number) => { x = clamp01(x); return -(Math.cos(Math.PI * x) - 1) / 2; };
/** Exponential out, rescaled so it ends exactly at 1. */
export const easeOutExpo = (x: number) => { x = clamp01(x); return x >= 1 ? 1 : (1 - Math.pow(2, -10 * x)) / (1 - Math.pow(2, -10)); };
export const smoothstep = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };
/** Smoothstep between two edges. */
export const ramp = (a: number, b: number, x: number) => smoothstep((x - a) / (b - a));

/**
 * Back-out: overshoots past 1 and settles with zero speed at x = 1.
 * `s` sets the overshoot (1.70158 is the classic ~10 %).
 */
export const easeOutBack = (x: number, s = 1.70158) => { x = clamp01(x); return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2); };

/** Decay (relative to the oscillation) that gives a damped cosine a first overshoot of `o`. */
const decays = new Map<number, number>();
function decayFor(o: number): number {
  let z = decays.get(o);
  if (z !== undefined) return z;
  // overshoot(z) = exp(-z (pi - atan z)) cos(atan z), falling as z grows: bisect
  let lo = 0, hi = 20;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const a = Math.atan(mid);
    if (Math.exp(-mid * (Math.PI - a)) * Math.cos(a) > o) lo = mid; else hi = mid;
  }
  z = (lo + hi) / 2;
  decays.set(o, z);
  return z;
}

/**
 * A controlled spring: rises quickly, overshoots by about `overshoot` (0.04 =
 * 4 %) once, and lands on exactly 1 with zero speed at x = 1.
 */
export function softSpring(x: number, overshoot = 0.05): number {
  x = clamp01(x);
  if (x >= 1) return 1;
  const z = decayFor(Math.min(0.9, Math.max(1e-4, overshoot)));
  const w = Math.PI / 0.55; // peaks a little after half way
  const raw = 1 - Math.exp(-z * w * x) * Math.cos(w * x);
  // blend into 1 over the tail so the end is exact and still
  const tail = smoothstep((x - 0.75) / 0.25);
  return raw + (1 - raw) * tail;
}

/** Bell curve on [0, 1]: 0 at both ends, 1 at `peak`, smooth everywhere. */
export function bell(x: number, peak = 0.5): number {
  x = clamp01(x);
  return x < peak ? smoothstep(x / peak) : smoothstep((1 - x) / (1 - peak));
}
