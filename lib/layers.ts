/**
 * Graphics layers: text, lower thirds, title cards, callouts, speaker labels,
 * shapes, animated vector graphics, SVG and images. Drawn on the same canvas
 * by preview and export, so motion looks identical in both.
 *
 * Geometry is in % of the frame (x/y = centre, w = % of width, h = % of height)
 * so layers scale with any output size or aspect ratio.
 */
import { splitClusters } from "./animation";
import { easeOutBack, easeOutQuad, lerp, softSpring } from "./easing";
import { fontString } from "./render";
import { DEFAULT_MOTION, uid, type Direction, type Easing, type Layer, type LayerAnim, type LayerKind, type Speaker } from "./project";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/* ---------- easing & motion ---------- */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const EASINGS: Record<Easing, (x: number) => number> = {
  linear: (x) => x,
  "ease-out": (x) => 1 - Math.pow(1 - x, 3),
  "ease-in-out": (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  back: (x) => easeOutBack(x, 1.4),
  spring: (x) => softSpring(x, 0.08),
};

export interface LayerPose {
  opacity: number;
  scale: number;
  /** Offset in px. */
  dx: number;
  dy: number;
  rotate: number;
  blur: number;
  /** 0..1 reveal for wipe / typewriter. */
  reveal: number;
  revealDir: Direction;
}

const REST_POSE: LayerPose = { opacity: 1, scale: 1, dx: 0, dy: 0, rotate: 0, blur: 0, reveal: 1, revealDir: "right" };

function dirVec(d: Direction): [number, number] {
  return d === "left" ? [-1, 0] : d === "right" ? [1, 0] : d === "up" ? [0, -1] : [0, 1];
}

/**
 * Apply one animation at progress p (0 = hidden, 1 = settled; already eased).
 * `raw` is the un-eased progress, used where a move has its own built-in
 * spring so it stays controlled whatever easing is picked.
 */
function applyAnim(pose: LayerPose, anim: LayerAnim, p: number, raw: number, dir: Direction, W: number, H: number, entering: boolean) {
  if (anim === "none") return;
  const [vx, vy] = dirVec(dir);
  const k = 1 - p;
  // entering slides *from* the opposite side so "up" moves upwards into place
  const s = entering ? -1 : 1;
  // opacity always eases (no hard first or last frame)
  const fade = (portion: number) => easeOutQuad(raw / portion);
  switch (anim) {
    case "fade": pose.opacity *= clamp01(p); break;
    case "pop": pose.opacity *= fade(0.5); pose.scale *= entering ? lerp(0.85, 1, softSpring(raw, 0.25)) : lerp(0.85, 1, p); break;
    case "zoom": pose.opacity *= fade(0.5); pose.scale *= 1 + 0.25 * k; break;
    case "slide": pose.opacity *= fade(0.6); pose.dx += s * vx * k * W * 0.1; pose.dy += s * vy * k * H * 0.1; break;
    case "spin": pose.opacity *= fade(0.5); pose.rotate += k * -30; pose.scale *= 0.8 + 0.2 * p; break;
    case "bounce": pose.opacity *= fade(0.3); pose.dy += -Math.abs(Math.cos(raw * Math.PI * 2)) * Math.pow(1 - raw, 2) * H * 0.05; break;
    case "blur": pose.opacity *= clamp01(p); pose.blur += k * 10; break;
    case "wipe": pose.reveal = Math.min(pose.reveal, p); pose.revealDir = dir; break;
    case "typewriter": pose.reveal = Math.min(pose.reveal, p); pose.revealDir = "right"; break;
  }
}

/** Pose of a layer at output time t (opacity 0 = not visible). */
export function layerPose(l: Layer, t: number, W: number, H: number): LayerPose {
  if (l.hidden || t < l.start || t >= l.end) return { ...REST_POSE, opacity: 0 };
  const m = { ...DEFAULT_MOTION, ...l.motion };
  const pose: LayerPose = { ...REST_POSE, opacity: l.opacity, rotate: l.rotation };
  const ease = EASINGS[m.easing] ?? EASINGS["ease-out"];
  const d = Math.max(0.01, m.duration);
  const sinceIn = t - l.start - m.delay;
  if (sinceIn < 0 && m.in !== "none") return { ...pose, opacity: 0 };
  if (m.in !== "none" && sinceIn < d) applyAnim(pose, m.in, ease(clamp01(sinceIn / d)), clamp01(sinceIn / d), m.direction, W, H, true);
  const untilOut = l.end - t;
  if (m.out !== "none" && untilOut < d) applyAnim(pose, m.out, ease(clamp01(untilOut / d)), clamp01(untilOut / d), m.direction, W, H, false);
  const since = t - l.start;
  switch (m.loop) {
    case "float": pose.dy += Math.sin(since * 2.2) * H * 0.006; break;
    case "pulse": pose.scale *= 1 + Math.sin(since * 5) * 0.035; break;
    case "spin": pose.rotate += since * 60; break;
    case "shake": pose.dx += Math.sin(since * 40) * W * 0.003; break;
  }
  return pose;
}

/* ---------- images (SVG + uploaded assets) ---------- */

const images = new Map<string, { img: HTMLImageElement; ok: boolean; promise: Promise<boolean> }>();

function loadImage(key: string, src: string): Promise<boolean> {
  const hit = images.get(key);
  if (hit) return hit.promise;
  const img = new Image();
  img.decoding = "async";
  const promise = new Promise<boolean>((resolve) => {
    img.onload = () => { const e = images.get(key); if (e) e.ok = true; resolve(true); };
    img.onerror = () => resolve(false);
  });
  images.set(key, { img, ok: false, promise });
  img.src = src;
  return promise;
}

/** Asset blob URLs, registered by the editor (lib/assets.ts). */
const assetUrls = new Map<string, string>();
export function registerAssetUrl(id: string, url: string) {
  assetUrls.set(id, url);
}

function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function imageFor(l: Layer): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  let key: string | null = null;
  let src: string | null = null;
  if (l.svg) { key = `svg:${l.svg.length}:${hash(l.svg)}`; src = svgUrl(l.svg); }
  else if (l.assetId && assetUrls.has(l.assetId)) { key = `asset:${l.assetId}`; src = assetUrls.get(l.assetId)!; }
  if (!key || !src) return null;
  const e = images.get(key);
  if (!e) { void loadImage(key, src); return null; }
  return e.ok ? e.img : null;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** A stored image asset, once decoded (used for image clips). */
export function assetImage(assetId: string): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  const src = assetUrls.get(assetId);
  if (!src) return null;
  const key = `asset:${assetId}`;
  const e = images.get(key);
  if (!e) { void loadImage(key, src); return null; }
  return e.ok ? e.img : null;
}

