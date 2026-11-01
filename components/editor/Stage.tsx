"use client";
/**
 * The preview: draws every frame with the same renderer as the export, and
 * lets you move/resize captions and move/resize/rotate graphics directly on
 * the video, with centre snapping.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "./EditorContext";
import { renderFrame, type SourceFrame } from "@/lib/renderFrame";
import { itemAt, transitionAt } from "@/lib/edl";
import { outputSize, platformById } from "@/lib/frame";
import { layerBox } from "@/lib/layers";
import { makeThumb } from "@/lib/library";
import type { CaptionBox } from "@/lib/render";
import type { Layer } from "@/lib/project";
import { IconAlignH, IconAlignV, IconCheck, IconX, IconTrash, IconCopy, IconEdit } from "@/components/Icons";
import { BrandedLoader } from "@/components/ui";
import { Dashboard } from "./Dashboard";

type Drag =
  | { kind: "caption"; mode: "move" | "resize" | "click"; sx: number; sy: number; k: number; W: number; H: number; posX: number; posY: number; size: number; d0: number; moved: boolean; key: string | null }
  | { kind: "layer"; mode: "move" | "resize" | "rotate"; id: string; sx: number; sy: number; k: number; W: number; H: number; l0: Layer; moved: boolean; cx: number; cy: number; a0: number };

export function Stage() {
  const ed = useEditor();
  const { doc, videoRef, musicRef, videoUrl, musicUrl, playback, tl, lines, selection, setSelection, scope, project } = ed;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const capBoxRef = useRef<CaptionBox | null>(null);
  const capSelRef = useRef<HTMLDivElement>(null);
  const layerSelRef = useRef<HTMLDivElement>(null);
  const guideXRef = useRef<HTMLDivElement>(null);
  const guideYRef = useRef<HTMLDivElement>(null);
  const thumbPending = useRef(false);
  const [centred, setCentred] = useState<{ x: boolean; y: boolean } | null>(null);
  /** Text graphic being edited in place on the video. */
  const [editing, setEditing] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const [fileOver, setFileOver] = useState(false);
  const drag = useRef<Drag | null>(null);
  /** Fingers / pointers currently down on the stage (for pinch). */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** Two-finger pinch: resize (and move) the selected caption or graphic. */
  const pinch = useRef<
    | { kind: "caption"; key: string | null; d0: number; mx0: number; my0: number; size: number; posX: number; posY: number; k: number; W: number; H: number }
    | { kind: "layer"; id: string; d0: number; mx0: number; my0: number; l0: Layer; k: number; W: number; H: number }
    | null
  >(null);

  /* ---------- render loop ---------- */
  const live = useRef({ doc, lines, tl, selection, showWm: ed.showWm, wmCorner: ed.settings.wmCorner, isEmpty: ed.isEmpty, quality: ed.settings.previewQuality, grid: ed.settings.showGrid });
  live.current = { doc, lines, tl, selection, showWm: ed.showWm, wmCorner: ed.settings.wmCorner, isEmpty: ed.isEmpty, quality: ed.settings.previewQuality, grid: ed.settings.showGrid };

  const hasDrawn = useRef(false);
  useEffect(() => {
    let raf = 0;
    let lastUi = 0;
    hasDrawn.current = false;
    const tick = (now: number) => {
      const t = playback.tick(now);
      const c = canvasRef.current;
      const v = videoRef.current;
      const L = live.current;
      if (c) {
        const hasV = !!(v && videoUrl && v.videoWidth);
        const sw = hasV ? v!.videoWidth : 1080;
        const sh = hasV ? v!.videoHeight : 1920;
        const cap = L.quality === "half" ? 540 : L.quality === "full" ? Math.min(sw, sh) : Math.min(1080, Math.min(sw, sh));
        const { w: W, h: H } = outputSize(sw, sh, L.doc.frame.aspect, cap);
        if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
        const ctx = c.getContext("2d")!;
        if (L.isEmpty) {
          ctx.clearRect(0, 0, W, H);
          capBoxRef.current = null;
        } else {
          const it = itemAt(L.tl, t);
          // the player lined up on this clip (image clips draw themselves)
          const src: SourceFrame | null = it?.clip.kind === "video" ? playback.frameFor(it.index) : null;
          const tr = transitionAt(L.tl, t);
          const otherIt = tr ? (tr.phase === "out" ? tr.to : tr.from) : null;
          const pending = (it?.clip.kind === "video" && !src) || (!!otherIt && otherIt.clip.kind === "video" && !playback.frameFor(otherIt.index));
          c.dataset.pending = pending ? "1" : "0";
          // timing probe: set window.__capTrace = [] in the console to log every drawn frame
          const trace = (window as unknown as { __capTrace?: unknown[] }).__capTrace;
          if (trace) trace.push({ now, t, p: tr ? tr.p : null, pending, live: !!src, ct: src ? (src.image as HTMLVideoElement).currentTime : null, idx: it?.index ?? -1 });
          // a clip whose player is still finding its frame keeps the last good picture instead of flashing a wrong one
          if (!(it?.clip.kind === "video" && !src && hasDrawn.current)) capBoxRef.current = renderFrame(ctx, {
            W, H, t, tl: L.tl, frame: L.doc.frame, lines: L.lines, style: L.doc.style, overrides: L.doc.overrides,
            translations: L.doc.translations, layers: L.doc.layers, captionZ: L.doc.captionZ, speakers: L.doc.speakers,
            watermark: L.showWm ? { corner: L.wmCorner } : null, effects: L.doc.effects, other: (p) => playback.frameFor(p.index),
          }, src);
          hasDrawn.current = true;
          // safe-zone guide (editor only)
          const plat = platformById(L.doc.frame.platform);
          if (L.doc.frame.showSafeZone && plat.safe) {
            const [st, sr, sb, sl] = plat.safe;
            ctx.save();
            ctx.fillStyle = "rgba(214,255,54,0.10)";
            ctx.fillRect(0, 0, W, H * st);
            ctx.fillRect(0, H * (1 - sb), W, H * sb);
            ctx.fillRect(0, H * st, W * sl, H * (1 - st - sb));
            ctx.fillRect(W * (1 - sr), H * st, W * sr, H * (1 - st - sb));
            ctx.setLineDash([W * 0.012, W * 0.01]);
            ctx.strokeStyle = "rgba(214,255,54,0.95)";
            ctx.lineWidth = Math.max(2, W * 0.003);
            ctx.strokeRect(W * sl, H * st, W * (1 - sl - sr), H * (1 - st - sb));
            ctx.restore();
          }
          // rule-of-thirds grid (editor only)
          if (L.grid) {
            ctx.save();
            ctx.strokeStyle = "rgba(255,255,255,0.55)";
            ctx.lineWidth = Math.max(1, W * 0.002);
            ctx.shadowColor = "rgba(0,0,0,0.5)";
            ctx.shadowBlur = 2;
            ctx.beginPath();
            for (const f of [1 / 3, 2 / 3]) { ctx.moveTo(W * f, 0); ctx.lineTo(W * f, H); ctx.moveTo(0, H * f); ctx.lineTo(W, H * f); }
            ctx.stroke();
            ctx.restore();
          }
        }
        placeSelection(W, H, t);
      }
      if (now - lastUi > 80) { lastUi = now; ed.timeStore.set(t); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, playback]);

  /* ---------- selection overlays ---------- */
  const geom = () => {
    const st = stageRef.current!;
    const c = canvasRef.current!;
    const r = st.getBoundingClientRect();
    const W = c.width, H = c.height;
    const k = Math.min(r.width / W, r.height / H);
    return { r, W, H, k, ox: (r.width - W * k) / 2, oy: (r.height - H * k) / 2 };
  };

  function placeSelection(W: number, H: number, t: number) {
    const st = stageRef.current;
    if (!st) return;
    const r = st.getBoundingClientRect();
    const k = Math.min(r.width / W, r.height / H);
    const ox = (r.width - W * k) / 2;
    const oy = (r.height - H * k) / 2;
    const sel = live.current.selection;
    const cs = capSelRef.current;
    if (cs) {
      const b = capBoxRef.current;
      if (b && sel?.kind === "caption") {
        cs.style.display = "block";
        cs.style.left = `${ox + b.x * k}px`; cs.style.top = `${oy + b.y * k}px`;
        cs.style.width = `${b.w * k}px`; cs.style.height = `${b.h * k}px`;
      } else cs.style.display = "none";
    }
    const ls = layerSelRef.current;
    if (ls) {
      const l = sel?.kind === "layer" ? live.current.doc.layers?.find((x) => x.id === sel.id) : undefined;
      if (l && !l.hidden && t >= l.start && t < l.end) {
        const b = layerBox(l, W, H);
        ls.style.display = "block";
        ls.style.left = `${ox + b.x * k}px`; ls.style.top = `${oy + b.y * k}px`;
        ls.style.width = `${b.w * k}px`; ls.style.height = `${b.h * k}px`;
        ls.style.transform = `rotate(${l.rotation}deg)`;
        ls.classList.toggle("locked", !!l.locked);
      } else ls.style.display = "none";
    }
  }

  const toCanvas = (cx: number, cy: number) => {
    const g = geom();
    return { x: (cx - g.r.left - g.ox) / g.k, y: (cy - g.r.top - g.oy) / g.k, ...g };
  };

  const hitCaption = (x: number, y: number, k: number) => {
    const b = capBoxRef.current;
    const pad = 14 / k;
    return !!b && x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
  };

  const hitLayer = (x: number, y: number, W: number, H: number): Layer | null => {
    const t = playback.getTime();
    const ls = (doc.layers ?? []).filter((l) => !l.hidden && t >= l.start && t < l.end).sort((a, b) => b.z - a.z);
    for (const l of ls) {
      const cx = (W * l.x) / 100;
      const cy = (H * l.y) / 100;
      const a = (-l.rotation * Math.PI) / 180;
      const dx = x - cx, dy = y - cy;
      const rx = dx * Math.cos(a) - dy * Math.sin(a);
      const ry = dx * Math.sin(a) + dy * Math.cos(a);
      const hw = Math.max(12, (W * l.w) / 200), hh = Math.max(12, (H * l.h) / 200);
      if (Math.abs(rx) <= hw && Math.abs(ry) <= hh) return l;
    }
    return null;
  };

  /** Centre lines: faint while dragging, bright when exactly centred. */
  const showGuides = useCallback((on: boolean, x = false, y = false) => {
    const set = (el: HTMLDivElement | null, hit: boolean) => { if (!el) return; el.style.display = on ? "block" : "none"; el.classList.toggle("hit", hit); };
    const st = stageRef.current;
    const c = canvasRef.current;
    if (st && c && c.width) {
      const r = st.getBoundingClientRect();
      const k = Math.min(r.width / c.width, r.height / c.height);
      const fw = c.width * k, fh = c.height * k;
      if (guideXRef.current) { guideXRef.current.style.top = `${(r.height - fh) / 2}px`; guideXRef.current.style.height = `${fh}px`; }
      if (guideYRef.current) { guideYRef.current.style.left = `${(r.width - fw) / 2}px`; guideYRef.current.style.width = `${fw}px`; }
    }
    set(guideXRef.current, x);
    set(guideYRef.current, y);
    setCentred(on ? { x, y } : null);
  }, []);

  const startPinch = (): boolean => {
    const pts = [...pointers.current.values()];
    if (pts.length !== 2) return false;
    const g = geom();
    const d0 = Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
    const mx0 = (pts[0].x + pts[1].x) / 2, my0 = (pts[0].y + pts[1].y) / 2;
    const d = drag.current;
    const layerId = d?.kind === "layer" ? d.id : selection?.kind === "layer" ? selection.id : null;
    const l = layerId ? doc.layers?.find((x) => x.id === layerId) : undefined;
    if (l && !l.locked) {
      pinch.current = { kind: "layer", id: l.id, d0, mx0, my0, l0: l, k: g.k, W: g.W, H: g.H };
    } else {
      const b = capBoxRef.current;
      if (!b) return false;
      const key = b.key ?? null;
      const useLine = scope === "line" && key;
      const ov = key ? doc.overrides[key] : undefined;
      const st = doc.style;
      if (key) setSelection({ kind: "caption", key });
      pinch.current = {
        kind: "caption", key, d0, mx0, my0, k: g.k, W: g.W, H: g.H,
        size: (useLine ? ov?.sizeVh : undefined) ?? st.sizeVh,
        posX: (useLine ? ov?.posX : undefined) ?? st.posX ?? 50,
        posY: (useLine ? ov?.posY : undefined) ?? st.posY,
      };
    }
    if (!d) project.checkpoint();
    playback.pause();
    drag.current = null;
    showGuides(false);
    return true;
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || ed.isEmpty) return;
    const target = e.target as HTMLElement;
    if (target.closest(".dash, button, textarea, .stage-toolbar, .restore-note, .key-callout, a")) return;
    if (editing) setEditing(null);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && startPinch()) { e.currentTarget.setPointerCapture(e.pointerId); return; }
    if (pointers.current.size > 2 || pinch.current) return;
    const p = toCanvas(e.clientX, e.clientY);
    // layer handles first
    const handle = target.closest("[data-handle]")?.getAttribute("data-handle");
    if (handle && selection?.kind === "layer") {
      const l = doc.layers?.find((x) => x.id === selection.id);
      if (l && !l.locked) {
        project.checkpoint();
        playback.pause();
        const cx = (p.W * l.x) / 100, cy = (p.H * l.y) / 100;
        drag.current = { kind: "layer", mode: handle === "rotate" ? "rotate" : "resize", id: l.id, sx: e.clientX, sy: e.clientY, k: p.k, W: p.W, H: p.H, l0: l, moved: false, cx, cy, a0: Math.atan2(p.y - cy, p.x - cx) };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }
    const capHandle = !!target.closest(".sel-handle");
    if (!capHandle) {
      const l = hitLayer(p.x, p.y, p.W, p.H);
      if (l) {
        setSelection({ kind: "layer", id: l.id });
        if (!l.locked) {
          project.checkpoint();
          playback.pause();
          drag.current = { kind: "layer", mode: "move", id: l.id, sx: e.clientX, sy: e.clientY, k: p.k, W: p.W, H: p.H, l0: l, moved: false, cx: 0, cy: 0, a0: 0 };
          showGuides(true, Math.abs(l.x - 50) < 0.01, Math.abs(l.y - 50) < 0.01);
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }
    const b = capBoxRef.current;
    let mode: "move" | "resize" | "click" = "click";
    if (capHandle && b) mode = "resize";
    else if (hitCaption(p.x, p.y, p.k)) mode = "move";
    const key = b?.key ?? null;
    if (mode !== "click") {
      if (key) setSelection({ kind: "caption", key });
      project.checkpoint();
      playback.pause();
    }
    const ov = key ? doc.overrides[key] : undefined;
    const useLine = scope === "line" && key;
    const st = doc.style;
    const d0 = b ? Math.max(8, Math.hypot(p.x - (b.x + b.w / 2), p.y - (b.y + b.h / 2))) : 1;
    drag.current = {
      kind: "caption", mode, sx: e.clientX, sy: e.clientY, k: p.k, W: p.W, H: p.H, key,
      posX: (useLine ? ov?.posX : undefined) ?? st.posX ?? 50,
      posY: (useLine ? ov?.posY : undefined) ?? st.posY,
      size: (useLine ? ov?.sizeVh : undefined) ?? st.sizeVh,
      d0, moved: false,
    };
    if (mode === "move") {
      const d = drag.current;
      showGuides(true, Math.abs(d.posX - 50) < 0.01, Math.abs(d.posY - 50) < 0.01);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const setCaptionPos = (key: string | null, p: { posX?: number; posY?: number; sizeVh?: number }) => {
    if (scope === "line" && key) {
      project.update((d) => ({ ...d, overrides: { ...d.overrides, [key]: { ...d.overrides[key], ...p } } }), { history: false });
    } else project.update((d) => ({ ...d, style: { ...d.style, ...p } }), { history: false });
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pc = pinch.current;
    if (pc) {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const scale = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / pc.d0;
      const dx = ((pts[0].x + pts[1].x) / 2 - pc.mx0) / pc.k;
      const dy = ((pts[0].y + pts[1].y) / 2 - pc.my0) / pc.k;
      if (pc.kind === "caption") {
        setCaptionPos(pc.key, {
          sizeVh: +Math.min(16, Math.max(2, pc.size * scale)).toFixed(2),
          posX: +Math.min(100, Math.max(0, pc.posX + (dx / pc.W) * 100)).toFixed(2),
          posY: +Math.min(98, Math.max(2, pc.posY + (dy / pc.H) * 100)).toFixed(2),
        });
      } else {
        const l0 = pc.l0;
        const w = Math.max(2, l0.w * scale), h = Math.max(1, l0.h * scale);
        const x = Math.min(100, Math.max(0, l0.x + (dx / pc.W) * 100)), y = Math.min(100, Math.max(0, l0.y + (dy / pc.H) * 100));
        project.update((doc2) => ({ ...doc2, layers: (doc2.layers ?? []).map((l) => (l.id === pc.id ? { ...l, w: +w.toFixed(2), h: +h.toFixed(2), x: +x.toFixed(2), y: +y.toFixed(2) } : l)) }), { history: false });
      }
      return;
    }
    const d = drag.current;
    if (!d) {
      if (ed.isEmpty) return;
      const p = toCanvas(e.clientX, e.clientY);
      const st = stageRef.current;
      const t = e.target as HTMLElement;
      if (st) st.style.cursor = t.closest("[data-handle=rotate]") ? "grab" : t.closest(".sel-handle, [data-handle=resize]") ? "nwse-resize" : hitLayer(p.x, p.y, p.W, p.H) || hitCaption(p.x, p.y, p.k) ? "move" : "default";
      return;
    }
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) d.moved = true;
    if (!d.moved) return;
    if (d.kind === "layer") {
      const l0 = d.l0;
      if (d.mode === "move") {
        let x = Math.min(100, Math.max(0, l0.x + ((e.clientX - d.sx) / d.k / d.W) * 100));
        let y = Math.min(100, Math.max(0, l0.y + ((e.clientY - d.sy) / d.k / d.H) * 100));
        const sx = Math.abs(x - 50) < 1.2, sy = Math.abs(y - 50) < 1.2;
        if (sx) x = 50;
        if (sy) y = 50;
        showGuides(true, sx, sy);
        project.update((doc2) => ({ ...doc2, layers: (doc2.layers ?? []).map((l) => (l.id === d.id ? { ...l, x: +x.toFixed(2), y: +y.toFixed(2) } : l)) }), { history: false });
      } else if (d.mode === "resize") {
        const p = toCanvas(e.clientX, e.clientY);
        const a = (-l0.rotation * Math.PI) / 180;
        const dx = p.x - d.cx, dy = p.y - d.cy;
        const rx = Math.abs(dx * Math.cos(a) - dy * Math.sin(a));
        const ry = Math.abs(dx * Math.sin(a) + dy * Math.cos(a));
        let w = Math.max(2, ((rx * 2) / d.W) * 100);
        let h = Math.max(1, ((ry * 2) / d.H) * 100);
        if (e.shiftKey) { const k = Math.max(w / l0.w, h / l0.h); w = l0.w * k; h = l0.h * k; }
        project.update((doc2) => ({ ...doc2, layers: (doc2.layers ?? []).map((l) => (l.id === d.id ? { ...l, w: +w.toFixed(2), h: +h.toFixed(2) } : l)) }), { history: false });
      } else {
        const p = toCanvas(e.clientX, e.clientY);
        const ang = Math.atan2(p.y - d.cy, p.x - d.cx);
        let deg = l0.rotation + ((ang - d.a0) * 180) / Math.PI;
        deg = ((deg + 540) % 360) - 180;
        // Shift: 15° steps. Otherwise snap to 0/45/90… when within 3°.
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        else if (Math.abs(deg - Math.round(deg / 45) * 45) < 3) deg = Math.round(deg / 45) * 45;
        project.update((doc2) => ({ ...doc2, layers: (doc2.layers ?? []).map((l) => (l.id === d.id ? { ...l, rotation: +deg.toFixed(1) } : l)) }), { history: false });
      }
      return;
    }
    if (d.mode === "click") return;
    if (d.mode === "move") {
      let x = Math.min(100, Math.max(0, d.posX + ((e.clientX - d.sx) / d.k / d.W) * 100));
      let y = Math.min(98, Math.max(2, d.posY + ((e.clientY - d.sy) / d.k / d.H) * 100));
      const sx = Math.abs(x - 50) < 1.5, sy = Math.abs(y - 50) < 1.2;
      if (sx) x = 50;
      if (sy) y = 50;
      showGuides(true, sx, sy);
      setCaptionPos(d.key, { posX: +x.toFixed(2), posY: +y.toFixed(2) });
    } else {
      const p = toCanvas(e.clientX, e.clientY);
      const b = capBoxRef.current;
      if (!b) return;
      const dist = Math.hypot(p.x - (b.x + b.w / 2), p.y - (b.y + b.h / 2));
      setCaptionPos(d.key, { sizeVh: +Math.min(16, Math.max(2, d.size * (dist / d.d0))).toFixed(2) });
    }
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      // the pinch ends when either finger lifts; the other finger does nothing until it lifts too
      if (pointers.current.size < 2) { pinch.current = null; drag.current = null; }
      return;
    }
    const d = drag.current;
    drag.current = null;
    showGuides(false);
    if (!d) return;
    if (d.kind === "caption" && !d.moved && d.mode === "click") {
      if (selection) setSelection(null);
      else playback.toggle();
    }
  };

  const centre = (axis: "x" | "y") => {
    if (selection?.kind === "layer") {
      ed.updateLayer(selection.id, axis === "x" ? { x: 50 } : { y: 50 });
    } else {
      const key = selection?.kind === "caption" ? selection.key : null;
      if (scope === "line" && key) project.update((d) => ({ ...d, overrides: { ...d.overrides, [key]: { ...d.overrides[key], ...(axis === "x" ? { posX: 50 } : { posY: 50 }) } } }));
      else project.update((d) => ({ ...d, style: { ...d.style, ...(axis === "x" ? { posX: 50 } : { posY: 50 }) } }));
    }
    showGuides(true, axis === "x", axis === "y");
    setTimeout(() => showGuides(false), 900);
  };

  const selLayer = selection?.kind === "layer" ? doc.layers?.find((l) => l.id === selection.id) : undefined;
  const selKey = selection?.kind === "caption" ? selection.key : null;
  const TEXT_KINDS = ["text", "titleCard", "lowerThird", "callout", "sticker"];
  const canEditText = !!selLayer && TEXT_KINDS.includes(selLayer.kind);

  /** Edit a text graphic right on the video (double-click, or the pencil in the toolbar). */
  const startEdit = (id: string) => {
    const l = doc.layers?.find((x) => x.id === id);
    if (!l || !TEXT_KINDS.includes(l.kind)) return;
    playback.pause();
    playback.seek(Math.max(l.start, Math.min(l.end - 0.05, playback.getTime())));
    setSelection({ kind: "layer", id });
    setEditing(id);
    setTimeout(() => { editRef.current?.focus(); editRef.current?.select(); }, 30);
  };
  const onDouble = (e: React.MouseEvent<HTMLDivElement>) => {
    if (ed.isEmpty) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, textarea, .stage-toolbar, a")) return;
    const p = toCanvas(e.clientX, e.clientY);
    const l = hitLayer(p.x, p.y, p.W, p.H);
    if (l && TEXT_KINDS.includes(l.kind) && !l.locked) startEdit(l.id);
    else if (l) ed.setPanel("graphics", true);
    else if (hitCaption(p.x, p.y, p.k)) ed.setPanel("captions", true);
  };

  /* ---------- files dropped on the video ---------- */
  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e) || ed.isEmpty) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (!fileOver) setFileOver(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (stageRef.current?.contains(e.relatedTarget as Node | null)) return;
    setFileOver(false);
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e) || ed.isEmpty) return;
    e.preventDefault(); e.stopPropagation();
    setFileOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    const p = toCanvas(e.clientX, e.clientY);
    const pos = { x: Math.round(Math.min(95, Math.max(5, (p.x / p.W) * 100))), y: Math.round(Math.min(95, Math.max(5, (p.y / p.H) * 100))) };
    for (const f of files) {
      if (/^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name)) void ed.addGraphicFile(f, pos); // on the video = a graphic on top
      else if (f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name)) void ed.addMediaClip(f, "playhead"); // a video = a clip at the playhead
      else ed.handleFiles([f]);
    }
  };

  return (
    <div className={`stage ${fileOver ? "file-over" : ""}`} ref={stageRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDouble}
      onDragOver={onDragOver} onDragEnter={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      aria-label="Video preview. Click a caption or graphic to select it; drag to move; double-click text to edit it." role="application">
      {/* extra videos added as clips: one hidden element each, driven by the playback clock */}
      {Object.entries(ed.sourceUrls).filter(([id]) => ed.clips.some((c) => c.kind === "video" && c.sourceId === id)).map(([id, url]) => (
        <video key={id} src={url} playsInline preload="auto" className="source-video" muted={!!doc.audio?.muted}
          ref={(el) => { if (el) ed.extraVideos.current.set(id, el); else ed.extraVideos.current.delete(id); }}
          onLoadedMetadata={(e) => { e.currentTarget.playbackRate = playback.rate; }} />
      ))}
      {/* a twin player per source, so the next clip is already on its frame at a cut (lib/overlap.ts) */}
      {[...(videoUrl ? [["main", videoUrl] as const] : []), ...Object.entries(ed.sourceUrls).filter(([id]) => ed.clips.some((c) => c.kind === "video" && c.sourceId === id))].map(([id, url]) => (
        <video key={`twin-${id}`} src={url} playsInline preload="auto" muted className="source-video" aria-hidden="true"
          ref={(el) => { if (el) ed.twinVideos.current.set(id, el); else ed.twinVideos.current.delete(id); }} />
      ))}
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          playsInline
          preload="auto"
          className="source-video"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            ed.setVideoDuration(v.duration);
            ed.setSrcDims({ w: v.videoWidth, h: v.videoHeight });
            project.setMeta({ duration: v.duration });
            v.playbackRate = playback.rate;
          }}
          onLoadedData={(e) => {
            const v = e.currentTarget;
            if (!ed.meta.thumb && v.duration) { thumbPending.current = true; v.currentTime = Math.min(1, v.duration * 0.3); }
          }}
          onSeeked={() => {
            if (!thumbPending.current) return;
            thumbPending.current = false;
            requestAnimationFrame(() => requestAnimationFrame(() => {
              const c = canvasRef.current;
              if (c && c.width) project.setMeta({ thumb: makeThumb(c, c.width, c.height) });
              playback.seek(playback.getTime());
            }));
          }}
          onError={() => ed.toast({ kind: "error", title: "This browser can't play the video", message: "It may use a format like HEVC (common on iPhone). Try Chrome or Edge, or convert it to an H.264 MP4." })}
        />
      ) : null}
      {musicUrl ? <audio ref={musicRef} src={musicUrl} preload="auto" hidden /> : null}
      <canvas ref={canvasRef} className="preview" hidden={ed.isEmpty} />
      {ed.work ? <BrandedLoader overlay label={ed.work.label} progress={ed.work.progress} /> : null}
      <div className="guide-x" ref={guideXRef} />
      <div className="guide-y" ref={guideYRef} />
      {centred && (centred.x || centred.y) ? (
        <div className="centred-badge" role="status"><IconCheck size={14} /> {centred.x && centred.y ? "Centred" : centred.x ? "Centred left–right" : "Centred top–bottom"}</div>
      ) : null}
      <div className="sel-box" ref={capSelRef}><span className="sel-handle" title="Drag to resize" /></div>
      <div className={`layer-sel ${editing ? "editing" : ""}`} ref={layerSelRef}>
        <span data-handle="resize" className="lh lh-br" title="Drag to resize (Shift keeps proportions)" />
        <span data-handle="rotate" className="lh lh-rot" title="Drag to rotate (Shift snaps to 45°)" />
        {editing && selLayer && selLayer.id === editing ? (
          <textarea ref={editRef} className="stage-text-edit" value={selLayer.text ?? ""} aria-label="Graphic text" rows={2}
            onChange={(e) => ed.updateLayer(selLayer.id, { text: e.target.value }, `text:${selLayer.id}`)}
            onKeyDown={(e) => { if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); setEditing(null); } }}
            onBlur={() => setEditing(null)} />
        ) : null}
      </div>
      {fileOver ? <div className="stage-drop-hint" aria-hidden="true"><b>Drop here</b><span>Image → graphic on the video · Video → clip at the playhead</span></div> : null}

      {selection?.kind === "caption" || selLayer ? (
        <div className="stage-toolbar" role="toolbar" aria-label={selLayer ? "Graphic" : "Caption position"}>
          {selLayer ? (
            <>
              <span className="stb-name">{selLayer.name}</span>
              {canEditText ? <button className="btn small ghost stb-edit" onClick={() => startEdit(selLayer.id)} aria-label="Edit text" data-tip="Edit the text (double-click the graphic)"><IconEdit size={14} /> Edit text</button> : null}
              <button className="btn small ghost" onClick={() => ed.setPanel("graphics", true)} data-tip="Font, colour, size, timing and motion">Style…</button>
              <button className="btn small ghost" onClick={() => { const c = { ...selLayer, id: ed.uid("L"), x: Math.min(95, selLayer.x + 3), y: Math.min(95, selLayer.y + 3), z: ed.nextZ() }; ed.addLayer(c); }} aria-label="Duplicate" data-tip="Duplicate"><IconCopy size={14} /></button>
              <button className="btn small ghost danger" onClick={() => ed.removeLayer(selLayer.id)} aria-label="Delete graphic" data-tip="Delete (Del)"><IconTrash size={14} /></button>
            </>
          ) : (
            <div className="seg">
              <button className={scope === "all" ? "on" : ""} onClick={() => ed.setScope("all")}>All captions</button>
              <button className={scope === "line" ? "on" : ""} onClick={() => { ed.setScope("line"); ed.setPanel("captions"); }}>This caption</button>
            </div>
          )}
          <button className="btn icon small ghost" onClick={() => centre("x")} data-tip="Centre left–right" aria-label="Centre horizontally"><IconAlignH size={16} /></button>
          <button className="btn icon small ghost" onClick={() => centre("y")} data-tip="Centre top–bottom" aria-label="Centre vertically"><IconAlignV size={16} /></button>
          {selKey && doc.overrides[selKey] ? (
            <button className="btn small ghost" onClick={() => project.update((d) => { const o = { ...d.overrides }; delete o[selKey]; return { ...d, overrides: o }; })}>Reset this caption</button>
          ) : null}
          <button className="btn icon small ghost" onClick={() => setSelection(null)} aria-label="Done"><IconX size={14} /></button>
        </div>
      ) : lines.length || doc.layers?.length ? (
        <div className="stage-hint">Click a caption or graphic to move it · double-click text to edit</div>
      ) : null}

      {ed.needsKey && !ed.isEmpty && !doc.words.length && !ed.transcription.busy ? (
        <div className="key-callout" role="alert">
          <span className="key-callout-ico" aria-hidden="true">🔑</span>
          <div>
            <strong>One step left: add your free ElevenLabs key</strong>
            <p>Captions are written by ElevenLabs on your own free account. It takes about 2 minutes, and only once on this device.</p>
            <div className="row-btns">
              <button className="btn primary" onClick={ed.openKeySetup}>Add my key</button>
              <a className="btn ghost" href="https://elevenlabs.io/app/developers/api-keys" target="_blank" rel="noopener noreferrer">Open ElevenLabs</a>
            </div>
          </div>
        </div>
      ) : null}
      {ed.isEmpty && ed.ready ? <Dashboard /> : null}
      {!videoUrl && doc.words.length ? (
        <div className="restore-note">{ed.meta.videoName ? `Drop ${ed.meta.videoName} to see these captions on the video.` : "Sample captions: drop a video to caption your own."}</div>
      ) : null}
    </div>
  );
}
