/**
 * Draw one output frame: the clip (video or title card), the transition into or
 * out of it, graphics layers below the captions, the captions (+ translation
 * line), layers above, and the watermark.
 *
 * The preview calls this every animation frame and the exporter calls it for
 * every encoded frame, with the same arguments, so they always match.
 */
import { composeFrame } from "./frame";
import { itemAt, transitionAt, type EditTimeline } from "./edl";
import { drawCaptions, fontString, type CaptionBox } from "./render";
import { cutOutPeople } from "./segment";
import { assetImage, drawLayers } from "./layers";
import { drawWatermark, type WatermarkCorner } from "./watermark";
import { CAPTION_Z, type Background, type CardClip, type Layer, type Speaker } from "./project";
import { fxStateAt, NO_FX, type FxClip } from "./effects/fx";
import { applyCamera, drawFxFlash, drawFxOverlays } from "./effects/fxRender";
import type { CaptionLine, CaptionStyle, FrameSettings, Overrides, Translations } from "./types";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Scene {
  W: number;
  H: number;
  /** Output-timeline seconds. */
  t: number;
  tl: EditTimeline;
  frame: FrameSettings;
  /** Captions on the output timeline. */
  lines: CaptionLine[];
  style: CaptionStyle;
  overrides: Overrides;
  translations?: Translations;
  layers?: Layer[];
  captionZ?: number;
  speakers?: Record<string, Speaker>;
  watermark?: { corner: WatermarkCorner } | null;
  /** Video effects on the output timeline. */
  effects?: FxClip[];
}

export interface SourceFrame {
  image: CanvasImageSource;
  w: number;
  h: number;
}

/* ---------- backgrounds & cards ---------- */

const svgImages = new Map<string, HTMLImageElement>();
function svgImage(svg: string): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  let img = svgImages.get(svg);
  if (!img) {
    img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    svgImages.set(svg, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

/** Wait until every SVG background is decoded (export calls this first). */
export async function preloadBackgrounds(bgs: (Background | undefined)[]): Promise<void> {
  await Promise.all(
    bgs.filter((b): b is Background => !!b && b.kind === "svg" && !!b.svg).map((b) => {
      svgImage(b.svg!);
      const img = svgImages.get(b.svg!)!;
      return img.complete ? Promise.resolve() : new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); });
    }),
  );
}

