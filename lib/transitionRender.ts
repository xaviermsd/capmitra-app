/**
 * Drawing clip transitions. Both pictures (the clip being left and the clip
 * being entered) are drawn into their own layer, then composited with canvas
 * transforms, globalAlpha, compositing modes and cheap blurs (a filtered,
 * downscaled copy scaled back up). No per-pixel loops, so the preview stays
 * real time. Timing and curves come from lib/transitions.ts and lib/easing.ts.
 */
import type { TransitionKind } from "./project";
import { bell, clamp01, easeInOutCubic, lerp } from "./easing";
import { coverScale, transitionLayout, type Pose } from "./transitions";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Draw = (c: Ctx) => void;

/* ---------- scratch canvases ---------- */

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

const pool = new Map<string, AnyCanvas>();
function scratch(name: string, w: number, h: number): { c: AnyCanvas; x: Ctx } {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  let c = pool.get(name);
  if (!c || c.width !== w || c.height !== h) { c = makeCanvas(w, h); pool.set(name, c); }
  const x = c.getContext("2d") as Ctx;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = "source-over";
  x.filter = "none";
  return { c, x };
}

/** Draw a picture into a named full-frame layer (opaque black underneath). */
function layer(name: string, W: number, H: number, draw: Draw): AnyCanvas {
  const { c, x } = scratch(name, W, H);
  x.fillStyle = "#000";
  x.fillRect(0, 0, W, H);
  x.save();
  draw(x);
  x.restore();
  return c;
}

/* ---------- placing a picture ---------- */

/** Draw a full-frame picture placed by a pose (scale and rotation about the centre, then offset). */
function put(ctx: Ctx, img: AnyCanvas, W: number, H: number, scale: number, rot: number, dx: number, dy: number): void {
  ctx.save();
  // whole pixels, so two pictures pushed edge to edge never leave a hairline seam
  ctx.translate(Math.round(W / 2 + dx), Math.round(H / 2 + dy));
  if (rot) ctx.rotate(rot);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.drawImage(img as CanvasImageSource, -W / 2, -H / 2, W, H);
  ctx.restore();
}

/**
 * One pose, with its zoom or rotational blur: copies spread along the motion
 * and averaged (copy k drawn at 1/(k+1), so all copies weigh the same). Zoom
 * copies only ever grow from the pose's scale, and every rotated copy of a
 * picture that covers the frame gets its own cover scale, so blurred copies
 * never bring an edge into view.
 */
function drawPose(ctx: Ctx, img: AnyCanvas, W: number, H: number, ps: Pose): void {
  const zs = ps.zoomBlur ?? 0;
  const rs = ps.spinBlur ?? 0;
  const strength = clamp01(Math.max(zs, rs) / 0.5);
  const n = 1 + Math.round(11 * strength);
  const covering = ps.scale >= coverScale(ps.rot, W, H) - 1e-6;
  const draw = (x: Ctx) => {
    if (ps.shadow && ps.scale < 0.999) {
      x.save();
      x.translate(Math.round(W / 2 + ps.dx), Math.round(H / 2 + ps.dy));
      x.rotate(ps.rot);
      x.shadowColor = "rgba(0,0,0,0.55)";
      x.shadowBlur = Math.min(W, H) * 0.06;
      x.fillStyle = "#000";
      const sw = W * ps.scale, sh = H * ps.scale;
      x.fillRect(-sw / 2, -sh / 2, sw, sh);
      x.restore();
    }
    for (let k = 0; k < n; k++) {
      const f = n === 1 ? 0 : k / (n - 1);
      const rot = ps.rot + rs * (f - 0.5);
      let scale = ps.scale * (1 + zs * f);
      if (covering && rs) scale = Math.max(scale, coverScale(rot, W, H));
      x.save();
      x.globalAlpha = 1 / (k + 1);
      put(x, img, W, H, scale, rot, ps.dx, ps.dy);
      x.restore();
    }
  };
  if (ps.alpha >= 0.999) { draw(ctx); return; }
  if (ps.alpha <= 0.001) return;
  if (n === 1 && !ps.shadow) {
    ctx.save();
    ctx.globalAlpha = ps.alpha;
    put(ctx, img, W, H, ps.scale, ps.rot, ps.dx, ps.dy);
    ctx.restore();
    return;
  }
  // blurred copies fade as one picture
  const u = scratch("tr-u", W, H);
  u.x.clearRect(0, 0, W, H);
  draw(u.x);
  ctx.save();
  ctx.globalAlpha = ps.alpha;
  ctx.drawImage(u.c as CanvasImageSource, 0, 0, W, H);
  ctx.restore();
}

/**
 * Blur by filtering a downscaled copy and scaling it back up: fast at any
 * radius. The copy gets a border of near-edge picture first, so the edges
 * stay bright instead of fading to black.
 */
