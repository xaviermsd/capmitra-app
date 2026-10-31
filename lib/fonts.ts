/**
 * Caption fonts (Google Fonts), by writing system.
 *
 * - Gujarati faces: every Google Font with a Gujarati subset (fonts.google.com/metadata, Oct 2026).
 * - Devanagari faces: curated; each was checked to serve a Devanagari subset.
 * - Fallbacks: one Noto face per other script, so Bengali, Tamil, Arabic, CJK…
 *   never fall back to a system font (which would make the export differ
 *   from the preview on another computer).
 * Every URL here was checked against fonts.googleapis.com/css2 (HTTP 200).
 */
import { scriptsIn, type ScriptId } from "./languages";

export interface CaptionFont {
  family: string;
  category: "Sans" | "Serif" | "Display" | "Handwriting";
  weights: number[];
  /** Writing systems the face covers besides Latin. */
  scripts: ScriptId[];
  /** Variable font: request a range instead of a list. */
  range?: [number, number];
  /** Also load the italic face. */
  italic?: boolean;
}
/** Kept for older imports. */
export type GujaratiFont = CaptionFont;

const W = (a: number, b: number) => [100, 200, 300, 400, 500, 600, 700, 800, 900].filter((w) => w >= a && w <= b);

export const GUJARATI_FONTS: CaptionFont[] = [
  { family: "Anek Gujarati", category: "Sans", weights: W(100, 800), scripts: ["Gujr"] },
  { family: "Hind Vadodara", category: "Sans", weights: W(300, 700), scripts: ["Gujr"] },
  { family: "Noto Sans Gujarati", category: "Sans", weights: W(100, 900), scripts: ["Gujr"] },
  { family: "Mukta Vaani", category: "Sans", weights: W(200, 800), scripts: ["Gujr"] },
  { family: "Baloo Bhai 2", category: "Display", weights: W(400, 800), scripts: ["Gujr"] },
  { family: "Shrikhand", category: "Display", weights: [400], scripts: ["Gujr"] },
  { family: "Farsan", category: "Display", weights: [400], scripts: ["Gujr"] },
  { family: "Kumar One", category: "Display", weights: [400], scripts: ["Gujr"] },
  { family: "Kumar One Outline", category: "Display", weights: [400], scripts: ["Gujr"] },
  { family: "Mogra", category: "Display", weights: [400], scripts: ["Gujr"] },
  { family: "Noto Serif Gujarati", category: "Serif", weights: W(100, 900), scripts: ["Gujr"] },
  { family: "Rasa", category: "Serif", weights: W(300, 700), scripts: ["Gujr"], italic: true },
];

export const DEVANAGARI_FONTS: CaptionFont[] = [
  { family: "Noto Sans Devanagari", category: "Sans", weights: W(100, 900), scripts: ["Deva"], range: [100, 900] },
  { family: "Mukta", category: "Sans", weights: W(200, 800), scripts: ["Deva"] },
  { family: "Hind", category: "Sans", weights: W(300, 700), scripts: ["Deva"] },
  { family: "Poppins", category: "Sans", weights: W(100, 900), scripts: ["Deva"] },
  { family: "Baloo 2", category: "Display", weights: W(400, 800), scripts: ["Deva"], range: [400, 800] },
  { family: "Rajdhani", category: "Display", weights: W(300, 700), scripts: ["Deva"] },
  { family: "Teko", category: "Display", weights: W(300, 700), scripts: ["Deva"], range: [300, 700] },
  { family: "Rozha One", category: "Display", weights: [400], scripts: ["Deva"] },
  { family: "Yatra One", category: "Display", weights: [400], scripts: ["Deva"] },
  { family: "Kalam", category: "Handwriting", weights: [300, 400, 700], scripts: ["Deva"] },
  { family: "Tiro Devanagari Hindi", category: "Serif", weights: [400], scripts: ["Deva"] },
  { family: "Noto Serif Devanagari", category: "Serif", weights: W(100, 900), scripts: ["Deva"], range: [100, 900] },
];

/** Latin-only display faces for English, Gujlish and Hinglish captions and for accent words. */
export const LATIN_FONTS: CaptionFont[] = [
  { family: "Montserrat", category: "Sans", weights: W(100, 900), scripts: [], range: [100, 900] },
  { family: "Archivo Black", category: "Display", weights: [400], scripts: [] },
  { family: "Bebas Neue", category: "Display", weights: [400], scripts: [] },
  { family: "Playfair Display", category: "Serif", weights: W(400, 900), scripts: [], range: [400, 900], italic: true },
  { family: "Pacifico", category: "Handwriting", weights: [400], scripts: [] },
  { family: "Dancing Script", category: "Handwriting", weights: W(400, 700), scripts: [], range: [400, 700] },
  { family: "Caveat", category: "Handwriting", weights: W(400, 700), scripts: [], range: [400, 700] },
  { family: "Permanent Marker", category: "Handwriting", weights: [400], scripts: [] },
];

