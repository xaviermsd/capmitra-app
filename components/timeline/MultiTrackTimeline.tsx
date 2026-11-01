"use client";
/**
 * Multi-track timeline on the output clock:
 *
 *   ruler     click / drag to scrub
 *   video     clips, images and cards: select, drag edges to trim, drag to reorder;
 *             drop a video or image file to add it where it lands
 *   captions  drag to retime, drag an edge to change start/end
 *   graphics  one lane per overlapping layer: drag to move, edges to change in/out
 *   music     drag to change where the music starts
 *
 * Snaps to the playhead and to every edge (toggle with the magnet, or hold Alt).
 * Ctrl + scroll zooms; scroll pans when zoomed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, useTime } from "@/components/editor/EditorContext";
import { clipLength, mergeWithNext, moveClip, removeClip, speedOf, trimEdge, type Placed } from "@/lib/edl";
import { assetImage as imageFor } from "@/lib/layers";
import type { ImageClip, Layer, SoundClip } from "@/lib/project";
import { fxMeta, type FxClip } from "@/lib/effects/fx";
import { beatsOnTimeline } from "@/lib/effects/beats";
import { IconJoin, IconMagnet, IconScissors, IconTrash, IconPlus, IconUndo, IconRedo, IconTransition, IconFrame, IconWords, IconShapes, IconSparkle, IconVolume, IconMusic, IconCopy, IconEdit, IconSettings, IconEye, IconEyeOff, IconChevronLeft, IconChevronRight } from "@/components/Icons";
import { FX_DRAG_TYPE, findItem, transitionName, useApplyEffect } from "@/components/editor/panels/EffectsPanel";
import { CutSheet, joinTarget, splitHere } from "@/components/editor/QuickControls";

const RULER = 20;
const VIDEO_H = 46;
const CAP_H = 34;
const LANE_H = 24;
const MUSIC_H = 24;
const GAP = 4;
const LABEL_W = 0;
/** Room after the last clip for the "+" button and its tooltip, so the end never touches the screen edge. */
const END_PAD = 96;
/** Default scale: seconds don't stretch to fill the width; a short video stays short, a long one scrolls. */
const MIN_PPS = 28;
const MAX_PPS = 110;

type Hit =
  | { kind: "ruler" }
  | { kind: "clip"; it: Placed; edge: "start" | "end" | null }
  | { kind: "caption"; key: string; edge: "start" | "end" | null; start: number; end: number }
  | { kind: "layer"; l: Layer; edge: "start" | "end" | null }
  | { kind: "music"; edge: null }
  | { kind: "fx"; f: FxClip; edge: "start" | "end" | null }
  | { kind: "sound"; s: SoundClip; edge: null }
  | { kind: "empty" };

interface DragState {
  hit: Hit;
  x0: number;
  t0: number;
  moved: boolean;
  /** clip reorder: target index */
  dropIndex?: number;
  /** original values */
  orig?: { start: number; end: number };
  startClips?: import("@/lib/project").Clip[];
}

/** Put layers on lanes so overlapping ones don't collide. */
function laneLayers<T extends { id: string; start: number; end: number; z?: number }>(layers: T[]): { lanes: T[][]; laneOf: Map<string, number> } {
  const sorted = layers.slice().sort((a, b) => a.start - b.start || (b.z ?? 0) - (a.z ?? 0));
  const lanes: T[][] = [];
  const ends: number[] = [];
  const laneOf = new Map<string, number>();
  for (const l of sorted) {
    let i = ends.findIndex((e) => e <= l.start + 1e-6);
    if (i < 0) { i = lanes.length; lanes.push([]); ends.push(0); }
    lanes[i].push(l);
    ends[i] = l.end;
    laneOf.set(l.id, i);
  }
  return { lanes, laneOf };
}

