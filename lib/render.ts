import { entrance, exitFactor, LETTER_STAGGER, REST, splitClusters, wordPop, type Pose } from "./animation";
import { LINGER, lineAt, shownWords, wordState, type WordState } from "./grouping";
import { FALLBACK_FONTS, fallbackChain, injectFont, nearestWeight } from "./fonts";
import { displayWord } from "./translit";
import { translationFor } from "./bilingual";
import type { CaptionLine, CaptionStyle, LineOverride, Overrides, Translations, Word } from "./types";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Placed {
  word: Word;
  text: string;
  /** Index within the visible caption. */
  index: number;
  x: number; // left edge
  y: number; // vertical centre of the row
  /** Total width (text + emoji). */
  w: number;
  /** Text width only. */
  tw: number;
  emoji?: string;
  /** Row inside the caption (0 = first). */
  row: number;
  /** Font size of this word in px (rows and accents can change it). */
  fpx: number;
  /** Canvas font string for this word. */
  font: string;
}

const isLatin = (s: string) => /[A-Za-z]/.test(s);

const FALLBACKS = fallbackChain().map((f) => `"${f}"`).join(", ");
const ALL_FALLBACKS = Object.values(FALLBACK_FONTS).map((f) => f!.family).filter((f, i, a) => a.indexOf(f) === i).map((f) => `"${f}"`).join(", ");

/**
 * Canvas font: the chosen face, then a Noto face for every other script, then emoji.
 * The same string is used for preview and export, so both pick the same glyphs.
 */