export function drawBackground(ctx: Ctx, W: number, H: number, bg: Background, t = 0): void {
  if (bg.kind === "gradient") {
    const [c1, c2] = bg.colors ?? ["#0E0F12", "#2A2E36"];
    const a = ((bg.angle ?? 135) * Math.PI) / 180;
    const r = Math.hypot(W, H) / 2;
    const g = ctx.createLinearGradient(W / 2 - Math.cos(a) * r, H / 2 - Math.sin(a) * r, W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  ctx.fillStyle = bg.color ?? "#0E0F12";
  ctx.fillRect(0, 0, W, H);
  if (bg.kind === "pattern") {
    const fg = bg.colors?.[0] ?? "rgba(255,255,255,0.08)";
    ctx.save();
    ctx.fillStyle = fg;
    ctx.strokeStyle = fg;
    const s = Math.max(W, H) / 24;
    if (bg.pattern === "grid") {
      ctx.lineWidth = Math.max(1, s * 0.04);
      for (let x = 0; x <= W; x += s) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y <= H; y += s) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    } else if (bg.pattern === "waves") {
      ctx.lineWidth = Math.max(1, s * 0.08);
      for (let y = -s; y <= H + s; y += s * 1.5) {
        ctx.beginPath();
        for (let x = 0; x <= W; x += s / 4) ctx.lineTo(x, y + Math.sin(x / s + t * 1.5) * s * 0.3);
        ctx.stroke();
      }
    } else if (bg.pattern === "rays") {
      ctx.translate(W / 2, H / 2);
      ctx.rotate(t * 0.15);
      for (let i = 0; i < 16; i += 2) {
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.arc(0, 0, Math.hypot(W, H), (i * Math.PI) / 8, ((i + 1) * Math.PI) / 8);
        ctx.closePath(); ctx.fill();
      }
    } else {
      for (let y = s / 2; y < H; y += s) for (let x = s / 2; x < W; x += s) { ctx.beginPath(); ctx.arc(x, y, s * 0.08, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  } else if (bg.kind === "svg" && bg.svg) {
    const img = svgImage(bg.svg);
    if (img) {
      const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      ctx.drawImage(img, (W - img.naturalWidth * k) / 2, (H - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
    }
  }
}

function drawCard(ctx: Ctx, W: number, H: number, c: CardClip, local: number) {
  drawBackground(ctx, W, H, c.background, local);
  const font = c.font ?? "Anek Gujarati";
  const color = c.color ?? "#FFFFFF";
  const appear = Math.min(1, local / 0.5);
  const ease = 1 - Math.pow(1 - appear, 3);
  ctx.save();
  ctx.globalAlpha = ease;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const short = Math.min(W, H);
  if (c.title) {
    const px = short * 0.085;
    ctx.font = fontString({ font, weight: 800 }, px);
    ctx.fillStyle = color;
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = px * 0.3;
    ctx.fillText(c.title, W / 2, H / 2 - (c.subtitle ? px * 0.45 : 0) + (1 - ease) * px * 0.4, W * 0.9);
  }
  if (c.subtitle) {
    const px = short * 0.042;
    ctx.font = fontString({ font, weight: 500 }, px);
    ctx.fillStyle = color;
    ctx.globalAlpha = ease * 0.85;
    ctx.fillText(c.subtitle, W / 2, H / 2 + short * 0.06 + (1 - ease) * px * 0.6, W * 0.9);
  }
  ctx.restore();
}

/* ---------- the frame ---------- */

/** Returns the caption's bounding box (for click-to-select in the preview). */
export function renderFrame(ctx: Ctx, s: Scene, src: SourceFrame | null): CaptionBox | null {
  const { W, H, t } = s;
  const item = itemAt(s.tl, t);
  const tr = transitionAt(s.tl, t);
  let fx = s.effects?.length ? fxStateAt(s.effects, t) : NO_FX;
  // transitions that borrow effect drawing
  if (tr && (tr.kind === "glitch" || tr.kind === "whip")) {
    fx = { ...fx };
    if (tr.kind === "glitch") { fx.glitch = { amount: Math.max(fx.glitch?.amount ?? 0, tr.amount), seed: Math.round(t * 30) }; fx.rgbSplit = Math.max(fx.rgbSplit, tr.amount); }
    else fx.motionBlur = Math.max(fx.motionBlur, tr.amount);
  }

  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (fx !== NO_FX) applyCamera(ctx, W, H, fx);

  // transform the base picture for movement transitions
  if (tr) {
    const a = tr.amount;
    const sign = tr.phase === "out" ? -1 : 1;
    if (tr.kind === "zoom") {
      const k = 1 + 0.35 * a;
      ctx.translate(W / 2, H / 2); ctx.scale(k, k); ctx.translate(-W / 2, -H / 2);
    } else if (tr.kind === "spin") {
      ctx.translate(W / 2, H / 2); ctx.rotate(sign * a * 0.6); ctx.scale(1 + 0.4 * a, 1 + 0.4 * a); ctx.translate(-W / 2, -H / 2);
    } else if (tr.kind === "whip") ctx.translate(-sign * W * 0.35 * a, 0);
    else if (tr.kind === "slide-left") ctx.translate(sign * W * a, 0);
    else if (tr.kind === "slide-up") ctx.translate(0, sign * H * a);
    else if (tr.kind === "blur") ctx.filter = `${ctx.filter && ctx.filter !== "none" ? ctx.filter + " " : ""}blur(${Math.round(a * Math.max(W, H) * 0.02)}px)`;
    else if (tr.kind === "wipe") {
      ctx.beginPath();
      if (tr.phase === "in") ctx.rect(0, 0, W * (1 - a), H); else ctx.rect(W * a, 0, W * (1 - a), H);
      ctx.clip();
    }
  }

  // image clips draw their own picture (the preview and the exporter pass no source frame)
  if (item?.clip.kind === "image") {
    const img = assetImage(item.clip.assetId);
    src = img && img.naturalWidth ? { image: img, w: img.naturalWidth, h: img.naturalHeight } : null;
  }
  if (item?.clip.kind === "card") {
    drawCard(ctx, W, H, item.clip, t - item.outStart);
  } else if (src) {
    const clip = item?.clip;
    let f = clip && clip.frame ? { ...s.frame, ...clip.frame } : s.frame;
    if (clip?.kind === "image" && clip.kenBurns && clip.kenBurns !== 1 && item) {
      // slow push-in over the whole clip
      const p = Math.min(1, Math.max(0, (t - item.outStart) / Math.max(0.1, item.outEnd - item.outStart)));
      f = { ...f, zoom: Math.max(1, (f.zoom ?? 1)) * (1 + (clip.kenBurns - 1) * p) };
    }
    composeFrame(ctx, src.image, src.w, src.h, W, H, f);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#23262E");
    g.addColorStop(1, "#0E0F12");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

  if (tr && (tr.kind === "fade" || tr.kind === "dip-white" || tr.kind === "zoom" || tr.kind === "blur" || tr.kind === "spin")) {
    ctx.save();
    ctx.globalAlpha = tr.kind === "fade" || tr.kind === "dip-white" ? tr.amount : tr.amount * 0.5;
    ctx.fillStyle = tr.kind === "dip-white" ? "#FFFFFF" : "#000000";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  if (fx !== NO_FX) drawFxOverlays(ctx, W, H, fx);

  const cz = s.captionZ ?? CAPTION_Z;
  const env = { speakers: s.speakers, duration: s.tl.duration };
  // captions behind the person: cut the people out of the picture now, draw them back over the captions
  const people = s.style.behindSubject && src && item?.clip.kind !== "card" ? cutOutPeople(ctx, W, H) : null;
  drawLayers(ctx, W, H, s.layers, t, env, -Infinity, cz);
  const box = drawCaptions(ctx, W, H, s.lines, t, s.style, s.overrides, s.translations, { speakers: s.speakers });
  if (people) ctx.drawImage(people, 0, 0);
  drawLayers(ctx, W, H, s.layers, t, env, cz, Infinity);
  if (fx !== NO_FX) drawFxFlash(ctx, W, H, fx);
  if (s.watermark) drawWatermark(ctx, W, H, s.frame, s.watermark.corner);
  return box;
}
