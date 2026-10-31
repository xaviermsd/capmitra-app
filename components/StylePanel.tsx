"use client";

import { useEffect, useRef, useState } from "react";
import { Color, Section, Select, Slider, Toggle } from "./Controls";
import { useDialog } from "./Dialog";
import { IconCheck, IconDownload, IconPlus, IconUpload, IconX } from "./Icons";
import { GUJARATI_FONTS, SAMPLE_TEXT, fontByFamily, injectAllFonts, nearestWeight } from "@/lib/fonts";
import { ELECTRIC_LIME_ID, TEMPLATES, baseTemplate, isCustomised, usesKeywords } from "@/lib/templates";
import { drawCaptions } from "@/lib/render";
import { loadSegmenter } from "@/lib/segment";
import type { CaptionLine, CaptionStyle, EnterAnimation, RevealMode } from "@/lib/types";

type Patch = (p: Partial<CaptionStyle>) => void;

const ENTERS: { value: EnterAnimation; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "pop", label: "Pop" },
  { value: "spring", label: "Spring" },
  { value: "rise", label: "Rise" },
  { value: "drop", label: "Drop" },
  { value: "slideleft", label: "Slide from left" },
  { value: "zoom", label: "Zoom out" },
  { value: "blur", label: "Blur in" },
  { value: "letters", label: "Pop by letter" },
  { value: "typewriter", label: "Typewriter" },
  { value: "bounce", label: "Bounce" },
  { value: "shake", label: "Shake" },
  { value: "glitch", label: "Glitch" },
  { value: "stamp", label: "Stamp" },
  { value: "slam", label: "Slam" },
  { value: "sticker", label: "Sticker slap" },
  { value: "elastic", label: "Elastic" },
  { value: "swing", label: "Swing" },
  { value: "whip", label: "Whip in" },
  { value: "punch", label: "Punch from left" },
  { value: "roll", label: "Roll in" },
  { value: "chatpop", label: "Chat pop" },
  { value: "notify", label: "Notification drop" },
  { value: "flicker", label: "Flicker" },
];

const REVEALS: { value: RevealMode; label: string }[] = [
  { value: "chunk", label: "Whole caption, highlight spoken word" },
  { value: "build", label: "Build up word by word" },
  { value: "solo", label: "One word at a time" },
  { value: "karaoke", label: "Karaoke colour sweep" },
];

/* ---------- Templates ---------- */

const PREVIEW_LINES: CaptionLine[] = [
  {
    id: "p",
    key: "a",
    start: 0,
    end: 3,
    words: [
      { id: "a", text: "તમારી", start: 0, end: 0.7 },
      { id: "b", text: "ભાષામાં", start: 0.7, end: 1.5 },
      { id: "c", text: "કેપ્શન", start: 1.6, end: 3 },
    ],
  },
];

/** Accent templates style ★ words, so their preview marks the last word as one. */
const PREVIEW_ACCENT: CaptionLine[] = PREVIEW_LINES.map((l) => ({ ...l, words: l.words.map((w, i, a) => (i === a.length - 1 ? { ...w, emphasis: true } : w)) }));

/** "Footage" moods behind the caption so white and coloured captions read as they would on video. */
const MOODS = 6;
const LOOP = 3.6; // seconds: the sample line runs 0–3 s, then holds briefly

/**
 * Template card with a live preview drawn by the real caption renderer, so the
 * preview moves exactly like the exported video. It plays when selected, on
 * hover (mouse) or while on screen (touch), and stays still for reduced motion.
 */