export function fontString(style: Pick<CaptionStyle, "font" | "weight"> & { italic?: boolean }, px: number): string {
  const w = nearestWeight(style.font, style.weight);
  return `${style.italic ? "italic " : ""}${w} ${px}px "${style.font}", ${ALL_FALLBACKS || FALLBACKS}, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
}

function setLetterSpacing(ctx: Ctx, px: number) {
  // Canvas letterSpacing is supported in Chromium/Safari; ignore elsewhere.
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

interface Look { font: string; weight: number; italic: boolean; mul: number; kase?: "upper" | "lower" }

/** Font, size and case of one word: the caption's own, changed by its row and by the accent (★ words). */
function lookFor(style: CaptionStyle, word: Word, row: number): Look {
  const r = style.rows?.[row];
  const a = word.emphasis ? style.accent : undefined;
  return {
    font: a?.font ?? r?.font ?? style.font,
    weight: a?.weight ?? r?.weight ?? style.weight,
    italic: a?.italic ?? r?.italic ?? false,
    mul: (r?.sizeMul ?? 1) * (a?.sizeMul ?? 1),
    kase: a?.case ?? r?.case,
  };
}

function caseText(text: string, style: CaptionStyle, look: Look): string {
  if (look.kase === "upper") return text.toUpperCase();
  if (look.kase === "lower") return text.toLowerCase();
  return style.uppercase && isLatin(text) ? text.toUpperCase() : text;
}

function layout(ctx: Ctx, words: Word[], style: CaptionStyle, W: number, H: number, px: number): { placed: Placed[]; rows: number; box: { x: number; y: number; w: number; h: number } } {
  // leave room for the outline, chips and the active word's pop so neighbours never touch
  const gap = px * (style.wordGap + (style.stroke?.width ?? 0) * 2 + Math.max(0, (style.active.scale ?? 1) - 1) * 1.5 + (style.chips ? style.chips.padX * 2 : 0));
  const maxW = (W * style.maxWidthPct) / 100;
  const emojiGap = px * 0.15;
  const baseFont = ctx.font;
  const simple = !style.accent && !style.rows?.length;
  const measure = (word: Word, row: number) => {
    const look = lookFor(style, word, row);
    const fpx = px * look.mul;
    const font = simple ? baseFont : fontString({ font: look.font, weight: look.weight, italic: look.italic }, fpx);
    if (!simple) ctx.font = font;
    const text = caseText(displayWord(word, style.script), style, look);
    const tw = ctx.measureText(text).width;
    if (!simple) ctx.font = baseFont;
    const ew = word.emoji ? ctx.measureText(word.emoji).width + emojiGap : 0;
    return { text, tw, w: tw + ew, fpx, font };
  };
  const items = words.map((word, index) => ({ word, index, emoji: word.emoji, ...measure(word, 0) }));

  const rows: (typeof items)[] = [];
  let row: typeof items = [];
  let rowW = 0;
  for (const it of items) {
    const add = row.length ? gap + it.w : it.w;
    const split = !!style.rowSplit && rows.length === 0 && row.length === style.rowSplit;
    if (row.length && (rowW + add > maxW || it.word.lineBreak || split)) {
      rows.push(row);
      row = [];
      rowW = 0;
    }
    rowW += row.length ? gap + it.w : it.w;
    row.push(it);
  }
  if (row.length) rows.push(row);
  // rows can have their own size and font: measure again now that each word knows its row
  if (style.rows?.length) rows.forEach((r, ri) => { if (ri > 0 || style.rows![0]) r.forEach((it, i) => { r[i] = { ...it, ...measure(it.word, ri) }; }); });

  const rowHs = rows.map((r) => Math.max(...r.map((it) => it.fpx)) * style.lineHeight);
  const totalH = rowHs.reduce((a, b) => a + b, 0);
  let cy = (H * style.posY) / 100;
  const margin = px * 0.6;
  cy = Math.min(Math.max(cy, totalH / 2 + margin), H - totalH / 2 - margin);
  const top = cy - totalH / 2;

  const placed: Placed[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  const cx0 = (W * (style.posX ?? 50)) / 100;
  let yAcc = top;
  rows.forEach((r, ri) => {
    const rw = r.reduce((s, it, i) => s + it.w + (i ? gap : 0), 0);
    const left = style.align === "left" ? cx0 - maxW / 2 : style.align === "right" ? cx0 + maxW / 2 - rw : cx0 - rw / 2;
    let x = left;
    const y = yAcc + rowHs[ri] / 2;
    yAcc += rowHs[ri];
    for (const it of r) {
      placed.push({ ...it, x, y, row: ri });
      x += it.w + gap;
    }
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, left + rw);
  });
  // keep the whole caption inside the frame horizontally
  let shift = 0;
  if (minX < margin) shift = margin - minX;
  else if (maxX > W - margin) shift = W - margin - maxX;
  if (shift) for (const p of placed) p.x += shift;
  return { placed, rows: rows.length, box: { x: minX + shift, y: top, w: maxX - minX, h: totalH } };
}

type Rect = { x: number; y: number; w: number; h: number };

/** Where the background box(es) go. "caption" keeps the original single box around the whole caption. */
function plateRects(placed: Placed[], box: Rect, style: CaptionStyle, W: number, px: number): Rect[] {
  const p = style.plate!;
  const padX = px * p.padX;
  const padY = px * p.padY;
  if (p.fit === "line") {
    const rows = new Map<number, { x0: number; x1: number; y: number; fpx: number }>();
    for (const pl of placed) {
      const r = rows.get(pl.row);
      if (r) { r.x0 = Math.min(r.x0, pl.x); r.x1 = Math.max(r.x1, pl.x + pl.w); r.fpx = Math.max(r.fpx, pl.fpx); }
      else rows.set(pl.row, { x0: pl.x, x1: pl.x + pl.w, y: pl.y, fpx: pl.fpx });
    }
    // half the height of a line of text
    return [...rows.values()].map((r) => ({ x: r.x0 - padX, y: r.y - r.fpx * 0.6 - padY, w: r.x1 - r.x0 + padX * 2, h: r.fpx * 1.2 + padY * 2 }));
  }
  if (p.fit === "full") {
    const maxW = (W * style.maxWidthPct) / 100;
    const cx = (W * (style.posX ?? 50)) / 100;
    const x = Math.max(0, cx - maxW / 2 - padX);
    const x1 = Math.min(W, cx + maxW / 2 + padX);
    return [{ x, y: box.y - padY, w: x1 - x, h: box.h + padY * 2 }];
  }
  const one = [{ x: box.x - padX, y: box.y - padY, w: box.w + padX * 2, h: box.h + padY * 2 }];
  if (p.header) { const hh = px * 1.15; one[0].y -= hh; one[0].h += hh; one[0].w = Math.max(one[0].w, px * 6); one[0].x = Math.min(one[0].x, box.x + box.w / 2 - one[0].w / 2); }
  return one;
}

/** Speech-bubble tail along the bottom edge of a box. */
function tailPath(ctx: Ctx, b: Rect, r: number, side: "left" | "center" | "right", px: number) {
  const tw = px * 0.55;
  const x0 = side === "left" ? b.x + r + px * 0.2 : side === "right" ? b.x + b.w - r - px * 0.2 - tw : b.x + b.w / 2 - tw / 2;
  const tipX = side === "left" ? x0 - px * 0.12 : side === "right" ? x0 + tw + px * 0.12 : x0 + tw / 2;
  const y = b.y + b.h;
  ctx.beginPath();
  ctx.moveTo(x0, y - 1);
  ctx.lineTo(tipX, y + px * 0.42);
  ctx.lineTo(x0 + tw, y - 1);
  return { x0, tw, tipX, y };
}

/** Icon, title and time along the top of a notification-style box. */
function drawHeader(ctx: Ctx, b: Rect, h: NonNullable<CaptionStyle["plate"]>["header"] & object, px: number, textColor: string) {
  const s = px * 0.78;
  const x = b.x + px * 0.38;
  const y = b.y + px * 0.3;
  ctx.save();
  ctx.fillStyle = h.iconColor;
  ctx.beginPath();
  ctx.roundRect(x, y, s, s, s * 0.26);
  ctx.fill();
  // a small chat glyph inside the icon
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.roundRect(x + s * 0.22, y + s * 0.26, s * 0.56, s * 0.38, s * 0.1);
  ctx.moveTo(x + s * 0.32, y + s * 0.6);
  ctx.lineTo(x + s * 0.3, y + s * 0.78);
  ctx.lineTo(x + s * 0.48, y + s * 0.62);
  ctx.fill();
  ctx.textBaseline = "middle";
  ctx.font = fontString({ font: "Anek Gujarati", weight: 700 }, px * 0.5);
  ctx.fillStyle = h.color ?? textColor;
  ctx.textAlign = "left";
  ctx.fillText(h.title, x + s + px * 0.24, y + s / 2);
  if (h.meta) {
    ctx.globalAlpha *= 0.55;
    ctx.font = fontString({ font: "Anek Gujarati", weight: 500 }, px * 0.44);
    ctx.textAlign = "right";
    ctx.fillText(h.meta, b.x + b.w - px * 0.38, y + s / 2);
  }
  ctx.restore();
}

function fillFor(style: CaptionStyle, state: WordState, word: Word): string | undefined {
  if (word.emphasis) return style.accent?.fill ?? style.emphasisFill;
  if (state === "active") return style.active.fill;
  if (state === "spoken") return style.spokenFill;
  return style.upcomingFill;
}

function paintText(ctx: Ctx, text: string, x: number, px: number, style: CaptionStyle, fill: string | CanvasGradient, glow?: string) {
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  const sh = style.shadow;
  const applyShadow = () => {
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = px * 0.5;
      ctx.shadowOffsetY = 0;
    } else if (sh) {
      ctx.shadowColor = sh.color;
      ctx.shadowBlur = px * sh.blur;
      ctx.shadowOffsetY = px * sh.offsetY;
    }
  };
  const clearShadow = () => {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  };
  if (style.extrude && style.extrude.depth > 0) {
    // stacked copies, one pixel apart, read as solid 3D depth
    const steps = Math.max(2, Math.round(style.extrude.depth * px));
    const a = ((style.extrude.angle ?? 45) * Math.PI) / 180;
    ctx.fillStyle = style.extrude.color;
    ctx.strokeStyle = style.extrude.color;
    ctx.lineWidth = style.stroke && style.stroke.width > 0 ? px * style.stroke.width * 2 : 0;
    for (let i = steps; i >= 1; i--) {
      const dx = Math.cos(a) * i;
      const dy = Math.sin(a) * i;
      if (ctx.lineWidth) ctx.strokeText(text, x + dx, dy);
      ctx.fillText(text, x + dx, dy);
    }
  }
  if (style.echo && style.echo.count > 0) {
    const base = ctx.globalAlpha;
    ctx.strokeStyle = style.echo.color;
    ctx.lineWidth = Math.max(1, px * 0.035);
    for (let i = style.echo.count; i >= 1; i--) {
      ctx.globalAlpha = base * (1 - (i / (style.echo.count + 1)) * 0.7);
      ctx.strokeText(text, x + i * style.echo.spacing * px, i * style.echo.spacing * px);
    }
    ctx.globalAlpha = base;
  }
  if (style.stroke && style.stroke.width > 0) {
    applyShadow();
    ctx.strokeStyle = style.stroke.color;
    ctx.lineWidth = px * style.stroke.width * 2;
    ctx.strokeText(text, x, 0);
    clearShadow();
    if (glow) applyShadow();
    ctx.fillStyle = fill;
    ctx.fillText(text, x, 0);
    clearShadow();
  } else {
    applyShadow();
    ctx.fillStyle = fill;
    ctx.fillText(text, x, 0);
    clearShadow();
  }
}

/** Outline-only text, for words not yet spoken. */
function paintHollow(ctx: Ctx, text: string, x: number, px: number, color: string) {
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, px * 0.045);
  ctx.strokeText(text, x, 0);
}

function roundBox(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string | undefined, border?: { color: string; width: number }, px = 0) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill && fill !== "transparent") { ctx.fillStyle = fill; ctx.fill(); }
  if (border && border.width > 0) { ctx.lineWidth = px * border.width; ctx.strokeStyle = border.color; ctx.stroke(); }
}

const requested = new Set<string>();
/**
 * Canvas text never triggers a font download, so ask for the accent and row faces
 * (italic included) the first time they are drawn; the editor redraws when they arrive.
 */
function requestExtraFonts(style: CaptionStyle, px: number) {
  const faces: { font: string; weight: number; italic?: boolean }[] = [];
  if (style.accent && (style.accent.font || style.accent.italic)) faces.push({ font: style.accent.font ?? style.font, weight: style.accent.weight ?? style.weight, italic: style.accent.italic });
  for (const r of style.rows ?? []) if (r.font || r.italic) faces.push({ font: r.font ?? style.font, weight: r.weight ?? style.weight, italic: r.italic });
  for (const f of faces) {
    const spec = fontString(f, Math.round(px));
    const key = `${f.font}|${f.weight}|${f.italic ? 1 : 0}`;
    if (requested.has(key)) continue;
    requested.add(key);
    injectFont(f.font);
    void document.fonts?.load(spec, "Aa અ अ").catch(() => requested.delete(key));
  }
}

/** Stable 0–1 number for a string (same word → same wobble, frame after frame). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

type Pt = [number, number];

/** Points of a hand-drawn mark around a word centred at 0 (w wide, font size fpx). */
function markPoints(kind: NonNullable<CaptionStyle["mark"]>["kind"], w: number, fpx: number, seed: string): Pt[] {
  const r = (n: number) => hash01(seed + n) - 0.5;
  const pts: Pt[] = [];
  const half = w / 2;
  if (kind === "circle") {
    // a loose loop that goes a little past where it started, like a pen circle
    const rx = half + fpx * 0.32, ry = fpx * 0.78;
    const a0 = -2.7 + r(1) * 0.4;
    const turns = 1.12;
    for (let i = 0; i <= 64; i++) {
      const a = a0 + (i / 64) * Math.PI * 2 * turns;
      const k = 1 + 0.06 * Math.sin(i * 0.35 + r(2) * 6) + (i / 64) * 0.08;
      pts.push([Math.cos(a) * rx * k + r(3) * fpx * 0.1, Math.sin(a) * ry * k - fpx * 0.02]);
    }
  } else if (kind === "underline") {
    const y = fpx * 0.6;
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      pts.push([-half - fpx * 0.12 + u * (w + fpx * 0.3), y + Math.sin(u * Math.PI) * fpx * 0.06 - u * u * fpx * 0.14 + r(4) * fpx * 0.03]);
    }
  } else if (kind === "scribble") {
    // three quick zig-zag passes under the word
    const y = fpx * 0.6;
    const n = Math.max(6, Math.round(w / (fpx * 0.45)));
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i <= n; i++) {
        const u = pass % 2 ? 1 - i / n : i / n;
        pts.push([-half - fpx * 0.08 + u * (w + fpx * 0.16), y + (i % 2 ? fpx * 0.14 : -fpx * 0.02) + pass * fpx * 0.07 + r(10 + pass) * fpx * 0.03]);
      }
    }
  } else if (kind === "highlight") {
    const y = fpx * 0.12;
    for (let i = 0; i <= 16; i++) {
      const u = i / 16;
      pts.push([-half - fpx * 0.14 + u * (w + fpx * 0.28), y + Math.sin(u * 5 + r(5) * 3) * fpx * 0.03 - u * fpx * 0.05]);
    }
  } else {
    // box: four strokes with a little overshoot at the corners
    const x0 = -half - fpx * 0.22, x1 = half + fpx * 0.22, y0 = -fpx * 0.74, y1 = fpx * 0.72;
    const o = fpx * 0.08;
    const seg = (a: Pt, b: Pt) => { for (let i = 0; i <= 10; i++) { const u = i / 10; pts.push([a[0] + (b[0] - a[0]) * u + r(20 + i) * fpx * 0.02, a[1] + (b[1] - a[1]) * u + r(30 + i) * fpx * 0.02]); } };
    seg([x0 - o, y0 + r(6) * o], [x1 + o, y0]);
    seg([x1, y0 - o], [x1 + r(7) * o, y1 + o]);
    seg([x1 + o, y1], [x0 - o, y1 + r(8) * o]);
    seg([x0, y1 + o], [x0 + r(9) * o, y0 - o]);
  }
  return pts;
}

/** Draw the first `k` (0–1) of a polyline, so the mark looks drawn on. */
function strokePartial(ctx: Ctx, pts: Pt[], k: number) {
  if (k <= 0 || pts.length < 2) return;
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const stop = lens[lens.length - 1] * Math.min(1, k);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    if (lens[i] <= stop) { ctx.lineTo(pts[i][0], pts[i][1]); continue; }
    const u = (stop - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]);
    ctx.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u);
    break;
  }
  ctx.stroke();
}

const isLight = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return true;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6;
};

const easeOut3 = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

function combine(a: Pose, b: Pose): Pose {
  return { opacity: a.opacity * b.opacity, scale: a.scale * b.scale, dx: a.dx + b.dx, dy: a.dy + b.dy, blur: a.blur + b.blur, rot: a.rot + b.rot };
}

/**
 * Draw the caption that is visible at time `t` onto a canvas of size W×H.
 * Used for both the live preview and the MP4 export.
 */
export interface CaptionBox { x: number; y: number; w: number; h: number; key: string }

export function styleWithOverride(style: CaptionStyle, ov?: LineOverride): CaptionStyle {
  if (!ov) return style;
  return {
    ...style,
    posX: ov.posX ?? style.posX,
    posY: ov.posY ?? style.posY,
    sizeVh: ov.sizeVh ?? style.sizeVh,
    font: ov.font ?? style.font,
    fill: ov.fill ?? style.fill,
    gradient: ov.fill ? undefined : style.gradient,
    active: ov.activeFill ? { ...style.active, fill: ov.activeFill } : style.active,
  };
}

/** Returns the caption's bounding box in canvas pixels (null if nothing is shown). */
export interface CaptionExtras {
  speakers?: Record<string, { name: string; color: string }>;
}

export function drawCaptions(ctx: Ctx, W: number, H: number, lines: CaptionLine[], t: number, baseStyle: CaptionStyle, overrides?: Overrides, translations?: Translations, extras?: CaptionExtras): CaptionBox | null {
  const li = lineAt(lines, t);
  if (li < 0) return null;
  const line = lines[li];
  const ov = overrides?.[line.key];
  if (ov?.hidden) return null;
  const style = styleWithOverride(baseStyle, ov);
  const words = shownWords(line.words, t, style.reveal);
  if (!words.length) return null;

  const px = (H * style.sizeVh) / 100;
  if (typeof document !== "undefined") requestExtraFonts(style, px);
  ctx.save();
  ctx.font = fontString(style, px);
  setLetterSpacing(ctx, px * style.letterSpacing);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const { placed, box } = layout(ctx, words, style, W, H, px);
  const perWord = style.reveal === "build" || style.reveal === "solo";
  const letters = style.enter === "letters" || style.enter === "typewriter";
  const eo = { easing: style.easing, direction: style.direction, delay: style.enterDelay };
  const enterPose = perWord || letters ? REST : entrance(style.enter, t - line.start, style.speed, eo);
  // leaving into a pause: ease out instead of vanishing (a caption that is
  // replaced straight away just hands over to the next one's entrance)
  const next = lines[li + 1];
  const visibleEnd = line.end + (next ? Math.min(LINGER, Math.max(0, next.start - line.end)) : LINGER);
  const exitK = next && next.start - visibleEnd < 0.01 ? 1 : exitFactor(t, visibleEnd);
  const linePose = exitK < 1 ? { ...enterPose, opacity: enterPose.opacity * exitK, scale: enterPose.scale * (0.97 + 0.03 * exitK) } : enterPose;

  // background plate behind the caption (one box, one per line, or full width)
  const plates = style.plate ? plateRects(placed, box, style, W, px) : [];
  if (style.plate) {
    const p = style.plate;
    ctx.save();
    ctx.globalAlpha = linePose.opacity;
    if (p.moveWithText && (linePose.scale !== 1 || linePose.dx || linePose.dy || linePose.rot)) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      ctx.translate(cx + linePose.dx * px, cy + linePose.dy * px);
      ctx.scale(linePose.scale, linePose.scale);
      if (linePose.rot) ctx.rotate((linePose.rot * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
    const r = px * p.radius;
    if (p.shadow && (p.shadow.x || p.shadow.y)) {
      ctx.fillStyle = p.shadow.color;
      for (const b of plates) { ctx.beginPath(); ctx.roundRect(b.x + px * p.shadow.x, b.y + px * p.shadow.y, b.w, b.h, r); ctx.fill(); }
    }
    plates.forEach((b, i) => {
      let fill: string | CanvasGradient = p.color;
      if (p.gradient) {
        const g = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
        g.addColorStop(0, p.gradient[0]);
        g.addColorStop(1, p.gradient[1]);
        fill = g;
      }
      const hasTail = !!p.tail && i === plates.length - 1;
      if (hasTail && p.shadow && (p.shadow.x || p.shadow.y)) {
        ctx.save(); ctx.translate(px * p.shadow.x, px * p.shadow.y); tailPath(ctx, b, r, p.tail!, px); ctx.fillStyle = p.shadow.color; ctx.fill(); ctx.restore();
      }
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, r);
      ctx.fillStyle = fill;
      ctx.fill();
      if (p.border && p.border.width > 0) {
        ctx.lineWidth = px * p.border.width;
        ctx.strokeStyle = p.border.color;
        ctx.stroke();
      }
      if (hasTail) {
        const tp = tailPath(ctx, b, r, p.tail!, px);
        ctx.fillStyle = fill;
        ctx.fill();
        if (p.border && p.border.width > 0) {
          // only the two slanted edges, so the tail joins the box without a seam
          ctx.beginPath();
          ctx.moveTo(tp.x0, tp.y);
          ctx.lineTo(tp.tipX, tp.y + px * 0.42);
          ctx.lineTo(tp.x0 + tp.tw, tp.y);
          ctx.lineWidth = px * p.border.width;
          ctx.strokeStyle = p.border.color;
          ctx.lineJoin = "round";
          ctx.stroke();
        }
      }
      if (p.header && i === 0) drawHeader(ctx, b, p.header, px, style.fill);
    });
    ctx.restore();
  }

  // active-word box that glides from the previous word to the spoken one
  const slide = !!(style.active.box && style.active.boxSlide);
  if (slide) {
    const ai = placed.findIndex((pl) => wordState(pl.word, t) === "active");
    if (ai >= 0) {
      const cur = placed[ai];
      const prev = ai > 0 && placed[ai - 1].row === cur.row ? placed[ai - 1] : undefined;
      const k = prev ? easeOut3((t - cur.word.start) / (0.16 / style.speed)) : 1;
      const from = prev ?? cur;
      const x = from.x + (cur.x - from.x) * k;
      const w = from.w + (cur.w - from.w) * k;
      const bx = px * (style.active.boxPadX ?? 0.15);
      const by = px * (style.active.boxPadY ?? 0.05);
      const fpx = cur.fpx;
      ctx.save();
      ctx.globalAlpha = linePose.opacity;
      roundBox(ctx, x - bx + linePose.dx * px, cur.y - fpx * 0.62 - by + linePose.dy * px, w + bx * 2, fpx * 1.24 + by * 2, px * (style.active.boxRadius ?? 0.2), style.active.box, style.active.boxBorder, px);
      ctx.restore();
    }
  }

  // global letter index, for cascades across the whole caption
  let letterBase = 0;

  for (const pl of placed) {
    const { word } = pl;
    const state = wordState(word, t);
    let pose = linePose;
    if (perWord && !letters) {
      const wp = entrance(style.enter, t - word.start, style.speed, eo);
      pose = exitK < 1 ? { ...wp, opacity: wp.opacity * exitK, scale: wp.scale * (0.97 + 0.03 * exitK) } : wp;
    }

    // spoken-word pop
    const extra = (style.active.scale ?? 1) - 1;
    let k = 0;
    if (extra !== 0 && state !== "upcoming") k = wordPop(t, word.start, word.end);
    const wordScale = 1 + extra * k;

    let opacity = pose.opacity;
    if (state === "upcoming" && (style.reveal === "chunk" || style.reveal === "karaoke")) opacity *= style.upcomingOpacity;
    if (opacity <= 0.001) {
      letterBase += splitClusters(pl.text).length;
      continue;
    }

    const cx = pl.x + pl.w / 2 + pose.dx * px;
    const cy = pl.y + pose.dy * px;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(cx, cy);
    ctx.scale(pose.scale * wordScale, pose.scale * wordScale);
    if (pose.rot) ctx.rotate((pose.rot * Math.PI) / 180);
    if (pose.blur > 0) ctx.filter = `blur(${pose.blur * px}px)`;

    const half = pl.w / 2;
    const isActive = state === "active";
    const fpx = pl.fpx;
    const acc = word.emphasis ? style.accent : undefined;
    if (pl.font !== ctx.font) ctx.font = pl.font;
    if (acc?.yOffset) ctx.translate(0, acc.yOffset * fpx);

    // chip behind every word (alternating tilt for a sticker feel)
    if (style.chips) {
      const c = style.chips;
      if (c.tilt) ctx.rotate(((pl.index % 2 ? -1 : 1) * c.tilt * Math.PI) / 180);
      roundBox(ctx, -half - px * c.padX, -fpx * 0.62 - px * c.padY, pl.w + px * c.padX * 2, fpx * 1.24 + px * c.padY * 2, px * c.radius, isActive && c.activeColor ? c.activeColor : c.color, c.border, px);
    }

    // highlight box behind the active word
    if (isActive && style.active.box && !slide) {
      const bx = px * (style.active.boxPadX ?? 0.15);
      const by = px * (style.active.boxPadY ?? 0.05);
      roundBox(ctx, -half - bx, -fpx * 0.62 - by, pl.w + bx * 2, fpx * 1.24 + by * 2, px * (style.active.boxRadius ?? 0.2), style.active.box, style.active.boxBorder, px);
    }

    const rowFill = style.rows?.[pl.row]?.fill;
    let base: string | CanvasGradient = rowFill ?? style.fill;
    const grad = acc?.gradient ?? (rowFill ? undefined : style.gradient);
    if (grad) {
      const g = ctx.createLinearGradient(0, -fpx * 0.55, 0, fpx * 0.55);
      g.addColorStop(0, grad[0]);
      g.addColorStop(1, grad[1]);
      base = g;
    }
    // the accent can drop or change the caption's outline and shadow
    const ws: CaptionStyle = acc
      ? { ...style, stroke: acc.stroke === undefined ? style.stroke : acc.stroke ?? undefined, shadow: acc.shadow === undefined ? style.shadow : acc.shadow ?? undefined }
      : style;
    const hollow = !!style.upcomingHollow && state === "upcoming" && !word.emphasis && (style.reveal === "chunk" || style.reveal === "karaoke");
    // hand-drawn mark: drawn on over ~0.35 s from when the word is spoken
    const mk = style.mark;
    const marked = !!mk && ((mk.target ?? "emphasis") === "active" ? isActive : !!word.emphasis) && state !== "upcoming";
    const markK = marked ? easeOut3((t - word.start) / (0.35 / style.speed)) : 0;
    const drawMark = () => {
      if (!mk || markK <= 0) return;
      ctx.save();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = mk.color;
      ctx.lineCap = mk.kind === "highlight" ? "butt" : "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = mk.kind === "highlight" ? fpx * 0.95 : Math.max(1.5, fpx * mk.width);
      if (mk.kind === "highlight") ctx.globalAlpha *= 0.88;
      strokePartial(ctx, markPoints(mk.kind, pl.tw, fpx, word.id), markK);
      ctx.restore();
    };
    if (mk?.kind === "highlight") drawMark();
    const lb = style.letters;
    const ransom = !!lb && ((lb.target ?? "all") === "all" || !!word.emphasis);
    const hollowColor = rowFill ?? style.upcomingFill ?? style.fill;
    const spColor = style.speakerColors && word.speaker ? extras?.speakers?.[word.speaker]?.color : undefined;
    let stateFill = state === "active" || word.emphasis ? fillFor(style, state, word) : spColor ?? fillFor(style, state, word);
    // on a chip or box the spoken word must use the colour made for it, even when it is a ★ word
    if (isActive && word.emphasis && !acc?.fill && (style.chips?.activeColor || style.active.box) && style.active.fill) stateFill = style.active.fill;
    if (acc?.gradient && !acc.fill) stateFill = undefined;
    if (spColor && !stateFill) base = spColor;
    const glow = isActive ? style.active.glow ?? acc?.glow : acc?.glow;

    if (style.reveal === "karaoke" && !word.emphasis) {
      // upcoming colour underneath, active colour wiped in left→right
      const under = style.upcomingFill ?? base;
      const over = style.active.fill ?? style.spokenFill ?? "#FFD60A";
      const prog = state === "spoken" ? 1 : state === "upcoming" ? 0 : Math.min(1, (t - word.start) / Math.max(0.05, word.end - word.start));
      if (hollow && prog === 0) paintHollow(ctx, pl.text, -half, fpx, hollowColor);
      else paintText(ctx, pl.text, -half, fpx, ws, under, glow);
      if (prog > 0) {
        ctx.save();
        ctx.beginPath();
        const pad = fpx * 0.5; // covers outline overhang at the edges
        ctx.rect(-half - pad, -fpx * 2, pl.tw * prog + pad + (prog >= 1 ? pad : 0), fpx * 4);
        ctx.clip();
        paintText(ctx, pl.text, -half, fpx, { ...ws, shadow: undefined }, over);
        ctx.restore();
      }
    } else if (letters) {
      const parts = splitClusters(pl.text);
      const startAt = perWord ? word.start : line.start;
      const stagger = style.enter === "typewriter" ? LETTER_STAGGER * 1.4 : LETTER_STAGGER;
      const animKind = style.enter === "typewriter" ? "typewriter" : "letters";
      const fullyIn = t - startAt - ((perWord ? 0 : letterBase) + parts.length) * (stagger / style.speed) > 0.4;
      if (fullyIn) {
        paintText(ctx, pl.text, -half, fpx, ws, stateFill ?? base, glow);
      } else {
        let x = -half;
        parts.forEach((ch, i) => {
          const idx = (perWord ? 0 : letterBase) + i;
          const p = combine(pose, entrance(animKind, t - startAt - idx * (stagger / style.speed), style.speed));
          const w = ctx.measureText(ch).width;
          if (p.opacity > 0.001) {
            ctx.save();
            ctx.globalAlpha = opacity * p.opacity;
            ctx.translate(x + w / 2 + (p.dx - pose.dx) * px, (p.dy - pose.dy) * px);
            ctx.scale(p.scale, p.scale);
            if (p.rot - pose.rot) ctx.rotate(((p.rot - pose.rot) * Math.PI) / 180);
            paintText(ctx, ch, -w / 2, fpx, ws, stateFill ?? base, glow);
            ctx.restore();
          }
          x += w;
        });
      }
    } else if (ransom && lb) {
      // every letter on its own scrap: colour, tilt and height wobble picked per letter, stable across frames
      let x = -half;
      splitClusters(pl.text).forEach((ch, i) => {
        const w = ctx.measureText(ch).width;
        const r1 = hash01(`${word.id}:${i}:c`), r2 = hash01(`${word.id}:${i}:t`), r3 = hash01(`${word.id}:${i}:y`);
        const ci = Math.floor(r1 * lb.colors.length) % lb.colors.length;
        const bg = lb.colors[ci];
        const ink = lb.inks?.[ci] ?? (isLight(bg) ? "#080808" : "#FFFFFF");
        ctx.save();
        ctx.translate(x + w / 2, (r3 - 0.5) * fpx * 0.12);
        ctx.rotate(((r2 - 0.5) * 2 * lb.tilt * Math.PI) / 180);
        const pw = w * 0.86 + px * lb.padX * 2;
        roundBox(ctx, -pw / 2, -fpx * 0.6 - px * lb.padY, pw, fpx * 1.2 + px * lb.padY * 2, px * lb.radius, bg);
        ctx.fillStyle = isActive && style.active.fill ? style.active.fill : ink;
        ctx.textAlign = "center";
        ctx.fillText(ch, 0, 0);
        ctx.restore();
        x += w;
      });
    } else if (hollow) {
      paintHollow(ctx, pl.text, -half, fpx, hollowColor);
    } else {
      paintText(ctx, pl.text, -half, fpx, ws, stateFill ?? base, glow);
    }

    if (mk && mk.kind !== "highlight") drawMark();

    if (pl.emoji) {
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = px * 0.15;
      ctx.fillStyle = "#fff";
      ctx.font = fontString(style, px);
      ctx.fillText(pl.emoji, -half + pl.tw + px * 0.15, 0);
    }

    ctx.restore();
    letterBase += splitClusters(pl.text).length;
  }
  ctx.restore();
  let out: { x: number; y: number; w: number; h: number };
  if (style.plate && plates.length) {
    // union of the boxes, plus border and hard shadow
    const p = style.plate;
    const bw = p.border ? (px * p.border.width) / 2 : 0;
    const sx = p.shadow ? px * p.shadow.x : 0;
    const sy = p.shadow ? px * p.shadow.y : 0;
    const x0 = Math.min(...plates.map((b) => b.x)) - bw + Math.min(0, sx);
    const y0 = Math.min(...plates.map((b) => b.y)) - bw + Math.min(0, sy);
    const x1 = Math.max(...plates.map((b) => b.x + b.w)) + bw + Math.max(0, sx);
    const y1 = Math.max(...plates.map((b) => b.y + b.h)) + bw + Math.max(0, sy);
    out = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  } else {
    const padX = px * 0.15;
    const padY = px * 0.1;
    out = { x: box.x - padX, y: box.y - padY, w: box.w + padX * 2, h: box.h + padY * 2 };
  }

  // second line (translation), drawn smaller under (or above) the caption
  const sec = style.secondary;
  const tr = sec?.enabled ? translationFor(line, translations) : undefined;
  if (sec && tr?.text) {
    const b = drawSecondary(ctx, W, H, tr.text, style, px, out, linePose.opacity);
    if (b) {
      const x0 = Math.min(out.x, b.x);
      const y0 = Math.min(out.y, b.y);
      out = { x: x0, y: y0, w: Math.max(out.x + out.w, b.x + b.w) - x0, h: Math.max(out.y + out.h, b.y + b.h) - y0 };
    }
  }
  return { ...out, key: line.key };
}

/** Word-wrap `text` to `maxW`, measuring with the current font. */
function wrap(ctx: Ctx, text: string, maxW: number, maxRows = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > maxW) {
      rows.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) rows.push(cur);
  if (rows.length > maxRows) {
    const kept = rows.slice(0, maxRows);
    kept[maxRows - 1] = `${kept[maxRows - 1]}…`;
    return kept;
  }
  return rows;
}

function drawSecondary(ctx: Ctx, W: number, H: number, text: string, style: CaptionStyle, px: number, main: { x: number; y: number; w: number; h: number }, opacity: number) {
  const sec = style.secondary!;
  const spx = Math.max(6, px * sec.sizeRatio);
  const font = { font: sec.font ?? style.font, weight: sec.weight ?? Math.min(style.weight, 600) };
  ctx.save();
  ctx.font = fontString(font, spx);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const maxW = (W * style.maxWidthPct) / 100;
  const rows = wrap(ctx, text, maxW);
  const rowH = spx * 1.25;
  const blockH = rows.length * rowH;
  const gap = px * sec.gap;
  const margin = spx * 0.6;
  let top = sec.above ? main.y - gap - blockH : main.y + main.h + gap;
  // flip to the other side if it would leave the frame
  if (top + blockH > H - margin) top = main.y - gap - blockH;
  if (top < margin) top = Math.min(H - margin - blockH, main.y + main.h + gap);
  const cx = main.x + main.w / 2;
  const widths = rows.map((r) => ctx.measureText(r).width);
  const bw = Math.max(...widths);
  ctx.globalAlpha = opacity;
  if (sec.plate) {
    ctx.fillStyle = sec.plate;
    ctx.beginPath();
    ctx.roundRect(cx - bw / 2 - spx * 0.4, top - spx * 0.15, bw + spx * 0.8, blockH + spx * 0.3, spx * 0.3);
    ctx.fill();
  }
  rows.forEach((r, i) => {
    const y = top + rowH * i + rowH / 2;
    ctx.lineJoin = "round";
    if (style.stroke && style.stroke.width > 0 && !sec.plate) {
      ctx.strokeStyle = style.stroke.color;
      ctx.lineWidth = spx * Math.min(0.16, style.stroke.width * 2);
      ctx.strokeText(r, cx, y);
    } else if (!sec.plate) {
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = spx * 0.35;
    }
    ctx.fillStyle = sec.fill;
    ctx.fillText(r, cx, y);
    ctx.shadowColor = "transparent";
  });
  ctx.restore();
  return { x: cx - bw / 2, y: top, w: bw, h: blockH };
}
