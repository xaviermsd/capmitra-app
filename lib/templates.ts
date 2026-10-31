import type { CaptionStyle } from "./types";

const BASE: Omit<CaptionStyle, "id" | "name"> = {
  font: "Anek Gujarati",
  weight: 800,
  sizeVh: 6,
  posY: 70,
  maxWidthPct: 86,
  align: "center",
  letterSpacing: 0,
  lineHeight: 1.25,
  wordGap: 0.28,
  uppercase: false,
  fill: "#FFFFFF",
  stroke: { color: "#000000", width: 0.06 },
  shadow: { color: "rgba(0,0,0,0.55)", blur: 0.25, offsetY: 0.06 },
  active: { fill: "#FFD60A", scale: 1.1 },
  upcomingOpacity: 1,
  emphasisFill: "#FF4D4D",
  reveal: "chunk",
  enter: "pop",
  speed: 1,
  maxWords: 4,
  maxRows: 2,
  breakOnPause: 0.28,
  minDuration: 0.6,
};

function t(id: string, name: string, s: Partial<CaptionStyle>): CaptionStyle {
  return { ...structuredClone(BASE), ...s, id, name, active: { ...(s.active ?? BASE.active) } };
}

/** CapMitra's own look: lime sticker box, ink outline and hard shadow, like the Export button. */
export const ELECTRIC_LIME_ID = "electric-lime";