/** Decode image assets by id (export waits for this). Returns ids that failed. */
export async function preloadAssetImages(ids: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const id of new Set(ids)) {
    const url = assetUrls.get(id);
    if (!url || !(await loadImage(`asset:${id}`, url))) failed.push(id);
  }
  return failed;
}

/** Load every image the layers use (export waits for this). Returns names that failed. */
export async function preloadLayerImages(layers: Layer[]): Promise<string[]> {
  const failed: string[] = [];
  for (const l of layers) {
    if (l.svg) { if (!(await loadImage(`svg:${l.svg.length}:${hash(l.svg)}`, svgUrl(l.svg)))) failed.push(l.name); }
    else if (l.assetId) {
      const url = assetUrls.get(l.assetId);
      if (!url || !(await loadImage(`asset:${l.assetId}`, url))) failed.push(l.name);
    }
  }
  return failed;
}

/* ---------- drawing ---------- */

export interface LayerEnv {
  speakers?: Record<string, Speaker>;
  /** Output duration, for progress bars. */
  duration: number;
}

function wrapLines(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && ctx.measureText(next).width > maxW) { out.push(cur); cur = w; } else cur = next;
    }
    out.push(cur);
  }
  return out;
}

function revealText(text: string, reveal: number): string {
  if (reveal >= 1) return text;
  const parts = splitClusters(text);
  return parts.slice(0, Math.round(parts.length * reveal)).join("");
}

