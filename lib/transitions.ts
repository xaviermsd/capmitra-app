/**
 * Transition catalogue and timing maths (pure, unit-tested in
 * tests/transitions.test.ts). Drawing lives in lib/transitionRender.ts.
 *
 * A transition is centred on the cut: it runs from `cut - half` to
 * `cut + half` with progress p going 0 -> 1 (0.5 exactly at the cut). The
 * timeline itself never changes length. While the outgoing clip is still
 * playing (p < 0.5) the incoming clip is shown from its first frame; after the
 * cut the outgoing clip is held on its last frame. Both pictures are on screen
 * together, so slides, wipes and dissolves never show a black gap.
 */
import type { Clip, TransitionKind, VideoClip } from "./project";
import { clamp01, easeInCubic, ramp, smoothstep } from "./easing";

export interface TransitionMeta {
  kind: TransitionKind;
  label: string;
  /** Shorter name for small tiles. */
  short?: string;
  /** Default length in seconds. */
  duration: number;
}

/** Every transition, in the order the pickers show them. */
export const TRANSITION_META: TransitionMeta[] = [
  { kind: "none", label: "None", duration: 0 },
  { kind: "fade", label: "Cross dissolve", short: "Dissolve", duration: 0.5 },
  { kind: "dip-black", label: "Dip to black", short: "Dip black", duration: 0.6 },
  { kind: "dip-white", label: "Flash", duration: 0.35 },
  { kind: "zoom", label: "Zoom", duration: 0.45 },
  { kind: "slide-left", label: "Slide", duration: 0.45 },
  { kind: "slide-up", label: "Slide up", duration: 0.45 },
  { kind: "wipe", label: "Wipe", duration: 0.5 },
  { kind: "blur", label: "Blur", duration: 0.5 },
  { kind: "whip", label: "Whip pan", duration: 0.35 },
  { kind: "spin", label: "Spin", duration: 0.5 },
  { kind: "glitch", label: "Glitch", duration: 0.35 },
];

export const transitionMeta = (k: TransitionKind): TransitionMeta => TRANSITION_META.find((m) => m.kind === k) ?? TRANSITION_META[1];
export const defaultDuration = (k: TransitionKind) => transitionMeta(k).duration;

/** Half-length of a transition on a cut, limited so it never takes more than half of either clip. */
export function transitionHalf(duration: number, lenBefore: number, lenAfter: number): number {
  return Math.max(0, Math.min(duration / 2, lenBefore / 2, lenAfter / 2));
}

/** Progress 0..1 through a transition centred on `cut`, or null outside it. */
export function transitionProgress(t: number, cut: number, half: number): number | null {
  if (half <= 0 || t < cut - half || t >= cut + half) return null;
  return clamp01((t - (cut - half)) / (2 * half));
}

/**
 * The legacy single "amount" (0 = no effect, 1 = full effect at the cut).
 * Kept for anything that still thinks in dips.
 */
export const dipAmount = (p: number) => smoothstep(1 - Math.abs(p - 0.5) * 2);

/**
 * Travel for moves that accelerate into the cut and decelerate out of it:
 * 0 -> 1 at the cut -> 2 at the end, with matching speed on both sides.
 */
export function throughTravel(p: number): number {
  p = clamp01(p);
  return p < 0.5 ? easeInCubic(p * 2) : 2 - easeInCubic(2 - p * 2);
}

/** Speed of throughTravel, normalised so the peak (at the cut) is 1. */
export function throughSpeed(p: number): number {
  p = clamp01(p);
  const x = p < 0.5 ? p * 2 : 2 - p * 2;
  return x * x;
}

/** Weight of the incoming picture in a cross-fade spread over [p0, p1]. */
export const mixIn = (p: number, p0 = 0, p1 = 1) => (p1 <= p0 ? (p >= p0 ? 1 : 0) : ramp(p0, p1, p));

/**
 * Smallest scale that keeps a W x H picture covering the W x H frame when it
 * is rotated by `rad`, so a spin never shows empty corners.
 */
export function coverScale(rad: number, W: number, H: number): number {
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return Math.max(c + s * (H / W), c + s * (W / H));
}

/** Audio gain across a transition: a short duck at the cut, the whole way down only for a dip to black. */
export function transitionGain(kind: TransitionKind, t: number, cut: number, half: number): number {
  if (half <= 0) return 1;
  const d = Math.abs(t - cut);
  const w = kind === "dip-black" ? half : Math.min(half, 0.08);
  if (d >= w) return 1;
  return smoothstep(d / w);
}

/* ---------- edge frames ---------- */

/** Source time of a video clip's first or last frame (the last is nudged inside the clip). */
export function edgeTime(clip: VideoClip, edge: "start" | "end"): number {
  return edge === "start" ? clip.srcStart : Math.max(clip.srcStart, clip.srcEnd - 0.04);
}

/** Cache key for an edge frame: which video, and when. */
export const edgeKey = (clip: VideoClip, edge: "start" | "end") => `${clip.sourceId ?? "main"}@${edgeTime(clip, edge).toFixed(3)}`;

/** Edge frames needed to draw every transition in an edit list. */
export function edgeRequests(clips: Clip[]): { clip: VideoClip; edge: "start" | "end" }[] {
  const out: { clip: VideoClip; edge: "start" | "end" }[] = [];
  const seen = new Set<string>();
  const add = (clip: Clip | undefined, edge: "start" | "end") => {
    if (!clip || clip.kind !== "video") return;
    const k = edgeKey(clip, edge);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ clip, edge });
  };
  for (let i = 1; i < clips.length; i++) {
    const tr = clips[i].transition;
    if (!tr || tr.kind === "none" || tr.duration <= 0) continue;
    add(clips[i - 1], "end");
    add(clips[i], "start");
  }
  return out;
}

/* ---------- per-transition motion (shared by the renderer and the tests) ---------- */

/** Zoom ratio covered on each side of the cut. */
export const ZOOM_RATIO = 1.9;

/**
 * Scales in the zoom: the outgoing picture pushes in, faster and faster, to the
 * cut; the incoming one starts pushed in just as far and eases back out to
 * normal. Both stay at 1 or above, so the frame never shows an edge.
 */
export function zoomScales(p: number): { from: number; to: number } {
  const g = throughTravel(p);
  return { from: Math.pow(ZOOM_RATIO, g), to: Math.pow(ZOOM_RATIO, 2 - g) };
}

/** Largest spin angle, radians (about 14 degrees). */
export const SPIN_MAX = (14 * Math.PI) / 180;

/** Rotation of the outgoing and incoming pictures in the spin. */
export function spinAngles(p: number): { from: number; to: number } {
  const g = throughTravel(p);
  return { from: SPIN_MAX * g, to: SPIN_MAX * (g - 2) };
}

/**
 * Push travel 0..1 for slides and whip pans: the outgoing picture sits at
 * -travel * span and the incoming one right after it, edge to edge.
 */
export function pushTravel(p: number, whip: boolean): number {
  p = clamp01(p);
  if (whip) return p < 0.5 ? 8 * p ** 4 : 1 - Math.pow(-2 * p + 2, 4) / 2;
  return p < 0.5 ? 4 * p ** 3 : 1 - Math.pow(-2 * p + 2, 3) / 2;
}
