import type { EnterAnimation } from "./types";
import { clamp01, easeInCubic, easeOutBack, easeOutCubic, easeOutExpo, easeOutQuad, lerp, softSpring } from "./easing";

/*
 * Caption entrances. Shared rules so every style feels like one family:
 *   - opacity always eases in (never a hard first frame) and the pose lands on
 *     exactly REST at the end (never a jump on the last frame)
 *   - scales start close to 1 (0.6 to 0.9) and overshoot by a few percent at most
 *   - positional moves decelerate into place (cubic / expo out)
 */

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

/** Opacity that eases in over the first `portion` of the move (no hard first frame). */
const fadeIn = (p: number, portion = 0.5) => easeOutQuad(p / portion);

/** Duration of each entrance, seconds at speed 1. */
const DURATION: Record<EnterAnimation, number> = {
  none: 0,
  fade: 0.22,
  pop: 0.3,
  spring: 0.45,
  rise: 0.32,
  drop: 0.36,
  slideleft: 0.32,
  zoom: 0.32,
  blur: 0.34,
  letters: 0.26,
  typewriter: 0.06,
  bounce: 0.5,
  shake: 0.4,
  glitch: 0.3,
  stamp: 0.3,
  whip: 0.3,
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
      // drops in and bounces twice, each bounce smaller
      const b = Math.abs(Math.cos(p * Math.PI * 2.5)) * Math.pow(1 - p, 2);
      return { ...REST, opacity: fadeIn(p, 0.25), dy: -0.45 * b, scale: 1 + 0.04 * b };
    }
    case "shake":
      return { ...REST, opacity: fadeIn(p, 0.25), dx: Math.sin(elapsed * 70) * 0.1 * Math.pow(1 - p, 2) };
    case "glitch": {
      const r = flick(Math.floor(elapsed * 60));
      return { ...REST, opacity: fadeIn(p, 0.15) * (p < 0.7 ? (r > 0.35 ? 1 : 0.25) : 1), dx: (r - 0.5) * 0.22 * (1 - p), blur: r > 0.85 ? 0.04 * (1 - p) : 0 };
    }
    case "stamp": {
      // comes down fast from larger, lands, a small squash, settles
      const fall = clamp01(p / 0.6);
      const hit = clamp01((p - 0.6) / 0.4);
      const scale = p < 0.6 ? lerp(1.6, 1, easeInCubic(fall)) : 1 - 0.05 * Math.sin(hit * Math.PI) * (1 - hit);
      return { ...REST, opacity: fadeIn(p, 0.25), scale };
    }
    case "whip":
      return { ...REST, opacity: fadeIn(p, 0.35), dx: 1.2 * Math.pow(1 - p, 3), blur: 0.14 * Math.pow(1 - p, 2), rot: -5 * Math.pow(1 - p, 2) };
    case "swing":
      return { ...REST, opacity: fadeIn(p, 0.25), rot: -18 * (1 - softSpring(p, 0.3)), dy: -0.12 * (1 - easeOutCubic(p)) };
    case "elastic": {
      const e = p >= 1 ? 1 : 1 - Math.pow(2, -10 * p) * Math.cos(p * Math.PI * 4.5);
      return { ...REST, opacity: fadeIn(p, 0.25), scale: 0.55 + 0.45 * e };
    }
    case "slam": {
      // falls fast, squashes on impact, settles (scale stays continuous)
      const fall = clamp01(p / 0.55);
      const hit = clamp01((p - 0.55) / 0.45);
      const scale = p < 0.55 ? lerp(1.12, 1, fall * fall) : 1 + 0.08 * Math.sin(hit * Math.PI) * (1 - hit);
      return { ...REST, opacity: fadeIn(p, 0.25), dy: -0.9 * (1 - fall * fall), scale };
    }
    case "sticker":
      // slapped on: scales up with a small twist and a little overshoot
      return { ...REST, opacity: fadeIn(p, 0.3), scale: lerp(0.6, 1, easeOutBack(p, 2)), rot: -10 * (1 - easeOutCubic(p)) };
    case "chatpop":
      return { ...REST, opacity: fadeIn(p, 0.35), scale: lerp(0.7, 1, easeOutBack(p, 1.8)), dy: 0.3 * (1 - easeOutCubic(p)) };
    case "notify":
      return { ...REST, opacity: fadeIn(p, 0.35), dy: -1.1 * (1 - easeOutBack(p, 1.3)) };
    case "punch":
      return { ...REST, opacity: fadeIn(p, 0.3), dx: -0.8 * (1 - easeOutBack(p, 1.8)), scale: 1 + 0.08 * Math.sin(p * Math.PI) };
    case "roll":
      return { ...REST, opacity: fadeIn(p, 0.35), dx: -0.6 * (1 - easeOutCubic(p)), rot: -45 * (1 - easeOutBack(p, 1.3)) };
    case "flicker": {
      const r = flick(Math.floor(elapsed * 30));
      return { ...REST, opacity: p > 0.75 ? 1 : (r > 0.45 ? 0.95 : 0.15) * fadeIn(p, 0.1) };
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
  linear: (x: number) => clamp01(x),
  "ease-out": easeOutCubic,
  "ease-in-out": (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  back: (x: number) => easeOutBack(x, 1.4),
  spring: (x: number) => softSpring(x, 0.08),
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
      return { ...REST, opacity: easeOutQuad(p) };
    case "pop":
    case "letters":
      // from 85 % with a soft overshoot of about 4 %
      return { ...REST, opacity: fadeIn(p, 0.5), scale: lerp(0.85, 1, softSpring(p, 0.25)) };
    case "spring":
      return { ...REST, opacity: fadeIn(p, 0.35), scale: lerp(0.7, 1, softSpring(p, 0.22)) };
    case "rise":
      return { ...REST, opacity: fadeIn(p, 0.6), dy: 0.4 * (1 - easeOutCubic(p)) };
    case "drop":
      return { ...REST, opacity: fadeIn(p, 0.4), dy: -0.55 * (1 - easeOutBack(p, 1.6)) };
    case "slideleft":
      return { ...REST, opacity: fadeIn(p, 0.6), dx: -0.7 * (1 - easeOutCubic(p)) };
    case "zoom":
      return { ...REST, opacity: fadeIn(p, 0.5), scale: lerp(1.25, 1, easeOutExpo(p)) };
    case "blur":
      return { ...REST, opacity: fadeIn(p, 0.7), blur: 0.2 * (1 - easeOutCubic(p)), scale: lerp(1.04, 1, easeOutCubic(p)) };
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
      return { ...REST, opacity: clamp01(e) };
    case "pop":
    case "letters":
    case "spring":
      return { ...REST, opacity: fadeIn(p, 0.5), scale: lerp(0.85, 1, e) };
    case "rise":
    case "drop":
    case "slideleft": {
      // moves *towards* the chosen direction into place
      const ux = dir ? -vx : kind === "slideleft" ? -1 : 0;
      const uy = dir ? -vy : kind === "rise" ? 1 : kind === "drop" ? -1 : 0;
      return { ...REST, opacity: fadeIn(p, 0.6), dx: 0.7 * ux * (1 - e), dy: 0.5 * uy * (1 - e) };
    }
    case "zoom":
      return { ...REST, opacity: fadeIn(p, 0.5), scale: lerp(1.25, 1, e) };
    case "blur":
      return { ...REST, opacity: fadeIn(p, 0.7), blur: 0.2 * (1 - e), scale: lerp(1.04, 1, e) };
  }
  return REST;
}

