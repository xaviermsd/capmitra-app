/**
 * Video effects on the timeline (zoom punch, shake, glitch, flash, cinematic
 * bars, colour looks…). Each effect is a clip with a start, end and intensity.
 *
 * `fxStateAt()` turns the active effects into one plain description of the
 * frame (camera transform, colour filter, overlays). It's pure, so the preview
 * and the export get exactly the same numbers, and it's unit-tested.
 */

export type FxType =
  // camera
  | "zoom-punch" | "zoom-in" | "zoom-out" | "slow-zoom" | "shake" | "earthquake" | "spin-punch" | "whip"
  // overlays
  | "flash" | "flash-black" | "glitch" | "rgb-split" | "vhs" | "strobe" | "bars" | "vignette" | "grain" | "light-leak" | "blur-in"
  // colour looks
  | "grade-warm" | "grade-cool" | "grade-teal-orange" | "grade-vintage" | "grade-mono" | "grade-vivid" | "grade-dream" | "grade-noir";

export interface FxClip {
  id: string;
  type: FxType;
  /** Output-timeline seconds. */
  start: number;
  end: number;
  /** 0..1 */
  intensity: number;
  /** Set when added by beat sync / a preset (so they can be cleared together). */
  group?: string;
}

export interface FxMeta {
  type: FxType;
  label: string;
  kind: "camera" | "overlay" | "grade";
  /** Typical length when dropped at the playhead (s). */
  length: number;
  /** Good for placing on music beats. */
  beat?: boolean;
}

export const FX: FxMeta[] = [
  { type: "zoom-punch", label: "Zoom punch", kind: "camera", length: 0.35, beat: true },
  { type: "zoom-in", label: "Zoom in", kind: "camera", length: 1 },
  { type: "zoom-out", label: "Zoom out", kind: "camera", length: 1 },
  { type: "slow-zoom", label: "Slow zoom (Ken Burns)", kind: "camera", length: 5 },
  { type: "shake", label: "Camera shake", kind: "camera", length: 0.5, beat: true },
  { type: "earthquake", label: "Earthquake", kind: "camera", length: 0.8 },
  { type: "spin-punch", label: "Spin punch", kind: "camera", length: 0.4, beat: true },
  { type: "whip", label: "Whip pan", kind: "camera", length: 0.3 },
  { type: "flash", label: "Flash", kind: "overlay", length: 0.25, beat: true },
  { type: "flash-black", label: "Black flash", kind: "overlay", length: 0.25, beat: true },
  { type: "glitch", label: "Glitch", kind: "overlay", length: 0.4, beat: true },
  { type: "rgb-split", label: "RGB split", kind: "overlay", length: 0.6, beat: true },
  { type: "vhs", label: "VHS", kind: "overlay", length: 4 },
  { type: "strobe", label: "Strobe", kind: "overlay", length: 1 },
  { type: "bars", label: "Cinematic bars", kind: "overlay", length: 6 },
  { type: "vignette", label: "Vignette", kind: "overlay", length: 6 },
  { type: "grain", label: "Film grain", kind: "overlay", length: 6 },
  { type: "light-leak", label: "Light leak", kind: "overlay", length: 2 },
  { type: "blur-in", label: "Blur in", kind: "overlay", length: 0.8 },
  { type: "grade-warm", label: "Warm", kind: "grade", length: 6 },
  { type: "grade-cool", label: "Cool", kind: "grade", length: 6 },
  { type: "grade-teal-orange", label: "Teal & orange", kind: "grade", length: 6 },
  { type: "grade-vintage", label: "Vintage", kind: "grade", length: 6 },
  { type: "grade-mono", label: "Black & white", kind: "grade", length: 6 },
  { type: "grade-vivid", label: "Vivid", kind: "grade", length: 6 },
  { type: "grade-dream", label: "Dreamy", kind: "grade", length: 6 },
  { type: "grade-noir", label: "Noir", kind: "grade", length: 6 },
];

export const fxMeta = (t: FxType) => FX.find((f) => f.type === t)!;

export interface FxState {
  /** Camera transform applied to the video picture (around the frame centre). */
  scale: number;
  /** Offsets as a fraction of the frame size. */
  dx: number;
  dy: number;
  /** Degrees. */
  rotate: number;
  /** Horizontal motion blur strength 0..1 (whip). */
  motionBlur: number;
  /** CSS filter for the video picture ("none" when no grade). */
  filter: string;
  flash: { color: string; alpha: number } | null;
  /** Glitch: number of displaced slices (0 = none), seeded per frame. */
  glitch: { amount: number; seed: number } | null;
  rgbSplit: number;
  bars: number;
  vignette: number;
  grain: { amount: number; seed: number } | null;
  scanlines: number;
  lightLeak: number;
  blur: number;
}

