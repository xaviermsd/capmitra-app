import type { AspectId, FrameSettings } from "./types";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Platform {
  id: string;
  label: string;
  aspect: AspectId;
  /** Safe-zone margins as fractions of the frame (top, right, bottom, left). */
  safe?: [number, number, number, number];
}

const px = (t: number, r: number, b: number, l: number): [number, number, number, number] => [t / 1920, r / 1080, b / 1920, l / 1080];

/**
 * Safe zones are approximate guides (adaptlypost.com, 2026 guide) for where
 * platform buttons and captions cover a 1080×1920 video.
 */
export const PLATFORMS: Platform[] = [
  { id: "original", label: "Original (as filmed)", aspect: "original" },
  { id: "ig-reel", label: "Instagram Reel", aspect: "9:16", safe: px(210, 84, 310, 0) },
  { id: "ig-story", label: "Instagram Story", aspect: "9:16", safe: px(100, 0, 200, 0) },
  { id: "yt-shorts", label: "YouTube Shorts", aspect: "9:16", safe: px(120, 96, 300, 0) },
  { id: "tiktok", label: "TikTok", aspect: "9:16", safe: px(108, 120, 320, 60) },
  { id: "fb-reel", label: "Facebook Reel", aspect: "9:16", safe: px(100, 0, 300, 0) },
  { id: "fb-story", label: "Facebook / WhatsApp Story", aspect: "9:16", safe: px(100, 0, 200, 0) },
  { id: "ig-feed", label: "Instagram / Facebook feed (4:5)", aspect: "4:5" },
  { id: "square", label: "Square post (1:1)", aspect: "1:1" },
  { id: "youtube", label: "YouTube video (16:9)", aspect: "16:9" },
  { id: "fb-landscape", label: "Facebook landscape (16:9)", aspect: "16:9" },
  { id: "classic", label: "Classic 4:3", aspect: "4:3" },
];

export const ASPECTS: { id: AspectId; label: string; ratio: number | null }[] = [
  { id: "original", label: "Original", ratio: null },
  { id: "9:16", label: "9:16 vertical", ratio: 9 / 16 },
  { id: "4:5", label: "4:5 portrait", ratio: 4 / 5 },
  { id: "1:1", label: "1:1 square", ratio: 1 },
  { id: "16:9", label: "16:9 landscape", ratio: 16 / 9 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
];

export const DEFAULT_FRAME: FrameSettings = {
  platform: "original",
  aspect: "original",
  fit: "crop",
  bg: "#000000",
  panX: 50,
  panY: 50,
  zoom: 1,
  showSafeZone: true,
};

export function platformById(id: string): Platform {
  return PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[0];
}

/** Describe a video's shape, e.g. "1080×1920 · 9:16 vertical". */
export function describeShape(w: number, h: number): string {
  if (!w || !h) return "";
  const r = w / h;
  const near = ASPECTS.filter((a) => a.ratio).reduce((best, a) => (Math.abs(a.ratio! - r) < Math.abs(best.ratio! - r) ? a : best), ASPECTS[1]);
  const orient = r < 0.95 ? "vertical" : r > 1.05 ? "landscape" : "square";
  const exact = Math.abs(near.ratio! - r) < 0.02;
  return `${w}×${h} · ${exact ? near.id : r.toFixed(2) + ":1"} ${orient}`;
}

/**
 * Output size for the chosen aspect. `short` is the target length of the short
 * side in px (0 = keep the source resolution); never upscales beyond the source.
 */
export function outputSize(srcW: number, srcH: number, aspect: AspectId, short = 0): { w: number; h: number } {
  const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio ?? srcW / srcH;
  const srcShort = Math.min(srcW, srcH);
  const s = short > 0 ? Math.min(short, Math.max(srcShort, 480)) : srcShort;
  let w: number;
  let h: number;
  if (ratio < 1) {
    w = s;
    h = s / ratio;
  } else {
    h = s;
    w = s * ratio;
  }
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { w: even(w), h: even(h) };
}

/** Draw one video frame into the output frame using crop / blurred / colour fill. */
export function composeFrame(ctx: Ctx, src: CanvasImageSource, srcW: number, srcH: number, W: number, H: number, f: FrameSettings): void {
  if (!srcW || !srcH) return;
  const cover = Math.max(W / srcW, H / srcH);
  const contain = Math.min(W / srcW, H / srcH);
  const same = Math.abs(W / H - srcW / srcH) < 0.01;

  if (f.fit === "crop" || same) {
    const s = cover * (same ? Math.max(1, f.zoom) : Math.max(1, f.zoom));
    const dw = srcW * s;
    const dh = srcH * s;
    const dx = (W - dw) * (f.panX / 100);
    const dy = (H - dh) * (f.panY / 100);
    ctx.drawImage(src, dx, dy, dw, dh);
    return;
  }
  if (f.fit === "blur") {
    ctx.save();
    ctx.filter = `blur(${Math.round(Math.max(W, H) * 0.025)}px) brightness(0.7)`;
    const s = cover * 1.1;
    ctx.drawImage(src, (W - srcW * s) / 2, (H - srcH * s) / 2, srcW * s, srcH * s);
    ctx.restore();
  } else {
    ctx.fillStyle = f.bg;
    ctx.fillRect(0, 0, W, H);
  }
  const s = contain * Math.max(1, f.zoom);
  const dw = srcW * s;
  const dh = srcH * s;
  ctx.drawImage(src, (W - dw) * (f.panX / 100), (H - dh) * (f.panY / 100), dw, dh);
}
