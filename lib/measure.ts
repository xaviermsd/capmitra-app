/**
 * Measures caption text with the real font (canvas), in em, for width-aware
 * caption grouping. Shared by the editor and batch processing so captions
 * split identically everywhere. Falls back to estimates without a DOM.
 */
import { fontString } from "./render";
import type { CaptionStyle } from "./types";

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

export function clearMeasureCache() {
  cache.clear();
}

export function makeMeasure(style: Pick<CaptionStyle, "font" | "weight" | "letterSpacing">): ((text: string) => number) | undefined {
  if (typeof document === "undefined") return undefined;
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  const c = ctx;
  if (!c) return undefined;
  const font = fontString(style, 100);
  return (text: string) => {
    const k = `${font}|${style.letterSpacing}|${text}`;
    let v = cache.get(k);
    if (v === undefined) {
      c.font = font;
      v = c.measureText(text).width / 100 + Math.max(0, [...text].length - 1) * (style.letterSpacing ?? 0);
      if (cache.size > 20000) cache.clear();
      cache.set(k, v);
    }
    return v;
  };
}
