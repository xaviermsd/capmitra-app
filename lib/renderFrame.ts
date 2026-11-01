/**
 * Draw one output frame: the clip (video or title card), the transition into or
 * out of it, graphics layers below the captions, the captions (+ translation
 * line), layers above, and the watermark.
 *
 * The preview calls this every animation frame and the exporter calls it for
 * every encoded frame, with the same arguments, so they always match.
 */
import { composeFrame } from "./frame";
import { itemAt, transitionAt, type EditTimeline, type Placed } from "./edl";
import { drawTransition } from "./transitionRender";
import { drawCaptions, fontString, type CaptionBox } from "./render";
import { LINGER, lineAt } from "./grouping";
import { smoothstep } from "./easing";
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
  /**
   * The picture of the clip that isn't the playing one during a transition:
   * its real footage at the handle time (see lib/overlap.ts). When it isn't
   * ready the frame is drawn without the transition, never with a black side.
   */
  other?: OtherFrame;
}

export type OtherFrame = (it: Placed) => SourceFrame | null;

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

/** Paint one clip's picture over the whole frame. */
function drawPicture(ctx: Ctx, s: Scene, it: Placed | null, src: SourceFrame | null, t: number): void {
  const { W, H } = s;
  const clip = it?.clip;
  // image clips draw their own picture (the preview and the exporter pass no source frame)
  if (clip?.kind === "image") {
    const img = assetImage(clip.assetId);
    src = img && img.naturalWidth ? { image: img, w: img.naturalWidth, h: img.naturalHeight } : null;
  }
  if (clip?.kind === "card" && it) {
    drawCard(ctx, W, H, clip, Math.max(0, Math.min(t, it.outEnd) - it.outStart));
  } else if (src) {
    let f = clip && clip.kind !== "card" && clip.frame ? { ...s.frame, ...clip.frame } : s.frame;
    if (clip?.kind === "image" && clip.kenBurns && clip.kenBurns !== 1 && it) {
      // slow push-in over the whole clip
      const p = Math.min(1, Math.max(0, (t - it.outStart) / Math.max(0.1, it.outEnd - it.outStart)));
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
}

/** Seconds a caption that changes at a cut takes to cross-fade into the next one. */
export const CAPTION_HANDOVER = 0.1;
/** A caption change this close to a cut counts as changing at the cut. */
const CAPTION_CUT_WINDOW = 0.25;

let capLayers: [OffscreenCanvas | HTMLCanvasElement, OffscreenCanvas | HTMLCanvasElement] | null = null;
function capLayer(i: 0 | 1, W: number, H: number) {
  const make = () => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H }));
  capLayers ??= [make(), make()];
  const c = capLayers[i];
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const x = c.getContext("2d") as Ctx;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, W, H);
  return { c, x };
}

/**
 * The captions at t. When one caption hands straight over to the next close
 * to a cut, the old one stays for a moment and cross-fades into the new one
 * instead of popping, so the caption change rides along with the picture change.
 */
function drawCaptionsAt(ctx: Ctx, s: Scene, t: number): CaptionBox | null {
  const { W, H } = s;
  const draw = (c: Ctx, at: number) => drawCaptions(c, W, H, s.lines, at, s.style, s.overrides, s.translations, { speakers: s.speakers });
  const li = lineAt(s.lines, t);
  const line = s.lines[li];
  const prev = s.lines[li - 1];
  const into = line ? t - line.start : Infinity;
  const handover = !!prev && into >= 0 && into < CAPTION_HANDOVER && line.start - prev.end < 0.05 + LINGER;
  const nearCut = handover && s.tl.items.some((it, i) => i > 0 && Math.abs(line.start - it.outStart) < CAPTION_CUT_WINDOW);
  if (!nearCut) return draw(ctx, t);
  const k = smoothstep(into / CAPTION_HANDOVER);
  const a = capLayer(0, W, H);
  draw(a.x, line.start - 1e-3);
  const b = capLayer(1, W, H);
  const box = draw(b.x, t);
  ctx.save();
  ctx.globalAlpha = 1 - k;
  ctx.drawImage(a.c as CanvasImageSource, 0, 0, W, H);
  ctx.globalAlpha = k;
  ctx.drawImage(b.c as CanvasImageSource, 0, 0, W, H);
  ctx.restore();
  return box;
}

/** Returns the caption's bounding box (for click-to-select in the preview). */
export function renderFrame(ctx: Ctx, s: Scene, src: SourceFrame | null): CaptionBox | null {
  const { W, H, t } = s;
  const item = itemAt(s.tl, t);
  const tr = transitionAt(s.tl, t);
  const fx = s.effects?.length ? fxStateAt(s.effects, t) : NO_FX;

  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (fx !== NO_FX) applyCamera(ctx, W, H, fx);

  // both pictures must be real for a transition: the playing clip and the other clip's footage
  const live = tr ? (tr.phase === "out" ? tr.from : tr.to) : null;
  const other = tr ? (tr.phase === "out" ? tr.to : tr.from) : null;
  const otherSrc = other && other.clip.kind === "video" ? s.other?.(other) ?? null : null;
  const ready = !!tr && (other!.clip.kind !== "video" || !!otherSrc) && (live!.clip.kind !== "video" || !!src);
  if (tr && ready) {
    const paintLive = (c: Ctx) => drawPicture(c, s, live, src, t);
    const paintOther = (c: Ctx) => drawPicture(c, s, other, otherSrc, Math.max(other!.outStart, Math.min(other!.outEnd, t)));
    drawTransition(ctx, W, H, { kind: tr.kind, p: tr.p, t }, tr.phase === "out" ? paintLive : paintOther, tr.phase === "out" ? paintOther : paintLive);
  } else {
    drawPicture(ctx, s, item, src, t);
  }
  ctx.restore();

  if (fx !== NO_FX) drawFxOverlays(ctx, W, H, fx);

  const cz = s.captionZ ?? CAPTION_Z;
  const env = { speakers: s.speakers, duration: s.tl.duration };
  // captions behind the person: cut the people out of the picture now, draw them back over the captions
  const people = s.style.behindSubject && src && item?.clip.kind !== "card" ? cutOutPeople(ctx, W, H) : null;
  drawLayers(ctx, W, H, s.layers, t, env, -Infinity, cz);
  const box = drawCaptionsAt(ctx, s, t);
  if (people) ctx.drawImage(people, 0, 0);
  drawLayers(ctx, W, H, s.layers, t, env, cz, Infinity);
  if (fx !== NO_FX) drawFxFlash(ctx, W, H, fx);
  if (s.watermark) drawWatermark(ctx, W, H, s.frame, s.watermark.corner);
  return box;
}
