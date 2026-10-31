/**
 * Brand kits: a creator's logo, fonts, colours, caption look, frame, export
 * settings, intro/outro cards and language defaults, applied to any project
 * in one click (and to every video in a batch).
 */
import { tx } from "./library";
import { DEFAULT_MOTION, uid, type Background, type CardClip, type Clip, type ExportPrefs, type Layer, type ProjectDoc } from "./project";
import type { CaptionStyle, FrameSettings, Script } from "./types";

export interface CardTemplate {
  enabled: boolean;
  title: string;
  subtitle?: string;
  duration: number;
  background: Background;
}

export interface BrandKit {
  id: string;
  name: string;
  created: number;
  updated: number;
  logo?: { assetId: string; corner: "tl" | "tr" | "bl" | "br"; size: number; opacity: number };
  fonts: { caption: string; title: string };
  colors: { primary: string; accent: string; text: string; background: string };
  /** A full caption look (overrides fonts/colours for captions when set). */
  captionStyle?: CaptionStyle;
  frame?: Partial<FrameSettings>;
  exportPrefs?: Partial<ExportPrefs>;
  intro?: CardTemplate;
  outro?: CardTemplate;
  language?: { transcription?: string; script?: Script; translateTo?: string; bilingual?: boolean };
}

export function newKit(name: string): BrandKit {
  const now = Date.now();
  return {
    id: uid("bk"), name, created: now, updated: now,
    fonts: { caption: "Baloo Bhai 2", title: "Anek Gujarati" },
    colors: { primary: "#D6FF36", accent: "#D6FF36", text: "#FFFFFF", background: "#0E0F12" },
    intro: { enabled: false, title: name, subtitle: "", duration: 2, background: { kind: "gradient", colors: ["#0E0F12", "#2A2E36"], angle: 135 } },
    outro: { enabled: false, title: "Follow for more", subtitle: "", duration: 2.5, background: { kind: "gradient", colors: ["#2A2E36", "#0E0F12"], angle: 135 } },
  };
}

/** Capture the current project's look as a kit. */
export function kitFromProject(doc: ProjectDoc, name: string): BrandKit {
  const k = newKit(name);
  return {
    ...k,
    fonts: { caption: doc.style.font, title: doc.style.font },
    colors: { ...k.colors, text: doc.style.fill, accent: doc.style.active.fill ?? k.colors.accent, primary: doc.style.emphasisFill },
    captionStyle: structuredClone(doc.style),
    frame: { aspect: doc.frame.aspect, platform: doc.frame.platform, fit: doc.frame.fit, bg: doc.frame.bg },
    exportPrefs: doc.exportPrefs,
  };
}

function card(t: CardTemplate, tag: "brand-intro" | "brand-outro", font: string, color: string): CardClip {
  return {
    id: uid("c"), kind: "card", tag, duration: Math.max(0.5, t.duration), background: t.background,
    title: t.title, subtitle: t.subtitle, font, color,
    transition: tag === "brand-outro" ? { kind: "fade", duration: 0.6 } : undefined,
  };
}

const corners = { tl: [10, 7], tr: [90, 7], bl: [10, 93], br: [90, 93] } as const;

/**
 * Apply a kit. `baseClips` are the project's current clips (the editor passes
 * its effective clips, so a project without an edit list gets one).
 */
export function applyBrandKit(doc: ProjectDoc, kit: BrandKit, baseClips: Clip[]): ProjectDoc {
  const style: CaptionStyle = kit.captionStyle
    ? { ...structuredClone(kit.captionStyle), script: kit.language?.script ?? kit.captionStyle.script ?? doc.style.script }
    : {
      ...doc.style,
      font: kit.fonts.caption,
      fill: kit.colors.text,
      emphasisFill: kit.colors.primary,
      active: { ...doc.style.active, fill: kit.colors.accent },
      script: kit.language?.script ?? doc.style.script,
    };
  if (kit.language?.bilingual) style.secondary = { ...(style.secondary ?? { sizeRatio: 0.55, fill: "#FFFFFF", gap: 0.35 }), enabled: true };

  // clips: drop old brand cards, add new ones
  let clips = baseClips.filter((c) => !c.tag);
  if (kit.intro?.enabled) clips = [card(kit.intro, "brand-intro", kit.fonts.title, kit.colors.text), ...clips.map((c, i) => (i === 0 && c.kind === "video" ? { ...c, transition: c.transition ?? { kind: "fade" as const, duration: 0.6 } } : c))];
  if (kit.outro?.enabled) clips = [...clips, card(kit.outro, "brand-outro", kit.fonts.title, kit.colors.text)];

  // logo layer
  let layers = (doc.layers ?? []).filter((l) => l.tag !== "brand-logo");
  if (kit.logo) {
    const [x, y] = corners[kit.logo.corner];
    const logo: Layer = {
      id: uid("L"), tag: "brand-logo", kind: "image", name: "Logo", assetId: kit.logo.assetId,
      start: 0, end: 36000, x, y, w: kit.logo.size, h: kit.logo.size, rotation: 0, opacity: kit.logo.opacity,
      z: 90, motion: { ...DEFAULT_MOTION, in: "fade", out: "none" },
    };
    layers = [...layers, logo];
  }

  return {
    ...doc,
    style,
    frame: { ...doc.frame, ...(kit.frame ?? {}) },
    exportPrefs: kit.exportPrefs ? { ...(doc.exportPrefs ?? { format: "mp4", short: 0, quality: "high", fps: 0 }), ...kit.exportPrefs } : doc.exportPrefs,
    clips,
    layers,
    brandKitId: kit.id,
  };
}

/* ---------- storage (this browser) ---------- */

export async function listKits(): Promise<BrandKit[]> {
  try {
    const all = await tx<BrandKit[]>("brandkits", "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

export async function saveKit(k: BrandKit): Promise<void> {
  await tx("brandkits", "readwrite", (s) => s.put({ ...k, updated: Date.now() }));
}

export async function deleteKit(id: string): Promise<void> {
  await tx("brandkits", "readwrite", (s) => s.delete(id));
}

export async function getKit(id: string): Promise<BrandKit | undefined> {
  try {
    return await tx<BrandKit | undefined>("brandkits", "readonly", (s) => s.get(id));
  } catch {
    return undefined;
  }
}
