"use client";
/**
 * Graphics: add text, titles, lower thirds, callouts, speaker labels, shapes,
 * animated graphics, SVGs and images; order them with the captions; edit
 * position, size, rotation, opacity, timing and motion.
 */
import { useRef, useState } from "react";
import { useEditor, useTime } from "../EditorContext";
import { Color, Section, Select, Slider, Toggle } from "@/components/Controls";
import { IconArrowDown, IconArrowUp, IconEye, IconEyeOff, IconLock, IconUnlock, IconTrash, IconUpload, IconCopy, IconPlus, IconEdit } from "@/components/Icons";
import { LAYER_TEMPLATES, makeLayer } from "@/lib/layers";
import { ALL_FONTS, nearestWeight, fontByFamily } from "@/lib/fonts";
import { CAPTION_Z, DEFAULT_MOTION, type Direction, type Easing, type Layer, type LayerAnim, type ShapeKind } from "@/lib/project";

const ANIMS: { value: LayerAnim; label: string }[] = [
  { value: "none", label: "None" }, { value: "fade", label: "Fade" }, { value: "pop", label: "Pop" }, { value: "slide", label: "Slide" },
  { value: "wipe", label: "Wipe" }, { value: "zoom", label: "Zoom" }, { value: "spin", label: "Spin" }, { value: "bounce", label: "Bounce" },
  { value: "blur", label: "Blur" }, { value: "typewriter", label: "Typewriter (text)" },
];
const EASE: { value: Easing; label: string }[] = [
  { value: "ease-out", label: "Smooth stop" }, { value: "ease-in-out", label: "Smooth in & out" }, { value: "back", label: "Overshoot" },
  { value: "spring", label: "Spring" }, { value: "linear", label: "Linear" },
];
const DIRS: { value: Direction; label: string }[] = [{ value: "up", label: "Up" }, { value: "down", label: "Down" }, { value: "left", label: "Left" }, { value: "right", label: "Right" }];
const SHAPES: { value: ShapeKind; label: string }[] = [
  { value: "rect", label: "Box" }, { value: "circle", label: "Circle" }, { value: "line", label: "Line" }, { value: "arrow", label: "Arrow" },
  { value: "star", label: "Star" }, { value: "burst", label: "Burst" }, { value: "pulse", label: "Pulse rings (animated)" },
  { value: "sparkle", label: "Sparkles (animated)" }, { value: "underline", label: "Underline sweep (animated)" },
];
const TEXT_KINDS = new Set(["text", "titleCard", "lowerThird", "callout", "speakerLabel", "sticker"]);

type Row = { kind: "captions"; z: number } | { kind: "layer"; z: number; l: Layer };