function drawTextBlock(ctx: Ctx, text: string, x: number, y: number, maxW: number, px: number, color: string, align: CanvasTextAlign, font: string, weight: number, reveal: number, shadow = true) {
  ctx.font = fontString({ font, weight }, px);
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, revealText(text, reveal), maxW);
  const lh = px * 1.2;
  const top = y - ((lines.length - 1) * lh) / 2;
  if (shadow) { ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = px * 0.25; ctx.shadowOffsetY = px * 0.05; }
  ctx.fillStyle = color;
  lines.forEach((ln, i) => ctx.fillText(ln, x, top + i * lh));
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  return lines.length * lh;
}

function star(ctx: Ctx, cx: number, cy: number, r: number, points: number, inner: number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = (Math.PI * i) / points - Math.PI / 2;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawShape(ctx: Ctx, l: Layer, w: number, h: number, since: number) {
  const color = l.color ?? "#D6FF36";
  const lw = Math.max(1, (l.stroke ?? 0) * Math.min(w, h) * 0.02);
  ctx.fillStyle = color;
  ctx.strokeStyle = l.accent ?? color;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const filled = !(l.stroke && l.stroke > 0 && !l.background);
  switch (l.shape ?? "rect") {
    case "rect":
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.12);
      if (l.background) { ctx.fillStyle = l.background; ctx.fill(); }
      if (filled && !l.background) ctx.fill(); if (l.stroke) ctx.stroke();
      break;
    case "circle":
      ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (filled) ctx.fill(); if (l.stroke) ctx.stroke();
      break;
    case "line":
      ctx.lineWidth = Math.max(2, h * 0.5 || lw);
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke();
      break;
    case "arrow": {
      const t = Math.max(3, h * 0.18);
      ctx.lineWidth = t;
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2 - t * 1.5, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2 - h * 0.45, -h / 2); ctx.lineTo(w / 2 - h * 0.45, h / 2); ctx.closePath(); ctx.fill();
      break;
    }
    case "star": star(ctx, 0, 0, Math.min(w, h) / 2, 5, 0.45); if (filled) ctx.fill(); if (l.stroke) ctx.stroke(); break;
    case "burst": star(ctx, 0, 0, Math.min(w, h) / 2, 12, 0.72); ctx.fill(); break;
    case "pulse": {
      // animated rings
      for (let i = 0; i < 3; i++) {
        const p = ((since * 0.8 + i / 3) % 1);
        ctx.globalAlpha *= 1;
        ctx.beginPath(); ctx.ellipse(0, 0, (w / 2) * p, (h / 2) * p, 0, 0, Math.PI * 2);
        ctx.save(); ctx.globalAlpha *= 1 - p; ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.04); ctx.stroke(); ctx.restore();
      }
      ctx.beginPath(); ctx.ellipse(0, 0, w * 0.12, h * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "sparkle": {
      for (let i = 0; i < 5; i++) {
        const a = i * 2.4;
        const r = Math.min(w, h) * (0.12 + 0.3 * ((i * 0.37) % 1));
        const tw = 0.5 + 0.5 * Math.sin(since * 6 + i * 1.7);
        const sx = Math.cos(a) * w * 0.35;
        const sy = Math.sin(a) * h * 0.35;
        ctx.save(); ctx.globalAlpha *= tw; star(ctx, sx, sy, r * (0.6 + 0.4 * tw), 4, 0.25); ctx.fill(); ctx.restore();
      }
      break;
    }
    case "underline": {
      const p = Math.min(1, since / 0.6);
      ctx.lineWidth = Math.max(3, h * 0.6);
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2 + w * EASINGS["ease-out"](p), 0); ctx.stroke();
      break;
    }
  }
}