function blurInto(ctx: Ctx, img: AnyCanvas, W: number, H: number, radius: number, extraFilter = ""): void {
  if (radius < 0.75) {
    ctx.save();
    if (extraFilter) ctx.filter = extraFilter;
    ctx.drawImage(img as CanvasImageSource, 0, 0, W, H);
    ctx.restore();
    return;
  }
  const ds = Math.min(16, Math.max(1, radius / 3));
  const sw = Math.ceil(W / ds), sh = Math.ceil(H / ds);
  const r = radius / ds;
  const m = Math.ceil(r * 2.5);
  const a = scratch("blur-a", sw + 2 * m, sh + 2 * m);
  a.x.imageSmoothingQuality = "high";
  a.x.drawImage(img as CanvasImageSource, 0, 0, sw + 2 * m, sh + 2 * m); // stretched copy fills the border
  a.x.drawImage(img as CanvasImageSource, m, m, sw, sh);
  const b = scratch("blur-b", sw + 2 * m, sh + 2 * m);
  b.x.clearRect(0, 0, sw + 2 * m, sh + 2 * m);
  b.x.filter = `blur(${r.toFixed(2)}px)`;
  b.x.drawImage(a.c as CanvasImageSource, 0, 0);
  b.x.filter = "none";
  ctx.save();
  ctx.imageSmoothingQuality = "high";
  if (extraFilter) ctx.filter = extraFilter;
  ctx.drawImage(b.c as CanvasImageSource, m, m, sw, sh, 0, 0, W, H);
  ctx.restore();
}

/**
 * Directional (motion) blur: a gentle squash along the motion with a smoothing
 * downscale (a clean box filter), stretched back, then averaged copies spread
 * over the blur length. The squash is kept small so the stretch never shows
 * blocks, and the copies sit close enough on the soft picture to read as one streak.
 */
function dirBlur(ctx: Ctx, img: AnyCanvas, W: number, H: number, len: number, horiz: boolean): void {
  if (len < 1.5) { ctx.drawImage(img as CanvasImageSource, 0, 0, W, H); return; }
  const k = Math.max(1, Math.min(8, len / 10));
  let src: AnyCanvas = img;
  if (k >= 2) {
    const sw = horiz ? Math.max(4, Math.ceil(W / k)) : W;
    const sh = horiz ? H : Math.max(4, Math.ceil(H / k));
    let cw = W, ch = H, step = 0;
    // halve step by step: each bilinear halving is a true 2-pixel average
    while (horiz ? cw / 2 >= sw : ch / 2 >= sh) {
      cw = horiz ? Math.ceil(cw / 2) : cw;
      ch = horiz ? ch : Math.ceil(ch / 2);
      const t = scratch(`dir-${horiz ? "h" : "v"}${step++}`, cw, ch);
      t.x.drawImage(src as CanvasImageSource, 0, 0, cw, ch);
      src = t.c;
    }
  }
  ctx.save();
  ctx.imageSmoothingQuality = "high";
  // the unshifted picture first, so the edges are always covered
  ctx.drawImage(src as CanvasImageSource, 0, 0, W, H);
  const n = Math.max(2, Math.min(14, Math.round(len / (k * 1.5))));
  for (let i = 0; i < n; i++) {
    const o = (i / (n - 1) - 0.5) * len;
    ctx.globalAlpha = 1 / (i + 2);
    ctx.drawImage(src as CanvasImageSource, horiz ? o : 0, horiz ? 0 : o, W, H);
  }
  ctx.restore();
}

/** Deterministic noise in [0, 1). */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/* ---------- the transitions ---------- */

export interface TransitionDraw {
  kind: TransitionKind;
  /** Progress 0..1, 0.5 at the cut. */
  p: number;
  /** Output time (seeds the glitch). */
  t: number;
}

/**
 * Composite a transition onto `ctx` (the full W x H frame). `drawFrom` and
 * `drawTo` each paint one clip's picture onto a full-frame context. Where the
 * pictures go comes from transitionLayout(); this only paints it.
 */
