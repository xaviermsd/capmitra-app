/**
 * Bilingual captions: each caption keeps its spoken words, and may also have a
 * translation shown as a smaller second line. Translations are stored apart
 * from the words (by caption key), so editing or re-timing words never loses
 * the original text, and translating never replaces it.
 */
import type { CaptionLine, LineTranslation, SecondaryLine, Translations } from "./types";

export const DEFAULT_SECONDARY: SecondaryLine = { enabled: true, sizeRatio: 0.55, fill: "#FFFFFF", gap: 0.35 };

const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

export const lineText = (l: Pick<CaptionLine, "words">) => norm(l.words.map((w) => w.text).join(" "));

/**
 * The translation for a caption: by its key, or (when captions were regrouped
 * and keys changed) by matching the original text.
 */
export function translationFor(line: CaptionLine, tr: Translations | undefined): LineTranslation | undefined {
  if (!tr) return undefined;
  const direct = tr[line.key];
  if (direct) return direct;
  const text = lineText(line);
  for (const v of Object.values(tr)) if (norm(v.source) === text) return v;
  return undefined;
}

/** The caption's words changed since it was translated. */
export function isStale(line: CaptionLine, t: LineTranslation | undefined): boolean {
  return !!t && !t.manual && norm(t.source) !== lineText(line);
}

/** Captions that still need translating (missing or stale), keeping hand-edited ones. */
export function linesToTranslate(lines: CaptionLine[], tr: Translations | undefined, lang: string, all = false): CaptionLine[] {
  return lines.filter((l) => {
    const t = translationFor(l, tr);
    if (!t) return true;
    if (t.manual && !all) return false;
    return all || t.lang !== lang || isStale(l, t);
  });
}

/** Merge new translations in, re-keyed to the current captions; drops entries for captions that no longer exist. */
export function mergeTranslations(lines: CaptionLine[], old: Translations | undefined, fresh: { line: CaptionLine; text: string }[], lang: string): Translations {
  const out: Translations = {};
  for (const l of lines) {
    const t = translationFor(l, old);
    if (t) out[l.key] = t;
  }
  for (const { line, text } of fresh) out[line.key] = { text: text.trim(), source: lineText(line), lang };
  return out;
}

/** Re-key translations after captions are regrouped (keeps text-matched ones). */
export function rekeyTranslations(lines: CaptionLine[], tr: Translations | undefined): Translations | undefined {
  if (!tr) return tr;
  const out: Translations = {};
  let changed = false;
  for (const l of lines) {
    const t = translationFor(l, tr);
    if (t) {
      out[l.key] = t;
      if (tr[l.key] !== t) changed = true;
    }
  }
  if (Object.keys(out).length !== Object.keys(tr).length) changed = true;
  return changed ? out : tr;
}