export const TEMPLATES: CaptionStyle[] = [
  t(ELECTRIC_LIME_ID, "Electric Lime", {
    font: "Anek Gujarati", weight: 800, sizeVh: 5.4, posY: 72, maxWidthPct: 84, lineHeight: 1.72, wordGap: 0.26,
    fill: "#080808", stroke: undefined, shadow: undefined,
    plate: { color: "#D6FF36", radius: 0.24, padX: 0.5, padY: 0.18, border: { color: "#080808", width: 0.07 }, shadow: { color: "#080808", x: 0.1, y: 0.1 }, fit: "line", moveWithText: true },
    active: { fill: "#D6FF36", box: "#080808", boxRadius: 0.16, boxPadX: 0.1, boxPadY: 0.06, scale: 1.05 },
    emphasisFill: "#D92D20", reveal: "chunk", enter: "pop", maxWords: 4, maxRows: 2,
  }),
  t("spotlight", "Spotlight", {
    font: "Baloo Bhai 2", weight: 800, sizeVh: 6.6, posY: 55, reveal: "build", enter: "spring",
    maxWords: 3, maxRows: 1, active: { fill: "#FFD60A", scale: 1.14 },
  }),
  t("boxed", "Boxed", {
    font: "Anek Gujarati", weight: 800, sizeVh: 6, stroke: undefined,
    active: { fill: "#FFFFFF", box: "#FF3B30", boxRadius: 0.22, boxPadX: 0.16, boxPadY: 0.06, scale: 1.04 },
    enter: "pop", posY: 75,
  }),
  t("karaoke", "Karaoke", {
    font: "Hind Vadodara", weight: 700, sizeVh: 5.4, reveal: "karaoke", enter: "fade", maxWords: 6,
    active: { fill: "#00E5FF" }, spokenFill: "#00E5FF", posY: 80,
  }),
  t("oneword", "One word", {
    font: "Shrikhand", weight: 400, sizeVh: 9, reveal: "solo", enter: "pop", maxWords: 1, maxRows: 1,
    fill: "#FFE14D", active: { fill: "#FFE14D", scale: 1.05 }, stroke: { color: "#111111", width: 0.09 }, posY: 50,
  }),
  t("subtitle", "Classic subtitle", {
    font: "Noto Sans Gujarati", weight: 600, sizeVh: 4.2, posY: 86, maxWords: 8, enter: "none", stroke: undefined,
    shadow: undefined, active: {}, plate: { color: "rgba(0,0,0,0.65)", radius: 0.2, padX: 0.5, padY: 0.2 },
    minDuration: 1,
  }),
  t("typewriter", "Typewriter", {
    font: "Mukta Vaani", weight: 700, sizeVh: 5.6, enter: "typewriter", reveal: "chunk", maxWords: 5,
    active: { fill: "#7CFF6B" }, stroke: { color: "#000000", width: 0.05 },
  }),
  t("neon", "Neon", {
    font: "Mukta Vaani", weight: 800, sizeVh: 6.2, stroke: undefined, fill: "#FFFFFF",
    shadow: { color: "#FF2BD6", blur: 0.5, offsetY: 0 }, active: { fill: "#FF8BF0", glow: "#FF2BD6", scale: 1.08 },
    enter: "blur", reveal: "build",
  }),
  t("boldpop", "Bold pop", {
    font: "Kumar One", weight: 400, sizeVh: 7, fill: "#FFE600", stroke: { color: "#000000", width: 0.11 },
    active: { fill: "#FFFFFF", scale: 1.15 }, enter: "spring", maxWords: 2, maxRows: 1, posY: 60,
  }),
  t("gold", "Royal gold", {
    font: "Rasa", weight: 700, sizeVh: 6.4, gradient: ["#FFF3B0", "#D4A017"], stroke: { color: "#3B2500", width: 0.04 },
    active: { scale: 1.08, glow: "#FFD700" }, enter: "rise", reveal: "build", maxWords: 4,
  }),
  t("minimal", "Minimal", {
    font: "Anek Gujarati", weight: 500, sizeVh: 4.6, stroke: undefined,
    shadow: { color: "rgba(0,0,0,0.6)", blur: 0.3, offsetY: 0.04 }, active: {}, upcomingOpacity: 0.45,
    enter: "rise", posY: 78, maxWords: 6,
  }),
  t("farsan", "Farsan fun", {
    font: "Farsan", weight: 400, sizeVh: 7.4, fill: "#FFFFFF", stroke: { color: "#E63946", width: 0.08 },
    active: { fill: "#FFD166", scale: 1.12 }, enter: "drop", reveal: "build", maxWords: 3,
  }),
  t("news", "News strip", {
    font: "Noto Serif Gujarati", weight: 700, sizeVh: 4.4, posY: 88, stroke: undefined, shadow: undefined,
    plate: { color: "#C1121F", radius: 0.08, padX: 0.6, padY: 0.25 }, active: { fill: "#FFE066" },
    enter: "slideleft", maxWords: 7, maxRows: 1,
  }),
  t("greenbox", "Green highlight", {
    font: "Baloo Bhai 2", weight: 800, sizeVh: 6.2, stroke: { color: "#000000", width: 0.05 },
    active: { fill: "#000000", box: "#39FF88", boxRadius: 0.3, boxPadX: 0.18, boxPadY: 0.04, scale: 1.06 },
    enter: "pop", reveal: "build", maxWords: 3,
  }),
  t("outline", "Outline", {
    font: "Kumar One Outline", weight: 400, sizeVh: 7, stroke: undefined, fill: "#FFFFFF",
    active: { fill: "#FFD60A", scale: 1.1 }, enter: "zoom", maxWords: 3, maxRows: 1,
  }),
  t("story", "Story card", {
    font: "Hind Vadodara", weight: 700, sizeVh: 4.8, fill: "#111111", stroke: undefined, shadow: undefined,
    plate: { color: "#FFFFFF", radius: 0.35, padX: 0.55, padY: 0.25 }, active: { fill: "#E63946" },
    enter: "pop", maxWords: 5, posY: 72,
  }),
  t("sunset", "Sunset gradient", {
    font: "Anek Gujarati", weight: 800, sizeVh: 6.6, gradient: ["#FF9A3C", "#FF2E63"], stroke: { color: "#FFFFFF", width: 0.05 },
    active: { scale: 1.12, glow: "#FF6A3D" }, enter: "spring", reveal: "build", maxWords: 3,
  }),
  t("mogra", "Mogra bold", {
    font: "Mogra", weight: 400, sizeVh: 7, fill: "#FFFFFF", stroke: { color: "#5B2A86", width: 0.09 },
    active: { fill: "#B8F35B", scale: 1.1 }, enter: "letters", maxWords: 3,
  }),
  t("lettercascade", "Letter cascade", {
    font: "Noto Sans Gujarati", weight: 800, sizeVh: 6, enter: "letters", reveal: "build",
    active: { fill: "#4CC9F0", scale: 1.06 }, maxWords: 4,
  }),

  // ---- accent word: the ★ word gets its own font (highlight keywords first) ----
  t("mehndi-script", "Mehndi Script", {
    font: "Anek Gujarati", weight: 700, sizeVh: 5.4, posY: 72, stroke: undefined,
    shadow: { color: "rgba(0,0,0,0.5)", blur: 0.3, offsetY: 0.05 }, active: { scale: 1.04 },
    accent: { font: "Pacifico", weight: 400, sizeMul: 1.3, fill: "#FF5FA2", yOffset: 0.06, glow: "rgba(255,95,162,0.55)" },
    reveal: "build", enter: "pop", maxWords: 4,
  }),
  t("golden-italic", "Golden Italic", {
    font: "Anek Gujarati", weight: 700, sizeVh: 5.2, posY: 70, stroke: undefined,
    shadow: { color: "rgba(0,0,0,0.55)", blur: 0.3, offsetY: 0.05 }, active: { scale: 1.04 },
    accent: { font: "Playfair Display", weight: 800, italic: true, sizeMul: 1.35, gradient: ["#FFF1B8", "#D4A017"], glow: "rgba(212,160,23,0.45)" },
    reveal: "build", enter: "rise", maxWords: 4,
  }),
  t("ink-signature", "Ink Signature", {
    font: "Anek Gujarati", weight: 800, sizeVh: 5.4, posY: 72, stroke: { color: "#000000", width: 0.04 },
    active: { scale: 1.05 },
    accent: { font: "Caveat", weight: 700, sizeMul: 1.5, fill: "#FF3B3B", stroke: null, shadow: { color: "rgba(0,0,0,0.6)", blur: 0.25, offsetY: 0.04 }, yOffset: 0.04 },
    reveal: "build", enter: "pop", maxWords: 4,
  }),
  t("big-word", "Big Word", {
    font: "Anek Gujarati", weight: 800, sizeVh: 4.8, posY: 66, fill: "#E9ECEF", stroke: undefined,
    shadow: { color: "rgba(0,0,0,0.6)", blur: 0.3, offsetY: 0.05 }, active: { fill: "#FFFFFF", scale: 1.05 },
    accent: { sizeMul: 1.75, fill: "#FFFFFF", case: "upper" }, upcomingOpacity: 0.5,
    reveal: "chunk", enter: "stamp", maxWords: 4, lineHeight: 1.1,
  }),

  // ---- row hierarchy ----
  t("headline-drop", "Headline Drop", {
    font: "Anek Gujarati", weight: 800, sizeVh: 6, posY: 64, uppercase: true, maxWidthPct: 70, lineHeight: 1.05,
    stroke: undefined, shadow: { color: "rgba(0,0,0,0.6)", blur: 0.3, offsetY: 0.06 },
    rows: [{ sizeMul: 0.62, fill: "#FFFFFF", weight: 700 }, { sizeMul: 1.25, fill: "#D6FF36" }], rowSplit: 2,
    emphasisFill: "#FFFFFF", active: { scale: 1.06 }, reveal: "build", enter: "rise", maxWords: 4, maxRows: 2,
  }),
  t("title-sub", "Title & Sub", {
    font: "Anek Gujarati", weight: 800, sizeVh: 6.2, posY: 68, maxWidthPct: 72, lineHeight: 1.12, stroke: undefined,
    shadow: { color: "rgba(0,0,0,0.55)", blur: 0.3, offsetY: 0.05 },
    rows: [{ sizeMul: 1.2 }, { sizeMul: 0.6, fill: "#C9CED6", weight: 600 }], rowSplit: 2,
    emphasisFill: "#FFD60A", active: { fill: "#FFD60A" }, reveal: "build", enter: "pop", maxWords: 4, maxRows: 2,
  }),
  t("dhamaka-caps", "Dhamaka Caps", {
    font: "Anek Gujarati", weight: 800, sizeVh: 6.6, posY: 62, uppercase: true, maxWidthPct: 66, lineHeight: 1.02,
    stroke: { color: "#000000", width: 0.05 },
    rows: [{ fill: "#FF3B30" }, { fill: "#FFFFFF", sizeMul: 0.82 }], rowSplit: 2, emphasisFill: "#FFD60A",
    active: { scale: 1.1 }, reveal: "build", enter: "slam", maxWords: 4, maxRows: 2,
  }),

  // ---- hollow: words fill in as they are spoken ----
  t("hollow-fill", "Hollow Fill", {
    font: "Anek Gujarati", weight: 800, sizeVh: 6.4, posY: 66, uppercase: true, stroke: undefined, shadow: undefined,
    fill: "#FFFFFF", upcomingHollow: true, active: { fill: "#D6FF36" }, emphasisFill: "#D6FF36",
    reveal: "karaoke", enter: "fade", maxWords: 3, maxRows: 1,
  }),

  // ---- pills, chips and boxes ----
  t("lime-pill", "Lime Pill", {
    font: "Anek Gujarati", weight: 800, sizeVh: 5, posY: 74, fill: "#080808", stroke: undefined, shadow: undefined,
    plate: { color: "#D6FF36", radius: 0.6, padX: 0.5, padY: 0.16, border: { color: "#080808", width: 0.06 }, fit: "line", moveWithText: true },
    active: { scale: 1.06 }, emphasisFill: "#3B28CC", upcomingOpacity: 0.45, reveal: "chunk", enter: "pop", maxWords: 4, lineHeight: 1.6,
  }),
  t("word-chips", "Word Chips", {
    font: "Anek Gujarati", weight: 700, sizeVh: 5, posY: 74, fill: "#FFFFFF", stroke: undefined, shadow: undefined,
    chips: { color: "rgba(8,8,8,0.82)", activeColor: "#D6FF36", radius: 0.28, padX: 0.2, padY: 0.08 },
    active: { fill: "#080808", scale: 1.04 }, emphasisFill: "#D6FF36", reveal: "build", enter: "pop", maxWords: 4, lineHeight: 1.6, wordGap: 0.12,
  }),
  t("sticker-chips", "Sticker Chips", {
    font: "Anek Gujarati", weight: 800, sizeVh: 5.2, posY: 70, fill: "#080808", uppercase: true, stroke: undefined, shadow: undefined,
    chips: { color: "#FFFFFF", activeColor: "#FFD60A", radius: 0.16, padX: 0.18, padY: 0.08, border: { color: "#080808", width: 0.06 }, tilt: 3 },
    active: { fill: "#080808", scale: 1.06 }, emphasisFill: "#E63946", reveal: "build", enter: "sticker", maxWords: 3, lineHeight: 1.7, wordGap: 0.14,
  }),
  t("glide-box", "Glide Box", {
    font: "Anek Gujarati", weight: 800, sizeVh: 5.6, posY: 72, fill: "#FFFFFF", stroke: undefined,
    shadow: { color: "rgba(0,0,0,0.5)", blur: 0.25, offsetY: 0.04 },
    active: { fill: "#FFFFFF", box: "#7C5CFF", boxRadius: 0.2, boxPadX: 0.14, boxPadY: 0.06, boxSlide: true }, emphasisFill: "#FFD60A",
    reveal: "chunk", enter: "pop", maxWords: 4,
  }),
  t("frame-line", "Frame Line", {
    font: "Anek Gujarati", weight: 700, sizeVh: 5.4, posY: 72, fill: "#FFFFFF", stroke: undefined,
    shadow: { color: "rgba(0,0,0,0.6)", blur: 0.3, offsetY: 0.05 },
    active: { fill: "#FFFFFF", box: "transparent", boxBorder: { color: "#D6FF36", width: 0.07 }, boxRadius: 0.12, boxPadX: 0.14, boxPadY: 0.06, boxSlide: true }, emphasisFill: "#D6FF36",
    upcomingOpacity: 0.7, reveal: "chunk", enter: "fade", maxWords: 4,
  }),

  // ---- chat and phone UI ----
  t("chat-bubble", "Chat Bubble", {
    font: "Anek Gujarati", weight: 700, sizeVh: 4.6, posY: 72, maxWidthPct: 74, fill: "#111111", stroke: undefined, shadow: undefined,
    plate: { color: "#FFFFFF", radius: 0.55, padX: 0.55, padY: 0.28, tail: "left", moveWithText: true, shadow: { color: "rgba(0,0,0,0.25)", x: 0, y: 0.08 } },
    active: { fill: "#1D5FD6" }, emphasisFill: "#1D5FD6", reveal: "chunk", enter: "chatpop", maxWords: 6, lineHeight: 1.3,
  }),
  t("lime-reply", "Lime Reply", {
    font: "Anek Gujarati", weight: 800, sizeVh: 4.8, posY: 72, maxWidthPct: 74, fill: "#080808", stroke: undefined, shadow: undefined,
    plate: { color: "#D6FF36", radius: 0.55, padX: 0.55, padY: 0.28, tail: "right", border: { color: "#080808", width: 0.06 }, shadow: { color: "#080808", x: 0.08, y: 0.08 }, moveWithText: true },
    active: { scale: 1.05 }, upcomingOpacity: 0.5, emphasisFill: "#3B28CC", reveal: "chunk", enter: "chatpop", maxWords: 5, lineHeight: 1.3,
  }),
  t("ping-card", "Ping Card", {
    font: "Anek Gujarati", weight: 600, sizeVh: 4.2, posY: 22, maxWidthPct: 78, align: "left", fill: "#111111", stroke: undefined, shadow: undefined,
    plate: { color: "rgba(255,255,255,0.94)", radius: 0.5, padX: 0.42, padY: 0.32, moveWithText: true, shadow: { color: "rgba(0,0,0,0.22)", x: 0, y: 0.1 },
      header: { title: "New message", meta: "now", iconColor: "#7C5CFF", color: "#111111" } },
    active: { fill: "#7C5CFF" }, emphasisFill: "#7C5CFF", reveal: "chunk", enter: "notify", maxWords: 7, lineHeight: 1.3,
  }),

  // ---- sticker and 3D ----
  t("sticker-3d", "Sticker 3D", {
    font: "Anek Gujarati", weight: 800, sizeVh: 7, posY: 62, uppercase: true, fill: "#FFD60A",
    stroke: { color: "#080808", width: 0.06 }, shadow: undefined, extrude: { color: "#080808", depth: 0.12, angle: 50 },
    active: { fill: "#FFFFFF", scale: 1.1 }, emphasisFill: "#FF5FA2", reveal: "build", enter: "sticker", maxWords: 2, maxRows: 1,
  }),
  t("echo-candy", "Echo Candy", {
    font: "Anek Gujarati", weight: 800, sizeVh: 6.6, posY: 62, fill: "#FF5FA2", stroke: undefined,
    shadow: undefined, echo: { color: "#FFFFFF", count: 2, spacing: 0.07 },
    active: { fill: "#FFFFFF", scale: 1.08 }, emphasisFill: "#FFD60A", reveal: "build", enter: "pop", maxWords: 3, maxRows: 1,
  }),
  t("sunset-box", "Sunset Box", {
    font: "Anek Gujarati", weight: 800, sizeVh: 5.6, posY: 70, uppercase: true, fill: "#FFFFFF", stroke: undefined, shadow: undefined,
    plate: { color: "#FF6A3D", gradient: ["#FF9A3C", "#FF2E63"], radius: 0.14, padX: 0.4, padY: 0.12, fit: "line", moveWithText: true },
    active: { fill: "#FFF3B0", scale: 1.06 }, emphasisFill: "#FFF3B0", reveal: "chunk", enter: "zoom", maxWords: 3, lineHeight: 1.45,
  }),

  // ---- behind the person: one huge word, people walk in front of it ----
  t("behind-me", "Behind Me", {
    font: "Anek Gujarati", weight: 800, sizeVh: 13, posY: 34, uppercase: true, fill: "#FFFFFF", stroke: undefined,
    shadow: { color: "rgba(0,0,0,0.25)", blur: 0.2, offsetY: 0.03 }, behindSubject: true,
    active: { scale: 1 }, emphasisFill: "#D6FF36", reveal: "solo", enter: "stamp", maxWords: 1, maxRows: 1, letterSpacing: -0.02,
  }),

  // ---- hand-drawn marks on the ★ word (drawn on as it is spoken) ----
  t("circle-it", "Circle It", {
    font: "Anek Gujarati", weight: 800, sizeVh: 5.6, posY: 70, fill: "#FFFFFF", stroke: undefined,
    shadow: { color: "rgba(0,0,0,0.55)", blur: 0.3, offsetY: 0.05 }, mark: { kind: "circle", color: "#FF3B3B", width: 0.075 },
    emphasisFill: "#FFFFFF", active: { scale: 1.05 }, reveal: "build", enter: "pop", maxWords: 4,
  }),
  t("marker-swipe", "Marker Swipe", {
    font: "Anek Gujarati", weight: 800, sizeVh: 5.6, posY: 70, fill: "#FFFFFF", stroke: undefined,
    shadow: { color: "rgba(0,0,0,0.5)", blur: 0.3, offsetY: 0.05 }, mark: { kind: "highlight", color: "#FFD60A", width: 0.9 },
    accent: { fill: "#080808", shadow: null }, active: { scale: 1.04 }, reveal: "build", enter: "rise", maxWords: 4,
  }),
  t("underline-pop", "Underline Pop", {
    font: "Anek Gujarati", weight: 800, sizeVh: 5.6, posY: 70, fill: "#FFFFFF", stroke: { color: "#000000", width: 0.04 },
    mark: { kind: "underline", color: "#D6FF36", width: 0.09 }, emphasisFill: "#D6FF36", active: { scale: 1.06 },
    reveal: "build", enter: "pop", maxWords: 4,
  }),
  t("scribble-note", "Scribble Note", {
    font: "Anek Gujarati", weight: 700, sizeVh: 5.2, posY: 70, fill: "#FFFFFF", stroke: undefined,
    shadow: { color: "rgba(0,0,0,0.5)", blur: 0.3, offsetY: 0.05 }, mark: { kind: "scribble", color: "#FF5FA2", width: 0.06 },
    accent: { font: "Caveat", weight: 700, sizeMul: 1.45, fill: "#FFFFFF", yOffset: -0.04 }, active: { scale: 1.04 },
    reveal: "build", enter: "pop", maxWords: 4,
  }),
  t("box-note", "Box Note", {
    font: "Anek Gujarati", weight: 800, sizeVh: 5.4, posY: 70, fill: "#FFFFFF", stroke: undefined,
    shadow: { color: "rgba(0,0,0,0.55)", blur: 0.3, offsetY: 0.05 }, mark: { kind: "box", color: "#FFFFFF", width: 0.06 },
    emphasisFill: "#FFD60A", active: { scale: 1.04 }, reveal: "build", enter: "pop", maxWords: 4, wordGap: 0.4,
  }),

  // ---- ransom-note letters ----
  t("ransom-note", "Ransom Note", {
    font: "Anek Gujarati", weight: 800, sizeVh: 5.6, posY: 66, uppercase: true, fill: "#080808", stroke: undefined, shadow: undefined,
    letters: { colors: ["#FFFFFF", "#FFD60A", "#080808", "#FF5FA2", "#8ED8F8", "#D6FF36", "#FF6A3D"], tilt: 9, padX: 0.05, padY: 0.07, radius: 0.05 },
    letterSpacing: 0.14, wordGap: 0.32, active: { scale: 1.08 }, reveal: "build", enter: "sticker", maxWords: 3, lineHeight: 1.5,
  }),
  t("cut-out-word", "Cut-out Word", {
    font: "Anek Gujarati", weight: 800, sizeVh: 5.4, posY: 70, fill: "#FFFFFF", stroke: undefined,
    shadow: { color: "rgba(0,0,0,0.55)", blur: 0.3, offsetY: 0.05 },
    letters: { colors: ["#FFFFFF", "#FFD60A", "#080808", "#FF5FA2", "#D6FF36"], tilt: 10, padX: 0.05, padY: 0.07, radius: 0.05, target: "emphasis" },
    accent: { case: "upper", sizeMul: 1.15 }, active: { scale: 1.05 }, reveal: "build", enter: "pop", maxWords: 4, lineHeight: 1.5,
  }),
];

