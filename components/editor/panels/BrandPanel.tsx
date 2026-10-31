"use client";
/** Brand kits: logo, fonts, colours, caption look, intro/outro, language and export defaults. */
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../EditorContext";
import { Color, Section, Select, Slider, Toggle } from "@/components/Controls";
import { IconBrand, IconTrash, IconUpload, IconPlus, IconCheck } from "@/components/Icons";
import { applyBrandKit, deleteKit, kitFromProject, listKits, newKit, saveKit, type BrandKit, type CardTemplate } from "@/lib/brandkit";
import { putAsset, assetUrl, probeMedia } from "@/lib/assets";
import { ALL_FONTS } from "@/lib/fonts";
import { PRESETS, TRANSLATION_TARGETS } from "@/lib/languages";

export function BrandPanel() {
  const ed = useEditor();
  const { doc, project, toast, clips } = ed;
  const [kits, setKits] = useState<BrandKit[] | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const refresh = () => void listKits().then(setKits);
  useEffect(refresh, []);
  const kit = kits?.find((k) => k.id === editId);
  useEffect(() => { if (kit?.logo) void assetUrl(kit.logo.assetId).then(setLogoUrl); else setLogoUrl(null); }, [kit?.logo]);

  const save = async (k: BrandKit) => { await saveKit(k); refresh(); };
  const patchKit = (p: Partial<BrandKit>) => kit && void save({ ...kit, ...p });
  const patchCard = (which: "intro" | "outro", p: Partial<CardTemplate>) => kit && patchKit({ [which]: { ...(kit[which] ?? newKit(kit.name)[which]!), ...p } });

  const apply = (k: BrandKit) => {
    project.update((d) => applyBrandKit(d, k, clips));
    if (k.language?.transcription) ed.setSettings({ language: k.language.transcription, ...(k.language.translateTo ? { translateTo: k.language.translateTo } : {}) });
    toast({ kind: "success", title: `${k.name} applied`, message: "Undo with Ctrl+Z.", duration: 2500 });
  };

  const create = async (fromProject: boolean) => {
    const name = await ed.dialog.prompt({ title: fromProject ? "Save this look as a brand kit" : "New brand kit", input: { value: fromProject ? `${ed.meta.name} style` : "My brand" }, confirmLabel: "Create" });
    if (!name) return;
    const k = fromProject ? kitFromProject(doc, name) : newKit(name);
    await save(k);
    setEditId(k.id);
  };

  const uploadLogo = async (f: File) => {
    if (!kit) return;
    try {
      if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(f.type)) throw new Error("Use a PNG, JPG, WebP or SVG logo (transparent PNG works best).");
      let blob: Blob = f;
      if (f.type === "image/svg+xml") {
        const { sanitizeSvg } = await import("@/lib/svgSafe");
        blob = new Blob([sanitizeSvg(await f.text()).svg], { type: "image/svg+xml" });
      }
      const meta = f.type === "image/svg+xml" ? {} : await probeMedia(f);
      const a = await putAsset(blob, f.name, "image", meta);
      patchKit({ logo: { assetId: a.id, corner: kit.logo?.corner ?? "tr", size: kit.logo?.size ?? 14, opacity: kit.logo?.opacity ?? 0.9 } });
    } catch (e) {
      toast({ kind: "error", title: "Couldn't use that logo", message: (e as Error).message });
    }
  };

  if (kit) {
    return (
      <>
        <Section title={kit.name} right={<button className="btn small ghost" onClick={() => setEditId(null)}>Done</button>}>
          <label className="field"><span className="field-label">Name</span><span className="field-input"><input className="txt grow" value={kit.name} onChange={(e) => patchKit({ name: e.target.value })} /></span></label>
          <div className="row-btns wrap">
            <button className="btn small primary" onClick={() => apply(kit)}><IconCheck size={14} /> Apply to this project</button>
            <button className="btn small ghost" onClick={() => { void save({ ...kitFromProject(doc, kit.name), id: kit.id, created: kit.created, logo: kit.logo, intro: kit.intro, outro: kit.outro, language: kit.language }); toast({ kind: "success", title: "Kit updated from this project", duration: 2000 }); }}>Update from this project</button>
          </div>
        </Section>
        <Section title="Logo">
          <div className="logo-row">
            {logoUrl ? <img src={logoUrl} alt="" className="logo-preview" /> : <span className="logo-preview empty"><IconBrand /></span>}
            <button className="btn small" onClick={() => logoRef.current?.click()}><IconUpload size={14} /> {kit.logo ? "Replace" : "Upload logo"}</button>
            {kit.logo ? <button className="btn small ghost danger" onClick={() => patchKit({ logo: undefined })}>Remove</button> : null}
            <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ""; }} />
          </div>
          {kit.logo ? (
            <>
              <Select label="Corner" value={kit.logo.corner} options={[{ value: "tl", label: "Top left" }, { value: "tr", label: "Top right" }, { value: "bl", label: "Bottom left" }, { value: "br", label: "Bottom right" }]} onChange={(v) => patchKit({ logo: { ...kit.logo!, corner: v } })} />
              <Slider label="Size" value={kit.logo.size} min={4} max={40} step={0.5} unit="% width" onChange={(v) => patchKit({ logo: { ...kit.logo!, size: v } })} />
              <Slider label="Opacity" value={kit.logo.opacity} min={0.1} max={1} step={0.05} onChange={(v) => patchKit({ logo: { ...kit.logo!, opacity: v } })} />
            </>
          ) : null}
        </Section>
        <Section title="Fonts and colours">
          <Select label="Caption font" value={kit.fonts.caption} options={ALL_FONTS.map((f) => ({ value: f.family, label: f.family }))} onChange={(v) => patchKit({ fonts: { ...kit.fonts, caption: v } })} />
          <Select label="Title font" value={kit.fonts.title} options={ALL_FONTS.map((f) => ({ value: f.family, label: f.family }))} onChange={(v) => patchKit({ fonts: { ...kit.fonts, title: v } })} />
          <Color label="Text" value={kit.colors.text} onChange={(v) => patchKit({ colors: { ...kit.colors, text: v ?? "#FFFFFF" } })} />
          <Color label="Highlight" value={kit.colors.accent} onChange={(v) => patchKit({ colors: { ...kit.colors, accent: v ?? "#D6FF36" } })} />
          <Color label="Brand colour" value={kit.colors.primary} onChange={(v) => patchKit({ colors: { ...kit.colors, primary: v ?? "#D6FF36" } })} />
          <Toggle label="Use a saved caption look" value={!!kit.captionStyle} onChange={(v) => patchKit({ captionStyle: v ? structuredClone(doc.style) : undefined })} hint={kit.captionStyle ? `“${kit.captionStyle.name}”` : "otherwise fonts + colours only"} />
        </Section>
        {(["intro", "outro"] as const).map((w) => {
          const c = kit[w] ?? newKit(kit.name)[w]!;
          return (
            <Section key={w} title={w === "intro" ? "Intro card" : "Outro card"}>
              <Toggle label={`Add an ${w}`} value={c.enabled} onChange={(v) => patchCard(w, { enabled: v })} />
              {c.enabled ? (
                <>
                  <label className="field"><span className="field-label">Title</span><span className="field-input"><input className="txt grow" value={c.title} onChange={(e) => patchCard(w, { title: e.target.value })} /></span></label>
                  <label className="field"><span className="field-label">Subtitle</span><span className="field-input"><input className="txt grow" value={c.subtitle ?? ""} onChange={(e) => patchCard(w, { subtitle: e.target.value })} /></span></label>
                  <Slider label="Duration" value={c.duration} min={0.5} max={8} step={0.1} unit="s" onChange={(v) => patchCard(w, { duration: v })} />
                  <Color label="From" value={c.background.colors?.[0] ?? kit.colors.primary} onChange={(v) => patchCard(w, { background: { kind: "gradient", angle: 135, colors: [v ?? kit.colors.primary, c.background.colors?.[1] ?? "#2A2E36"] } })} />
                  <Color label="To" value={c.background.colors?.[1] ?? "#2A2E36"} onChange={(v) => patchCard(w, { background: { kind: "gradient", angle: 135, colors: [c.background.colors?.[0] ?? kit.colors.primary, v ?? "#2A2E36"] } })} />
                </>
              ) : null}
            </Section>
          );
        })}
        <Section title="Language and export defaults">
          <Select label="Language" value={PRESETS.find((p) => p.transcription === kit.language?.transcription && p.script === kit.language?.script)?.id ?? ""} options={[{ value: "", label: "Keep the project's" }, ...PRESETS.map((p) => ({ value: p.id, label: p.label }))]}
            onChange={(v) => { const p = PRESETS.find((x) => x.id === v); patchKit({ language: p ? { ...kit.language, transcription: p.transcription, script: p.script } : undefined }); }} />
          <Select label="Second line" value={kit.language?.bilingual ? kit.language.translateTo ?? "en-IN" : ""} options={[{ value: "", label: "Off" }, ...TRANSLATION_TARGETS.map((t) => ({ value: t.code, label: `Translation: ${t.name}` }))]}
            onChange={(v) => patchKit({ language: { ...kit.language, bilingual: !!v, translateTo: v || undefined } })} />
          <Toggle label="Use this project's frame and export settings" value={!!kit.frame} onChange={(v) => patchKit({ frame: v ? { aspect: doc.frame.aspect, platform: doc.frame.platform, fit: doc.frame.fit, bg: doc.frame.bg } : undefined, exportPrefs: v ? doc.exportPrefs : undefined })} />
        </Section>
        <Section title="Danger zone">
          <button className="btn small danger" onClick={async () => {
            if (!(await ed.dialog.confirm({ title: `Delete “${kit.name}”?`, message: "Projects that used it keep their look.", confirmLabel: "Delete kit", danger: true }))) return;
            await deleteKit(kit.id);
            setEditId(null);
            refresh();
          }}><IconTrash size={14} /> Delete kit</button>
        </Section>
      </>
    );
  }

  return (
    <>
      <Section title="Brand kits" right={
        <span className="row-btns">
          <button className="btn small" onClick={() => void create(true)}><IconPlus size={14} /> From this project</button>
          <button className="btn small ghost" onClick={() => void create(false)}>New</button>
        </span>
      }>
        {kits === null ? <div className="skeleton small" /> : kits.length ? (
          <ul className="kit-list">
            {kits.map((k) => (
              <li key={k.id} className={`kit-row ${doc.brandKitId === k.id ? "on" : ""}`}>
                <span className="kit-swatches" aria-hidden="true">{[k.colors.primary, k.colors.accent, k.colors.text].map((c, i) => <i key={i} style={{ background: c }} />)}</span>
                <span className="kit-name"><b>{k.name}</b><em>{[k.logo ? "logo" : "", k.intro?.enabled ? "intro" : "", k.outro?.enabled ? "outro" : "", k.captionStyle ? "caption look" : ""].filter(Boolean).join(" · ") || "fonts + colours"}</em></span>
                <button className="btn small primary" onClick={() => apply(k)}>Apply</button>
                <button className="btn small ghost" onClick={() => setEditId(k.id)}>Edit</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Save your logo, fonts, colours, caption look, intro/outro and export settings once, then apply them to any video, or to a whole batch, in one click.</p>
        )}
      </Section>
    </>
  );
}
