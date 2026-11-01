/**
 * Transition catalogue and timing maths (pure, unit-tested in
 * tests/transitions.test.ts). Drawing lives in lib/transitionRender.ts.
 *
 * A transition is centred on the cut: it runs from `cut - half` to
 * `cut + half` with progress p going 0 -> 1 (0.5 exactly at the cut). The
 * timeline itself never changes length. Both clips move during it: the
 * incoming clip plays its head handle before the cut and the outgoing clip its
 * tail handle after it (lib/overlap.ts), so both pictures are real footage.
 */
import type { TransitionKind } from "./project";
import { bell, clamp01, easeInCubic, easeInExpo, easeInOutCubic, easeInOutQuart, easeInOutSine, easeInQuad, easeOutCubic, easeOutExpo, ramp, smoothstep } from "./easing";

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
  { kind: "dip-white", label: "Flash", duration: 0.32 },
  { kind: "flash-black", label: "Flash black", duration: 0.32 },
  { kind: "zoom", label: "Zoom in", duration: 0.5 },
  { kind: "zoom-out", label: "Zoom out", duration: 0.5 },
  { kind: "slide-left", label: "Slide left", duration: 0.4 },
  { kind: "slide-right", label: "Slide right", duration: 0.4 },
  { kind: "slide-up", label: "Slide up", duration: 0.4 },
  { kind: "slide-down", label: "Slide down", duration: 0.4 },
  { kind: "whip", label: "Whip pan", duration: 0.3 },
  { kind: "spin", label: "Spin", duration: 0.45 },
  { kind: "glitch", label: "Glitch", duration: 0.3 },
  { kind: "blur", label: "Blur", duration: 0.45 },
  { kind: "wipe", label: "Wipe", duration: 0.45 },
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

/* ---------- per-transition motion (shared by the renderer and the tests) ---------- */

/** How far the zoom punches in at the cut. */
export const ZOOM_PUNCH = 2.2;
/** Where the flash (white or black) is fully on: held across the cut for a frame or two. */
export const FLASH_HOLD: [number, number] = [0.42, 0.58];
/** Window around the cut where the glitch flickers between both clips. */
export const GLITCH_FLICKER = 0.12;

/** One clip's picture in a transition, placed about the frame centre. */
export interface Pose {
  who: "from" | "to";
  scale: number;
  /** Radians, clockwise. */
  rot: number;
  dx: number;
  dy: number;
  alpha: number;
  /** Zoom blur: copies spread from `scale` up to `scale * (1 + zoomBlur)`. */
  zoomBlur?: number;
  /** Rotational blur: copies spread over this many radians around `rot`. */
  spinBlur?: number;
  /** Soft drop shadow (a picture shrinking away over the next one). */
  shadow?: boolean;
}

export interface TransitionLayout {
  /** Bottom first. */
  layers: Pose[];
  /** Motion blur along the move, in pixels. */
  motionBlur: number;
  horiz: boolean;
  /** Defocus over the whole picture, in pixels. */
  blur: number;
  /** Exposure lift (1 = none). */
  bright: number;
  /** A solid colour over everything (flash, dips). */
  wash: { color: string; alpha: number } | null;
}

const pose = (who: Pose["who"], o: Partial<Pose> = {}): Pose => ({ who, scale: 1, rot: 0, dx: 0, dy: 0, alpha: 1, ...o });
/** The outgoing picture until the cut, then the incoming one. */
const sideAt = (p: number): Pose["who"] => (p < 0.5 ? "from" : "to");

/**
 * Push travel 0 -> 1. Slides use cubic in-out, so the move spreads over the
 * middle of the window and both pictures are seen travelling; the whip uses
 * quart in-out, faster in the middle but still readable.
 */
export const pushTravel = (p: number, whip = false) => (whip ? easeInOutQuart(p) : easeInOutCubic(p));
/** Speed of pushTravel, normalised so the peak (the middle) is 1. */
export function pushSpeed(p: number, whip = false): number {
  p = clamp01(p);
  const u = p < 0.5 ? p * 2 : 2 - p * 2;
  return whip ? u * u * u : u * u;
}

/**
 * Where every picture is at progress p. Pure geometry, so the tests can check
 * that the frame is always fully covered (no black edges or corners) except
 * where a transition is meant to go to black.
 */