/** Draw one layer (already positioned at its centre). */
function drawLayerBody(ctx: Ctx, l: Layer, w: number, h: number, H: number, t: number, pose: LayerPose, env: LayerEnv) {
  const font = l.font ?? "Anek Gujarati";
  const weight = l.weight ?? 700;
  const px = (H * (l.size ?? 5)) / 100;
  const since = t - l.start;
  switch (l.kind as LayerKind) {
    case "text":
    case "sticker": {
      if (l.background) {
        ctx.fillStyle = l.background;
        ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.18); ctx.fill();
      }
      drawTextBlock(ctx, l.text ?? "", 0, 0, w * 0.92, px, l.color ?? "#FFFFFF", "center", font, weight, pose.reveal, !l.background);
      break;
    }
    case "titleCard": {
      if (l.background) { ctx.fillStyle = l.background; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, px * 0.4); ctx.fill(); }
      const th = drawTextBlock(ctx, l.text ?? "", 0, l.subtitle ? -px * 0.45 : 0, w * 0.9, px, l.color ?? "#FFFFFF", "center", font, Math.max(weight, 700), pose.reveal);
      if (l.subtitle) drawTextBlock(ctx, l.subtitle, 0, th / 2 + px * 0.3, w * 0.9, px * 0.5, l.accent ?? "#D6FF36", "center", font, 500, pose.reveal);
      break;
    }
    case "lowerThird": {
      const accent = l.accent ?? "#D6FF36";
      ctx.fillStyle = l.background ?? "rgba(11,16,32,0.82)";
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, h * 0.14); ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(-w / 2, -h / 2, Math.max(4, w * 0.018), h);
      const left = -w / 2 + w * 0.06;
      drawTextBlock(ctx, l.text ?? "", left, l.subtitle ? -h * 0.17 : 0, w * 0.88, px, l.color ?? "#FFFFFF", "left", font, Math.max(weight, 700), pose.reveal, false);
      if (l.subtitle) drawTextBlock(ctx, l.subtitle, left, h * 0.22, w * 0.88, px * 0.62, accent, "left", font, 500, pose.reveal, false);
      break;
    }
    case "callout": {
      const bg = l.background ?? "#FFFFFF";
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h * 0.8, h * 0.2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-w * 0.15, h * 0.3); ctx.lineTo(-w * 0.3, h / 2); ctx.lineTo(-w * 0.02, h * 0.3); ctx.closePath(); ctx.fill();
      drawTextBlock(ctx, l.text ?? "", 0, -h * 0.1, w * 0.85, px, l.color ?? "#111111", "center", font, weight, pose.reveal, false);
      break;
    }
    case "speakerLabel": {
      const sp = l.speaker ? env.speakers?.[l.speaker] : undefined;
      const name = l.text || sp?.name || "Speaker";
      const color = sp?.color ?? l.accent ?? "#22D3EE";
      ctx.font = fontString({ font, weight }, px);
      const tw = ctx.measureText(name).width;
      const pw = tw + px * 1.6;
      const ph = px * 1.6;
      ctx.fillStyle = l.background ?? "rgba(11,16,32,0.8)";
      ctx.beginPath(); ctx.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(-pw / 2 + ph * 0.5, 0, px * 0.28, 0, Math.PI * 2); ctx.fill();
      drawTextBlock(ctx, name, px * 0.35, 0, pw, px, l.color ?? "#FFFFFF", "center", font, weight, pose.reveal, false);
      break;
    }
    case "progress": {
      const p = env.duration > 0 ? Math.min(1, Math.max(0, t / env.duration)) : 0;
      ctx.fillStyle = l.background ?? "rgba(255,255,255,0.25)";
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, h / 2); ctx.fill();
      ctx.fillStyle = l.color ?? "#D6FF36";
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, Math.max(h, w * p), h, h / 2); ctx.fill();
      break;
    }
    case "shape":
      drawShape(ctx, l, w, h, since);
      break;
    case "svg":
    case "image": {
      const img = imageFor(l);
      if (img && img.naturalWidth) {
        const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * k;
        const dh = img.naturalHeight * k;
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      }
      break;
    }
  }
}