/** Templates whose look depends on ★ words: picking one highlights keywords if none are set. */
export const ACCENT_TEMPLATE_IDS = new Set(TEMPLATES.filter((x) => usesKeywords(x)).map((x) => x.id));

/** True when the look styles ★ words (accent font, hand-drawn mark or cut-out letters). */
export function usesKeywords(s: CaptionStyle): boolean {
  return !!s.accent || !!s.mark && (s.mark.target ?? "emphasis") === "emphasis" || s.letters?.target === "emphasis";
}

export function templateById(id: string): CaptionStyle {
  return structuredClone(TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0]);
}

/** Fields that belong to the project, not the look; switching or resetting a template keeps them. */
const KEEP = ["posX", "script", "secondary", "speakerColors"] as const;

/** The built-in template this style started from, if any. */
export function baseTemplate(style: CaptionStyle): CaptionStyle | undefined {
  return TEMPLATES.find((x) => x.id === style.id);
}

/** True when a style based on a built-in template has been customised. */
export function isCustomised(style: CaptionStyle): boolean {
  const base = baseTemplate(style);
  if (!base) return false;
  const strip = (s: CaptionStyle) => { const c: Record<string, unknown> = { ...s }; for (const k of KEEP) delete c[k]; return stable(c); };
  return strip(style) !== strip(base);
}


/** JSON with sorted keys at every level, ignoring undefined values. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
