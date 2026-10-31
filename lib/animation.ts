import type { EnterAnimation } from "./types";

export interface Pose {
  opacity: number;
  scale: number;
  /** Offsets in em. */
  dx: number;
  dy: number;
  /** Blur radius in em. */
  blur: number;
  /** Rotation in degrees. */
  rot: number;
}

export const REST: Pose = { opacity: 1, scale: 1, dx: 0, dy: 0, blur: 0, rot: 0 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x: number, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
/** Damped spring settling to 1. */
const spring = (x: number) => 1 - Math.exp(-6 * x) * Math.cos(10 * x);

/** Duration of each entrance, seconds at speed 1. */
const DURATION: Record<EnterAnimation, number> = {
  none: 0,
  fade: 0.18,
  pop: 0.22,
  spring: 0.45,
  rise: 0.26,
  drop: 0.3,
  slideleft: 0.28,
  zoom: 0.25,
  blur: 0.3,
  letters: 0.22,
  typewriter: 0.06,
  bounce: 0.5,
  shake: 0.4,
  glitch: 0.3,
  stamp: 0.24,
  whip: 0.26,
  swing: 0.55,
  elastic: 0.6,
  slam: 0.3,
  sticker: 0.32,
  chatpop: 0.34,
  notify: 0.42,
  punch: 0.28,
  roll: 0.38,
  flicker: 0.42,
};

/** Deterministic flicker for the glitch entrance. */
const flick = (n: number) => { const x = Math.sin(n * 91.7 + 3.1) * 43758.5; return x - Math.floor(x); };

function extraEntrance(kind: EnterAnimation, p: number, elapsed: number): Pose | null {
  switch (kind) {
    case "bounce": {
      // drops in and bounces twice
      const b = Math.abs(Math.cos(p * Math.PI * 2.5)) * Math.pow(1 - p, 2);
      return { ...REST, opacity: clamp01(p * 4), dy: -0.6 * b, scale: 1 + 0.06 * b };
    }
    case "shake":
      return { ...REST, opacity: clamp01(p * 4), dx: Math.sin(elapsed * 70) * 0.12 * (1 - p) };
    case "glitch": {
      const r = flick(Math.floor(elapsed * 60));
      return { ...REST, opacity: p < 0.7 ? (r > 0.35 ? 1 : 0.2) : 1, dx: (r - 0.5) * 0.25 * (1 - p), blur: r > 0.85 ? 0.05 : 0 };
    }
    case "stamp":
      // big and fast, lands with a tiny overshoot
      return { ...REST, opacity: clamp01(p * 5), scale: 1 + 1.2 * Math.pow(1 - p, 3) - 0.06 * Math.sin(p * Math.PI) * (p > 0.6 ? 1 : 0) };
    case "whip":
      return { ...REST, opacity: clamp01(p * 3), dx: 1.4 * Math.pow(1 - p, 3), blur: 0.18 * (1 - p), rot: -6 * (1 - p) };
    case "swing":
      return { ...REST, opacity: clamp01(p * 4), rot: -22 * (1 - spring(p)), dy: -0.15 * (1 - easeOutCubic(p)) };
    case "elastic": {
      const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p) * Math.cos(p * Math.PI * 4.5);
      return { ...REST, opacity: clamp01(p * 4), scale: 0.3 + 0.7 * e };
    }
    case "slam": {
      // falls fast, squashes on impact, settles
      const fall = clamp01(p / 0.55);
      const hit = clamp01((p - 0.55) / 0.45);
      return { ...REST, opacity: clamp01(p * 4), dy: -1.1 * (1 - fall * fall), scale: p < 0.55 ? 1.15 : 1 + 0.12 * Math.sin(hit * Math.PI) * (1 - hit) };
    }
    case "sticker":
      // slapped on: scales up with a twist and a bit of overshoot
      return { ...REST, opacity: clamp01(p * 4), scale: 0.35 + 0.65 * easeOutBack(p, 2.4), rot: -14 * (1 - easeOutCubic(p)) };
    case "chatpop":
      return { ...REST, opacity: clamp01(p * 3), scale: 0.45 + 0.55 * easeOutBack(p, 1.8), dy: 0.35 * (1 - easeOutCubic(p)) };
    case "notify":
      return { ...REST, opacity: clamp01(p * 3), dy: -1.3 * (1 - easeOutBack(p, 1.4)) };
    case "punch":
      return { ...REST, opacity: clamp01(p * 4), dx: -1 * (1 - easeOutBack(p, 2)), scale: 1 + 0.12 * Math.sin(p * Math.PI) };
    case "roll":
      return { ...REST, opacity: clamp01(p * 3), dx: -0.7 * (1 - easeOutCubic(p)), rot: -90 * (1 - easeOutBack(p, 1.3)) };
    case "flicker": {
      const r = flick(Math.floor(elapsed * 30));
      return { ...REST, opacity: p > 0.75 ? 1 : r > 0.45 ? 0.95 : 0.15 };
    }
  }
  return null;
}

export interface EntranceOptions {
  easing?: "linear" | "ease-out" | "ease-in-out" | "back" | "spring";
  direction?: "left" | "right" | "up" | "down";
  delay?: number;
}