const ACTIVE_IN = 0.16;
const ACTIVE_OUT = 0.18;

/** Soft overshoot when a word becomes active: 0 -> ~1.08 -> 1 over 160 ms. */
export function activePop(elapsed: number): number {
  if (elapsed <= 0) return 0;
  if (elapsed >= ACTIVE_IN) return 1;
  return easeOutBack(elapsed / ACTIVE_IN, 1.4);
}

/** After a word is spoken, ease its extra scale back to 0 over 180 ms. */
export function activeSettle(elapsed: number): number {
  if (elapsed <= 0) return 1;
  if (elapsed >= ACTIVE_OUT) return 0;
  return 1 - easeOutCubic(elapsed / ACTIVE_OUT);
}

/**
 * Extra-scale amount (0 to about 1.08) of a word that was active from `start`
 * to `end`, at time t. The settle starts from wherever the pop had got to, so
 * a short word never jumps when it stops being active.
 */
export function wordPop(t: number, start: number, end: number): number {
  if (t < start) return 0;
  if (t < end) return activePop(t - start);
  return activePop(end - start) * activeSettle(t - end);
}

/** Exit length for a caption that leaves into a pause, seconds. */
export const CAPTION_EXIT = 0.16;

/**
 * Caption exit factor, 1 (fully shown) -> 0 (gone) over the last
 * CAPTION_EXIT seconds before `visibleEnd`. Only used when nothing replaces
 * the caption right away.
 */
export function exitFactor(t: number, visibleEnd: number): number {
  const left = visibleEnd - t;
  if (left >= CAPTION_EXIT) return 1;
  if (left <= 0) return 0;
  return easeOutQuad(left / CAPTION_EXIT);
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