/** Draw the layers whose z is in [zFrom, zTo) at output time t. */
export function drawLayers(ctx: Ctx, W: number, H: number, layers: Layer[] | undefined, t: number, env: LayerEnv, zFrom = -Infinity, zTo = Infinity): void {
  if (!layers?.length) return;
  const visible = layers.filter((l) => !l.hidden && t >= l.start && t < l.end && l.z >= zFrom && l.z < zTo).sort((a, b) => a.z - b.z);
  for (const l of visible) {
    const pose = layerPose(l, t, W, H);
    if (pose.opacity <= 0.001) continue;
    const w = (W * l.w) / 100;
    const h = (H * l.h) / 100;
    ctx.save();
    ctx.globalAlpha = Math.min(1, pose.opacity);
    ctx.translate((W * l.x) / 100 + pose.dx, (H * l.y) / 100 + pose.dy);
    if (pose.rotate) ctx.rotate((pose.rotate * Math.PI) / 180);
    if (pose.scale !== 1) ctx.scale(pose.scale, pose.scale);
    if (pose.blur > 0) ctx.filter = `blur(${pose.blur}px)`;
    if (pose.reveal < 1 && l.motion.in !== "typewriter" && l.motion.out !== "typewriter") {
      // wipe: clip to the revealed part
      const r = pose.reveal;
      ctx.beginPath();
      if (pose.revealDir === "right") ctx.rect(-w / 2 - 4, -h / 2 - 4, (w + 8) * r, h + 8);
      else if (pose.revealDir === "left") ctx.rect(w / 2 + 4 - (w + 8) * r, -h / 2 - 4, (w + 8) * r, h + 8);
      else if (pose.revealDir === "down") ctx.rect(-w / 2 - 4, -h / 2 - 4, w + 8, (h + 8) * r);
      else ctx.rect(-w / 2 - 4, h / 2 + 4 - (h + 8) * r, w + 8, (h + 8) * r);
      ctx.clip();
    }
    drawLayerBody(ctx, l, w, h, H, t, { ...pose, reveal: l.motion.in === "typewriter" || l.motion.out === "typewriter" ? pose.reveal : 1 }, env);
    ctx.restore();
  }
}

/** Bounding box (px) of a layer at rest, for selection handles. */
export function layerBox(l: Layer, W: number, H: number) {
  const w = (W * l.w) / 100;
  const h = (H * l.h) / 100;
  return { x: (W * l.x) / 100 - w / 2, y: (H * l.y) / 100 - h / 2, w, h };
}

/* ---------- ready-made layers ---------- */

export interface LayerTemplate {
  id: string;
  label: string;
  group: "Text" | "Titles" | "Shapes" | "Animated" | "Info";
  make: (at: number, frameAspect: number) => Omit<Layer, "id" | "z">;
}

const base = (kind: LayerKind, name: string, at: number, len: number, rest: Partial<Layer>): Omit<Layer, "id" | "z"> => ({
  kind, name, start: at, end: at + len, x: 50, y: 50, w: 60, h: 10, rotation: 0, opacity: 1,
  motion: { ...DEFAULT_MOTION }, ...rest,
});