const CURVES = {
  linear: (x: number) => x,
  "ease-out": easeOutCubic,
  "ease-in-out": (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  back: (x: number) => easeOutBack(x),
  spring,
};

/** Pose of an element `elapsed` seconds after it started entering. */
export function entrance(kind: EnterAnimation, elapsed: number, speed = 1, o?: EntranceOptions): Pose {
  if (o?.delay) elapsed -= o.delay;
  if (o?.easing || o?.direction) return customEntrance(kind, elapsed, speed, o);
  const d = DURATION[kind] / Math.max(0.1, speed);
  if (kind === "none" || d <= 0 || elapsed >= d) return elapsed < 0 && kind !== "none" ? { ...REST, opacity: 0 } : REST;
  if (elapsed < 0) return { ...REST, opacity: 0 };
  const p = clamp01(elapsed / d);
  const extra = extraEntrance(kind, p, elapsed);
  if (extra) return extra;
  switch (kind) {
    case "fade":
    case "typewriter":
      return { ...REST, opacity: easeOutCubic(p) };
    case "pop":
    case "letters":
      return { ...REST, opacity: clamp01(p * 3), scale: 0.6 + 0.4 * easeOutBack(p) };
    case "spring":
      return { ...REST, opacity: clamp01(p * 4), scale: 0.5 + 0.5 * spring(p) };
    case "rise":
      return { ...REST, opacity: easeOutCubic(p), dy: 0.5 * (1 - easeOutCubic(p)) };
    case "drop":
      return { ...REST, opacity: clamp01(p * 3), dy: -0.7 * (1 - easeOutBack(p, 2.2)) };
    case "slideleft":
      return { ...REST, opacity: easeOutCubic(p), dx: -0.8 * (1 - easeOutCubic(p)) };
    case "zoom":
      return { ...REST, opacity: clamp01(p * 2), scale: 1.6 - 0.6 * easeOutCubic(p) };
    case "blur":
      return { ...REST, opacity: easeOutCubic(p), blur: 0.25 * (1 - p), scale: 1.05 - 0.05 * p };
  }
  return REST;
}

/** Entrance with a chosen easing curve and/or direction. */
function customEntrance(kind: EnterAnimation, elapsed: number, speed: number, o: EntranceOptions): Pose {
  const d = DURATION[kind] / Math.max(0.1, speed);
  if (kind === "none" || d <= 0) return REST;
  if (elapsed < 0) return { ...REST, opacity: 0 };
  if (elapsed >= d) return REST;
  const p = clamp01(elapsed / d);
  const extra = extraEntrance(kind, p, elapsed);
  if (extra) return extra;
  const e = CURVES[o.easing ?? "ease-out"](p);
  const dir = o.direction;
  const vx = dir === "left" ? -1 : dir === "right" ? 1 : 0;
  const vy = dir === "up" ? -1 : dir === "down" ? 1 : 0;
  switch (kind) {
    case "fade":
    case "typewriter":
      return { ...REST, opacity: e };
    case "pop":
    case "letters":
    case "spring":
      return { ...REST, opacity: clamp01(p * 3), scale: 0.6 + 0.4 * e };
    case "rise":
    case "drop":
    case "slideleft": {
      // moves *towards* the chosen direction into place
      const ux = dir ? -vx : kind === "slideleft" ? -1 : 0;
      const uy = dir ? -vy : kind === "rise" ? 1 : kind === "drop" ? -1 : 0;
      return { ...REST, opacity: clamp01(e * 1.5), dx: 0.8 * ux * (1 - e), dy: 0.6 * uy * (1 - e) };
    }
    case "zoom":
      return { ...REST, opacity: clamp01(p * 2), scale: 1.6 - 0.6 * e };
    case "blur":
      return { ...REST, opacity: e, blur: 0.25 * (1 - e), scale: 1.05 - 0.05 * e };
  }
  return REST;
}

/** Quick overshoot when a word becomes active: 0 → ~1.1 → 1 over 140ms. */
export function activePop(elapsed: number): number {
  if (elapsed <= 0) return 0;
  if (elapsed >= 0.14) return 1;
  return easeOutBack(elapsed / 0.14, 2);
}

/** After a word is spoken, ease its extra scale back to 0 over 140ms. */
export function activeSettle(elapsed: number): number {
  if (elapsed <= 0) return 1;
  if (elapsed >= 0.14) return 0;
  return Math.pow(1 - elapsed / 0.14, 3);
}

let segmenter: Intl.Segmenter | null | undefined;

/**
 * Split text into user-perceived characters. Uses Intl.Segmenter so Gujarati
 * clusters like "ક્ષ", "સ્તે" or "ર્ગ" stay together instead of breaking the
 * conjunct into a bare consonant + virama.
 */
export function splitGraphemes(text: string): string[] {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("gu", { granularity: "grapheme" }) : null;
  }
  if (!segmenter) return Array.from(text);
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/** Merge Gujarati clusters joined by virama (older ICU splits them). */
export function splitClusters(text: string): string[] {
  const g = splitGraphemes(text);
  const out: string[] = [];
  for (const piece of g) {
    const last = out[out.length - 1];
    if (last && /્$/.test(last)) out[out.length - 1] = last + piece;
    else out.push(piece);
  }
  return out;
}

export const LETTER_STAGGER = 0.035;
