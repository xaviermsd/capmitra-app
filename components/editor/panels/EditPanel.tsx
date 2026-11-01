"use client";
/**
 * Clips: add more videos and images to the timeline, split, join, reorder,
 * trim, remove parts, transitions between clips, and per-clip framing, speed
 * and volume. (Older projects' title cards are still editable here.)
 */
import { useRef, useState } from "react";
import { useEditor, useTime } from "../EditorContext";
import { Color, Section, Select, Slider, Toggle } from "@/components/Controls";
import { IconArrowDown, IconArrowUp, IconScissors, IconTrash, IconPlus, IconUpload, IconTranscript, IconFrame, IconCopy } from "@/components/Icons";
import { canMerge, clipLength, mergeWithNext, moveClip, removeClip, rippleDelete, SPEEDS, speedOf, type InsertWhere } from "@/lib/edl";
import { sanitizeSvg } from "@/lib/svgSafe";
import { splitHere } from "../QuickControls";
import { ALL_FONTS } from "@/lib/fonts";
import { putAsset, probeMedia, assetUrl } from "@/lib/assets";
import type { Background, CardClip, Clip, ImageClip, TransitionKind, VideoClip } from "@/lib/project";
import { defaultDuration, TRANSITION_META } from "@/lib/transitions";

const TRANSITIONS: { value: TransitionKind; label: string }[] = TRANSITION_META.map((m) => ({ value: m.kind, label: m.kind === "none" ? "Cut (none)" : m.label }));