export function transitionLayout(kind: TransitionKind, p: number, W: number, H: number, t = 0): TransitionLayout {
  p = clamp01(p);
  const L: TransitionLayout = { layers: [], motionBlur: 0, horiz: true, blur: 0, bright: 1, wash: null };
  const short = Math.min(W, H);
  const u = clamp01(p * 2); // first half: 0 -> 1 into the cut
  const w = clamp01(p * 2 - 1); // second half: 0 -> 1 out of the cut
  const crossAtCut = ramp(0.47, 0.53, p);

  switch (kind) {
    case "fade":
      L.layers = [pose("from"), pose("to", { alpha: easeInOutSine(p) })];
      return L;

    case "dip-black": {
      const k = p < 0.5 ? easeInOutSine(p / 0.44) : easeInOutSine((1 - p) / 0.44);
      L.layers = [pose(sideAt(p))];
      L.wash = { color: "#000000", alpha: clamp01(k) };
      return L;
    }

    case "dip-white":
    case "flash-black": {
      const [h0, h1] = FLASH_HOLD;
      const k = p < h0 ? easeInQuad(p / h0) : p <= h1 ? 1 : Math.pow(1 - (p - h1) / (1 - h1), 2);
      L.layers = [pose(sideAt(p))];
      const white = kind === "dip-white";
      L.wash = { color: white ? "#FFFFFF" : "#000000", alpha: clamp01(k) };
      if (white) L.bright = 1 + 1.4 * k; // the picture blows out as the light comes up
      return L;
    }

    case "zoom": {
      // punch in: the old clip rushes in to 2.2x, the new one lands from 2.2x
      const Z = ZOOM_PUNCH;
      const from = pose("from", { scale: 1 + (Z - 1) * easeInExpo(u), zoomBlur: 0.5 * easeInQuad(u) });
      const to = pose("to", { scale: Z - (Z - 1) * easeOutExpo(w), zoomBlur: 0.5 * Math.pow(1 - w, 2) });
      L.layers = p < 0.47 ? [from] : p >= 0.53 ? [to] : [from, { ...to, alpha: crossAtCut }];
      L.blur = short * 0.012 * (p < 0.5 ? easeInQuad(u) : Math.pow(1 - w, 2));
      return L;
    }

    case "zoom-out": {
      // the old clip shrinks away over the new one, which settles from 1.35x underneath
      const q = clamp01(p / 0.6);
      L.layers = [
        pose("to", { scale: 1.35 - 0.35 * easeOutCubic(p) }),
        pose("from", { scale: 1 - 0.45 * easeInQuad(q), alpha: 1 - ramp(0.38, 0.62, p), shadow: true }),
      ];
      // a soft defocus instead of zoom-blur copies (copies ghost on a fading picture); gone by the end
      L.blur = short * 0.01 * bell(p) * (1 - ramp(0.7, 0.95, p));
      return L;
    }

    case "slide-left":
    case "slide-right":
    case "slide-up":
    case "slide-down":
    case "whip": {
      // a full-frame push, edge to edge, so there is never a gap
      const whip = kind === "whip";
      const horiz = kind === "slide-left" || kind === "slide-right" || whip;
      const sign = kind === "slide-right" || kind === "slide-down" ? 1 : -1;
      const span = horiz ? W : H;
      const e = pushTravel(p, whip);
      const off = sign * e * span;
      const back = off - sign * span;
      // a whip lands with a small settle: a touch of scale that eases out
      const settle = whip ? 1 + 0.06 * (p < 0.5 ? easeInQuad(u) : Math.pow(1 - w, 3)) : 1;
      const v = pushSpeed(p, whip);
      L.layers = horiz
        ? [pose("from", { dx: off, scale: settle }), pose("to", { dx: back, scale: settle })]
        : [pose("from", { dy: off, scale: settle }), pose("to", { dy: back, scale: settle })];
      L.horiz = horiz;
      // blur follows the speed but stays a fraction of the per-frame move, so
      // mid-push frames still show both pictures rather than a smear
      L.motionBlur = (whip ? 0.22 : 0.07) * span * v;
      if (whip) L.blur = short * 0.004 * v;
      return L;
    }

    case "spin": {
      // 90 degrees out, 90 degrees in; the scale is the exact cover scale for each angle
      const a0 = (Math.PI / 2) * easeInCubic(u);
      const a1 = -(Math.PI / 2) * (1 - easeOutCubic(w));
      const from = pose("from", { rot: a0, scale: coverScale(a0, W, H), spinBlur: 0.5 * easeInQuad(u) });
      const to = pose("to", { rot: a1, scale: coverScale(a1, W, H), spinBlur: 0.5 * Math.pow(1 - w, 2) });
      L.layers = p < 0.47 ? [from] : p >= 0.53 ? [to] : [from, { ...to, alpha: crossAtCut }];
      L.blur = short * 0.01 * (p < 0.5 ? easeInQuad(u) : Math.pow(1 - w, 2));
      return L;
    }

    case "blur": {
      const b = bell(p);
      const s = 1 + 0.06 * b;
      L.layers = [pose("from", { scale: s }), pose("to", { scale: s, alpha: ramp(0.35, 0.65, p) })];
      L.blur = short * 0.09 * b;
      return L;
    }

    case "glitch": {
      // flickers between both clips for a few frames right at the cut
      let who = sideAt(p);
      if (Math.abs(p - 0.5) < GLITCH_FLICKER) who = Math.floor(t * 30) % 2 === 0 ? "to" : "from";
      L.layers = [pose(who)];
      return L;
    }

    case "wipe":
      L.layers = [pose("from"), pose("to", { alpha: 1 })];
      return L;

    default:
      L.layers = [pose(sideAt(p))];
      return L;
  }
}

/**
 * Whether the point (x, y) of the W x H frame is covered by an opaque picture
 * in this layout (used by the tests for the no-black-edges guarantee).
 */
export function covers(l: TransitionLayout, W: number, H: number, x: number, y: number): boolean {
  return l.layers.some((ps) => {
    if (ps.alpha < 0.999) return false;
    // into the picture's own frame: undo translate, rotate, scale about the centre
    const px = x - W / 2 - ps.dx;
    const py = y - H / 2 - ps.dy;
    const c = Math.cos(-ps.rot), s = Math.sin(-ps.rot);
    const qx = (px * c - py * s) / ps.scale;
    const qy = (px * s + py * c) / ps.scale;
    return Math.abs(qx) <= W / 2 + 1e-6 && Math.abs(qy) <= H / 2 + 1e-6;
  });
}
