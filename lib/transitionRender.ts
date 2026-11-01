/**
 * Drawing clip transitions. Both pictures (the clip being left and the clip
 * being entered) are drawn into their own layer, then composited with canvas
 * transforms, globalAlpha, compositing modes and cheap blurs (a filtered,
 * downscaled copy scaled back up). No per-pixel loops, so the preview stays
 * real time. Timing and curves come from lib/transitions.ts and lib/easing.ts.
 */
import type { TransitionKind } from "./project";
import { bell, clamp01, easeInOutCubic, easeInOutSine, easeInQuad, easeOutCubic, lerp, ramp } from "./easing";
import { mixIn, pushTravel, spinAngles, throughSpeed, zoomScales } from "./transitions";

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

interface Place { scale?: number; rot?: number; dx?: number; dy?: number; alpha?: number; mirror?: boolean }

/**
 * Draw a full-frame picture scaled and rotated about the centre. With
 * `mirror`, the edges are filled with mirrored copies (like the mirror-edge
 * trick editors use), so shrinking or rotating never shows empty corners.
 */
function put(ctx: Ctx, img: AnyCanvas, W: number, H: number, o: Place = {}): void {
  const s = o.scale ?? 1;
  const rot = o.rot ?? 0;
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha *= clamp01(o.alpha);
  ctx.translate(W / 2 + (o.dx ?? 0), H / 2 + (o.dy ?? 0));
  if (rot) ctx.rotate(rot);
  if (s !== 1) ctx.scale(s, s);
  const src = img as CanvasImageSource;
  if (o.mirror && (s < 0.999 || rot)) {
    // reach of the frame from the centre, in picture units
    const reach = Math.hypot(W, H) / 2 / s;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        if (!rot && (Math.abs(i) * W - W / 2 > W / 2 / s || Math.abs(j) * H - H / 2 > H / 2 / s)) continue;
        if (rot && Math.hypot(i * W, j * H) - Math.hypot(W, H) / 2 > reach) continue;
        ctx.save();
        ctx.translate(i * W, j * H);
        if (i || j) ctx.scale(i ? -1 : 1, j ? -1 : 1);
        ctx.drawImage(src, -W / 2, -H / 2, W, H);
        ctx.restore();
      }
    }
  } else {
    ctx.drawImage(src, -W / 2, -H / 2, W, H);
  }
  ctx.restore();
}

/**
 * Zoom / spin motion blur: several copies spread along the motion, averaged
 * (copy k drawn at 1/(k+1) so all copies weigh the same). The first copy must
 * cover the frame, which put() with `mirror` guarantees.
 */
