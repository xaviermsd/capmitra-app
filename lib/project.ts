/**
 * The project document: everything that makes up one edited video.
 *
 *   words        spoken words with timing (caption time; + offset = source video time)
 *   clips        the edit list: pieces of the source video in order, plus title "cards"
 *   layers       graphics on top of (or under) the captions
 *   audio        volume, fades and background music
 *   translations second-line captions, by caption key
 *   speakers     names and colours for diarized speakers
 *
 * Older projects (no clips) are upgraded on load: their trim becomes one clip.
 */
import type { VoiceSettings } from "./voice/presets";
import type { CaptionStyle, FrameSettings, LineOverride, Overrides, ProjectData, Translations, Trim, Word } from "./types";

/* ---------- edit list ---------- */

export type TransitionKind =
  | "none" | "fade" | "dip-black" | "dip-white" | "flash-black" | "zoom" | "zoom-out"
  | "slide-left" | "slide-right" | "slide-up" | "slide-down" | "wipe" | "blur" | "spin" | "glitch" | "whip";

/** How a clip enters (from the previous clip). */
export interface Transition {
  kind: TransitionKind;
  /** Seconds, split evenly across the cut (half out, half in). */
  duration: number;
}

export interface Background {
  kind: "color" | "gradient" | "pattern" | "svg";
  color?: string;
  colors?: [string, string];
  /** Gradient angle in degrees. */
  angle?: number;
  pattern?: "dots" | "grid" | "waves" | "rays";
  /** Sanitised SVG markup (see lib/svgSafe.ts). */
  svg?: string;
}

interface ClipBase {
  id: string;
  transition?: Transition;
  /** Set on items added by a brand kit, so re-applying a kit replaces them. */
  tag?: "brand-intro" | "brand-outro";
}

/**
 * A piece of a video, [srcStart, srcEnd) in that video's seconds. Without
 * `sourceId` it comes from the project's main video (the one with captions);
 * with it, from an extra video stored as an asset.
 */
export interface VideoClip extends ClipBase {
  kind: "video";
  srcStart: number;
  srcEnd: number;
  /** Asset id of an extra video; absent = the main video. */
  sourceId?: string;
  /** Length of that extra video (s), so trimming knows its bounds. */
  srcDuration?: number;
  /** Shown in the clip list for extra videos. */
  name?: string;
  /** 0..2, multiplies the project volume. */
  volume?: number;
  /** Playback speed, 0.25..4 (1 = normal). The clip lasts (srcEnd - srcStart) / speed on the timeline. */
  speed?: number;
  /** Per-clip framing (otherwise the project frame applies). */
  frame?: Partial<Pick<FrameSettings, "panX" | "panY" | "zoom" | "fit">>;
}

/** A title/intro/outro card with no source video. */
export interface CardClip extends ClipBase {
  kind: "card";
  duration: number;
  background: Background;
  title?: string;
  subtitle?: string;
  /** Title colour. */
  color?: string;
  font?: string;
}

/** A still image shown for `duration` seconds, framed like video. */
export interface ImageClip extends ClipBase {
  kind: "image";
  assetId: string;
  name?: string;
  duration: number;
  frame?: Partial<Pick<FrameSettings, "panX" | "panY" | "zoom" | "fit">>;
  /** Slow zoom in (Ken Burns), 1 = none, e.g. 1.15. */
  kenBurns?: number;
}

export type Clip = VideoClip | CardClip | ImageClip;

/** Does this clip come from the project's main video (where the captions live)? */
export const isMainVideo = (c: Clip): c is VideoClip => c.kind === "video" && !c.sourceId;
/** Clips with their own length (cards, images). */
export const isTimed = (c: Clip): c is CardClip | ImageClip => c.kind !== "video";

/* ---------- graphics ---------- */

export type LayerKind = "text" | "lowerThird" | "titleCard" | "callout" | "speakerLabel" | "shape" | "svg" | "image" | "progress" | "sticker";
export type ShapeKind = "rect" | "circle" | "line" | "arrow" | "star" | "burst" | "pulse" | "sparkle" | "underline";
export type Easing = "linear" | "ease-out" | "ease-in-out" | "back" | "spring";
export type LayerAnim = "none" | "fade" | "pop" | "slide" | "wipe" | "zoom" | "spin" | "bounce" | "typewriter" | "blur";
export type Direction = "left" | "right" | "up" | "down";

export interface LayerMotion {
  /** Entrance / exit animation. */
  in: LayerAnim;
  out: LayerAnim;
  /** Seconds. */
  duration: number;
  /** Seconds after the layer's start before the entrance begins. */
  delay: number;
  easing: Easing;
  direction: Direction;
  /** Continuous motion while visible. */
  loop?: "none" | "float" | "pulse" | "spin" | "shake";
}

export interface Layer {
  id: string;
  kind: LayerKind;
  name: string;
  /** Output-timeline seconds. */
  start: number;
  end: number;
  /** Centre position, % of frame. */
  x: number;
  y: number;
  /** Size, % of frame width / height. */
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  /** Stacking order; captions sit at Project.captionZ. */
  z: number;
  hidden?: boolean;
  locked?: boolean;
  motion: LayerMotion;
  /** Kind-specific settings. */
  text?: string;
  subtitle?: string;
  font?: string;
  weight?: number;
  /** Text size, % of frame height. */
  size?: number;
  color?: string;
  accent?: string;
  background?: string;
  shape?: ShapeKind;
  stroke?: number;
  /** Asset id for images / SVG files. */
  assetId?: string;
  /** Inline sanitised SVG markup. */
  svg?: string;
  /** For speakerLabel layers: which speaker. */
  speaker?: string;
  /** Set on items added by a brand kit. */
  tag?: "brand-logo";
}