/** One reliable face per writing system, used automatically for characters the chosen font lacks. */
export const FALLBACK_FONTS: Partial<Record<ScriptId, CaptionFont>> = {
  Gujr: { family: "Noto Sans Gujarati", category: "Sans", weights: W(100, 900), scripts: ["Gujr"] },
  Deva: { family: "Noto Sans Devanagari", category: "Sans", weights: W(100, 900), scripts: ["Deva"], range: [100, 900] },
  Beng: { family: "Noto Sans Bengali", category: "Sans", weights: W(100, 900), scripts: ["Beng"], range: [100, 900] },
  Taml: { family: "Noto Sans Tamil", category: "Sans", weights: W(100, 900), scripts: ["Taml"], range: [100, 900] },
  Telu: { family: "Noto Sans Telugu", category: "Sans", weights: W(100, 900), scripts: ["Telu"], range: [100, 900] },
  Knda: { family: "Noto Sans Kannada", category: "Sans", weights: W(100, 900), scripts: ["Knda"], range: [100, 900] },
  Mlym: { family: "Noto Sans Malayalam", category: "Sans", weights: W(100, 900), scripts: ["Mlym"], range: [100, 900] },
  Guru: { family: "Noto Sans Gurmukhi", category: "Sans", weights: W(100, 900), scripts: ["Guru"], range: [100, 900] },
  Orya: { family: "Noto Sans Oriya", category: "Sans", weights: W(100, 900), scripts: ["Orya"], range: [100, 900] },
  Arab: { family: "Noto Sans Arabic", category: "Sans", weights: W(100, 900), scripts: ["Arab"], range: [100, 900] },
  Thai: { family: "Noto Sans Thai", category: "Sans", weights: W(100, 900), scripts: ["Thai"], range: [100, 900] },
  Jpan: { family: "Noto Sans JP", category: "Sans", weights: W(100, 900), scripts: ["Jpan", "Hans"], range: [100, 900] },
  Hans: { family: "Noto Sans SC", category: "Sans", weights: W(100, 900), scripts: ["Hans"], range: [100, 900] },
  Kore: { family: "Noto Sans KR", category: "Sans", weights: W(100, 900), scripts: ["Kore"], range: [100, 900] },
  Latn: { family: "Noto Sans", category: "Sans", weights: W(100, 900), scripts: ["Latn", "Cyrl", "Grek"], range: [100, 900] },
  Cyrl: { family: "Noto Sans", category: "Sans", weights: W(100, 900), scripts: ["Cyrl"], range: [100, 900] },
  Grek: { family: "Noto Sans", category: "Sans", weights: W(100, 900), scripts: ["Grek"], range: [100, 900] },
};

export const ALL_FONTS: CaptionFont[] = [...GUJARATI_FONTS, ...DEVANAGARI_FONTS, ...LATIN_FONTS];

/** Sample text per script: font loading needs a character from the right unicode-range. */
export const SAMPLES: Partial<Record<ScriptId, string>> = {
  Gujr: "નમસ્તે ગુજરાત", Deva: "नमस्ते भारत", Beng: "নমস্কার", Taml: "வணக்கம்", Telu: "నమస్తే", Knda: "ನಮಸ್ಕಾರ",
  Mlym: "നമസ്കാരം", Guru: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ", Orya: "ନମସ୍କାର", Arab: "سلام", Thai: "สวัสดี", Jpan: "こんにちは", Hans: "你好",
  Kore: "안녕하세요", Latn: "Hello", Cyrl: "Привет", Grek: "Γειά",
};

export const SAMPLE_TEXT = SAMPLES.Gujr!;

/** Fonts to offer in the picker for a writing system (Latin text works with all). */
export function fontsForScript(script: ScriptId): CaptionFont[] {
  if (script === "Gujr") return GUJARATI_FONTS;
  if (script === "Deva") return DEVANAGARI_FONTS;
  if (script === "Latn") return [...LATIN_FONTS, ...GUJARATI_FONTS, ...DEVANAGARI_FONTS];
  const fb = FALLBACK_FONTS[script];
  return fb ? [fb] : GUJARATI_FONTS;
}