function smear(ctx: Ctx, img: AnyCanvas, W: number, H: number, scale: number, rot: number, strength: number, zoomSpread: number, rotSpread: number, mirror: boolean): void {
  const n = 1 + Math.round(7 * clamp01(strength));
  for (let k = 0; k < n; k++) {
    const f = n === 1 ? 0 : k / (n - 1) - 0.5;
    ctx.save();
    ctx.globalAlpha = 1 / (k + 1);
    put(ctx, img, W, H, { scale: scale * (1 + f * zoomSpread * strength), rot: rot + f * rotSpread * strength, mirror });
    ctx.restore();
  }
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
 * Directional (motion) blur: squash the picture along the motion with a
 * smoothing downscale, then stretch it back. Smooth streaks, no ghost copies.
 */
function dirBlur(ctx: Ctx, img: AnyCanvas, W: number, H: number, len: number, horiz: boolean): void {
  if (len < 1.5) { ctx.drawImage(img as CanvasImageSource, 0, 0, W, H); return; }
  const k = Math.min(32, len / 6);
  const sw = horiz ? Math.max(4, Math.ceil(W / k)) : W;
  const sh = horiz ? H : Math.max(4, Math.ceil(H / k));
  // halve step by step: each bilinear halving is a true 2-pixel average, so the
  // squash is a clean box filter instead of skipping pixels
  let src: AnyCanvas = img;
  let cw = W, ch = H, flip = 0;
  while (horiz ? cw / 2 >= sw : ch / 2 >= sh) {
    cw = horiz ? Math.ceil(cw / 2) : cw;
    ch = horiz ? ch : Math.ceil(ch / 2);
    const t = scratch(`dir-${flip++}`, cw, ch); // step n always has the same size, so canvases are reused
    t.x.drawImage(src as CanvasImageSource, 0, 0, cw, ch);
    src = t.c;
  }

  // three overlapping copies along the motion smooth out the stretch (averaged: 1, 1/2, 1/3)
  const d = len / 6;
  ctx.save();
  ctx.imageSmoothingQuality = "high";
  const offs = [0, -d, d];
  offs.forEach((o, i) => {
    ctx.globalAlpha = 1 / (i + 1);
    ctx.drawImage(src as CanvasImageSource, horiz ? o : 0, horiz ? 0 : o, W, H);
  });
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
 * `drawTo` each paint one clip's picture onto a full-frame context.
 */
export function drawTransition(ctx: Ctx, W: number, H: number, tr: TransitionDraw, drawFrom: Draw, drawTo: Draw): void {
  const p = clamp01(tr.p);
  const short = Math.min(W, H);
  const A = () => layer("tr-a", W, H, drawFrom);
  const B = () => layer("tr-b", W, H, drawTo);

  switch (tr.kind) {
    case "fade": {
      // true cross-dissolve: the new picture fades in over the old one
      put(ctx, A(), W, H);
      put(ctx, B(), W, H, { alpha: easeInOutSine(p) });
      return;
    }

    case "dip-black": {
      // down to black, a breath of black, back up
      const k = p < 0.5 ? easeInOutSine(p / 0.44) : easeInOutSine((1 - p) / 0.44);
      put(ctx, p < 0.5 ? A() : B(), W, H);
      ctx.save();
      ctx.globalAlpha = clamp01(k);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      return;
    }

    case "dip-white": {
      // a quick bloom of light that hides the cut: fast attack, softer decay
      const b = p < 0.5 ? easeInQuad(ramp(0.12, 0.5, p)) : 1 - easeOutCubic(ramp(0.5, 0.95, p));
      const base = scratch("tr-t", W, H);
      put(base.x, A(), W, H);
      const mix = mixIn(p, 0.44, 0.56);
      if (mix > 0) put(base.x, B(), W, H, { alpha: mix });
      ctx.save();
      ctx.filter = b > 0.01 ? `brightness(${(1 + 1.1 * b).toFixed(3)}) saturate(${(1 - 0.35 * b).toFixed(3)})` : "none";
      ctx.drawImage(base.c as CanvasImageSource, 0, 0, W, H);
      ctx.restore();
      if (b > 0.01) {
        // glow: a blurred copy added on top
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.85 * b;
        blurInto(ctx, base.c, W, H, short * 0.05 * b, "brightness(1.4)");
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = 0.7 * Math.pow(b, 1.6);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      return;
    }

    case "zoom": {
      // the old clip pushes in faster and faster to the cut; the new one starts
      // pushed in just as far and eases back out. Radial blur peaks at the cut.
      const z = zoomScales(p);
      const v = throughSpeed(p);
      const mix = mixIn(p, 0.4, 0.6);
      const tmp = scratch("tr-t", W, H);
      if (mix < 1) smear(tmp.x, A(), W, H, z.from, 0, v, 0.14, 0, false);
      if (mix > 0) {
        if (mix >= 1) smear(tmp.x, B(), W, H, z.to, 0, v, 0.14, 0, false);
        else {
          const u = scratch("tr-u", W, H);
          smear(u.x, B(), W, H, z.to, 0, v, 0.14, 0, false);
          put(tmp.x, u.c, W, H, { alpha: mix });
        }
      }
      blurInto(ctx, tmp.c, W, H, short * 0.01 * v);
      return;
    }

    case "spin": {
      // a restrained spin: about 14 degrees each side of the cut with a gentle
      // push-in, rotational blur, mirrored edges so no corners go empty
      const ang = spinAngles(p);
      const v = throughSpeed(p);
      const zoom = 1 + 0.12 * bell(p);
      const mix = mixIn(p, 0.4, 0.6);
      const spread = 0.12;
      const tmp = scratch("tr-t", W, H);
      if (mix < 1) smear(tmp.x, A(), W, H, zoom, ang.from, v, 0.03, spread, true);
      if (mix > 0) {
        if (mix >= 1) smear(tmp.x, B(), W, H, zoom, ang.to, v, 0.03, spread, true);
        else {
          const u = scratch("tr-u", W, H);
          smear(u.x, B(), W, H, zoom, ang.to, v, 0.03, spread, true);
          put(tmp.x, u.c, W, H, { alpha: mix });
        }
      }
      blurInto(ctx, tmp.c, W, H, short * 0.014 * v);
      return;
    }

    case "slide-left":
    case "slide-up":
    case "whip": {
      // push: both clips travel together, edge to edge, so there's never a gap
      const horiz = tr.kind !== "slide-up";
      const span = horiz ? W : H;
      const whip = tr.kind === "whip";
      const e = pushTravel(p, whip);
      const x = p < 0.5 ? p * 2 : 2 - p * 2;
      const v = whip ? Math.pow(x, 3) : x * x; // normalised speed, peak at the cut
      const off = -e * span;
      const tmp = scratch("tr-t", W, H);
      if (horiz) { put(tmp.x, A(), W, H, { dx: off }); put(tmp.x, B(), W, H, { dx: off + W }); }
      else { put(tmp.x, A(), W, H, { dy: off }); put(tmp.x, B(), W, H, { dy: off + H }); }
      // directional motion blur along the move, strongest at the cut
      dirBlur(ctx, tmp.c, W, H, (whip ? 0.14 : 0.035) * span * v, horiz);
      return;
    }

    case "wipe": {
      // soft-edged diagonal wipe, left to right
      const ang = (12 * Math.PI) / 180;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const band = 0.22 * Math.max(W, H) * dx;
      const us = [0, W * dx, H * dy, W * dx + H * dy];
      const u0 = Math.min(...us) - band, u1 = Math.max(...us) + band;
      const u = lerp(u0, u1, easeInOutCubic(p));
      put(ctx, A(), W, H);
      const b = B();
      const bx = (b.getContext("2d") as Ctx);
      const g = bx.createLinearGradient((u - band / 2) * dx, (u - band / 2) * dy, (u + band / 2) * dx, (u + band / 2) * dy);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      bx.save();
      bx.globalCompositeOperation = "destination-in";
      bx.fillStyle = g;
      bx.fillRect(0, 0, W, H);
      bx.restore();
      put(ctx, b, W, H);
      return;
    }

    case "blur": {
      // defocus out of one shot and into the next, with a slight push-in
      const r = short * 0.055 * bell(p);
      const zoom = 1 + 0.05 * bell(p);
      const mix = mixIn(p, 0.3, 0.7);
      const base = scratch("tr-t", W, H);
      put(base.x, A(), W, H, { scale: zoom });
      if (mix > 0) put(base.x, B(), W, H, { scale: zoom, alpha: mix });
      blurInto(ctx, base.c, W, H, r);
      return;
    }

    case "glitch": {
      // short and punchy: RGB split and torn slices, strongest right at the cut
      const g = Math.pow(bell(p), 2.2);
      const seed = Math.floor(tr.t * 24);
      const a = A(), b = B();
      const main = p < 0.5 ? a : b;
      const other = p < 0.5 ? b : a;
      const base = scratch("tr-t", W, H);
      base.x.drawImage(main as CanvasImageSource, 0, 0);
      if (g > 0.05) {
        const n = 3 + Math.floor(hash(seed) * 6 * g + 2 * g);
        for (let i = 0; i < n; i++) {
          const y = hash(seed * 3.1 + i) * H;
          const h = (0.015 + hash(seed * 7.7 + i) * 0.08) * H;
          const shift = (hash(seed * 5.3 + i) - 0.5) * W * 0.16 * g;
          // near the cut some slices come from the other clip
          const src = Math.abs(p - 0.5) < 0.14 && hash(seed * 9.1 + i) > 0.5 ? other : main;
          base.x.drawImage(src as CanvasImageSource, 0, y, W, h, shift, y, W, h);
        }
      }
      const d = short * 0.022 * g;
      if (d < 0.5) { ctx.drawImage(base.c as CanvasImageSource, 0, 0, W, H); return; }
      // split into red and cyan, offset them, add them back together
      const red = scratch("tr-r", W, H);
      red.x.drawImage(base.c as CanvasImageSource, 0, 0);
      red.x.globalCompositeOperation = "multiply";
      red.x.fillStyle = "#FF0000";
      red.x.fillRect(0, 0, W, H);
      const cyan = scratch("tr-c", W, H);
      cyan.x.drawImage(base.c as CanvasImageSource, 0, 0);
      cyan.x.globalCompositeOperation = "multiply";
      cyan.x.fillStyle = "#00FFFF";
      cyan.x.fillRect(0, 0, W, H);
      ctx.save();
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(red.c as CanvasImageSource, -d, 0, W, H);
      ctx.drawImage(cyan.c as CanvasImageSource, d * 0.6, 0, W, H);
      ctx.restore();
      // a cyan/red edge-fill where the split leaves the border uncovered
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(base.c as CanvasImageSource, 0, 0, Math.ceil(d * 0.6) + 1, H, 0, 0, Math.ceil(d * 0.6) + 1, H);
      ctx.drawImage(base.c as CanvasImageSource, W - Math.ceil(d) - 1, 0, Math.ceil(d) + 1, H, W - Math.ceil(d) - 1, 0, Math.ceil(d) + 1, H);
      ctx.restore();
      if (g > 0.4) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.25 * g;
        ctx.fillStyle = hash(seed * 1.7) > 0.5 ? "#00E5FF" : "#FF2EA6";
        ctx.fillRect(0, hash(seed * 2.2) * H, W, H * (0.006 + 0.012 * hash(seed * 4.4)));
        ctx.restore();
      }
      return;
    }

    default: {
      put(ctx, p < 0.5 ? A() : B(), W, H);
    }
  }
}