export const NO_FX: FxState = {
  scale: 1, dx: 0, dy: 0, rotate: 0, motionBlur: 0, filter: "none", flash: null, glitch: null,
  rgbSplit: 0, bars: 0, vignette: 0, grain: null, scanlines: 0, lightLeak: 0, blur: 0,
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
/** Quick rise, smooth fall: a punch envelope over 0..1. */
const punch = (p: number) => (p < 0.18 ? easeOut(p / 0.18) : 1 - easeOut((p - 0.18) / 0.82));
/** Ease in/out over the first/last 0.25 s of a long effect. */
function ramp(t: number, s: number, e: number, edge = 0.25) {
  const a = clamp01((t - s) / edge);
  const b = clamp01((e - t) / edge);
  return Math.min(a, b);
}
/** Deterministic pseudo-random noise (same in preview and export). */
export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const GRADES: Record<string, (k: number) => string> = {
  "grade-warm": (k) => `sepia(${0.25 * k}) saturate(${1 + 0.25 * k}) hue-rotate(${-8 * k}deg) brightness(${1 + 0.03 * k})`,
  "grade-cool": (k) => `saturate(${1 + 0.1 * k}) hue-rotate(${12 * k}deg) brightness(${1 - 0.02 * k})`,
  "grade-teal-orange": (k) => `contrast(${1 + 0.18 * k}) saturate(${1 + 0.35 * k}) sepia(${0.12 * k}) hue-rotate(${-12 * k}deg)`,
  "grade-vintage": (k) => `sepia(${0.45 * k}) contrast(${1 - 0.1 * k}) brightness(${1 + 0.05 * k}) saturate(${1 - 0.25 * k})`,
  "grade-mono": (k) => `grayscale(${k}) contrast(${1 + 0.15 * k})`,
  "grade-vivid": (k) => `saturate(${1 + 0.6 * k}) contrast(${1 + 0.12 * k})`,
  "grade-dream": (k) => `brightness(${1 + 0.1 * k}) saturate(${1 + 0.2 * k}) contrast(${1 - 0.1 * k})`,
  "grade-noir": (k) => `grayscale(${k}) contrast(${1 + 0.45 * k}) brightness(${1 - 0.08 * k})`,
};

/** Combine every effect active at time t (output timeline). `frame` seeds noise per frame. */
export function fxStateAt(effects: FxClip[] | undefined, t: number, frame = Math.round(t * 30)): FxState {
  if (!effects?.length) return NO_FX;
  const s: FxState = { ...NO_FX };
  const filters: string[] = [];
  for (const f of effects) {
    if (t < f.start || t >= f.end) continue;
    const len = Math.max(0.01, f.end - f.start);
    const p = clamp01((t - f.start) / len);
    const k = clamp01(f.intensity);
    switch (f.type) {
      case "zoom-punch": s.scale *= 1 + 0.22 * k * punch(p); break;
      case "zoom-in": s.scale *= 1 + 0.3 * k * easeOut(p); break;
      case "zoom-out": s.scale *= 1 + 0.3 * k * (1 - easeOut(p)); break;
      case "slow-zoom": s.scale *= 1 + 0.12 * k * p; break;
      case "spin-punch": s.scale *= 1 + 0.15 * k * punch(p); s.rotate += 6 * k * Math.sin(p * Math.PI) * (hash01(Math.floor(f.start * 10)) > 0.5 ? 1 : -1); break;
      case "shake":
      case "earthquake": {
        const amp = (f.type === "earthquake" ? 0.035 : 0.018) * k * (1 - p * 0.6);
        s.dx += (hash01(frame * 1.3 + 1) - 0.5) * 2 * amp;
        s.dy += (hash01(frame * 1.7 + 2) - 0.5) * 2 * amp;
        if (f.type === "earthquake") s.rotate += (hash01(frame + 9) - 0.5) * 2.5 * k;
        s.scale *= 1 + amp * 1.5; // hide the edges
        break;
      }
      case "whip": { const w = Math.sin(p * Math.PI); s.dx += 0.25 * k * (p - 0.5) * 2 * w; s.motionBlur = Math.max(s.motionBlur, w * k); break; }
      case "flash": { const a = punch(p) * k; if (!s.flash || a > s.flash.alpha) s.flash = { color: "#FFFFFF", alpha: a }; break; }
      case "flash-black": { const a = punch(p) * k; if (!s.flash || a > s.flash.alpha) s.flash = { color: "#000000", alpha: a }; break; }
      case "strobe": { const on = Math.floor((t - f.start) * 12) % 2 === 0; if (on) s.flash = { color: "#FFFFFF", alpha: 0.55 * k * ramp(t, f.start, f.end, 0.1) }; break; }
      case "glitch": s.glitch = { amount: Math.max(s.glitch?.amount ?? 0, k * (0.4 + 0.6 * hash01(frame))), seed: frame }; s.rgbSplit = Math.max(s.rgbSplit, 0.6 * k); break;
      case "rgb-split": s.rgbSplit = Math.max(s.rgbSplit, k * Math.sin(p * Math.PI)); break;
      case "vhs": { const r = ramp(t, f.start, f.end) * k; s.scanlines = Math.max(s.scanlines, r); s.rgbSplit = Math.max(s.rgbSplit, 0.35 * r); s.grain = { amount: Math.max(s.grain?.amount ?? 0, 0.5 * r), seed: frame }; filters.push(`saturate(${1 - 0.25 * r}) contrast(${1 + 0.1 * r})`); if (hash01(frame * 0.37) > 0.93) s.glitch = { amount: 0.3 * r, seed: frame }; break; }
      case "bars": s.bars = Math.max(s.bars, k * ramp(t, f.start, f.end, 0.4)); break;
      case "vignette": s.vignette = Math.max(s.vignette, k * ramp(t, f.start, f.end)); break;
      case "grain": s.grain = { amount: Math.max(s.grain?.amount ?? 0, k * ramp(t, f.start, f.end)), seed: frame }; break;
      case "light-leak": s.lightLeak = Math.max(s.lightLeak, k * Math.sin(p * Math.PI)); break;
      case "blur-in": s.blur = Math.max(s.blur, k * (1 - easeOut(p))); break;
      default: {
        const g = GRADES[f.type];
        if (g) filters.push(g(k * ramp(t, f.start, f.end, 0.3)));
      }
    }
  }
  s.filter = filters.length ? filters.join(" ") : "none";
  return s;
}

/** Is anything going on that changes the picture? */
export const fxActive = (s: FxState) => s !== NO_FX;