function TemplateThumb({ style, selected, onClick, mood = 0 }: { style: CaptionStyle; selected: boolean; onClick: () => void; mood?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false);
  const [visible, setVisible] = useState(false);
  const [env, setEnv] = useState({ reduce: false, touch: false });

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const touch = window.matchMedia("(hover: none)");
    const upd = () => setEnv({ reduce: reduce.matches, touch: touch.matches });
    upd();
    reduce.addEventListener?.("change", upd);
    touch.addEventListener?.("change", upd);
    const el = btn.current;
    const io = el ? new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.4 }) : null;
    if (el && io) io.observe(el);
    return () => { reduce.removeEventListener?.("change", upd); touch.removeEventListener?.("change", upd); io?.disconnect(); };
  }, []);

  const playing = !env.reduce && visible && (selected || hover || env.touch);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const s = { ...style, posY: 52, maxWords: 3, maxRows: 1, sizeVh: 24, maxWidthPct: 92 };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, c.width, c.height);
      drawCaptions(ctx, c.width, c.height, usesKeywords(style) ? PREVIEW_ACCENT : PREVIEW_LINES, t, s);
    };
    let raf = 0;
    let timer = 0;
    let stop = false;
    if (playing) {
      const t0 = performance.now();
      let last = 0;
      const tick = (now: number) => {
        if (stop) return;
        if (now - last > 33) { last = now; draw(((now - t0) / 1000) % LOOP); }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } else {
      // still frame; redraw a few times while the fonts arrive
      let n = 0;
      const loop = () => { if (stop) return; draw(1.2); if (++n < 20) timer = window.setTimeout(loop, 200); };
      loop();
      document.fonts?.ready.then(() => { if (!stop) draw(1.2); });
    }
    return () => { stop = true; cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [style, playing]);

  return (
    <button ref={btn} className={`tpl ${selected ? "on" : ""}`} onClick={onClick} title={style.name} aria-pressed={selected}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <span className={`tpl-scr mood-${mood % MOODS}`}>
        <canvas ref={ref} width={360} height={180} />
        {selected ? <span className="tpl-tick" aria-hidden="true"><IconCheck size={13} /></span> : null}
      </span>
      <span className="tpl-name"><b>{style.name}</b>{selected ? <em>Selected</em> : null}</span>
    </button>
  );
}

