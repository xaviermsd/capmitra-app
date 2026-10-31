"use client";
/** Caption script (native / Gujlish / Hinglish / Roman) and fonts for every script in the captions. */
import { useEffect, useMemo, useState } from "react";
import { useEditor } from "../EditorContext";
import { useStylePatch } from "./LookPanels";
import { Color, Section, Select, Slider, Toggle } from "@/components/Controls";
import { DEVANAGARI_FONTS, GUJARATI_FONTS, LATIN_FONTS, SAMPLES, fontByFamily, injectFont, nearestWeight, type CaptionFont } from "@/lib/fonts";
import type { AccentStyle } from "@/lib/types";

const ACCENT_FONTS = [...LATIN_FONTS, ...GUJARATI_FONTS, ...DEVANAGARI_FONTS];
import { normaliseScript, scriptOptions, scriptsIn, scriptOf, languageByCode } from "@/lib/languages";
import { displayText } from "@/lib/translit";

export function TextPanel() {
  const { doc, settings } = useEditor();
  const patch = useStylePatch();
  const style = doc.style;
  const sample = doc.words.slice(0, 40).map((w) => w.text).join(" ");
  const scripts = useMemo(() => scriptsIn(sample), [sample]);
  const spoken = doc.language ?? settings.language;
  const main = scripts.has("Deva") && !scripts.has("Gujr") ? "Deva" : scripts.has("Gujr") ? "Gujr" : languageByCode(spoken)?.script ?? "Gujr";
  const [tab, setTab] = useState<"Gujr" | "Deva" | "Latn">(main === "Deva" ? "Deva" : "Gujr");
  useEffect(() => { setTab(main === "Deva" ? "Deva" : "Gujr"); }, [main]);
  const fonts: CaptionFont[] = tab === "Deva" ? DEVANAGARI_FONTS : tab === "Latn" ? LATIN_FONTS : GUJARATI_FONTS;
  useEffect(() => { fonts.forEach((f) => injectFont(f.family)); }, [fonts]);
  const f = fontByFamily(style.font);
  const lang = doc.language ?? (scripts.has("Deva") ? "hi" : scripts.has("Gujr") ? "gu" : settings.language);
  const opts = scriptOptions(lang);
  const current = normaliseScript(style.script);
  const previewWords = (sample || SAMPLES.Gujr!).split(" ").slice(0, 6).join(" ");
  const chosenCovers = scripts.size === 0 || [...scripts].every((s) => s === "Latn" || f.scripts.includes(s));
  const sampleText = tab === "Deva" ? SAMPLES.Deva! : tab === "Latn" ? "Aa Hello" : SAMPLES.Gujr!;
  const acc = style.accent;
  const patchAcc = (p: Partial<AccentStyle>) => patch({ accent: { ...style.accent, ...p } });
  useEffect(() => { if (acc?.font) injectFont(acc.font); }, [acc?.font]);

  return (
    <>
      <Section title="Write captions in">
        <div className="choice-list" role="radiogroup" aria-label="Caption script">
          {opts.map((o) => (
            <button key={o.value} role="radio" aria-checked={current === o.value} className={`choice ${current === o.value ? "on" : ""}`} onClick={() => patch({ script: o.value })}>
              <b>{o.label}</b>
              <em>{o.value === "native" ? (o.hint || previewWords) : displayText(previewWords, o.value) || o.hint}</em>
            </button>
          ))}
        </div>
        {opts.length === 1 && scriptOf(sample) !== "Latn" ? <p className="muted">English-letter spelling is available for Gujarati, Hindi, Marathi and Nepali captions.</p> : null}
        {current !== "native" ? <p className="muted">Fix any spelling in Language → English-letter spellings, or per word in Captions.</p> : null}
      </Section>
      <Section title="Fonts" right={
        <div className="seg small" role="tablist" aria-label="Font script">
          <button role="tab" aria-selected={tab === "Gujr"} className={tab === "Gujr" ? "on" : ""} onClick={() => setTab("Gujr")}>ગુજરાતી</button>
          <button role="tab" aria-selected={tab === "Deva"} className={tab === "Deva" ? "on" : ""} onClick={() => setTab("Deva")}>हिन्दी</button>
          <button role="tab" aria-selected={tab === "Latn"} className={tab === "Latn" ? "on" : ""} onClick={() => setTab("Latn")}>English</button>
        </div>
      }>
        {!chosenCovers ? (
          <p className="note warn">“{style.font}” doesn&apos;t include every script in your captions; missing letters use a matching Noto font automatically (same in the export).</p>
        ) : null}
        <div className="fonts">
          {fonts.map((g) => (
            <button key={g.family} className={`font-card ${style.font === g.family ? "on" : ""}`} onClick={() => patch({ font: g.family, weight: nearestWeight(g.family, style.weight) })} aria-pressed={style.font === g.family}>
              <span className="font-sample" style={{ fontFamily: `"${g.family}"`, fontWeight: nearestWeight(g.family, style.weight) }}>{sampleText}</span>
              <span className="font-name">{g.family} <em>{g.category}</em></span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Text">
        <Select label="Weight" value={nearestWeight(style.font, style.weight)} options={f.weights.map((w) => ({ value: w, label: String(w) }))} onChange={(v) => patch({ weight: v })} />
        <Slider label="Size" value={style.sizeVh} min={2} max={16} step={0.1} unit="% of height" onChange={(v) => patch({ sizeVh: v })} />
        <Slider label="Letter spacing" value={style.letterSpacing} min={-0.1} max={0.3} step={0.005} unit="em" onChange={(v) => patch({ letterSpacing: v })} />
        <Slider label="Word gap" value={style.wordGap} min={0} max={1} step={0.01} unit="em" onChange={(v) => patch({ wordGap: v })} />
        <Slider label="Line height" value={style.lineHeight} min={0.8} max={2.2} step={0.01} onChange={(v) => patch({ lineHeight: v })} />
        <Toggle label="UPPERCASE English words" value={style.uppercase} onChange={(v) => patch({ uppercase: v })} />
      </Section>
      <Section title="★ Emphasis words">
        <p className="muted">For words marked ★ (Captions → Highlight keywords, or ★ on any word).</p>
        <Toggle label="Own font and size" value={!!acc}
          onChange={(v) => patch({ accent: v ? { font: "Pacifico", weight: 400, sizeMul: 1.3, fill: style.emphasisFill } : undefined })} />
        {acc ? (
          <>
            <Select label="Font" value={acc.font ?? ""}
              options={[{ value: "", label: "Same as the caption" }, ...ACCENT_FONTS.map((g) => ({ value: g.family, label: `${g.family} · ${g.category}` }))]}
              onChange={(v) => patchAcc({ font: v || undefined, weight: v ? nearestWeight(v, acc.weight ?? style.weight) : undefined })} />
            <Slider label="Size" value={acc.sizeMul ?? 1} min={0.6} max={2.2} step={0.05} unit="×" onChange={(v) => patchAcc({ sizeMul: v })} />
            <Color label="Colour" value={acc.fill ?? style.emphasisFill} onChange={(v) => patchAcc({ fill: v, gradient: undefined })} />
            <Toggle label="Italic" value={!!acc.italic} onChange={(v) => patchAcc({ italic: v || undefined })} />
            <Select label="Case" value={acc.case ?? ""} options={[{ value: "", label: "As spoken" }, { value: "upper", label: "UPPERCASE" }, { value: "lower", label: "lowercase" }]}
              onChange={(v) => patchAcc({ case: (v || undefined) as AccentStyle["case"] })} />
            <Toggle label="Keep the caption outline" value={acc.stroke !== null} onChange={(v) => patchAcc({ stroke: v ? undefined : null })} />
            <Slider label="Raise / lower" value={acc.yOffset ?? 0} min={-0.4} max={0.4} step={0.01} unit="em" onChange={(v) => patchAcc({ yOffset: v || undefined })} />
          </>
        ) : (
          <Color label="Colour" value={style.emphasisFill} onChange={(v) => patch({ emphasisFill: v ?? style.emphasisFill })} />
        )}
      </Section>
    </>
  );
}