export function GraphicsPanel() {
  const ed = useEditor();
  const time = useTime();
  const { doc, selection, setSelection, project, toast, aspect } = ed;
  const fileRef = useRef<HTMLInputElement>(null);
  const layers = doc.layers ?? [];
  const sel = selection?.kind === "layer" ? layers.find((l) => l.id === selection.id) : undefined;
  const capZ = doc.captionZ ?? CAPTION_Z;
  /** With a graphic selected, its settings come first and the catalogue folds away. */
  const [addOpen, setAddOpen] = useState(false);
  const showAdd = !sel || addOpen;

  const add = (templateId: string) => {
    const at = Math.max(0, Math.min(time, Math.max(0, ed.tl.duration - 0.5)));
    const l = makeLayer(templateId, at, aspect, ed.nextZ());
    if (l.kind !== "progress") l.end = Math.min(Math.max(at + 0.5, ed.tl.duration || at + 4), l.end);
    ed.addLayer(l);
    setAddOpen(false);
    toast({ kind: "success", title: `${l.name} added`, message: TEXT_KINDS.has(l.kind) ? "Double-click it on the video to change the text. Font, colour and size are below." : "Drag it on the video; change its timing on the timeline.", duration: 3000 });
  };

  // stacking list, top first
  const rows: Row[] = [{ kind: "captions" as const, z: capZ }, ...layers.map((l) => ({ kind: "layer" as const, z: l.z, l }))].sort((a, b) => b.z - a.z);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const order = rows.slice();
    [order[i], order[j]] = [order[j], order[i]];
    const n = order.length;
    const zOf = new Map<string, number>();
    let cz = capZ;
    order.forEach((r, idx) => { const z = (n - idx) * 10; if (r.kind === "captions") cz = z; else zOf.set(r.l.id, z); });
    project.update((d) => ({ ...d, captionZ: cz, layers: (d.layers ?? []).map((l) => ({ ...l, z: zOf.get(l.id) ?? l.z })) }));
  };

  const up = (p: Partial<Layer>) => sel && ed.updateLayer(sel.id, p);
  const upMotion = (p: Partial<Layer["motion"]>) => sel && ed.updateLayer(sel.id, { motion: { ...sel.motion, ...p } });

  const groups = ["Text", "Titles", "Info", "Shapes", "Animated"] as const;

  return (
    <>
      {showAdd ? (
        <Section title="Add" right={
          <>
            <button className="btn small ghost" onClick={() => fileRef.current?.click()}><IconUpload size={14} /> Image, logo or SVG</button>
            {sel ? <button className="btn icon small ghost" onClick={() => setAddOpen(false)} aria-label="Hide the catalogue">-</button> : null}
          </>
        }>
          <div className="add-group">
            <h4>Media</h4>
            <div className="add-grid">
              <button className="add-tile media-tile" onClick={() => fileRef.current?.click()}><span className="add-ico ai-image" aria-hidden="true" />Image or logo<em>PNG, JPG, SVG · on top of the video</em></button>
            </div>
          </div>
          {groups.map((g) => (
            <div key={g} className="add-group">
              <h4>{g}</h4>
              <div className="add-grid">
                {LAYER_TEMPLATES.filter((t) => t.group === g).map((t) => (
                  <button key={t.id} className="add-tile" onClick={() => add(t.id)}><span className={`add-ico ai-${t.id}`} aria-hidden="true" />{t.label}</button>
                ))}
              </div>
            </div>
          ))}
          <p className="muted">New graphics start at the playhead. Text ones: double-click on the video to edit the words. SVGs are cleaned (no scripts or external links) before they&apos;re added.</p>
        </Section>
      ) : (
        <button className="btn wide ghost add-more" onClick={() => setAddOpen(true)}><IconPlus size={15} /> Add another graphic</button>
      )}
      <input ref={fileRef} type="file" accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; for (const f of fs) void ed.addGraphicFile(f); setAddOpen(false); }} />

      {sel ? (
        <>
          <Section title={sel.name} right={
            <span className="row-btns">
              <button className="btn small ghost" onClick={() => ed.addLayer({ ...sel, id: ed.uid("L"), x: Math.min(95, sel.x + 3), y: Math.min(95, sel.y + 3), z: ed.nextZ() })}><IconCopy size={14} /> Duplicate</button>
              <button className="btn small ghost danger" onClick={() => ed.removeLayer(sel.id)}><IconTrash size={14} /></button>
            </span>
          }>
            <label className="field"><span className="field-label">Name</span><span className="field-input"><input className="txt grow" value={sel.name} onChange={(e) => up({ name: e.target.value })} /></span></label>
            {TEXT_KINDS.has(sel.kind) && sel.kind !== "speakerLabel" ? (
              <label className="field stack layer-text"><span className="field-label"><IconEdit size={13} /> Text<em>or double-click it on the video</em></span><textarea rows={3} value={sel.text ?? ""} onChange={(e) => up({ text: e.target.value })} placeholder="Type the words to show…" /></label>
            ) : null}
            {sel.kind === "lowerThird" || sel.kind === "titleCard" ? (
              <label className="field"><span className="field-label">Second line</span><span className="field-input"><input className="txt grow" value={sel.subtitle ?? ""} onChange={(e) => up({ subtitle: e.target.value })} /></span></label>
            ) : null}
            {sel.kind === "speakerLabel" ? (
              <>
                <Select label="Speaker" value={sel.speaker ?? ""} options={[{ value: "", label: "Custom name" }, ...Object.entries(doc.speakers ?? {}).map(([id, s]) => ({ value: id, label: s.name }))]} onChange={(v) => up({ speaker: v || undefined })} />
                <label className="field"><span className="field-label">Name<em>empty = speaker&apos;s name</em></span><span className="field-input"><input className="txt grow" value={sel.text ?? ""} onChange={(e) => up({ text: e.target.value })} /></span></label>
              </>
            ) : null}
            {TEXT_KINDS.has(sel.kind) ? (
              <>
                <Select label="Font" value={sel.font ?? "Anek Gujarati"} options={ALL_FONTS.map((f) => ({ value: f.family, label: f.family }))} onChange={(v) => up({ font: v, weight: nearestWeight(v, sel.weight ?? 700) })} />
                <Select label="Weight" value={nearestWeight(sel.font ?? "Anek Gujarati", sel.weight ?? 700)} options={fontByFamily(sel.font ?? "Anek Gujarati").weights.map((w) => ({ value: w, label: String(w) }))} onChange={(v) => up({ weight: v })} />
                <Slider label="Text size" value={sel.size ?? 5} min={1.5} max={20} step={0.1} unit="% of height" onChange={(v) => up({ size: v })} />
              </>
            ) : null}
            {sel.kind === "shape" ? (
              <>
                <Select label="Shape" value={sel.shape ?? "rect"} options={SHAPES} onChange={(v) => up({ shape: v })} />
                <Slider label="Outline" value={sel.stroke ?? 0} min={0} max={10} step={0.5} onChange={(v) => up({ stroke: v || undefined })} />
              </>
            ) : null}
            {sel.kind !== "svg" && sel.kind !== "image" ? (
              <>
                <Color label="Colour" value={sel.color} onChange={(v) => up({ color: v })} />
                {sel.kind === "lowerThird" || sel.kind === "titleCard" || sel.kind === "speakerLabel" || sel.kind === "shape" ? <Color label="Accent" value={sel.accent} allowNone onChange={(v) => up({ accent: v })} /> : null}
                {sel.kind !== "sticker" ? <Color label="Background" value={sel.background} allowNone onChange={(v) => up({ background: v })} /> : null}
              </>
            ) : null}
          </Section>
          <Section title="Placement">
            <Slider label="Left to right" value={sel.x} min={0} max={100} step={0.5} unit="%" onChange={(v) => up({ x: v })} />
            <Slider label="Top to bottom" value={sel.y} min={0} max={100} step={0.5} unit="%" onChange={(v) => up({ y: v })} />
            <Slider label="Width" value={sel.w} min={1} max={120} step={0.5} unit="%" onChange={(v) => up({ w: v })} />
            <Slider label="Height" value={sel.h} min={0.3} max={120} step={0.5} unit="%" onChange={(v) => up({ h: v })} />
            <Slider label="Rotation" value={sel.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => up({ rotation: v })} />
            <Slider label="Opacity" value={sel.opacity} min={0} max={1} step={0.01} onChange={(v) => up({ opacity: v })} />
            <div className="row-btns wrap">
              <button className="btn small" onClick={() => up({ x: 50 })}>Centre left to right</button>
              <button className="btn small" onClick={() => up({ y: 50 })}>Centre top to bottom</button>
            </div>
          </Section>
          <Section title="Timing">
            <div className="time-row"><span>In</span><input type="number" step={0.05} min={0} value={+sel.start.toFixed(2)} onChange={(e) => up({ start: Math.max(0, Math.min(sel.end - 0.1, Number(e.target.value))) })} aria-label="Start time" /><button className="btn small ghost" onClick={() => up({ start: Math.min(time, sel.end - 0.1) })}>To playhead</button></div>
            <div className="time-row"><span>Out</span><input type="number" step={0.05} value={+Math.min(sel.end, ed.tl.duration || sel.end).toFixed(2)} onChange={(e) => up({ end: Math.max(sel.start + 0.1, Number(e.target.value)) })} aria-label="End time" /><button className="btn small ghost" onClick={() => up({ end: Math.max(time, sel.start + 0.1) })}>To playhead</button></div>
            <button className="btn small ghost" onClick={() => up({ start: 0, end: Math.max(ed.tl.duration, 1) })}>Whole video</button>
          </Section>
          <Section title="Motion">
            <Select label="Entrance" value={sel.motion.in} options={ANIMS} onChange={(v) => upMotion({ in: v })} />
            <Select label="Exit" value={sel.motion.out} options={ANIMS} onChange={(v) => upMotion({ out: v })} />
            <Slider label="Duration" value={sel.motion.duration} min={0.05} max={3} step={0.05} unit="s" onChange={(v) => upMotion({ duration: v })} />
            <Slider label="Delay" value={sel.motion.delay} min={0} max={3} step={0.05} unit="s" onChange={(v) => upMotion({ delay: v })} />
            <Select label="Easing" value={sel.motion.easing} options={EASE} onChange={(v) => upMotion({ easing: v })} />
            <Select label="Direction" value={sel.motion.direction} options={DIRS} onChange={(v) => upMotion({ direction: v })} />
            <Select label="While visible" value={sel.motion.loop ?? "none"} options={[{ value: "none", label: "Still" }, { value: "float", label: "Float" }, { value: "pulse", label: "Pulse" }, { value: "spin", label: "Spin" }, { value: "shake", label: "Shake" }]} onChange={(v) => upMotion({ loop: v })} />
            <Toggle label="Locked" value={!!sel.locked} onChange={(v) => up({ locked: v || undefined })} hint="can't be dragged on the video" />
          </Section>
        </>
      ) : layers.length ? <p className="muted pad">Click a graphic on the video (or in the list below) to change its text, font, colour, size, timing and motion.</p> : null}
      <Section title={`Layers (${layers.length})`}>
        <ol className="layer-list">
          {rows.map((r, i) => (
            <li key={r.kind === "captions" ? "__captions" : r.l.id} className={`layer-row ${r.kind === "layer" && sel?.id === r.l.id ? "on" : ""} ${r.kind === "captions" ? "caps" : ""}`}>
              {r.kind === "captions" ? (
                <span className="layer-name"><b>Captions</b><em>all captions</em></span>
              ) : (
                <>
                  <button className="btn icon small ghost" onClick={() => ed.updateLayer(r.l.id, { hidden: !r.l.hidden || undefined })} aria-label={r.l.hidden ? "Show" : "Hide"} aria-pressed={!r.l.hidden}>{r.l.hidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}</button>
                  <button className="layer-name" onClick={() => { setSelection({ kind: "layer", id: r.l.id }); ed.playback.seek(Math.max(r.l.start, Math.min(r.l.end - 0.05, ed.playback.getTime()))); }}>
                    <b>{r.l.name}</b><em>{r.l.text ? r.l.text.slice(0, 28) : `${r.l.start.toFixed(1)} to ${Math.min(r.l.end, ed.tl.duration).toFixed(1)} s`}</em>
                  </button>
                  <button className="btn icon small ghost" onClick={() => ed.updateLayer(r.l.id, { locked: !r.l.locked || undefined })} aria-label={r.l.locked ? "Unlock" : "Lock"} aria-pressed={!!r.l.locked}>{r.l.locked ? <IconLock size={14} /> : <IconUnlock size={14} />}</button>
                </>
              )}
              <button className="btn icon small ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Bring forward"><IconArrowUp size={14} /></button>
              <button className="btn icon small ghost" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Send backward"><IconArrowDown size={14} /></button>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