export function TemplatesPanel({
  style, onPick, presets, onSavePreset, onDeletePreset, onExportPresets, onImportPresets, onCustomise,
}: {
  style: CaptionStyle;
  /** Open the style settings (colours, outline, box, size). */
  onCustomise?: () => void;
  onPick: (s: CaptionStyle) => void;
  presets: CaptionStyle[];
  onSavePreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
  onExportPresets: () => void;
  onImportPresets: (f: File) => void;
}) {
  useEffect(() => injectAllFonts(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialog = useDialog();
  return (
    <>
      {onCustomise ? (
        <div className="tpl-current">
          <span><em>Current look</em><b>{style.name}{isCustomised(style) ? " (customised)" : ""}</b></span>
          <button className="btn primary" onClick={onCustomise}>Customise style</button>
        </div>
      ) : null}
      <Section title={`Templates (${TEMPLATES.length})`}>
        {isCustomised(style) ? (
          <div className="tpl-reset">
            <span>You've customised <b>{baseTemplate(style)!.name}</b>.</span>
            <button className="btn small" onClick={() => onPick(structuredClone(baseTemplate(style)!))}>Reset to original</button>
          </div>
        ) : null}
        <div className="thumbs">
          {TEMPLATES.map((t, i) => (
            <TemplateThumb key={t.id} mood={t.id === ELECTRIC_LIME_ID ? 4 : i - 1} style={t} selected={style.id === t.id} onClick={() => onPick(structuredClone(t))} />
          ))}
        </div>
      </Section>
      <Section
        title="My presets"
        right={
          <span className="row-btns">
            <button className="btn small" onClick={async () => {
              const n = await dialog.prompt({ title: "Save as preset", message: "Your team can import presets you export.", input: { value: style.name + " (mine)" }, confirmLabel: "Save preset" });
              if (n) onSavePreset(n);
            }}><IconPlus size={14} /> Save current</button>
            <button className="btn small ghost" onClick={onExportPresets} disabled={!presets.length}><IconDownload size={14} /> Export</button>
            <button className="btn small ghost" onClick={() => fileRef.current?.click()}><IconUpload size={14} /> Import</button>
            <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportPresets(f); e.target.value = ""; }} />
          </span>
        }
      >
        {presets.length ? (
          <div className="thumbs">
            {presets.map((p, i) => (
              <div key={p.id} className="preset">
                <TemplateThumb mood={i + 2} style={p} selected={style.id === p.id} onClick={() => onPick(structuredClone(p))} />
                <button className="x" onClick={() => onDeletePreset(p.id)} aria-label={`Delete preset ${p.name}`}><IconX size={12} /></button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Style a caption, then choose “Save current”. Export the file to share presets with your team.</p>
        )}
      </Section>
    </>
  );
}

/* ---------- Fonts ---------- */

export function FontPanel({ style, patch }: { style: CaptionStyle; patch: Patch }) {
  useEffect(() => injectAllFonts(), []);
  const f = fontByFamily(style.font);
  return (
    <>
      <Section title={`Gujarati fonts (${GUJARATI_FONTS.length})`}>
        <div className="fonts">
          {GUJARATI_FONTS.map((g) => (
            <button
              key={g.family}
              className={`font-card ${style.font === g.family ? "on" : ""}`}
              onClick={() => patch({ font: g.family, weight: nearestWeight(g.family, style.weight) })}
            >
              <span className="font-sample" style={{ fontFamily: `"${g.family}"`, fontWeight: nearestWeight(g.family, style.weight) }}>
                {SAMPLE_TEXT}
              </span>
              <span className="font-name">
                {g.family} <em>{g.category}</em>
              </span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Text">
        <Select
          label="Write captions in"
          value={style.script ?? "native"}
          options={[
            { value: "native", label: "ગુજરાતી (Gujarati script)" },
            { value: "gujlish", label: "Gujlish (romanised, e.g. namaste)" },
          ]}
          onChange={(v) => patch({ script: v })}
        />
        <Select label="Weight" value={nearestWeight(style.font, style.weight)} options={f.weights.map((w) => ({ value: w, label: String(w) }))} onChange={(v) => patch({ weight: v })} />
        <Slider label="Size" value={style.sizeVh} min={2} max={16} step={0.1} unit="% of height" onChange={(v) => patch({ sizeVh: v })} />
        <Slider label="Letter spacing" value={style.letterSpacing} min={-0.1} max={0.3} step={0.005} unit="em" onChange={(v) => patch({ letterSpacing: v })} />
        <Slider label="Word gap" value={style.wordGap} min={0} max={1} step={0.01} unit="em" onChange={(v) => patch({ wordGap: v })} />
        <Slider label="Line height" value={style.lineHeight} min={0.8} max={2.2} step={0.01} onChange={(v) => patch({ lineHeight: v })} />
        <Toggle label="UPPERCASE English words" value={style.uppercase} onChange={(v) => patch({ uppercase: v })} />
      </Section>
    </>
  );
}

/* ---------- Colours & effects ---------- */

export function StyleControls({ style, patch }: { style: CaptionStyle; patch: Patch }) {
  const a = style.active;
  const setA = (p: Partial<CaptionStyle["active"]>) => patch({ active: { ...a, ...p } });
  return (
    <>
      <Section title="Text colour">
        <Color label="Fill" value={style.fill} onChange={(v) => patch({ fill: v ?? "#ffffff" })} />
        <Toggle label="Gradient" value={!!style.gradient} onChange={(v) => patch({ gradient: v ? [style.fill, "#FFB703"] : undefined })} />
        {style.gradient ? (
          <>
            <Color label="Gradient top" value={style.gradient[0]} onChange={(v) => patch({ gradient: [v ?? "#ffffff", style.gradient![1]] })} />
            <Color label="Gradient bottom" value={style.gradient[1]} onChange={(v) => patch({ gradient: [style.gradient![0], v ?? "#ffffff"] })} />
          </>
        ) : null}
        <Color label="Upcoming words" value={style.upcomingFill} allowNone onChange={(v) => patch({ upcomingFill: v })} hint="before spoken" />
        <Slider label="Upcoming opacity" value={style.upcomingOpacity} min={0} max={1} step={0.05} onChange={(v) => patch({ upcomingOpacity: v })} />
        <Color label="Spoken words" value={style.spokenFill} allowNone onChange={(v) => patch({ spokenFill: v })} hint="after spoken" />
        <Color label="Emphasis words" value={style.emphasisFill} onChange={(v) => patch({ emphasisFill: v ?? "#ff4d4d" })} hint="★ in word editor" />
      </Section>
      <Section title="Spoken-word highlight">
        <Color label="Highlight colour" value={a.fill} allowNone onChange={(v) => setA({ fill: v })} />
        <Color label="Highlight box" value={a.box} allowNone onChange={(v) => setA({ box: v })} />
        {a.box ? (
          <>
            <Slider label="Box roundness" value={a.boxRadius ?? 0.2} min={0} max={0.8} step={0.01} onChange={(v) => setA({ boxRadius: v })} />
            <Slider label="Box padding X" value={a.boxPadX ?? 0.15} min={0} max={0.6} step={0.01} onChange={(v) => setA({ boxPadX: v })} />
            <Slider label="Box padding Y" value={a.boxPadY ?? 0.05} min={0} max={0.5} step={0.01} onChange={(v) => setA({ boxPadY: v })} />
          </>
        ) : null}
        <Slider label="Pop scale" value={a.scale ?? 1} min={0.8} max={1.6} step={0.01} unit="×" onChange={(v) => setA({ scale: v })} />
        <Color label="Glow" value={a.glow} allowNone onChange={(v) => setA({ glow: v })} />
      </Section>
      <Section title="Outline">
        <Toggle label="Outline" value={!!style.stroke} onChange={(v) => patch({ stroke: v ? { color: "#000000", width: 0.06 } : undefined })} />
        {style.stroke ? (
          <>
            <Color label="Outline colour" value={style.stroke.color} onChange={(v) => patch({ stroke: { ...style.stroke!, color: v ?? "#000" } })} />
            <Slider label="Outline width" value={style.stroke.width} min={0} max={0.2} step={0.005} onChange={(v) => patch({ stroke: { ...style.stroke!, width: v } })} />
          </>
        ) : null}
      </Section>
      <Section title="Shadow">
        <Toggle label="Shadow" value={!!style.shadow} onChange={(v) => patch({ shadow: v ? { color: "rgba(0,0,0,0.6)", blur: 0.25, offsetY: 0.06 } : undefined })} />
        {style.shadow ? (
          <>
            <Color label="Shadow colour" value={style.shadow.color} onChange={(v) => patch({ shadow: { ...style.shadow!, color: v ?? "#000" } })} />
            <Slider label="Blur" value={style.shadow.blur} min={0} max={1.5} step={0.01} onChange={(v) => patch({ shadow: { ...style.shadow!, blur: v } })} />
            <Slider label="Offset Y" value={style.shadow.offsetY} min={-0.3} max={0.3} step={0.005} onChange={(v) => patch({ shadow: { ...style.shadow!, offsetY: v } })} />
          </>
        ) : null}
      </Section>
      <Section title="Background plate">
        <Toggle label="Background" value={!!style.plate} onChange={(v) => patch({ plate: v ? { color: "rgba(0,0,0,0.6)", radius: 0.2, padX: 0.45, padY: 0.18 } : undefined })} />
        {style.plate ? (
          <>
            <Color label="Background colour" value={style.plate.color} onChange={(v) => patch({ plate: { ...style.plate!, color: v ?? "#000" } })} />
            <Slider label="Roundness" value={style.plate.radius} min={0} max={1} step={0.01} onChange={(v) => patch({ plate: { ...style.plate!, radius: v } })} />
            <Slider label="Padding X" value={style.plate.padX} min={0} max={1.5} step={0.01} onChange={(v) => patch({ plate: { ...style.plate!, padX: v } })} />
            <Slider label="Padding Y" value={style.plate.padY} min={0} max={1} step={0.01} onChange={(v) => patch({ plate: { ...style.plate!, padY: v } })} />
            <Select label="Box size" value={style.plate.fit ?? "caption"} options={[{ value: "line", label: "Fit each line" }, { value: "caption", label: "One box around the caption" }, { value: "full", label: "Full caption width" }]} onChange={(v) => patch({ plate: { ...style.plate!, fit: v as "line" | "caption" | "full" } })} />
            <Toggle label="Border" value={!!style.plate.border} onChange={(v) => patch({ plate: { ...style.plate!, border: v ? { color: "#080808", width: 0.07 } : undefined } })} />
            {style.plate.border ? (
              <>
                <Color label="Border colour" value={style.plate.border.color} onChange={(v) => patch({ plate: { ...style.plate!, border: { ...style.plate!.border!, color: v ?? "#080808" } } })} />
                <Slider label="Border width" value={style.plate.border.width} min={0} max={0.25} step={0.005} onChange={(v) => patch({ plate: { ...style.plate!, border: { ...style.plate!.border!, width: v } } })} />
              </>
            ) : null}
            <Toggle label="Hard shadow" value={!!style.plate.shadow} onChange={(v) => patch({ plate: { ...style.plate!, shadow: v ? { color: "#080808", x: 0.1, y: 0.1 } : undefined } })} hint="solid offset, no blur" />
            {style.plate.shadow ? (
              <>
                <Color label="Shadow colour" value={style.plate.shadow.color} onChange={(v) => patch({ plate: { ...style.plate!, shadow: { ...style.plate!.shadow!, color: v ?? "#080808" } } })} />
                <Slider label="Shadow offset X" value={style.plate.shadow.x} min={-0.4} max={0.4} step={0.005} onChange={(v) => patch({ plate: { ...style.plate!, shadow: { ...style.plate!.shadow!, x: v } } })} />
                <Slider label="Shadow offset Y" value={style.plate.shadow.y} min={-0.4} max={0.4} step={0.005} onChange={(v) => patch({ plate: { ...style.plate!, shadow: { ...style.plate!.shadow!, y: v } } })} />
              </>
            ) : null}
            <Toggle label="Box moves with the text" value={!!style.plate.moveWithText} onChange={(v) => patch({ plate: { ...style.plate!, moveWithText: v || undefined } })} hint="pop, slide and zoom entrances" />
          </>
        ) : null}
      </Section>
    </>
  );
}

/* ---------- Animation & layout ---------- */

export function MotionControls({ style, patch }: { style: CaptionStyle; patch: Patch }) {
  return (
    <>
      <Section title="Animation">
        <Select label="Reveal" value={style.reveal} options={REVEALS} onChange={(v) => patch({ reveal: v })} />
        <Select label="Entrance" value={style.enter} options={ENTERS} onChange={(v) => patch({ enter: v })} />
        <Slider label="Speed" value={style.speed} min={0.3} max={3} step={0.05} unit="×" onChange={(v) => patch({ speed: v })} />
      </Section>
      <Section title="Position & layout">
        <Toggle label="Behind the person" value={!!style.behindSubject} hint="people walk in front of the captions · runs on this device"
          onChange={(v) => { if (v) void loadSegmenter(); patch({ behindSubject: v || undefined }); }} />
        <Slider label="Vertical position" value={style.posY} min={5} max={95} step={0.5} unit="% from top" onChange={(v) => patch({ posY: v })} />
        <Slider label="Horizontal position" value={style.posX ?? 50} min={0} max={100} step={0.5} unit="% from left" onChange={(v) => patch({ posX: v })} />
        <div className="row-btns">
          <button className="btn small" onClick={() => patch({ posX: 50 })}>Centre horizontally</button>
          <span className="muted">Tip: drag the caption on the video.</span>
        </div>
        <Slider label="Max width" value={style.maxWidthPct} min={30} max={100} step={1} unit="%" onChange={(v) => patch({ maxWidthPct: v })} />
        <Select label="Align" value={style.align} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }]} onChange={(v) => patch({ align: v })} />
      </Section>
      <Section title="Caption grouping">
        <Slider label="Max words per caption" value={style.maxWords} min={1} max={15} step={1} onChange={(v) => patch({ maxWords: v })} />
        <Slider label="Max rows" value={style.maxRows} min={1} max={4} step={1} onChange={(v) => patch({ maxRows: v })} />
        <Slider label="New caption after pause" value={style.breakOnPause} min={0.05} max={2} step={0.01} unit="s" onChange={(v) => patch({ breakOnPause: v })} />
        <Slider label="Min caption duration" value={style.minDuration} min={0} max={3} step={0.05} unit="s" onChange={(v) => patch({ minDuration: v })} />
      </Section>
    </>
  );
}