const fmtT = (s: number, fine: boolean) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${fine ? sec.toFixed(1).padStart(4, "0") : String(Math.floor(sec)).padStart(2, "0")}`;
};

export function MultiTrackTimeline() {
  const ed = useEditor();
  const time = useTime();
  const { tl, lines, doc, waveform, selection, setSelection, project, playback } = ed;
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  /** True once the person has chosen a scale themselves; until then the scale follows the video. */
  const userZoomed = useRef(false);
  const [view, setView] = useState(0);
  const [snap, setSnap] = useState(true);
  const drag = useRef<DragState | null>(null);
  const [dropX, setDropX] = useState<number | null>(null);
  /** An effect tile being dragged over the timeline: where it would land. */
  const [fxDrop, setFxDrop] = useState<{ x: number; label: string; cut: boolean } | null>(null);
  /** A video/image file dragged over the timeline: where it would be inserted. */
  const [fileDrop, setFileDrop] = useState<{ x: number; label: string } | null>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  /** "+" at the end of the video track: which kind of media to add. */
  const [addMenu, setAddMenu] = useState(false);
  const [addAccept, setAddAccept] = useState("video/*,image/*,.mp4,.mov,.m4v,.webm,.mkv");
  /** Hide the floating action bar while something is being dragged. */
  const [dragging, setDragging] = useState(false);
  /** Two fingers on the timeline: pinch to zoom, move to pan. */
  const touches = useRef(new Map<number, number>());
  const pinch = useRef<{ d0: number; zoom0: number; view0: number; mid0: number } | null>(null);
  const { apply: applyEffect } = useApplyEffect();

  const layers = useMemo(() => doc.layers ?? [], [doc.layers]);
  // image clips: redraw once their pictures have decoded
  const [imgTick, setImgTick] = useState(0);
  useEffect(() => {
    const pending = (ed.clips.filter((c) => c.kind === "image") as ImageClip[]).filter((c) => !imageFor(c.assetId));
    if (!pending.length) return;
    const t = setTimeout(() => setImgTick((n) => n + 1), 400);
    return () => clearTimeout(t);
  }, [ed.clips, imgTick]);
  const { lanes, laneOf } = useMemo(() => laneLayers(layers), [layers]);
  const effects = useMemo(() => doc.effects ?? [], [doc.effects]);
  const soundsList = useMemo(() => (doc.sounds ?? []).map((x) => ({ ...x, end: x.start + x.duration })), [doc.sounds]);
  const fxL = useMemo(() => laneLayers(effects), [effects]);
  const sndL = useMemo(() => laneLayers(soundsList), [soundsList]);
  const nFx = Math.max(1, fxL.lanes.length);
  const nSnd = Math.max(1, sndL.lanes.length);
  const music = doc.audio?.music;
  const dur = Math.max(1, tl.duration);
  /** Scale when the whole video fits (zoom 1), with padding after the end. */
  const fitPps = Math.max(1e-6, (width - LABEL_W - END_PAD) / dur);
  const pps = fitPps * zoom;
  /** Seconds visible across the canvas. */
  const span = (width - LABEL_W) / pps;
  /** Furthest the view can scroll: the end plus its padding sits at the right edge. */
  const maxView = Math.max(0, dur + END_PAD / pps - span);
  // first layout: the remembered scale, or a sensible one instead of stretching the video across the screen
  useEffect(() => {
    // not once-only: the duration isn't known until the video has loaded, and a scale picked
    // before that would leave the clips squeezed into a corner
    if (userZoomed.current || width <= 240 || tl.duration <= 0) return;
    const target = ed.settings.timelinePps > 0 ? ed.settings.timelinePps : Math.min(MAX_PPS, Math.max(MIN_PPS, fitPps));
    const nz = target / fitPps;
    setZoom((z) => (Math.abs(z - nz) < 1e-3 ? z : nz));
  }, [width, fitPps, tl.duration, ed.settings.timelinePps]);
  // remember the scale (pixels per second) so the next project opens the same way
  useEffect(() => {
    if (!userZoomed.current) return; // only remember a scale the person chose
    const id = setTimeout(() => { const v = Math.round(pps); if (Math.abs(v - ed.settings.timelinePps) > 1) ed.setSettings({ timelinePps: v }); }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pps]);
  /** Zoom slider ↔ zoom: logarithmic, 0.2× … 200× */
  const Z_MIN = Math.log(0.2), Z_MAX = Math.log(200);
  const zoomSlider = ((Math.log(zoom) - Z_MIN) / (Z_MAX - Z_MIN)) * 100;
  const setZoomKeepingPlayhead = (nz: number) => {
    userZoomed.current = true;
    const npps = fitPps * nz;
    const nspan = (width - LABEL_W) / npps;
    const nmax = Math.max(0, dur + END_PAD / npps - nspan);
    // keep the playhead at the same place on screen
    const px = X(time);
    setZoom(nz);
    setView(Math.max(0, Math.min(nmax, time - (px - LABEL_W) / npps)));
  };

  const yVideo = RULER + GAP;
  const yCap = yVideo + VIDEO_H + GAP;
  const yLanes = yCap + CAP_H + GAP;
  const nLanes = Math.max(1, lanes.length);
  const yFx = yLanes + nLanes * (LANE_H + 2) + GAP;
  const ySnd = yFx + nFx * (LANE_H + 2) + GAP;
  const yMusic = ySnd + nSnd * (LANE_H + 2) + GAP;
  const H = yMusic + MUSIC_H + GAP;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // follow the playhead, but only when the *playhead* moved, never when the user scrolled away from it
  const lastTime = useRef(time);
  useEffect(() => {
    if (maxView <= 0) { if (view !== 0) setView(0); return; }
    if (view > maxView) { setView(maxView); return; }
    const moved = Math.abs(time - lastTime.current) > 1e-6;
    lastTime.current = time;
    if (!moved) return;
    if (time < view || time > view + span * 0.92) setView(Math.max(0, Math.min(maxView, time - span * (playback.playing ? 0.1 : 0.4))));
  }, [time, maxView, span, view, playback.playing]);
  const panTo = useCallback((v: number) => setView(Math.max(0, Math.min(maxView, v))), [maxView]);
  /** Where the canvas sits in the viewport: popovers are fixed-positioned from this so the scrolling track area can't clip them. */
  const [rect, setRect] = useState<{ left: number; top: number; bodyTop: number; bodyBottom: number } | null>(null);
  useEffect(() => {
    const el = wrap.current;
    const body = el?.parentElement;
    if (!el || !body) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      setRect((old) => (old && old.left === r.left && old.top === r.top && old.bodyTop === b.top && old.bodyBottom === b.bottom ? old : { left: r.left, top: r.top, bodyTop: b.top, bodyBottom: b.bottom }));
    };
    measure();
    body.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    const iv = window.setInterval(measure, 600); // layout changes we can't observe (panel resize, fullscreen)
    return () => { body.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure); ro.disconnect(); window.clearInterval(iv); };
  }, []);
  /** Page coordinates for a point on the canvas, or null when that row is scrolled out of view. */
  const onScreen = (x: number, y: number) => {
    if (!rect) return null;
    const py = rect.top + y;
    if (py < rect.bodyTop - 2 || py > rect.bodyBottom + 2) return null;
    return { x: rect.left + x, y: py };
  };

  const X = useCallback((t: number) => LABEL_W + (t - view) * pps, [view, pps]);
  const T = useCallback((x: number) => view + (x - LABEL_W) / pps, [view, pps]);

  /* ---------- snapping ---------- */
  const snapPoints = useMemo(() => {
    const pts = new Set<number>([0, tl.duration]);
    for (const it of tl.items) { pts.add(it.outStart); pts.add(it.outEnd); }
    for (const l of lines) { pts.add(l.start); pts.add(l.end); }
    for (const l of layers) { pts.add(l.start); pts.add(l.end); }
    for (const f of doc.effects ?? []) { pts.add(f.start); pts.add(f.end); }
    if (doc.audio?.music?.beats?.length) for (const b of beatsOnTimeline(doc.audio.music.beats, doc.audio.music.start, ed.musicDuration || Infinity, tl.duration, doc.audio.music.loop)) pts.add(b);
    return [...pts];
  }, [tl, lines, layers, doc.effects, doc.audio?.music, ed.musicDuration]);
  const snapT = useCallback((t: number, alt: boolean, exclude?: number[]) => {
    if (!snap || alt) return t;
    const tol = 8 / pps;
    let best = t;
    let bd = tol;
    for (const p of [...snapPoints, time]) {
      if (exclude?.some((e) => Math.abs(e - p) < 1e-6)) continue;
      const d = Math.abs(p - t);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }, [snap, pps, snapPoints, time]);

  /* ---------- drawing ---------- */
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(H * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, H);
    const css = getComputedStyle(c);
    const col = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
    // CapMitra: selection/playhead in lime + ink; every track a pastel fill with ink labels
    const accent = col("--text", "#F4F5EF");
    const saffron = col("--lime", "#D6FF36");
    const ink = "#080808";
    const tVideo = col("--track-video", "#B9C2CF");
    const tCap = col("--track-caption", "#D6FF36");
    const tGfx = col("--track-graphics", "#8ED8F8");
    const tFx = col("--track-fx", "#C9B8FF");
    const tSnd = col("--track-sound", "#FFD166");
    const tMusic = col("--track-music", "#FFA8A8");
    const dim = "rgba(120,120,140,0.35)";
    const textCol = col("--text", "#F5F7FF");
    const muted = col("--muted", "#A6B0CC");
    const line = col("--line-soft", "#1d2647");
    const sel = selection;

    // track backgrounds
    ctx.fillStyle = col("--panel-2", "#18213d");
    for (const [y, h] of [[yVideo, VIDEO_H], [yCap, CAP_H], [yLanes, nLanes * (LANE_H + 2) - 2], [yFx, nFx * (LANE_H + 2) - 2], [ySnd, nSnd * (LANE_H + 2) - 2], [yMusic, MUSIC_H]] as [number, number][]) {
      ctx.globalAlpha = 0.55;
      ctx.fillRect(0, y, width, h);
    }
    ctx.globalAlpha = 1;

    // ruler
    ctx.fillStyle = muted;
    ctx.font = "10px Inter, 'Anek Gujarati', sans-serif";
    const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 64) ?? 600;
    for (let s = Math.floor(view / step) * step; s < view + span + step; s += step) {
      const x = X(s);
      ctx.fillRect(x, RULER - 6, 1, 6);
      ctx.fillText(fmtT(s, step < 1), x + 3, 11);
    }
    ctx.fillStyle = line;
    ctx.fillRect(0, RULER, width, 1);

    const box = (x0: number, x1: number, y: number, h: number, fill: string, stroke: string, lw = 1, r = 5) => {
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.roundRect(x0, y, Math.max(3, x1 - x0), h, r);
      ctx.fill();
      ctx.stroke();
    };
    const label = (txt: string, x0: number, x1: number, y: number, size = 12, color = textCol) => {
      if (x1 - x0 < 24) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 + 4, y - size, x1 - x0 - 8, size * 2);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.font = `${size}px 'Anek Gujarati', Inter, sans-serif`;
      ctx.fillText(txt, Math.max(x0 + 6, 6), y + size * 0.35);
      ctx.restore();
    };

    /** Empty lane: a dashed placeholder with a short hint, instead of a long sentence under the playhead. */
    const emptyLane = (y: number, h: number, hint: string) => {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(6, y + 3, Math.max(40, width - 12), h - 6, 6); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = muted;
      ctx.font = "600 11px Inter, sans-serif";
      ctx.fillText(hint, 16, y + h / 2 + 4);
      ctx.restore();
    };

    // video track
    for (const it of tl.items) {
      const x0 = X(it.outStart);
      const x1 = X(it.outEnd);
      if (x1 < 0 || x0 > width) continue;
      const isSel = sel?.kind === "clip" && sel.id === it.clip.id;
      if (it.clip.kind === "video") {
        box(x0 + 1, x1 - 1, yVideo, VIDEO_H, tVideo, isSel ? accent : "rgba(8,8,8,0.25)", isSel ? 2 : 1);
        // waveform of the source part
        if (waveform) {
          const c2 = it.clip;
          ctx.save();
          ctx.beginPath(); ctx.rect(x0 + 2, yVideo, x1 - x0 - 4, VIDEO_H); ctx.clip();
          ctx.fillStyle = "rgba(8,8,8,0.35)";
          const mid = yVideo + VIDEO_H / 2 + 6;
          for (let x = Math.max(0, x0); x < Math.min(width, x1); x += 2) {
            const k = speedOf(c2);
            const s0 = c2.srcStart + (T(x) - it.outStart) * k;
            const s1 = s0 + (2 / pps) * k;
            let m = 0;
            for (let i = Math.floor(s0 * waveform.rate); i < Math.ceil(s1 * waveform.rate); i++) m = Math.max(m, waveform.peaks[i] ?? 0);
            const hh = m * (VIDEO_H / 2 - 8);
            ctx.fillRect(x, mid - hh, 1.5, hh * 2);
          }
          ctx.restore();
        }
        label(`${it.clip.sourceId ? `▶ ${it.clip.name ?? "Added video"} · ` : ""}${speedOf(it.clip) !== 1 ? `${speedOf(it.clip)}× speed · ` : ""}${fmtT(it.clip.srcStart, true)} to ${fmtT(Number.isFinite(it.clip.srcEnd) ? it.clip.srcEnd : 0, true)}`, x0, x1, yVideo + 11, 10, ink);
      } else if (it.clip.kind === "image") {
        box(x0 + 1, x1 - 1, yVideo, VIDEO_H, "#dfe7d2", isSel ? accent : "rgba(8,8,8,0.25)", isSel ? 2 : 1);
        // a small picture of the image itself, when it has loaded
        const img = imageFor(it.clip.assetId);
        if (img) {
          ctx.save();
          ctx.beginPath(); ctx.roundRect(x0 + 1, yVideo, Math.max(3, x1 - x0 - 2), VIDEO_H, 5); ctx.clip();
          const k = (VIDEO_H - 6) / img.naturalHeight;
          const tw = img.naturalWidth * k;
          for (let x = x0 + 3; x < x1 - 3; x += tw + 3) ctx.drawImage(img, x, yVideo + 3, Math.min(tw, x1 - 3 - x), VIDEO_H - 6);
          ctx.restore();
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.fillRect(x0 + 1, yVideo + VIDEO_H - 16, Math.max(3, x1 - x0 - 2), 16);
        }
        label(`🖼 ${it.clip.name ?? "Image"} · ${clipLength(it.clip).toFixed(1)} s`, x0, x1, yVideo + VIDEO_H - 8, 10, ink);
      } else {
        const bg = it.clip.background;
        const g = ctx.createLinearGradient(x0, 0, x1, 0);
        // gradients show their two colours; solid and pattern cards show their main colour
        const isGrad = bg.kind === "gradient";
        g.addColorStop(0, (isGrad ? bg.colors?.[0] : bg.color) ?? bg.color ?? "#0E0F12");
        g.addColorStop(1, (isGrad ? bg.colors?.[1] : bg.color) ?? bg.color ?? "#2A2E36");
        box(x0 + 1, x1 - 1, yVideo, VIDEO_H, "transparent", isSel ? accent : "rgba(255,255,255,0.5)", isSel ? 2 : 1);
        ctx.fillStyle = g; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.roundRect(x0 + 1, yVideo, Math.max(3, x1 - x0 - 2), VIDEO_H, 5); ctx.fill(); ctx.globalAlpha = 1;
        const main = (isGrad ? bg.colors?.[0] : bg.color) ?? "#0E0F12";
        const hex = /^#([0-9a-f]{6})$/i.exec(main)?.[1];
        const light = hex ? (0.299 * parseInt(hex.slice(0, 2), 16) + 0.587 * parseInt(hex.slice(2, 4), 16) + 0.114 * parseInt(hex.slice(4, 6), 16)) > 150 : false;
        label(`▣ ${it.clip.title || "Card"}`, x0, x1, yVideo + VIDEO_H / 2, 12, light ? ink : "#FFFFFF");
      }
      const tr = it.clip.transition;
      if (tr && tr.kind !== "none" && it.index > 0) {
        ctx.fillStyle = saffron;
        ctx.beginPath(); ctx.moveTo(x0, yVideo + 4); ctx.lineTo(x0 + 7, yVideo + 4); ctx.lineTo(x0, yVideo + 11); ctx.closePath(); ctx.fill();
      }
      if (isSel) {
        ctx.fillStyle = accent;
        ctx.fillRect(x0, yVideo + 10, 3, VIDEO_H - 20);
        ctx.fillRect(x1 - 3, yVideo + 10, 3, VIDEO_H - 20);
      }
    }
    if (dropX !== null) { ctx.fillStyle = saffron; ctx.fillRect(dropX - 1, yVideo - 2, 3, VIDEO_H + 4); }
    if (fileDrop) { ctx.fillStyle = saffron; ctx.fillRect(fileDrop.x - 1, yVideo - 2, 3, VIDEO_H + 4); }

    // captions
    for (const l of lines) {
      const x0 = X(l.start);
      const x1 = X(l.end);
      if (x1 < 0 || x0 > width) continue;
      const isSel = sel?.kind === "caption" && sel.key === l.key;
      const hidden = doc.overrides[l.key]?.hidden;
      box(x0, x1, yCap, CAP_H, hidden ? dim : tCap, isSel ? accent : "rgba(8,8,8,0.25)", isSel ? 2 : 1);
      label(l.words.map((w) => w.text).join(" "), x0, x1, yCap + CAP_H / 2, 13, hidden ? textCol : ink);
      if (isSel) { ctx.fillStyle = accent; ctx.fillRect(x0 - 2, yCap + 8, 4, CAP_H - 16); ctx.fillRect(x1 - 2, yCap + 8, 4, CAP_H - 16); }
    }

    // graphics lanes
    for (const l of layers) {
      const lane = laneOf.get(l.id) ?? 0;
      const y = yLanes + lane * (LANE_H + 2);
      const x0 = X(l.start);
      const x1 = X(Math.min(l.end, dur));
      if (x1 < 0 || x0 > width) continue;
      const isSel = sel?.kind === "layer" && sel.id === l.id;
      box(x0, x1, y, LANE_H, l.hidden ? dim : tGfx, isSel ? accent : "rgba(8,8,8,0.25)", isSel ? 2 : 1, 4);
      label(`${l.hidden ? "◌ " : ""}${l.name}${l.text ? `: ${l.text}` : ""}`, x0, x1, y + LANE_H / 2, 11, l.hidden ? textCol : ink);
    }
    if (!layers.length) emptyLane(yLanes, LANE_H, "+ Text, titles & shapes · Graphics panel");

    // effects
    for (const f of effects) {
      const lane = fxL.laneOf.get(f.id) ?? 0;
      const y = yFx + lane * (LANE_H + 2);
      const x0 = X(f.start), x1 = X(Math.min(f.end, dur));
      if (x1 < 0 || x0 > width) continue;
      const isSel = sel?.kind === "fx" && sel.id === f.id;
      box(x0, x1, y, LANE_H, tFx, isSel ? accent : "rgba(8,8,8,0.25)", isSel ? 2 : 1, 4);
      label(`✦ ${fxMeta(f.type)?.label ?? f.type}`, x0, x1, y + LANE_H / 2, 11, ink);
    }
    if (!effects.length) emptyLane(yFx, LANE_H, "+ Zooms, shakes & looks · Effects panel");
    // sound effects
    for (const x of soundsList) {
      const lane = sndL.laneOf.get(x.id) ?? 0;
      const y = ySnd + lane * (LANE_H + 2);
      const x0 = X(x.start), x1 = X(Math.min(x.end, dur));
      if (x1 < 0 || x0 > width) continue;
      const isSel = sel?.kind === "sound" && sel.id === x.id;
      box(x0, Math.max(x1, x0 + 18), y, LANE_H, tSnd, isSel ? accent : "rgba(8,8,8,0.25)", isSel ? 2 : 1, 4);
      label(`♫ ${x.name}`, x0, Math.max(x1, x0 + 60), y + LANE_H / 2, 11, ink);
    }
    if (!soundsList.length) emptyLane(ySnd, LANE_H, "+ Whooshes, pops & hits · Effects → Sound effects");

    // music
    if (music) {
      const x0 = X(music.start);
      const x1 = X(music.loop ? dur : Math.min(dur, music.start + (ed.musicDuration || dur)));
      box(x0, x1, yMusic, MUSIC_H, tMusic, "rgba(8,8,8,0.25)", 1, 4);
      if (music.beats?.length) {
        ctx.fillStyle = "rgba(8,8,8,0.45)";
        for (const b of beatsOnTimeline(music.beats, music.start, ed.musicDuration || Infinity, dur, music.loop)) {
          const bx = X(b);
          if (bx >= 0 && bx <= width) ctx.fillRect(bx, yMusic + MUSIC_H - 6, 1, 6);
        }
      }
      label(`♪ ${music.name}${music.bpm ? ` · ${Math.round(music.bpm)} BPM` : ""}`, x0, x1, yMusic + MUSIC_H / 2, 11, ink);
    } else emptyLane(yMusic, MUSIC_H, "+ Background music · Audio panel");

    // playhead
    const px = X(time);
    ctx.fillStyle = accent;
    ctx.fillRect(px - 1, 0, 2, H);
    ctx.fillStyle = saffron; ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px - 6, 0); ctx.lineTo(px + 6, 0); ctx.lineTo(px + 6, 6); ctx.lineTo(px, 11); ctx.lineTo(px - 6, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
  }, [width, H, tl, lines, layers, laneOf, music, view, pps, span, waveform, selection, time, X, T, yVideo, yCap, yLanes, yMusic, nLanes, dur, doc.overrides, dropX, fileDrop, ed.musicDuration, effects, soundsList, fxL, sndL, yFx, ySnd, imgTick]);

  /* ---------- hit testing ---------- */
  const hitAt = (x: number, y: number): Hit => {
    const edge = (x0: number, x1: number): "start" | "end" | null => (Math.abs(x - x0) < 7 ? "start" : Math.abs(x - x1) < 7 ? "end" : null);
    if (y < RULER) return { kind: "ruler" };
    if (y >= yVideo && y < yVideo + VIDEO_H) {
      for (const it of tl.items) {
        const x0 = X(it.outStart), x1 = X(it.outEnd);
        if (x >= x0 - 6 && x <= x1 + 6) return { kind: "clip", it, edge: edge(x0, x1) };
      }
      return { kind: "empty" };
    }
    if (y >= yCap && y < yCap + CAP_H) {
      for (const l of lines) {
        const x0 = X(l.start), x1 = X(l.end);
        if (x >= x0 - 6 && x <= x1 + 6) {
          const isSel = selection?.kind === "caption" && selection.key === l.key;
          return { kind: "caption", key: l.key, edge: isSel ? edge(x0, x1) : null, start: l.start, end: l.end };
        }
      }
      return { kind: "empty" };
    }
    if (y >= yLanes && y < yLanes + nLanes * (LANE_H + 2)) {
      const lane = Math.floor((y - yLanes) / (LANE_H + 2));
      for (const l of lanes[lane] ?? []) {
        const x0 = X(l.start), x1 = X(Math.min(l.end, dur));
        if (x >= x0 - 6 && x <= x1 + 6) return { kind: "layer", l, edge: edge(x0, x1) };
      }
      return { kind: "empty" };
    }
    if (y >= yFx && y < yFx + nFx * (LANE_H + 2)) {
      const lane = Math.floor((y - yFx) / (LANE_H + 2));
      for (const f of fxL.lanes[lane] ?? []) {
        const x0 = X(f.start), x1 = X(Math.min(f.end, dur));
        if (x >= x0 - 6 && x <= x1 + 6) return { kind: "fx", f, edge: edge(x0, x1) };
      }
      return { kind: "empty" };
    }
    if (y >= ySnd && y < ySnd + nSnd * (LANE_H + 2)) {
      const lane = Math.floor((y - ySnd) / (LANE_H + 2));
      for (const x2 of sndL.lanes[lane] ?? []) {
        const x0 = X(x2.start), x1 = Math.max(X(x2.end), x0 + 18);
        if (x >= x0 - 4 && x <= x1 + 4) return { kind: "sound", s: x2, edge: null };
      }
      return { kind: "empty" };
    }
    if (music && y >= yMusic && y < yMusic + MUSIC_H) {
      const x0 = X(music.start);
      if (x >= x0 - 6) return { kind: "music", edge: null };
    }
    return { kind: "empty" };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, x);
      if (touches.current.size === 2) {
        // second finger: stop whatever the first one started and pinch instead
        const [a, b] = [...touches.current.values()];
        pinch.current = { d0: Math.max(20, Math.abs(a - b)), zoom0: zoom, view0: view, mid0: (a + b) / 2 };
        drag.current = null; setDropX(null); setDragging(false);
        return;
      }
    }
    setAddMenu(false);
    const hit = hitAt(x, y);
    const t = T(x);
    if (hit.kind === "ruler" || hit.kind === "empty") {
      if (hit.kind === "empty") setSelection(null);
      playback.seek(Math.max(0, Math.min(dur, t)));
      drag.current = { hit: { kind: "ruler" }, x0: x, t0: t, moved: false };
      return;
    }
    if (hit.kind === "clip") setSelection({ kind: "clip", id: hit.it.clip.id });
    if (hit.kind === "caption") setSelection({ kind: "caption", key: hit.key });
    if (hit.kind === "layer") setSelection({ kind: "layer", id: hit.l.id });
    if (hit.kind === "fx") { setSelection({ kind: "fx", id: hit.f.id }); ed.setPanel("effects"); }
    if (hit.kind === "sound") { setSelection({ kind: "sound", id: hit.s.id }); ed.setPanel("effects"); }
    drag.current = {
      hit, x0: x, t0: t, moved: false, startClips: ed.clips,
      orig: hit.kind === "layer" ? { start: hit.l.start, end: hit.l.end } : hit.kind === "fx" ? { start: hit.f.start, end: hit.f.end } : hit.kind === "sound" ? { start: hit.s.start, end: hit.s.start + hit.s.duration } : hit.kind === "caption" ? { start: hit.start, end: hit.end } : hit.kind === "music" ? { start: music!.start, end: 0 } : undefined,
    };
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, x);
    const pc = pinch.current;
    if (pc) {
      const pts = [...touches.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      userZoomed.current = true;
      const nz = Math.min(200, Math.max(0.2, pc.zoom0 * (Math.abs(a - b) / pc.d0)));
      const npps = fitPps * nz;
      const nspan = (width - LABEL_W) / npps;
      // keep the time under the fingers' midpoint where it was, then follow the midpoint as they pan
      const tMid = pc.view0 + (pc.mid0 - LABEL_W) / (fitPps * pc.zoom0);
      setZoom(nz);
      setView(Math.max(0, Math.min(Math.max(0, dur + END_PAD / npps - nspan), tMid - ((a + b) / 2 - LABEL_W) / npps)));
      return;
    }
    const d = drag.current;
    if (!d) {
      const h = hitAt(x, e.clientY - r.top);
      e.currentTarget.style.cursor = h.kind === "ruler" ? "col-resize" : "edge" in h && h.edge ? "ew-resize" : h.kind === "empty" ? "text" : "grab";
      return;
    }
    const t = T(x);
    if (d.hit.kind === "ruler") { playback.seek(Math.max(0, Math.min(dur, t))); return; }
    if (!d.moved && Math.abs(x - d.x0) < 3) return;
    if (!d.moved) { d.moved = true; project.checkpoint(); playback.pause(); setDragging(true); }
    const dt = t - d.t0;
    const h = d.hit;
    if (h.kind === "clip") {
      if (h.edge) {
        // trim, always relative to the clips as they were when the drag began
        const edgeT = h.edge === "start" ? h.it.outStart : h.it.outEnd;
        const delta = snapT(edgeT + dt, e.altKey, [edgeT]) - edgeT;
        ed.setClips(trimEdge(d.startClips ?? ed.clips, h.it.clip.id, h.edge, delta, ed.srcDuration));
      } else {
        // reorder: show where it would drop
        let idx = 0;
        for (const it of tl.items) if (X((it.outStart + it.outEnd) / 2) < x) idx = it.index + 1;
        d.dropIndex = idx;
        const at = idx < tl.items.length ? tl.items[idx].outStart : tl.duration;
        setDropX(X(at));
      }
      return;
    }
    if (h.kind === "caption" && d.orig) {
      if (h.edge === "start") ed.retimeLine(h.key, snapT(d.orig.start + dt, e.altKey), d.orig.end, "start");
      else if (h.edge === "end") ed.retimeLine(h.key, d.orig.start, snapT(d.orig.end + dt, e.altKey), "end");
      else {
        const s = snapT(d.orig.start + dt, e.altKey, [d.orig.start]);
        ed.retimeLine(h.key, s, s + (d.orig.end - d.orig.start), "move");
      }
      return;
    }
    if (h.kind === "layer" && d.orig) {
      const o = d.orig;
      let start = o.start, end = o.end;
      if (h.edge === "start") start = Math.min(o.end - 0.1, Math.max(0, snapT(o.start + dt, e.altKey)));
      else if (h.edge === "end") end = Math.max(o.start + 0.1, snapT(o.end + dt, e.altKey));
      else {
        const len = o.end - o.start;
        start = Math.max(0, snapT(o.start + dt, e.altKey, [o.start, o.end]));
        const snappedEnd = snapT(start + len, e.altKey, [o.start, o.end]);
        if (Math.abs(snappedEnd - (start + len)) > 1e-6 && Math.abs(snappedEnd - (start + len)) < 8 / pps) start = snappedEnd - len;
        end = start + len;
      }
      project.update((doc2) => ({ ...doc2, layers: (doc2.layers ?? []).map((l) => (l.id === h.l.id ? { ...l, start: +start.toFixed(3), end: +end.toFixed(3) } : l)) }), { history: false });
      return;
    }
    if (h.kind === "fx" && d.orig) {
      const o = d.orig;
      let start = o.start, end = o.end;
      if (h.edge === "start") start = Math.min(o.end - 0.05, Math.max(0, snapT(o.start + dt, e.altKey)));
      else if (h.edge === "end") end = Math.max(o.start + 0.05, snapT(o.end + dt, e.altKey));
      else { start = Math.max(0, snapT(o.start + dt, e.altKey, [o.start, o.end])); end = start + (o.end - o.start); }
      project.update((doc2) => ({ ...doc2, effects: (doc2.effects ?? []).map((f) => (f.id === h.f.id ? { ...f, start: +start.toFixed(3), end: +end.toFixed(3) } : f)) }), { history: false });
      return;
    }
    if (h.kind === "sound" && d.orig) {
      const start = Math.max(0, snapT(d.orig.start + dt, e.altKey, [d.orig.start]));
      project.update((doc2) => ({ ...doc2, sounds: (doc2.sounds ?? []).map((x) => (x.id === h.s.id ? { ...x, start: +start.toFixed(3) } : x)) }), { history: false });
      return;
    }
    if (h.kind === "music" && d.orig) {
      const start = Math.max(0, snapT(d.orig.start + dt, e.altKey));
      project.update((doc2) => (doc2.audio?.music ? { ...doc2, audio: { ...doc2.audio, music: { ...doc2.audio.music, start: +start.toFixed(3) } } } : doc2), { history: false });
    }
  };

  const up = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (e) touches.current.delete(e.pointerId);
    if (pinch.current) { if (touches.current.size < 2) pinch.current = null; return; }
    const d = drag.current;
    drag.current = null;
    setDropX(null);
    setDragging(false);
    if (!d) return;
    const h = d.hit;
    if (h.kind === "clip" && d.moved && !h.edge && d.dropIndex !== undefined) {
      const from = h.it.index;
      let to = d.dropIndex;
      if (to > from) to -= 1;
      if (to !== from) ed.setClips(moveClip(ed.clips, h.it.clip.id, to));
    }
    if (!d.moved) {
      if (h.kind === "caption") playback.seek(Math.min(h.start + 0.25, (h.start + h.end) / 2));
      else if (h.kind === "layer") playback.seek(Math.max(h.l.start, Math.min(h.l.end - 0.05, playback.getTime())));
    }
  };

  const wheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const at = T(e.clientX - r.left);
      userZoomed.current = true;
      setZoom((z) => {
        const nz = Math.min(200, Math.max(0.2, z * (e.deltaY < 0 ? 1.25 : 1 / 1.25)));
        const npps = fitPps * nz;
        setView(Math.max(0, Math.min(Math.max(0, dur + END_PAD / npps - (width - LABEL_W) / npps), at - (e.clientX - r.left - LABEL_W) / npps)));
        return nz;
      });
    } else if (maxView > 0) {
      setView((v) => Math.max(0, Math.min(maxView, v + (e.deltaX || e.deltaY) / pps)));
    }
  };

  /* ---------- scrollbar under the tracks (drag the thumb, or tap beside it) ---------- */
  const sbDrag = useRef<{ x0: number; view0: number } | null>(null);
  const sbDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - r.left) / r.width;
    const total = maxView + span;
    const thumbStart = view / total, thumbEnd = (view + span) / total;
    const outside = frac < thumbStart || frac > thumbEnd;
    const v0 = Math.max(0, Math.min(maxView, outside ? frac * total - span / 2 : view));
    if (outside) panTo(v0); // jump
    sbDrag.current = { x0: e.clientX, view0: v0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const sbMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = sbDrag.current;
    if (!d) return;
    const r = e.currentTarget.getBoundingClientRect();
    panTo(d.view0 + ((e.clientX - d.x0) / r.width) * (maxView + span));
  };
  const sbUp = () => { sbDrag.current = null; };

  /* ---------- where the selected item sits, for its floating actions ---------- */
  const selBox = (): { x0: number; x1: number; y: number; h: number } | null => {
    const s = selection;
    if (!s) return null;
    if (s.kind === "clip") { const it = tl.items.find((i) => i.clip.id === s.id); return it ? { x0: X(it.outStart), x1: X(it.outEnd), y: yVideo, h: VIDEO_H } : null; }
    if (s.kind === "caption") { const l = lines.find((c) => c.key === s.key); return l ? { x0: X(l.start), x1: X(l.end), y: yCap, h: CAP_H } : null; }
    if (s.kind === "layer") { const l = layers.find((c) => c.id === s.id); return l ? { x0: X(l.start), x1: X(Math.min(l.end, dur)), y: yLanes + (laneOf.get(l.id) ?? 0) * (LANE_H + 2), h: LANE_H } : null; }
    if (s.kind === "fx") { const f = effects.find((c) => c.id === s.id); return f ? { x0: X(f.start), x1: X(Math.min(f.end, dur)), y: yFx + (fxL.laneOf.get(f.id) ?? 0) * (LANE_H + 2), h: LANE_H } : null; }
    if (s.kind === "sound") { const x2 = soundsList.find((c) => c.id === s.id); return x2 ? { x0: X(x2.start), x1: Math.max(X(x2.end), X(x2.start) + 18), y: ySnd + (sndL.laneOf.get(x2.id) ?? 0) * (LANE_H + 2), h: LANE_H } : null; }
    return null;
  };
  const selPos = !dragging && !fileDrop ? selBox() : null;
  const selLayerObj = selection?.kind === "layer" ? layers.find((l) => l.id === selection.id) : undefined;
  const selCaptionHidden = selection?.kind === "caption" ? !!doc.overrides[selection.key]?.hidden : false;
  const duplicateClip = () => {
    if (!selClip) return;
    const i = ed.clips.indexOf(selClip);
    const copy = { ...selClip, id: ed.uid("c"), tag: undefined } as typeof selClip;
    ed.setClips([...ed.clips.slice(0, i + 1), copy, ...ed.clips.slice(i + 1)]);
    setSelection({ kind: "clip", id: copy.id });
  };
  const duplicateLayer = () => {
    if (!selLayerObj) return;
    ed.addLayer({ ...selLayerObj, id: ed.uid("L"), x: Math.min(95, selLayerObj.x + 3), y: Math.min(95, selLayerObj.y + 3), z: ed.nextZ() });
  };
  const splitSelClip = () => {
    const it = selClip ? tl.items.find((i) => i.clip.id === selClip.id) : undefined;
    if (!it) return;
    if (t <= it.outStart + 0.05 || t >= it.outEnd - 0.05) return ed.toast({ kind: "info", title: "Move the playhead inside this clip to split it", duration: 2200 });
    splitHere(ed, t);
  };
  /** Right-click: select the item under the pointer so its actions appear. */
  const contextSelect = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const h = hitAt(e.clientX - r.left, e.clientY - r.top);
    if (h.kind === "clip") setSelection({ kind: "clip", id: h.it.clip.id });
    else if (h.kind === "caption") setSelection({ kind: "caption", key: h.key });
    else if (h.kind === "layer") setSelection({ kind: "layer", id: h.l.id });
    else if (h.kind === "fx") setSelection({ kind: "fx", id: h.f.id });
    else if (h.kind === "sound") setSelection({ kind: "sound", id: h.s.id });
  };
  const pickMedia = (accept: string) => { setAddAccept(accept); setAddMenu(false); setTimeout(() => mediaRef.current?.click(), 0); };
  // the "+" menu closes on a tap anywhere else or Escape
  useEffect(() => {
    if (!addMenu) return;
    const close = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest(".tl-end")) setAddMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAddMenu(false); };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", close, true); window.removeEventListener("keydown", esc); };
  }, [addMenu]);
  const endX = X(tl.duration);

  /* ---------- toolbar actions ---------- */
  const t = time;
  const selClip = selection?.kind === "clip" ? ed.clips.find((c) => c.id === selection.id) : undefined;
  const split = () => splitHere(ed, t);
  const joinId = joinTarget(ed.clips, selClip?.id ?? null, t, tl.items);
  const join = () => {
    if (!joinId) return;
    const i = ed.clips.findIndex((c) => c.id === joinId);
    const at = tl.items[i + 1]?.outStart ?? t;
    ed.setClips(mergeWithNext(ed.clips, joinId));
    setSelection({ kind: "clip", id: joinId });
    ed.toast({ kind: "success", title: `Joined the cut at ${fmtT(at, true)}`, action: { label: "Undo", onClick: () => ed.undo() }, duration: 3500 });
  };
  const [cutOpen, setCutOpen] = useState<{ id: string; el: HTMLElement } | null>(null);
  const del = () => {
    if (selection?.kind === "layer") ed.removeLayer(selection.id);
    else if (selection?.kind === "fx") { project.update((d) => ({ ...d, effects: (d.effects ?? []).filter((f) => f.id !== selection.id) })); setSelection(null); }
    else if (selection?.kind === "sound") { project.update((d) => ({ ...d, sounds: (d.sounds ?? []).filter((x) => x.id !== selection.id) })); setSelection(null); }
    else if (selection?.kind === "caption") { project.update((d) => ({ ...d, overrides: { ...d.overrides, [selection.key]: { ...d.overrides[selection.key], hidden: !d.overrides[selection.key]?.hidden } } })); }
    else if (selClip) {
      if (ed.clips.length < 2) return ed.toast({ kind: "info", title: "The timeline needs at least one clip", duration: 2200 });
      ed.setClips(removeClip(ed.clips, selClip.id));
      setSelection(null);
    }
  };
  const canDelete = !!selection;

  /* ---------- effects dragged in from the Effects panel ---------- */
  const cuts = tl.items.filter((it) => it.index > 0);
  const nearestCut = (t: number) => cuts.reduce<typeof cuts[number] | null>((b, it) => (!b || Math.abs(it.outStart - t) < Math.abs(b.outStart - t) ? it : b), null);
  const isFxDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(FX_DRAG_TYPE);
  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const dropTime = (e: React.DragEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return Math.max(0, Math.min(tl.duration, snapT(T(e.clientX - r.left), e.altKey)));
  };
  const fxDragOver = (e: React.DragEvent) => {
    if (isFileDrag(e)) {
      // a video or image file: it will be inserted at the nearest cut, or split the clip under it
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      const t = dropTime(e);
      const edges = [0, ...tl.items.map((it) => it.outEnd)];
      const near = edges.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), edges[0]);
      const snapEdge = Math.abs(X(near) - X(t)) < 14;
      setFileDrop({ x: X(snapEdge ? near : t), label: snapEdge ? (near === 0 ? "Add at the start" : near >= tl.duration - 1e-3 ? "Add at the end" : `Insert at ${fmtT(near, true)}`) : `Insert at ${fmtT(t, true)} (splits the clip)` });
      return;
    }
    if (!isFxDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const t = dropTime(e);
    // the item isn't readable during dragover, so show where it lands; transitions snap to the nearest cut on drop
    const c = nearestCut(t);
    const nearCut = !!c && Math.abs(X(c.outStart) - X(t)) < 28;
    setFxDrop({ x: nearCut ? X(c!.outStart) : X(t), label: nearCut ? `Cut ${fmtT(c!.outStart, true)}` : fmtT(t, true), cut: nearCut });
  };
  const fxDragLeave = (e: React.DragEvent) => {
    if (wrap.current?.contains(e.relatedTarget as Node | null)) return;
    setFxDrop(null);
    setFileDrop(null);
  };
  const fxDropIn = (e: React.DragEvent) => {
    if (isFileDrag(e)) {
      e.preventDefault(); e.stopPropagation();
      setFileDrop(null);
      const t = dropTime(e);
      const edges = [0, ...tl.items.map((it) => it.outEnd)];
      const near = edges.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), edges[0]);
      const at = Math.abs(X(near) - X(t)) < 14 ? near : t;
      const files = Array.from(e.dataTransfer.files ?? []);
      void (async () => { for (const f of files) await ed.addMediaClip(f, at <= 0 ? "start" : at >= tl.duration - 1e-3 ? "end" : "playhead", at); })();
      return;
    }
    if (!isFxDrag(e)) return;
    e.preventDefault();
    setFxDrop(null);
    let ref: { pack: string; id: string };
    try { ref = JSON.parse(e.dataTransfer.getData(FX_DRAG_TYPE)); } catch { return; }
    const item = findItem(ref.pack, ref.id);
    if (!item) return;
    const t = dropTime(e);
    if (item.action.type === "transition") {
      const c = nearestCut(t);
      if (c) setSelection({ kind: "clip", id: c.clip.id });
      void applyEffect(item, { time: t, clipId: c?.clip.id ?? null });
    } else {
      void applyEffect(item, { time: t });
    }
  };
  const openCut = (id: string, el: HTMLElement) => {
    setSelection({ kind: "clip", id });
    setCutOpen({ id, el });
  };

  // the "+" at the end and the floating actions: one guarded lookup each, using the exact y they are
  // drawn at, so a row half-scrolled under the ruler or the bottom edge can't crash the render
  const endPos = endX > -10 && endX < width + 40 ? onScreen(Math.min(width - 18, endX + 16), yVideo + VIDEO_H / 2) : null;
  const actPos = selPos ? onScreen(Math.max(4, Math.min(width - 4, (Math.max(0, selPos.x0) + Math.min(width, selPos.x1)) / 2)), selPos.y) : null;
  return (
    <div className="mtl">
      <div className="mtl-bar" role="toolbar" aria-label="Timeline">
        <button className="btn icon small ghost" onClick={ed.undo} disabled={!ed.project.canUndo} aria-label="Undo" data-tip="Undo (Ctrl+Z)"><IconUndo size={15} /></button>
        <button className="btn icon small ghost" onClick={ed.redo} disabled={!ed.project.canRedo} aria-label="Redo" data-tip="Redo (Ctrl+Shift+Z)"><IconRedo size={15} /></button>
        <span className="mtl-sep" aria-hidden="true" />
        <button className="btn small ghost" onClick={split} data-tip="Split the clip at the playhead (S)"><IconScissors size={15} /> Split</button>
        <button className="btn small ghost" onClick={del} disabled={!canDelete} data-tip={selection?.kind === "caption" ? "Hide / show this caption" : "Delete the selected clip, graphic, effect or sound (Del)"}><IconTrash size={15} /> Delete</button>
        <button className="btn small ghost" disabled={!joinId} onClick={join} data-tip={joinId ? "Join the clips at the nearest cut (undo a split)" : "Nothing to join: split a clip first"}><IconJoin size={15} /> Join</button>
        <span className="mtl-sep" aria-hidden="true" />
        <button className="btn small ghost mtl-add" onClick={() => mediaRef.current?.click()} data-tip="Add a video or image clip at the playhead (or drop a file on the timeline)"><IconPlus size={15} /> Add media</button>
        <input ref={mediaRef} type="file" accept={addAccept} multiple hidden onChange={async (e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; const where = addAccept.startsWith("video/*,image") ? "playhead" : "end"; for (const f of fs) await ed.addMediaClip(f, where); setAddAccept("video/*,image/*,.mp4,.mov,.m4v,.webm,.mkv"); }} />
        <button className="btn small ghost" onClick={() => ed.setPanel("edit", true)} data-tip="Trim, speed, framing, transitions"><IconTransition size={15} /> Clip options</button>
        <span className="mtl-spacer" />
        <button className="btn icon small ghost" onClick={() => { playback.seek(0); panTo(0); }} aria-label="Go to the start" data-tip="Start (Home)"><IconChevronLeft size={15} /></button>
        <button className="btn icon small ghost" onClick={() => { playback.seek(dur); panTo(maxView); }} aria-label="Go to the end" data-tip="End (End)"><IconChevronRight size={15} /></button>
        <button className={`btn small ghost snap-btn ${snap ? "on" : ""}`} onClick={() => setSnap((v) => !v)} aria-pressed={snap} data-tip="Snap to edges and playhead (hold Alt to bypass)"><IconMagnet size={15} /> Snap</button>
        <button className="btn icon small" onClick={() => setZoomKeepingPlayhead(Math.max(0.2, zoom / 1.5))} aria-label="Zoom out">−</button>
        <input className="mtl-zoom" type="range" min={0} max={100} step={0.5} value={zoomSlider} aria-label="Timeline zoom"
          onChange={(e) => setZoomKeepingPlayhead(Math.exp(Z_MIN + (Number(e.target.value) / 100) * (Z_MAX - Z_MIN)))} />
        <button className="btn icon small" onClick={() => setZoomKeepingPlayhead(Math.min(200, zoom * 1.5))} aria-label="Zoom in">+</button>
        <button className="btn small ghost" onClick={() => { userZoomed.current = true; setZoom(1); setView(0); }} aria-label="Fit the whole timeline" data-tip="Fit the whole video on screen">Fit</button>
      </div>
      <div className="mtl-body">
        <div className="mtl-labels" aria-hidden="true" style={{ height: H }}>
          {([
            ["video", "Video", IconFrame, yVideo, VIDEO_H],
            ["caption", "Captions", IconWords, yCap, CAP_H],
            ["graphics", "Graphics", IconShapes, yLanes, nLanes * (LANE_H + 2) - 2],
            ["fx", "Effects", IconSparkle, yFx, nFx * (LANE_H + 2) - 2],
            ["sound", "Sounds", IconVolume, ySnd, nSnd * (LANE_H + 2) - 2],
            ["music", "Music", IconMusic, yMusic, MUSIC_H],
          ] as const).map(([k, name, Icon, top, h]) => (
            <span key={k} className={`mtl-label t-${k}`} style={{ top, height: h }}>
              <i className="mtl-chip"><Icon size={13} /></i>
              <b>{name}</b>
            </span>
          ))}
        </div>
        <div className={`mtl-canvas ${fxDrop || fileDrop ? "fx-over" : ""}`} ref={wrap} onWheel={wheel} onDragOver={fxDragOver} onDragEnter={fxDragOver} onDragLeave={fxDragLeave} onDrop={fxDropIn}>
          <canvas ref={cv} style={{ width: "100%", height: H }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={contextSelect}
            role="slider" aria-label="Timeline position" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(time)} tabIndex={0}
            onKeyDown={(e) => {
              // handled here only (the editor-wide shortcut would move the playhead a second time)
              const now = playback.getTime();
              if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); playback.seek(now - (e.shiftKey ? 5 : 1)); }
              if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); playback.seek(now + (e.shiftKey ? 5 : 1)); }
              if (e.key === "Home") { e.stopPropagation(); playback.seek(0); }
              if (e.key === "End") { e.stopPropagation(); playback.seek(dur); }
            }} />
          {/* a button on every cut, like other editors: shows the transition, click to change it */}
          {cuts.map((it) => {
            const x = X(it.outStart);
            if (x < 10 || x > width - 10) return null;
            const tr = it.clip.transition && it.clip.transition.kind !== "none" ? it.clip.transition : null;
            const on = selection?.kind === "clip" && selection.id === it.clip.id;
            return (
              <button key={it.clip.id} className={`cut-btn ${tr ? "has" : ""} ${on ? "on" : ""}`} style={{ left: x, top: yVideo + VIDEO_H / 2 }}
                onClick={(e) => openCut(it.clip.id, e.currentTarget)} aria-label={`Transition at ${fmtT(it.outStart, true)}: ${tr ? transitionName(tr.kind) : "none"}`}
                data-tip={tr ? `${transitionName(tr.kind)}: click to change` : "Add a transition"}>
                {tr ? <IconTransition size={14} /> : <IconPlus size={13} />}
              </button>
            );
          })}
          {fxDrop ? (
            <div className={`fx-drop ${fxDrop.cut ? "cut" : ""}`} style={{ left: fxDrop.x }} aria-hidden="true"><span>{fxDrop.label}</span></div>
          ) : null}
          {fileDrop ? (
            <div className="fx-drop cut file" style={{ left: fileDrop.x }} aria-hidden="true"><span>{fileDrop.label}</span></div>
          ) : null}
          {/* "+" after the last clip: add a video, image or blank clip at the end */}
          {endPos ? createPortal(
            <div className={`tl-end ${Math.min(width - 18, endX + 16) > width - 200 ? "flip" : ""}`} style={{ position: "fixed", left: endPos.x, top: endPos.y }}>
              <button className={`cut-btn tl-end-btn tip-left ${addMenu ? "on" : ""}`} onClick={() => setAddMenu((v) => !v)} aria-label="Add a clip at the end" aria-expanded={addMenu} data-tip="Add a clip at the end"><IconPlus size={15} /></button>
              {addMenu ? (
                <div className="tl-menu" role="menu">
                  <button role="menuitem" onClick={() => pickMedia("video/*,.mp4,.mov,.m4v,.webm,.mkv")}><IconFrame size={14} /> Video clip</button>
                  <button role="menuitem" onClick={() => pickMedia("image/*")}><span className="add-ico ai-image mini" aria-hidden="true" /> Image clip</button>
                  <button role="menuitem" onClick={() => { setAddMenu(false); ed.placeClip({ id: ed.uid("c"), kind: "card", duration: 1, background: { kind: "color", color: "#000000" } }, "end"); }}><span className="add-ico ai-blank mini" aria-hidden="true" /> Blank colour</button>
                </div>
              ) : null}
            </div>, document.body) : null}
          {/* actions for the selected item, right above it */}
          {actPos && selPos && selection ? createPortal(
            // not enough room above the row (it would cover the toolbar) → sit under the row instead
            <div className={`tl-actions k-${selection.kind} ${actPos.y - (rect?.bodyTop ?? 0) < 46 ? "below" : ""}`}
              style={{ position: "fixed", left: actPos.x, top: actPos.y + (actPos.y - (rect?.bodyTop ?? 0) < 46 ? selPos.h : 0) }}
              role="toolbar" aria-label="Actions for the selected item">
              {selection.kind === "clip" ? (<>
                <button onClick={splitSelClip} data-tip="Split at the playhead (S)"><IconScissors size={14} /><span>Split</span></button>
                <button onClick={duplicateClip} data-tip="Duplicate"><IconCopy size={14} /><span>Duplicate</span></button>
                <button onClick={() => ed.setPanel("edit", true)} data-tip="Trim, speed, framing, transition"><IconSettings size={14} /><span>Options</span></button>
                <button className="danger" onClick={del} disabled={ed.clips.length < 2} data-tip="Delete (Del)"><IconTrash size={14} /></button>
              </>) : selection.kind === "layer" ? (<>
                {selLayerObj?.text !== undefined && selLayerObj.kind !== "speakerLabel" ? <button onClick={() => { ed.setPanel("graphics", true); setTimeout(() => (document.querySelector(".layer-text textarea") as HTMLTextAreaElement | null)?.focus(), 350); }} data-tip="Edit the text (or double-click it on the video)"><IconEdit size={14} /><span>Text</span></button> : null}
                <button onClick={() => ed.setPanel("graphics", true)} data-tip="Font, colour, size, timing, motion"><IconSettings size={14} /><span>Style</span></button>
                <button onClick={duplicateLayer} data-tip="Duplicate (Ctrl+D)"><IconCopy size={14} /><span>Duplicate</span></button>
                <button onClick={() => selLayerObj && ed.updateLayer(selLayerObj.id, { hidden: !selLayerObj.hidden || undefined })} data-tip={selLayerObj?.hidden ? "Show" : "Hide"}>{selLayerObj?.hidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}</button>
                <button className="danger" onClick={del} data-tip="Delete (Del)"><IconTrash size={14} /></button>
              </>) : selection.kind === "caption" ? (<>
                <button onClick={() => ed.setPanel("captions", true)} data-tip="Words, timing and style of this caption"><IconEdit size={14} /><span>Edit</span></button>
                <button onClick={del} data-tip={selCaptionHidden ? "Show this caption" : "Hide this caption"}>{selCaptionHidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}<span>{selCaptionHidden ? "Show" : "Hide"}</span></button>
              </>) : (<>
                <button onClick={() => ed.setPanel("effects", true)} data-tip="Settings"><IconSettings size={14} /><span>Options</span></button>
                <button className="danger" onClick={del} data-tip="Delete (Del)"><IconTrash size={14} /></button>
              </>)}
            </div>, document.body) : null}
        </div>
      </div>
      {/* scrollbar: shows which part of the timeline is on screen; drag it to move around */}
      {maxView > 0 ? (
        <div className="mtl-scroll" onPointerDown={sbDown} onPointerMove={sbMove} onPointerUp={sbUp} onPointerCancel={sbUp} role="scrollbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((view / Math.max(1e-6, maxView)) * 100)} aria-label="Timeline position">
          <span className="mtl-thumb" style={{ left: `${(view / (maxView + span)) * 100}%`, width: `${Math.max(4, (span / (maxView + span)) * 100)}%` }} />
        </div>
      ) : null}
      {cutOpen ? <CutSheet clipId={cutOpen.id} anchor={cutOpen.el} onClose={() => setCutOpen(null)} /> : null}
    </div>
  );
}