/* ---------- audio ---------- */

export interface Music {
  assetId: string;
  name: string;
  /** 0..1 */
  volume: number;
  /** Where the music starts on the output timeline (s). */
  start: number;
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
  /** How much to lower the music while someone speaks (0 = not at all, 1 = silent). */
  duck: number;
  /** Beat times within the music file (s), from the generator or beat detection. */
  beats?: number[];
  bpm?: number;
}

/** A sound effect (or any short audio) placed on the timeline. */
export interface SoundClip {
  id: string;
  assetId: string;
  name: string;
  /** Output-timeline seconds. */
  start: number;
  /** Length of the sound (s). */
  duration: number;
  /** 0..2 */
  volume: number;
  group?: string;
}

export interface AudioSettings {
  /** Original sound volume, 0..2. */
  volume: number;
  /** Original sound switched off (keeps the volume setting for when it's back on). */
  muted?: boolean;
  fadeIn: number;
  fadeOut: number;
  music?: Music;
  /** Voice enhancer on the original sound (lib/voice). */
  voice?: VoiceSettings;
}

export const DEFAULT_AUDIO: AudioSettings = { volume: 1, fadeIn: 0, fadeOut: 0 };

export interface Speaker {
  name: string;
  color: string;
}

export type ExportFormat = "mp4" | "webm";

export interface ExportPrefs {
  format: ExportFormat;
  /** Short side in px, 0 = source. */
  short: number;
  quality: "medium" | "high" | "very-high";
  /** Frames per second, 0 = same as source. */
  fps: number;
}

export const DEFAULT_EXPORT: ExportPrefs = { format: "mp4", short: 0, quality: "high", fps: 0 };

/* ---------- the document ---------- */

export interface ProjectDoc extends ProjectData {
  clips?: Clip[];
  /** Video effects on the output timeline (zoom punch, glitch, looks…). */
  effects?: import("./effects/fx").FxClip[];
  /** Sound effects on the output timeline. */
  sounds?: SoundClip[];
  layers?: Layer[];
  audio?: AudioSettings;
  speakers?: Record<string, Speaker>;
  /** Stacking position of the captions among layers. */
  captionZ?: number;
  exportPrefs?: ExportPrefs;
  brandKitId?: string;
  batchId?: string;
}

export const CAPTION_Z = 50;

let seq = 0;
export const uid = (p = "id") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** One clip covering the trimmed source (or the whole video when `duration` is unknown). */
export function clipsFromTrim(trim: Trim | undefined, duration: number): Clip[] {
  const start = Math.max(0, trim?.start ?? 0);
  const end = trim?.end ?? (duration > 0 ? duration : Infinity);
  return [{ id: "c-main", kind: "video", srcStart: start, srcEnd: end }];
}

/**
 * Clips to use: the saved edit list, or one clip from the legacy trim.
 * Open-ended clips (srcEnd = Infinity, saved before the duration was known)
 * are closed at `duration`.
 */
export function effectiveClips(doc: { clips?: Clip[]; trim?: Trim }, duration: number): Clip[] {
  const base = doc.clips?.length ? doc.clips : clipsFromTrim(doc.trim, duration);
  return base
    .map((c) => (isMainVideo(c) && duration > 0 && (!Number.isFinite(c.srcEnd) || c.srcEnd > duration) ? { ...c, srcEnd: duration } : c))
    .filter((c) => (c.kind === "video" ? c.srcEnd - c.srcStart > 0.01 || !Number.isFinite(c.srcEnd) : c.duration > 0));
}

/** JSON can't hold Infinity: store open ends as null and restore them. */
export function serialiseClips(clips: Clip[] | undefined): Clip[] | undefined {
  return clips?.map((c) => (c.kind === "video" && !Number.isFinite(c.srcEnd) ? ({ ...c, srcEnd: null as unknown as number }) : c));
}
export function reviveClips(clips: Clip[] | undefined): Clip[] | undefined {
  return clips?.map((c) => (c.kind === "video" && (c.srcEnd === null || c.srcEnd === undefined) ? { ...c, srcEnd: Infinity } : c));
}

/** Upgrade any saved project to the current shape (never throws). */
export function migrate<T extends Partial<ProjectDoc>>(p: T): T & { overrides: Overrides } {
  const out = { ...p, overrides: p.overrides ?? {} } as T & { overrides: Overrides };
  if (out.style?.script === "gujlish") out.style = { ...out.style, script: "casual" } as CaptionStyle;
  if (out.clips) out.clips = reviveClips(out.clips);
  if (out.layers) out.layers = out.layers.map((l) => ({ ...l, motion: { ...DEFAULT_MOTION, ...(l.motion ?? {}) } }));
  return out;
}

export const DEFAULT_MOTION: LayerMotion = { in: "fade", out: "fade", duration: 0.4, delay: 0, easing: "ease-out", direction: "up", loop: "none" };

/** Keys used to compare whether two docs differ (for autosave and undo). */
export type DocPatch = Partial<Omit<ProjectDoc, "words">> & { words?: Word[] };

export function lineOverride(o: Overrides, key: string): LineOverride | undefined {
  return o[key];
}

export type { Translations };