export function drawTransition(ctx: Ctx, W: number, H: number, tr: TransitionDraw, drawFrom: Draw, drawTo: Draw): void {
  const p = clamp01(tr.p);
  const L = transitionLayout(tr.kind, p, W, H, tr.t);
  const pics: { from?: AnyCanvas; to?: AnyCanvas } = {};
  const pic = (who: Pose["who"]) => (pics[who] ??= layer(who === "from" ? "tr-a" : "tr-b", W, H, who === "from" ? drawFrom : drawTo));

  if (tr.kind === "wipe") { wipe(ctx, W, H, p, pic("from"), pic("to")); return; }
  if (tr.kind === "glitch") { glitch(ctx, W, H, p, tr.t, pic(L.layers[0].who), pic(L.layers[0].who === "from" ? "to" : "from")); return; }

  const motion = L.motionBlur >= 1.5;
  const soft = L.blur >= 0.75 || L.bright > 1.001;
  const comp = motion || soft ? scratch("tr-t", W, H) : null;
  const x = comp ? comp.x : ctx;
  x.fillStyle = "#000";
  x.fillRect(0, 0, W, H);
  for (const ps of L.layers) drawPose(x, pic(ps.who), W, H, ps);

  if (comp) {
    let src: AnyCanvas = comp.c;
    if (motion) {
      const m = scratch("tr-m", W, H);
      dirBlur(m.x, src, W, H, L.motionBlur, L.horiz);
      src = m.c;
    }
    if (soft) blurInto(ctx, src, W, H, L.blur, L.bright > 1.001 ? `brightness(${L.bright.toFixed(3)})` : "");
    else ctx.drawImage(src as CanvasImageSource, 0, 0, W, H);
  }

  if (L.wash && L.wash.alpha > 0.001) {
    ctx.save();
    ctx.globalAlpha = L.wash.alpha;
    ctx.fillStyle = L.wash.color;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/** Soft-edged diagonal wipe, left to right, with a feathered moving edge. */
function wipe(ctx: Ctx, W: number, H: number, p: number, a: AnyCanvas, b: AnyCanvas): void {
  const ang = (14 * Math.PI) / 180;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const band = 0.18 * Math.max(W, H);
  const us = [0, W * dx, H * dy, W * dx + H * dy];
  const u0 = Math.min(...us) - band, u1 = Math.max(...us) + band;
  const u = lerp(u0, u1, easeInOutCubic(p));
  ctx.drawImage(a as CanvasImageSource, 0, 0, W, H);
  const m = scratch("tr-t", W, H);
  m.x.drawImage(b as CanvasImageSource, 0, 0, W, H);
  const g = m.x.createLinearGradient((u - band / 2) * dx, (u - band / 2) * dy, (u + band / 2) * dx, (u + band / 2) * dy);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  m.x.globalCompositeOperation = "destination-in";
  m.x.fillStyle = g;
  m.x.fillRect(0, 0, W, H);
  m.x.globalCompositeOperation = "source-over";
  ctx.drawImage(m.c as CanvasImageSource, 0, 0, W, H);
}

/** RGB split, torn slices and a few frames flickering between both clips at the cut. */
function glitch(ctx: Ctx, W: number, H: number, p: number, t: number, main: AnyCanvas, other: AnyCanvas): void {
  const g = Math.pow(bell(p), 1.4);
  const seed = Math.floor(t * 30);
  const short = Math.min(W, H);
  const base = scratch("tr-t", W, H);
  base.x.drawImage(main as CanvasImageSource, 0, 0, W, H);
  if (g > 0.03) {
    const n = 3 + Math.floor(hash(seed) * 7 * g + 4 * g);
    for (let i = 0; i < n; i++) {
      const y = Math.floor(hash(seed * 3.1 + i) * H);
      const h = Math.ceil((0.012 + hash(seed * 7.7 + i) * 0.09) * H);
      const shift = Math.round((hash(seed * 5.3 + i) - 0.5) * W * 0.3 * g);
      const src = Math.abs(p - 0.5) < 0.2 && hash(seed * 9.1 + i) > 0.45 ? other : main;
      // the torn slice wraps around, so its ends are picture too, never a gap
      base.x.drawImage(src as CanvasImageSource, 0, y, W, h, shift, y, W, h);
      base.x.drawImage(src as CanvasImageSource, 0, y, W, h, shift - Math.sign(shift || 1) * W, y, W, h);
    }
  }
  const d = short * 0.04 * g;
  if (d < 0.5) { ctx.drawImage(base.c as CanvasImageSource, 0, 0, W, H); return; }
  // red and cyan copies offset sideways, each scaled just enough to keep covering the frame
  const k = 1 + (2.2 * d) / W;
  const sw = W * k, sh = H * k;
  const red = scratch("tr-r", W, H);
  red.x.drawImage(base.c as CanvasImageSource, (W - sw) / 2 - d, (H - sh) / 2, sw, sh);
  red.x.globalCompositeOperation = "multiply";
  red.x.fillStyle = "#FF0000";
  red.x.fillRect(0, 0, W, H);
  const cyan = scratch("tr-c", W, H);
  cyan.x.drawImage(base.c as CanvasImageSource, (W - sw) / 2 + d, (H - sh) / 2, sw, sh);
  cyan.x.globalCompositeOperation = "multiply";
  cyan.x.fillStyle = "#00FFFF";
  cyan.x.fillRect(0, 0, W, H);
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(red.c as CanvasImageSource, 0, 0, W, H);
  ctx.drawImage(cyan.c as CanvasImageSource, 0, 0, W, H);
  ctx.restore();
  if (g > 0.35) {
    // a couple of bright scan bars
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 2; i++) {
      ctx.globalAlpha = 0.35 * g;
      ctx.fillStyle = hash(seed * 1.7 + i) > 0.5 ? "#00E5FF" : "#FF2EA6";
      ctx.fillRect(0, hash(seed * 2.2 + i * 5) * H, W, H * (0.004 + 0.014 * hash(seed * 4.4 + i)));
    }
    ctx.restore();
  }
}