function lookup(family: string): CaptionFont | undefined {
  return ALL_FONTS.find((f) => f.family === family) ?? Object.values(FALLBACK_FONTS).find((f) => f?.family === family);
}

export function fontByFamily(family: string): CaptionFont {
  return lookup(family) ?? GUJARATI_FONTS[0];
}

/** Closest weight the family actually has. */
export function nearestWeight(family: string, weight: number): number {
  const ws = fontByFamily(family).weights;
  return ws.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), ws[0]);
}

export function cssUrl(f: CaptionFont): string {
  const fam = f.family.replace(/ /g, "+");
  if (f.italic) {
    const spec = f.range ? [`0,${f.range[0]}..${f.range[1]}`, `1,${f.range[0]}..${f.range[1]}`] : [...f.weights.map((w) => `0,${w}`), ...f.weights.map((w) => `1,${w}`)];
    return `https://fonts.googleapis.com/css2?family=${fam}:ital,wght@${spec.join(";")}&display=swap`;
  }
  if (f.range) return `https://fonts.googleapis.com/css2?family=${fam}:wght@${f.range[0]}..${f.range[1]}&display=swap`;
  if (f.weights.length === 1 && f.weights[0] === 400) return `https://fonts.googleapis.com/css2?family=${fam}&display=swap`;
  return `https://fonts.googleapis.com/css2?family=${fam}:wght@${f.weights.join(";")}&display=swap`;
}

/** Families drawn after the chosen font, for characters it doesn't have. */
export function fallbackChain(text?: string): string[] {
  const order: ScriptId[] = ["Gujr", "Deva", "Beng", "Taml", "Telu", "Knda", "Mlym", "Guru", "Orya", "Arab", "Thai", "Jpan", "Hans", "Kore", "Latn"];
  const wanted = text ? scriptsIn(text) : null;
  const out: string[] = [];
  for (const s of order) {
    if (wanted && !wanted.has(s) && s !== "Gujr" && s !== "Deva") continue;
    const fam = FALLBACK_FONTS[s]?.family;
    if (fam && !out.includes(fam)) out.push(fam);
  }
  return out;
}

const injected = new Set<string>();
const loaded = new Map<string, Promise<boolean>>();

/** Add the Google Fonts stylesheet for a family (all weights). */
export function injectFont(family: string): void {
  if (typeof document === "undefined" || injected.has(family)) return;
  const f = lookup(family);
  if (!f) return; // not a font we serve (e.g. a system font)
  injected.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = cssUrl(f);
  document.head.appendChild(link);
}

/**
 * Make sure a family + weight is downloaded before drawing on canvas.
 * Canvas text does not trigger font loading by itself, so we ask for glyphs
 * of every script in `sample` explicitly. Resolves true when it loaded.
 */
export function loadFont(family: string, weight: number, sample = SAMPLE_TEXT + " abc"): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  injectFont(family);
  const w = nearestWeight(family, weight);
  const key = `${family}:${w}:${sample}`;
  let p = loaded.get(key);
  if (!p) {
    p = (async () => {
      // the stylesheet may still be in flight; retry briefly
      for (let i = 0; i < 40; i++) {
        try {
          const faces = await document.fonts.load(`${w} 40px "${family}"`, sample);
          if (faces.length) return true;
        } catch {
          /* ignore and retry */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    })();
    p.then((ok) => { if (!ok) loaded.delete(key); });
    loaded.set(key, p);
  }
  return p;
}

/** Which writing systems a font covers (Latin always). */
export function covers(family: string, script: ScriptId): boolean {
  if (script === "Latn") return true;
  const f = lookup(family);
  return !!f && f.scripts.includes(script);
}

/**
 * Load everything needed to draw `text` in `family`: the chosen font for the
 * scripts it covers, and the Noto fallback for scripts it doesn't.
 * Returns the scripts that still couldn't be loaded (empty = all good).
 */
export async function ensureFontsFor(family: string, weight: number, text: string): Promise<ScriptId[]> {
  const scripts = [...scriptsIn(text)];
  if (!scripts.length) scripts.push("Latn");
  const missing: ScriptId[] = [];
  for (const s of scripts) {
    const sample = SAMPLES[s] ?? "abc";
    if (covers(family, s)) {
      if (!(await loadFont(family, weight, sample))) missing.push(s);
      continue;
    }
    const fb = FALLBACK_FONTS[s];
    if (!fb) continue;
    if (!(await loadFont(fb.family, weight, sample))) missing.push(s);
  }
  return missing;
}

export function injectAllFonts(): void {
  [...GUJARATI_FONTS, ...LATIN_FONTS].forEach((f) => injectFont(f.family));
}
