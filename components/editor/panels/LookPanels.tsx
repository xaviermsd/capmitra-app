"use client";
/** Templates, colours/effects, motion and frame panels (wrapping the shared style controls). */
import { useCallback } from "react";
import { useEditor } from "../EditorContext";
import { MotionControls, StyleControls, TemplatesPanel } from "@/components/StylePanel";
import { FramePanel } from "@/components/FramePanel";
import { Color, Section, Select, Slider, Toggle } from "@/components/Controls";
import { DEFAULT_SECONDARY } from "@/lib/bilingual";
import { ALL_FONTS, nearestWeight } from "@/lib/fonts";
import { download } from "@/lib/subtitles";
import type { CaptionStyle, FrameSettings, SecondaryLine } from "@/lib/types";
import { baseTemplate, isCustomised, usesKeywords } from "@/lib/templates";
import { autoKeywords } from "@/lib/keywords";
import { baseWordId } from "@/lib/edl";

export function useStylePatch() {
  const { project } = useEditor();
  return useCallback((p: Partial<CaptionStyle>) => {
    project.update((d) => ({ ...d, style: { ...d.style, ...p } }), { coalesce: `style:${Object.keys(p).join(",")}` });
  }, [project]);
}

export function TemplatesPanelView() {
  const ed = useEditor();
  const { doc, presets, setPresets, toast, project } = ed;
  const style = doc.style;
  return (
    <TemplatesPanel
      style={style}
      onCustomise={() => ed.setPanel("style")}
      onPick={(s) => {
        // keep position, script and second-line settings when switching looks
        // accent looks style the ★ words: pick keywords automatically if none are marked yet
        const autoMark = usesKeywords(s) && doc.words.length > 0 && !doc.words.some((w) => w.emphasis);
        project.update((d) => ({
          ...d,
          words: autoMark ? autoKeywords(d.words, ed.lines.map((l) => ({ ...l, words: l.words.map((w) => ({ ...w, id: baseWordId(w.id) })) }))) : d.words,
          style: { ...s, posX: d.style.posX, script: d.style.script, secondary: d.style.secondary, speakerColors: d.style.speakerColors },
        }));
        toast(autoMark
          ? { kind: "success", title: `${s.name} applied`, message: "Keywords highlighted for this look. Change any with ★ Emphasis or the E key.", duration: 3200 }
          : { kind: "success", title: `${s.name} applied`, duration: 1600 });
      }}
      presets={presets}
      onSavePreset={(n) => { setPresets((p) => [...p, { ...structuredClone(style), id: `user-${Date.now().toString(36)}`, name: n }]); toast({ kind: "success", title: "Preset saved", message: n }); }}
      onDeletePreset={(id) => setPresets((p) => p.filter((x) => x.id !== id))}
      onExportPresets={() => { download("capmitra-presets.json", JSON.stringify(presets, null, 2), "application/json"); toast({ kind: "success", title: "Presets exported", message: "Send the file to your team to import." }); }}
      onImportPresets={async (f) => {
        try {
          const arr = JSON.parse(await f.text()) as CaptionStyle[];
          if (!Array.isArray(arr) || arr.some((x) => typeof x !== "object" || !x || typeof x.font !== "string")) throw new Error("This isn't a presets file.");
          setPresets((p) => [...p, ...arr.map((x) => ({ ...x, id: `user-${Math.random().toString(36).slice(2, 9)}` }))]);
          toast({ kind: "success", title: "Presets imported", message: `${arr.length} added.` });
        } catch (e) {
          toast({ kind: "error", title: "Couldn't import presets", message: (e as Error).message });
        }
      }}
    />
  );
}

