/** One spoken word with its timing, in seconds. */
export interface Word {
  id: string;
  text: string;
  start: number;
  end: number;
  /** Always drawn in the emphasis colour. */
  emphasis?: boolean;
  /** Force a new caption to start at this word. */
  breakBefore?: boolean;
  /** Start a new row (inside the same caption) at this word. */
  lineBreak?: boolean;
  /** Emoji drawn after the word. */
  emoji?: string;
  /** Speaker id from diarization, e.g. "speaker_0". */
  speaker?: string;
  /** Hand-corrected English-letter spelling, used when captions are romanised. */
  roman?: string;
}

/** A group of words that appear on screen together. */
export interface CaptionLine {
  id: string;
  /** Stable key (id of the first word) used for per-caption overrides. */
  key: string;
  words: Word[];
  start: number;
  end: number;
}

/**
 * How the words of the current caption appear:
 * - chunk:   whole caption at once, spoken word highlighted
 * - build:   words appear one by one as they are spoken and stay
 * - solo:    only the word being spoken is shown
 * - karaoke: whole caption shown, colour sweeps through each word as it is spoken
 */
export type RevealMode = "chunk" | "build" | "solo" | "karaoke";

export type EnterAnimation =
  | "none"
  | "fade"
  | "pop"
  | "spring"
  | "rise"
  | "drop"
  | "slideleft"
  | "zoom"
  | "blur"
  | "letters"
  | "typewriter"
  | "bounce"
  | "shake"
  | "glitch"
  | "stamp"
  | "whip"
  | "swing"
  | "elastic"
  | "slam"
  | "sticker"
  | "chatpop"
  | "notify"
  | "punch"
  | "roll"
  | "flicker";

export type Align = "left" | "center" | "right";

/**
 * How caption text is written: native script, strict English letters ("roman"),
 * or casual English letters with English loanwords spelled the English way
 * ("casual": Gujlish / Hinglish). "gujlish" is the old name for "casual".
 */
export type Script = "native" | "roman" | "casual" | "gujlish";

/** The smaller second line (usually an English translation). */
export interface SecondaryLine {
  enabled: boolean;
  /** Size relative to the main caption (0.5 = half). */
  sizeRatio: number;
  fill: string;
  /** Font; defaults to the caption font. */
  font?: string;
  weight?: number;
  /** Gap between the caption and the second line, in em of the main size. */
  gap: number;
  /** Draw it above the caption instead of below. */
  above?: boolean;
  /** Semi-transparent background behind the second line. */
  plate?: string;
}

/** A translation for one caption, kept separately from the spoken words. */
export interface LineTranslation {
  text: string;
  /** The caption text it was made from; when the caption changes the translation is marked stale. */
  source: string;
  /** Target language, e.g. "en-IN". */
  lang: string;
  /** Edited by hand (never overwritten by "Translate again" unless asked). */
  manual?: boolean;
}
export type Translations = Record<string, LineTranslation>;

/** Background box behind the caption. Sizes are fractions of the font size. */
export interface CaptionPlate {
  color: string;
  radius: number;
  padX: number;
  padY: number;
  /** Outline around the box. */
  border?: { color: string; width: number };
  /** Hard offset shadow (no blur), drawn behind the box. */
  shadow?: { color: string; x: number; y: number };
  /** "caption": one box around the whole caption (default); "line": one box per line; "full": full caption width. */
  fit?: "caption" | "line" | "full";
  /** The box moves and scales with the caption's entrance animation. */
  moveWithText?: boolean;
  /** Left-to-right gradient fill instead of a flat colour. */
  gradient?: [string, string];
  /** Speech-bubble tail under the box. */
  tail?: "left" | "center" | "right";
  /** A header row inside the box, like a phone notification: icon, title and time. */
  header?: { title: string; meta?: string; iconColor: string; color?: string };
}

export interface CaptionStyle {
  id: string;
  name: string;
  /** Font family (one of the Gujarati Google Fonts). */
  font: string;
  weight: number;
  /** Font size as % of frame height. */
  sizeVh: number;
  /** Vertical centre of the caption, % from top. */
  posY: number;
  /** Horizontal centre of the caption, % from left (default 50). */
  posX?: number;
  /** Max caption width as % of frame width before wrapping. */
  maxWidthPct: number;
  align: Align;
  /** Extra spacing between letters, in em. */
  letterSpacing: number;
  /** Row height multiplier. */
  lineHeight: number;
  /** Space between words, in em. */
  wordGap: number;
  /** Uppercase any Latin (English) words. */
  uppercase: boolean;
  /** Show Gujarati script or Gujlish (romanised). */
  script?: Script;

  fill: string;
  /** Optional vertical gradient for the text, overrides fill. */
  gradient?: [string, string];
  /** Outline; width is a fraction of font size (0.08 = thick). */
  stroke?: { color: string; width: number };
  shadow?: { color: string; blur: number; offsetY: number };
  /** Background plate behind the caption. */
  plate?: CaptionPlate;

  active: {
    fill?: string;
    /** Rounded box behind the spoken word. */
    box?: string;
    boxRadius?: number;
    boxPadX?: number;
    boxPadY?: number;
    /** Scale of the spoken word, e.g. 1.12. */
    scale?: number;
    /** Glow colour around the spoken word. */
    glow?: string;
    /** Outline drawn around the active-word box (use box "transparent" for an outline-only frame). */
    boxBorder?: { color: string; width: number };
    /** The box glides from the previous word to the spoken word instead of jumping. */
    boxSlide?: boolean;
  };
  /** Colour of words already spoken; defaults to fill. */
  spokenFill?: string;
  /** Colour of words not yet spoken (chunk/karaoke); defaults to fill. */
  upcomingFill?: string;
  /** Opacity of words not yet spoken (chunk/karaoke). */
  upcomingOpacity: number;
  emphasisFill: string;