const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}` : "end");
const WHERE: { value: InsertWhere; label: string }[] = [{ value: "playhead", label: "At the playhead" }, { value: "end", label: "At the end" }, { value: "start", label: "At the start" }];

/** The length of the video a clip comes from (the main video, or its own extra video). */
const srcDurOf = (c: VideoClip, mainDuration: number) => (c.sourceId ? c.srcDuration ?? (Number.isFinite(c.srcEnd) ? c.srcEnd : 0) : mainDuration);

export function EditPanel() {
  const ed = useEditor();
  const time = useTime();
  const { clips, setClips, selection, setSelection, tl, toast } = ed;
  const svgRef = useRef<HTMLInputElement>(null);
  const sel = selection?.kind === "clip" ? clips.find((c) => c.id === selection.id) : undefined;
  const selIdx = sel ? clips.indexOf(sel) : -1;
  const [where, setWhere] = useState<InsertWhere>("playhead");
  const mediaRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  const addBlank = () => {
    const card: CardClip = { id: ed.uid("c"), kind: "card", duration: 1, background: { kind: "color", color: "#000000" } };
    ed.placeClip(card, where);
    toast({ kind: "success", title: "Blank clip added", message: "Change its colour below, or use it as a pause between clips.", duration: 2200 });
  };
  const replaceImage = async (f: File) => {
    if (sel?.kind !== "image") return;
    try {
      const meta = await probeMedia(f);
      const a = await putAsset(f, f.name, "image", meta);
      await assetUrl(a.id);
      updClip({ assetId: a.id, name: f.name.replace(/\.[^.]+$/, "") });
    } catch (e) { toast({ kind: "error", title: "Couldn't use that image", message: (e as Error).message }); }
  };

  const updClip = (p: Partial<VideoClip> | Partial<CardClip> | Partial<ImageClip>, coalesce?: string) => {
    if (!sel) return;
    setClips(clips.map((c) => (c.id === sel.id ? ({ ...c, ...p } as Clip) : c)), coalesce ?? `clip:${sel.id}:${Object.keys(p).join(",")}`);
  };

  const applyTransitionToAll = () => {
    if (!sel?.transition) return;
    const tr = sel.transition;
    setClips(clips.map((c, i) => (i === 0 ? c : { ...c, transition: tr })));
    toast({ kind: "success", title: "Transition applied to every cut", duration: 1800 });
  };

  const bg = sel?.kind === "card" ? sel.background : undefined;
  const setBg = (p: Partial<Background>) => sel?.kind === "card" && updClip({ background: { ...sel.background, ...p } });

  return (
    <>
      {ed.doc.words.length ? (
        <button className="edit-bytext" onClick={() => ed.setPanel("transcript")}>
          <IconTranscript size={20} /><span><b>Edit by text</b><em>Delete words, pauses and filler words to cut the video</em></span>
        </button>
      ) : null}
      <Section title="Add to the timeline">
        <div className="where-chips" role="radiogroup" aria-label="Where to add">
          {WHERE.map((w) => <button key={w.value} role="radio" aria-checked={where === w.value} className={`pchip ${where === w.value ? "on" : ""}`} onClick={() => setWhere(w.value)}>{w.label}</button>)}
        </div>
        <div className="add-grid media">
          <button className="add-tile media-tile" onClick={() => mediaRef.current?.click()}>
            <span className="add-ico ai-video" aria-hidden="true"><IconFrame size={16} /></span>Video clip<em>MP4, MOV, WebM</em>
          </button>
          <button className="add-tile media-tile" onClick={() => { mediaRef.current?.setAttribute("accept", "image/*"); mediaRef.current?.click(); }}>
            <span className="add-ico ai-image" aria-hidden="true" />Image clip<em>shows for 4 s</em>
          </button>
          <button className="add-tile media-tile" onClick={addBlank}>
            <span className="add-ico ai-blank" aria-hidden="true" />Blank colour<em>a pause or a gap</em>
          </button>
        </div>
        <input ref={mediaRef} type="file" accept="video/*,image/*,.mp4,.mov,.m4v,.webm,.mkv" multiple hidden
          onChange={async (e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; e.target.setAttribute("accept", "video/*,image/*,.mp4,.mov,.m4v,.webm,.mkv"); for (const f of fs) await ed.addMediaClip(f, where); }} />
        <p className="muted">You can also drop a video or image straight onto the timeline where you want it. Logos and pictures <b>on top</b> of the video go in Graphics.</p>
      </Section>

      <Section title="Cut">
        <div className="row-btns wrap">
          <button className="btn small" onClick={() => splitHere(ed, time)}><IconScissors size={14} /> Split at playhead (S)</button>
          <button className="btn small ghost" disabled={time < 0.1} onClick={() => setClips(rippleDelete(clips, 0, time, () => ed.uid("c")))}>Remove everything before</button>
          <button className="btn small ghost" disabled={time > tl.duration - 0.1} onClick={() => { setClips(rippleDelete(clips, time, tl.duration, () => ed.uid("c"))); ed.playback.seek(Math.max(0, time - 0.05)); }}>Remove everything after</button>
        </div>
        <p className="muted">Cut parts are removed with their captions. Nothing is deleted from your original video, and Ctrl+Z undoes any edit.</p>
      </Section>

      <Section title={`Clips (${clips.length})`}>
        <ol className="clip-list">
          {clips.map((c, i) => {
            const it = tl.items[i];
            return (
              <li key={c.id} className={`clip-row ${sel?.id === c.id ? "on" : ""} ${c.kind}`}>
                <button className="clip-main" onClick={() => { setSelection({ kind: "clip", id: c.id }); if (it) ed.playback.seek(it.outStart + 0.01); }}>
                  <b>{c.kind === "video" ? (c.sourceId ? `▶ ${c.name ?? "Added video"}` : `Clip ${clips.slice(0, i + 1).filter((x) => x.kind === "video" && !x.sourceId).length}`) : c.kind === "image" ? `🖼 ${c.name ?? "Image"}` : `▣ ${c.title || "Card"}`}{c.tag ? " · brand" : ""}</b>
                  <em>{c.kind === "video" ? `${fmt(c.srcStart)} to ${fmt(c.srcEnd)}${c.sourceId ? "" : " of the video"}` : c.kind === "image" ? "image" : c.title ? "title card" : "blank"} · {clipLength(c).toFixed(1)} s{speedOf(c) !== 1 ? ` · ${speedOf(c)}×` : ""}{c.transition && c.transition.kind !== "none" ? ` · ${TRANSITIONS.find((t) => t.value === c.transition!.kind)?.label}` : ""}</em>
                </button>
                <button className="btn icon small ghost" onClick={() => { const copy = { ...c, id: ed.uid("c"), tag: undefined } as Clip; setClips([...clips.slice(0, i + 1), copy, ...clips.slice(i + 1)]); setSelection({ kind: "clip", id: copy.id }); }} aria-label="Duplicate clip"><IconCopy size={14} /></button>
                <button className="btn icon small ghost" disabled={i === 0} onClick={() => setClips(moveClip(clips, c.id, i - 1))} aria-label="Move earlier"><IconArrowUp size={14} /></button>
                <button className="btn icon small ghost" disabled={i === clips.length - 1} onClick={() => setClips(moveClip(clips, c.id, i + 1))} aria-label="Move later"><IconArrowDown size={14} /></button>
                <button className="btn icon small ghost" disabled={clips.length < 2} onClick={() => { setClips(removeClip(clips, c.id)); if (sel?.id === c.id) setSelection(null); }} aria-label="Remove clip"><IconTrash size={14} /></button>
              </li>
            );
          })}
        </ol>
      </Section>

      {sel ? (
        <>
          <Section title={sel.kind === "video" ? (sel.sourceId ? `Added video: ${sel.name ?? ""}` : "Selected clip") : sel.kind === "image" ? `Image: ${sel.name ?? ""}` : sel.title ? "Selected card" : "Blank clip"} right={canMerge(clips, sel.id) ? <button className="btn small ghost" onClick={() => setClips(mergeWithNext(clips, sel.id))}><IconPlus size={14} /> Join with next</button> : null}>
            {sel.kind === "image" ? (
              <>
                <Slider label="Duration" value={+sel.duration.toFixed(1)} min={0.3} max={30} step={0.1} unit="s" onChange={(v) => updClip({ duration: v })} />
                <Toggle label="Slow zoom in" value={!!sel.kenBurns && sel.kenBurns !== 1} onChange={(v) => updClip({ kenBurns: v ? 1.08 : 1 })} hint="gentle movement so the photo doesn't look frozen" />
                {sel.kenBurns && sel.kenBurns !== 1 ? <Slider label="Zoom amount" value={sel.kenBurns} min={1.02} max={1.4} step={0.01} unit="×" onChange={(v) => updClip({ kenBurns: v })} /> : null}
                <Select label="Fill the frame" value={sel.frame?.fit ?? ed.doc.frame.fit} options={[{ value: "crop", label: "Crop to fill" }, { value: "blur", label: "Fit, blurred edges" }, { value: "color", label: "Fit, plain colour" }]} onChange={(v) => updClip({ frame: { ...sel.frame, fit: v } })} />
                <Slider label="Zoom" value={sel.frame?.zoom ?? 1} min={1} max={3} step={0.01} unit="×" onChange={(v) => updClip({ frame: { ...sel.frame, zoom: v } })} />
                <Slider label="Pan left to right" value={sel.frame?.panX ?? 50} min={0} max={100} step={0.5} unit="%" onChange={(v) => updClip({ frame: { ...sel.frame, panX: v } })} />
                <Slider label="Pan up and down" value={sel.frame?.panY ?? 50} min={0} max={100} step={0.5} unit="%" onChange={(v) => updClip({ frame: { ...sel.frame, panY: v } })} />
                <div className="row-btns">
                  <button className="btn small" onClick={() => replaceRef.current?.click()}><IconUpload size={14} /> Replace image</button>
                  <input ref={replaceRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void replaceImage(f); }} />
                </div>
              </>
            ) : sel.kind === "video" ? (
              <>
                <Slider label="Starts at" value={+sel.srcStart.toFixed(2)} min={0} max={Math.max(0.1, (Number.isFinite(sel.srcEnd) ? sel.srcEnd : srcDurOf(sel, ed.srcDuration)) - 0.1)} step={0.01} unit="s in video" onChange={(v) => updClip({ srcStart: v })} />
                <Slider label="Ends at" value={+((Number.isFinite(sel.srcEnd) ? sel.srcEnd : srcDurOf(sel, ed.srcDuration))).toFixed(2)} min={sel.srcStart + 0.1} max={Math.max(sel.srcStart + 0.2, srcDurOf(sel, ed.srcDuration) || sel.srcEnd)} step={0.01} unit="s in video" onChange={(v) => updClip({ srcEnd: v })} />
                <div className="field field-chips">
                  <span className="field-label">Speed<em>voices keep their pitch</em></span>
                  <div className="speed-chips" role="radiogroup" aria-label="Clip speed">
                    {SPEEDS.map((k) => <button key={k} role="radio" aria-checked={speedOf(sel) === k} className={`pchip ${speedOf(sel) === k ? "on" : ""}`} onClick={() => updClip({ speed: k === 1 ? undefined : k })}>{k}×</button>)}
                  </div>
                </div>
                <Slider label="Volume" value={sel.volume ?? 1} min={0} max={2} step={0.05} unit="×" onChange={(v) => updClip({ volume: v === 1 ? undefined : v })} hint="preview plays up to 100%" />
                <Select label="Framing" value={sel.frame ? "custom" : "project"} options={[{ value: "project", label: "Same as project (Frame panel)" }, { value: "custom", label: "Custom for this clip" }]} onChange={(v) => updClip({ frame: v === "custom" ? { zoom: ed.doc.frame.zoom, panX: ed.doc.frame.panX, panY: ed.doc.frame.panY } : undefined })} />
                {sel.frame ? (
                  <>
                    <Slider label="Zoom" value={sel.frame.zoom ?? 1} min={1} max={3} step={0.01} unit="×" onChange={(v) => updClip({ frame: { ...sel.frame, zoom: v } })} />
                    <Slider label="Pan left to right" value={sel.frame.panX ?? 50} min={0} max={100} step={0.5} unit="%" onChange={(v) => updClip({ frame: { ...sel.frame, panX: v } })} />
                    <Slider label="Pan up and down" value={sel.frame.panY ?? 50} min={0} max={100} step={0.5} unit="%" onChange={(v) => updClip({ frame: { ...sel.frame, panY: v } })} />
                  </>
                ) : null}
              </>
            ) : (
              <>
                <Slider label="Duration" value={sel.duration} min={0.3} max={15} step={0.1} unit="s" onChange={(v) => updClip({ duration: v })} />
                <label className="field"><span className="field-label">Title</span><span className="field-input"><input className="txt grow" value={sel.title ?? ""} onChange={(e) => updClip({ title: e.target.value })} /></span></label>
                <label className="field"><span className="field-label">Subtitle</span><span className="field-input"><input className="txt grow" value={sel.subtitle ?? ""} onChange={(e) => updClip({ subtitle: e.target.value })} /></span></label>
                <Select label="Font" value={sel.font ?? "Anek Gujarati"} options={ALL_FONTS.map((f) => ({ value: f.family, label: f.family }))} onChange={(v) => updClip({ font: v })} />
                <Color label="Text colour" value={sel.color ?? "#FFFFFF"} onChange={(v) => updClip({ color: v })} />
                <Select label="Background" value={bg!.kind} options={[{ value: "gradient", label: "Gradient" }, { value: "color", label: "Solid colour" }, { value: "pattern", label: "Pattern" }, { value: "svg", label: "SVG artwork" }]} onChange={(v) => setBg({ kind: v })} />
                {bg!.kind === "gradient" ? (
                  <>
                    <Color label="From" value={bg!.colors?.[0] ?? "#0E0F12"} onChange={(v) => setBg({ colors: [v ?? "#0E0F12", bg!.colors?.[1] ?? "#2A2E36"] })} />
                    <Color label="To" value={bg!.colors?.[1] ?? "#2A2E36"} onChange={(v) => setBg({ colors: [bg!.colors?.[0] ?? "#0E0F12", v ?? "#2A2E36"] })} />
                    <Slider label="Angle" value={bg!.angle ?? 135} min={0} max={360} step={5} unit="°" onChange={(v) => setBg({ angle: v })} />
                  </>
                ) : null}
                {bg!.kind === "color" || bg!.kind === "pattern" ? <Color label="Colour" value={bg!.color ?? "#0E0F12"} onChange={(v) => setBg({ color: v })} /> : null}
                {bg!.kind === "pattern" ? (
                  <>
                    <Select label="Pattern" value={bg!.pattern ?? "dots"} options={[{ value: "dots", label: "Dots" }, { value: "grid", label: "Grid" }, { value: "waves", label: "Waves (animated)" }, { value: "rays", label: "Rays (animated)" }]} onChange={(v) => setBg({ pattern: v })} />
                    <Color label="Pattern colour" value={bg!.colors?.[0] ?? "rgba(255,255,255,0.1)"} onChange={(v) => setBg({ colors: [v ?? "#fff", bg!.colors?.[1] ?? "#000"] })} />
                  </>
                ) : null}
                {bg!.kind === "svg" ? (
                  <div className="row-btns">
                    <button className="btn small" onClick={() => svgRef.current?.click()}><IconUpload size={14} /> {bg!.svg ? "Replace SVG" : "Choose SVG"}</button>
                    <input ref={svgRef} type="file" accept=".svg,image/svg+xml" hidden onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      try { const r = sanitizeSvg(await f.text()); setBg({ svg: r.svg }); if (r.removed.length) toast({ kind: "info", title: "SVG cleaned for safety", message: `Removed: ${r.removed.join(", ")}.` }); }
                      catch (err) { toast({ kind: "error", title: "Couldn't use that SVG", message: (err as Error).message }); }
                    }} />
                  </div>
                ) : null}
              </>
            )}
          </Section>
          <Section title="Transition into this clip">
            {selIdx === 0 ? <p className="muted">On the first clip this fades in from black.</p> : null}
            <Select label="Effect" value={sel.transition?.kind ?? "none"} options={TRANSITIONS} onChange={(v) => updClip({ transition: v === "none" ? undefined : { kind: v, duration: defaultDuration(v) } })} />
            {sel.transition ? (
              <>
                <Slider label="Duration" value={sel.transition.duration} min={0.1} max={2} step={0.05} unit="s" onChange={(v) => updClip({ transition: { ...sel.transition!, duration: v } })} />
                {clips.length > 2 ? <button className="btn small ghost" onClick={applyTransitionToAll}>Use on every cut</button> : null}
              </>
            ) : null}
          </Section>
        </>
      ) : <p className="muted pad">Select a clip on the timeline (Video track) to trim it, change its speed or framing, or add a transition.</p>}
    </>
  );
}