export function StylePanelView() {
  const { doc, project, toast } = useEditor();
  const patch = useStylePatch();
  const style = doc.style;
  const base = baseTemplate(style);
  const sec = style.secondary ?? { ...DEFAULT_SECONDARY, enabled: false };
  const setSec = (p: Partial<SecondaryLine>) => patch({ secondary: { ...sec, ...p } });
  const hasSpeakers = Object.keys(doc.speakers ?? {}).length > 0;
  return (
    <>
      {base ? (
        <Section title="Template" right={<button className="btn small" disabled={!isCustomised(style)} onClick={() => {
          project.update((d) => ({ ...d, style: { ...structuredClone(base), posX: d.style.posX, script: d.style.script, secondary: d.style.secondary, speakerColors: d.style.speakerColors } }));
          toast({ kind: "success", title: `Reset to ${base.name}`, duration: 1600 });
        }}>Reset to original</button>}>
          <p className="muted">Based on <b>{base.name}</b>. {isCustomised(style) ? "You've made changes." : "No changes yet."}</p>
        </Section>
      ) : null}
      <StyleControls style={style} patch={patch} />
      <Section title="Second line (translation)">
        <Toggle label="Show translation under captions" value={sec.enabled} onChange={(v) => setSec({ enabled: v })} hint="add translations in the Language panel" />
        {sec.enabled ? (
          <>
            <Slider label="Size" value={sec.sizeRatio} min={0.3} max={1} step={0.01} unit="× caption" onChange={(v) => setSec({ sizeRatio: v })} />
            <Color label="Colour" value={sec.fill} onChange={(v) => setSec({ fill: v ?? "#FFFFFF" })} />
            <Select label="Font" value={sec.font ?? ""} options={[{ value: "", label: "Same as captions" }, ...ALL_FONTS.map((f) => ({ value: f.family, label: f.family }))]} onChange={(v) => setSec({ font: v || undefined, weight: v ? nearestWeight(v, sec.weight ?? 500) : undefined })} />
            <Slider label="Gap" value={sec.gap} min={0} max={1.5} step={0.01} unit="em" onChange={(v) => setSec({ gap: v })} />
            <Toggle label="Above the caption" value={!!sec.above} onChange={(v) => setSec({ above: v || undefined })} />
            <Color label="Background" value={sec.plate} allowNone onChange={(v) => setSec({ plate: v })} />
          </>
        ) : null}
      </Section>
      {hasSpeakers ? (
        <Section title="Speakers">
          <Toggle label="Colour words by speaker" value={!!style.speakerColors} onChange={(v) => patch({ speakerColors: v || undefined })} hint="names and colours in the Captions panel" />
        </Section>
      ) : null}
    </>
  );
}

export function MotionPanelView() {
  const { doc } = useEditor();
  const patch = useStylePatch();
  const style = doc.style;
  return (
    <>
      <MotionControls style={style} patch={patch} />
      <Section title="Entrance timing">
        <Select
          label="Easing"
          value={style.easing ?? ""}
          options={[{ value: "", label: "Template default" }, { value: "ease-out", label: "Smooth stop" }, { value: "ease-in-out", label: "Smooth in & out" }, { value: "back", label: "Overshoot" }, { value: "spring", label: "Spring" }, { value: "linear", label: "Linear" }]}
          onChange={(v) => patch({ easing: (v || undefined) as CaptionStyle["easing"] })}
        />
        <Select
          label="Direction"
          value={style.direction ?? ""}
          options={[{ value: "", label: "Template default" }, { value: "up", label: "Upwards" }, { value: "down", label: "Downwards" }, { value: "left", label: "To the left" }, { value: "right", label: "To the right" }]}
          onChange={(v) => patch({ direction: (v || undefined) as CaptionStyle["direction"] })}
          hint="for slide, rise and drop"
        />
        <Slider label="Delay" value={style.enterDelay ?? 0} min={0} max={0.6} step={0.01} unit="s" onChange={(v) => patch({ enterDelay: v || undefined })} />
        <p className="muted">Duration is set by Speed above. Easing and direction apply to Fade, Pop, Spring, Rise, Drop, Slide, Zoom and Blur.</p>
      </Section>
    </>
  );
}

export function FramePanelView() {
  const { doc, project, srcDims } = useEditor();
  const patch = useCallback((p: Partial<FrameSettings>) => project.update((d) => ({ ...d, frame: { ...d.frame, ...p } }), { coalesce: `frame:${Object.keys(p).join(",")}` }), [project]);
  return <FramePanel frame={doc.frame} patch={patch} srcW={srcDims.w} srcH={srcDims.h} />;
}