  reveal: RevealMode;
  enter: EnterAnimation;
  /** Animation speed multiplier. */
  speed: number;
  /** Max words per caption. */
  maxWords: number;
  /** Max rows a caption may wrap onto. */
  maxRows: number;
  /** Start a new caption when the pause between words is longer than this (s). */
  breakOnPause: number;
  /** Keep each caption on screen at least this long (s). */
  minDuration: number;
  /** Optional second line under each caption (translation). */
  secondary?: SecondaryLine;
  /** Colour each word by its speaker (diarized videos). */
  speakerColors?: boolean;
  /** Wait this long after a caption/word starts before its entrance (s). */
  enterDelay?: number;
  /** Override the entrance's easing curve. */
  easing?: "linear" | "ease-out" | "ease-in-out" | "back" | "spring";
  /** Direction for slide / rise entrances. */
  direction?: "left" | "right" | "up" | "down";
  /** A different look for emphasised (★) words, e.g. a script font on the key word. */
  accent?: AccentStyle;
  /** Per-row looks: rows[0] styles the first row of each caption, rows[1] the second, and so on. */
  rows?: RowStyle[];
  /** Start a second row after this many words (for title + subtitle looks). */
  rowSplit?: number;
  /** Words not yet spoken are drawn as an outline only (chunk and karaoke reveals). */
  upcomingHollow?: boolean;
  /** A rounded chip behind every word. */
  chips?: WordChips;
  /** Solid 3D depth behind the letters; depth in em. */
  extrude?: { color: string; depth: number; angle?: number };
  /** Outline copies trailing behind the letters. */
  echo?: { color: string; count: number; spacing: number };
  /** Draw the captions behind the people in the video (found on this device). */
  behindSubject?: boolean;
  /** A hand-drawn mark on key words, drawn on as the word is spoken. */
  mark?: WordMark;
  /** Ransom-note letters: every letter on its own coloured, tilted scrap. */
  letters?: LetterBoxes;
}

/** Look of emphasised words. Every field is optional and falls back to the caption's own. */
export interface AccentStyle {
  font?: string;
  weight?: number;
  italic?: boolean;
  /** Size relative to the caption (1.4 = 40% bigger). */
  sizeMul?: number;
  fill?: string;
  gradient?: [string, string];
  /** Outline; null removes the caption outline for these words. */
  stroke?: { color: string; width: number } | null;
  /** Shadow; null removes the caption shadow for these words. */
  shadow?: { color: string; blur: number; offsetY: number } | null;
  glow?: string;
  case?: "upper" | "lower";
  /** Nudge up (negative) or down, in em. */
  yOffset?: number;
}

/** Look of one row inside a caption. */
export interface RowStyle {
  sizeMul?: number;
  fill?: string;
  font?: string;
  weight?: number;
  italic?: boolean;
  case?: "upper" | "lower";
}

export interface WordMark {
  kind: "circle" | "underline" | "scribble" | "highlight" | "box";
  color: string;
  /** Pen width in em. */
  width: number;
  /** Which words get the mark: ★ words (default) or the word being spoken. */
  target?: "emphasis" | "active";
}

export interface LetterBoxes {
  /** Scrap colours, picked per letter. */
  colors: string[];
  /** Letter colour for each scrap colour (same order); defaults to ink on light, white on dark. */
  inks?: string[];
  /** Maximum tilt in degrees. */
  tilt: number;
  padX: number;
  padY: number;
  radius: number;
  /** All words (default) or only ★ words. */
  target?: "all" | "emphasis";
}

/** Chip (pill) drawn behind each word. */
export interface WordChips {
  color: string;
  /** Chip colour while the word is spoken. */
  activeColor?: string;
  radius: number;
  padX: number;
  padY: number;
  border?: { color: string; width: number };
  /** Alternate small tilt, in degrees, for a hand-placed sticker feel. */
  tilt?: number;
}

/** Changes that apply to one caption only. */
export interface LineOverride {
  posX?: number;
  posY?: number;
  sizeVh?: number;
  fill?: string;
  activeFill?: string;
  font?: string;
  hidden?: boolean;
  /** Keep this caption on screen longer (s). */
  extend?: number;
}

export type Overrides = Record<string, LineOverride>;

export type AspectId = "original" | "9:16" | "4:5" | "1:1" | "16:9" | "4:3";
export type FitMode = "crop" | "blur" | "color";

/** Output frame: shape, how the video fills it, and safe-zone guides. */
export interface FrameSettings {
  platform: string;
  aspect: AspectId;
  fit: FitMode;
  /** Background colour for "color" fit. */
  bg: string;
  /** Crop pan, % (50 = centred). */
  panX: number;
  panY: number;
  /** Extra zoom for crop, 1 = cover. */
  zoom: number;
  showSafeZone: boolean;
}

export interface Trim {
  start: number;
  /** null = until the end */
  end: number | null;
}

export interface ProjectData {
  words: Word[];
  style: CaptionStyle;
  offset: number;
  overrides: Overrides;
  frame: FrameSettings;
  trim: Trim;
  /** Spoken language of this project (as transcribed or detected). */
  language?: string;
  /** Second-line translations by caption key. */
  translations?: Translations;
}

export interface ProjectFile extends Partial<ProjectData> {
  app: "capmitra";
  version: 1 | 2;
  words: Word[];
  style: CaptionStyle;
  offset: number;
  videoName?: string;
}
