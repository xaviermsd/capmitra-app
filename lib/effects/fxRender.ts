/**
 * Drawing for video effects (see fx.ts). Overlays are drawn right after the
 * video picture (under graphics and captions, so text stays readable); the
 * flash is drawn last, over everything.
 */
import { hash01, type FxState } from "./fx";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

let scratch: AnyCanvas | null = null;
function copyOf(ctx: Ctx, W: number, H: number): AnyCanvas {
  if (!scratch || scratch.width !== W || scratch.height !== H) scratch = makeCanvas(W, H);
  const sc = scratch.getContext("2d") as Ctx;
  sc.clearRect(0, 0, W, H);
  sc.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
  return scratch;
}

const noiseTiles: AnyCanvas[] = [];
function noiseTile(i: number): AnyCanvas {
  if (!noiseTiles.length) {
    for (let n = 0; n < 4; n++) {
      const c = makeCanvas(192, 192);
      const x = c.getContext("2d") as Ctx;
      const img = x.createImageData(192, 192);
      for (let p = 0; p < img.data.length; p += 4) {
        const v = Math.floor(hash01(p * 0.731 + n * 9973) * 255);
        img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
        img.data[p + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      noiseTiles.push(c);
    }
  }
  return noiseTiles[i % noiseTiles.length];
}

/** Camera transform + colour filter, applied before drawing the video picture. */
export function applyCamera(ctx: Ctx, W: number, H: number, s: FxState): void {
  if (s.scale !== 1 || s.dx || s.dy || s.rotate) {
    ctx.translate(W / 2 + s.dx * W, H / 2 + s.dy * H);
    if (s.rotate) ctx.rotate((s.rotate * Math.PI) / 180);
    ctx.scale(s.scale, s.scale);
    ctx.translate(-W / 2, -H / 2);
  }
  const f: string[] = [];
  if (s.filter !== "none") f.push(s.filter);
  if (s.blur > 0) f.push(`blur(${(s.blur * Math.max(W, H) * 0.012).toFixed(1)}px)`);
  if (f.length) ctx.filter = f.join(" ");
}

/** Overlays on top of the video picture (under graphics and captions). */
export function drawFxOverlays(ctx: Ctx, W: number, H: number, s: FxState): void {
  const short = Math.min(W, H);
  if (s.motionBlur > 0.05) {
    const src = copyOf(ctx, W, H);
    ctx.save();
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = 0.22 * s.motionBlur;
      ctx.drawImage(src as CanvasImageSource, (i - 2) * W * 0.03 * s.motionBlur, 0);
    }
    ctx.restore();
  }
  if (s.rgbSplit > 0.02) {
    const src = copyOf(ctx, W, H);
    const d = short * 0.012 * s.rgbSplit;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.55 * Math.min(1, s.rgbSplit + 0.3);
    ctx.filter = "sepia(1) saturate(8) hue-rotate(-50deg) brightness(0.8)";
    ctx.drawImage(src as CanvasImageSource, -d, 0);
    ctx.filter = "sepia(1) saturate(8) hue-rotate(150deg) brightness(0.8)";
    ctx.drawImage(src as CanvasImageSource, d, 0);
    ctx.restore();
  }
  if (s.glitch && s.glitch.amount > 0.02) {
    const src = copyOf(ctx, W, H);
    const n = 3 + Math.floor(hash01(s.glitch.seed) * 6);
    for (let i = 0; i < n; i++) {
      const y = hash01(s.glitch.seed * 3.1 + i) * H;
      const h = (0.01 + hash01(s.glitch.seed * 7.7 + i) * 0.07) * H;
      const off = (hash01(s.glitch.seed * 5.3 + i) - 0.5) * W * 0.12 * s.glitch.amount;
      ctx.drawImage(src as CanvasImageSource, 0, y, W, h, off, y, W, h);
    }
    ctx.save();
    ctx.globalAlpha = 0.18 * s.glitch.amount;
    ctx.fillStyle = hash01(s.glitch.seed) > 0.5 ? "#00FFFF" : "#FF00AA";
    ctx.fillRect(0, hash01(s.glitch.seed * 2.2) * H, W, H * 0.02);
    ctx.restore();
  }
  if (s.scanlines > 0.02) {
    ctx.save();
    ctx.globalAlpha = 0.18 * s.scanlines;
    ctx.fillStyle = "#000";
    const step = Math.max(2, Math.round(H / 320));
    for (let y = 0; y < H; y += step * 2) ctx.fillRect(0, y, W, step);
    ctx.restore();
  }
  if (s.grain && s.grain.amount > 0.02) {
    ctx.save();
    ctx.globalAlpha = 0.12 * s.grain.amount;
    ctx.globalCompositeOperation = "overlay";
    const tile = noiseTile(s.grain.seed);
    const pat = ctx.createPattern(tile as CanvasImageSource, "repeat");
    if (pat) {
      ctx.translate(-hash01(s.grain.seed) * 192, -hash01(s.grain.seed + 1) * 192);
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W + 192, H + 192);
    }
    ctx.restore();
  }
  if (s.lightLeak > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.7 * s.lightLeak;
    const g = ctx.createRadialGradient(W * 0.85, H * 0.15, 0, W * 0.85, H * 0.15, Math.max(W, H) * 0.7);
    g.addColorStop(0, "rgba(255,170,80,0.9)");
    g.addColorStop(0.4, "rgba(255,80,120,0.45)");
    g.addColorStop(1, "rgba(255,80,120,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (s.vignette > 0.02) {
    ctx.save();
    const g = ctx.createRadialGradient(W / 2, H / 2, short * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${0.75 * s.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (s.bars > 0.01) {
    // 2.39:1 letterbox on landscape, slimmer bands on vertical video
    const full = W > H ? Math.max(0, (H - W / 2.39) / 2) : H * 0.11;
    const b = full * s.bars;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, b);
    ctx.fillRect(0, H - b, W, b);
  }
}

/** Full-frame flash, drawn last. */
export function drawFxFlash(ctx: Ctx, W: number, H: number, s: FxState): void {
  if (!s.flash || s.flash.alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, s.flash.alpha);
  ctx.fillStyle = s.flash.color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