export const LAYER_TEMPLATES: LayerTemplate[] = [
  { id: "text", label: "Text", group: "Text", make: (at) => base("text", "Text", at, 4, { text: "તમારું લખાણ", size: 5, w: 70, h: 12, color: "#FFFFFF", motion: { ...DEFAULT_MOTION, in: "pop", easing: "back" } }) },
  { id: "headline", label: "Headline", group: "Text", make: (at) => base("text", "Headline", at, 4, { text: "BIG NEWS", size: 8, w: 80, h: 14, y: 22, color: "#D6FF36", weight: 800, motion: { ...DEFAULT_MOTION, in: "slide", direction: "up", easing: "back" } }) },
  { id: "label", label: "Label on a box", group: "Text", make: (at) => base("text", "Label", at, 4, { text: "Limited offer", size: 4, w: 48, h: 8, y: 30, color: "#FFFFFF", background: "#EE422C", motion: { ...DEFAULT_MOTION, in: "pop", easing: "back" } }) },
  { id: "typewriter", label: "Typewriter text", group: "Text", make: (at) => base("text", "Typewriter", at, 5, { text: "આજે શીખીએ…", size: 5, w: 80, h: 12, y: 25, color: "#FFFFFF", motion: { ...DEFAULT_MOTION, in: "typewriter", duration: 1.2, easing: "linear" } }) },
  { id: "lower", label: "Lower third", group: "Titles", make: (at, a) => base("lowerThird", "Lower third", at, 5, { text: "Harsh Prajapati", subtitle: "Creator · Ahmedabad", size: 3.4, x: a < 1 ? 50 : 30, y: 78, w: a < 1 ? 80 : 44, h: a < 1 ? 9 : 14, accent: "#D6FF36", motion: { ...DEFAULT_MOTION, in: "slide", out: "slide", direction: "right", duration: 0.5 } }) },
  { id: "title", label: "Title card", group: "Titles", make: (at) => base("titleCard", "Title card", at, 3, { text: "Episode 1", subtitle: "Gujarati recipes", size: 7, w: 84, h: 30, color: "#FFFFFF", accent: "#D6FF36", background: "rgba(11,16,32,0.72)", motion: { ...DEFAULT_MOTION, in: "zoom", out: "fade", duration: 0.5 } }) },
  { id: "callout", label: "Callout bubble", group: "Titles", make: (at) => base("callout", "Callout", at, 3, { text: "Wow! 😮", size: 4, x: 65, y: 30, w: 40, h: 14, background: "#FFFFFF", color: "#111111", motion: { ...DEFAULT_MOTION, in: "pop", easing: "back" } }) },
  { id: "speaker", label: "Speaker label", group: "Info", make: (at) => base("speakerLabel", "Speaker label", at, 4, { text: "", speaker: "speaker_0", size: 3, x: 50, y: 12, w: 40, h: 6, motion: { ...DEFAULT_MOTION, in: "slide", direction: "down" } }) },
  { id: "progress", label: "Progress bar", group: "Info", make: (at) => base("progress", "Progress bar", 0, 3600, { x: 50, y: 98, w: 100, h: 0.8, color: "#D6FF36", background: "rgba(255,255,255,0.25)", motion: { ...DEFAULT_MOTION, in: "none", out: "none" } }) },
  { id: "rect", label: "Box", group: "Shapes", make: (at) => base("shape", "Box", at, 4, { shape: "rect", w: 30, h: 12, color: "#D6FF36", motion: { ...DEFAULT_MOTION, in: "wipe", direction: "right" } }) },
  { id: "circle", label: "Circle", group: "Shapes", make: (at, a) => base("shape", "Circle", at, 4, { shape: "circle", w: 20, h: 20 * a, color: "#FF3B30", stroke: 3, background: undefined, motion: { ...DEFAULT_MOTION, in: "pop", easing: "back" } }) },
  { id: "arrow", label: "Arrow", group: "Shapes", make: (at) => base("shape", "Arrow", at, 3, { shape: "arrow", w: 30, h: 6, x: 40, y: 40, color: "#D6FF36", rotation: 20, motion: { ...DEFAULT_MOTION, in: "slide", direction: "right", loop: "float" } }) },
  { id: "star", label: "Star", group: "Shapes", make: (at, a) => base("shape", "Star", at, 3, { shape: "star", w: 14, h: 14 * a, x: 80, y: 20, color: "#D6FF36", motion: { ...DEFAULT_MOTION, in: "spin", loop: "pulse" } }) },
  { id: "burst", label: "Burst badge", group: "Shapes", make: (at, a) => base("shape", "Burst", at, 3, { shape: "burst", w: 22, h: 22 * a, x: 78, y: 22, color: "#EE422C", motion: { ...DEFAULT_MOTION, in: "pop", easing: "back", loop: "spin" } }) },
  { id: "pulse", label: "Pulse rings", group: "Animated", make: (at, a) => base("shape", "Pulse", at, 4, { shape: "pulse", w: 24, h: 24 * a, x: 50, y: 40, color: "#22D3EE", motion: { ...DEFAULT_MOTION, in: "fade" } }) },
  { id: "sparkle", label: "Sparkles", group: "Animated", make: (at, a) => base("shape", "Sparkles", at, 4, { shape: "sparkle", w: 40, h: 40 * a, x: 50, y: 30, color: "#D6FF36", motion: { ...DEFAULT_MOTION, in: "fade" } }) },
  { id: "underline", label: "Underline sweep", group: "Animated", make: (at) => base("shape", "Underline", at, 3, { shape: "underline", w: 50, h: 1.2, x: 50, y: 62, color: "#D6FF36", motion: { ...DEFAULT_MOTION, in: "none" } }) },
  { id: "sticker", label: "Emoji sticker", group: "Animated", make: (at) => base("sticker", "Sticker", at, 3, { text: "🔥", size: 10, w: 18, h: 10, x: 78, y: 30, motion: { ...DEFAULT_MOTION, in: "pop", easing: "spring", loop: "float" } }) },
];

export function makeLayer(templateId: string, at: number, frameAspect: number, z: number): Layer {
  const t = LAYER_TEMPLATES.find((x) => x.id === templateId) ?? LAYER_TEMPLATES[0];
  return { ...t.make(at, frameAspect), id: uid("L"), z };
}
