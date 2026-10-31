"use client";
/**
 * Effects library: Trending, Reels & Shorts, Cinematic, Transitions, Text
 * animations, Music and Sound effects. One click applies an item at the
 * playhead (or to the whole video / every cut); beat sync places effects on
 * the music's beats. Packs can be imported as JSON (see docs/EFFECT_PACKS.md).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, useTime } from "../EditorContext";
import { Section, Select, Slider } from "@/components/Controls";
import { IconPlay, IconSearch, IconTrash, IconUpload, IconX, IconMusic, IconSparkle, IconMotion, IconScissors, IconType, IconVolume } from "@/components/Icons";

/** One consistent SVG icon + track colour per kind of effect (replaces per-item emoji). */
const FX_KIND: Record<string, { Icon: (p: { size?: number }) => React.ReactElement; bg: string }> = {
  preset: { Icon: IconSparkle, bg: "var(--lime)" },
  "beat-sync": { Icon: IconMotion, bg: "var(--track-fx)" },
  "keyword-sync": { Icon: IconMotion, bg: "var(--track-fx)" },
  fx: { Icon: IconSparkle, bg: "var(--track-fx)" },
  transition: { Icon: IconScissors, bg: "var(--track-video)" },
  text: { Icon: IconType, bg: "var(--track-graphics)" },
  sfx: { Icon: IconVolume, bg: "var(--track-sound)" },
  music: { Icon: IconMusic, bg: "var(--track-music)" },
};
import { CATEGORIES, allPacks, itemsIn, registerPack, unregisterPack, validatePack, CORE_PACK, type EffectCategory, type EffectItem } from "@/lib/effects/packs";
import { FX, fxMeta, type FxType } from "@/lib/effects/fx";
import { applyAction, requirements, type Env, type PreparedSound } from "@/lib/effects/apply";
import { beatsOnTimeline } from "@/lib/effects/beats";
import { beatsFor, ensureMusic, ensureSfx, previewAsset } from "@/lib/effects/library";
import { autoKeywords } from "@/lib/keywords";
import { baseWordId } from "@/lib/edl";
import { LS } from "@/lib/settings";

const BEAT_FX = FX.filter((f) => f.beat);

/* ---------- shared with the timeline ---------- */

/** dataTransfer type for an effect tile dragged onto the timeline. */
export const FX_DRAG_TYPE = "application/x-acg-effect";

/** Find an item by its pack and id (from a drag). */
export function findItem(pack: string, id: string): EffectItem | undefined {
  return allPacks().find((p) => p.id === pack)?.items.find((it) => it.id === id);
}

let pendingCategory: EffectCategory | null = null;
const categoryListeners = new Set<(c: EffectCategory) => void>();
/** Open a category in the Effects panel (used by the cut buttons on the timeline). */
export function requestFxCategory(c: EffectCategory) {
  pendingCategory = c;
  categoryListeners.forEach((f) => f(c));
}

type Applyable = Pick<EffectItem, "name" | "action">;
/** Where to apply: defaults to the playhead and the selected clip. */
export interface ApplyAt { time?: number; clipId?: string | null }

/** Applies an effect item to the project (shared by clicking a tile and dropping it on the timeline). */
export function useApplyEffect() {
  const ed = useEditor();
  const time = useTime();
  const { doc, project, toast, dismiss, selection, tl, clips, lines, outWords } = ed;
  const [busy, setBusy] = useState<string | null>(null);
  const music = doc.audio?.music;

  /** Beats of the current music on the output timeline (analysing uploads once). */
  const currentBeats = async (): Promise<number[]> => {
    if (!music) return [];
    let beats = music.beats;
    if (!beats?.length) {
      const tid = toast({ kind: "busy", title: "Finding the beats…", message: music.name });
      try {
        const r = await beatsFor(music.assetId);
        beats = r.beats;
        project.update((d) => (d.audio?.music ? { ...d, audio: { ...d.audio, music: { ...d.audio.music, beats: r.beats, bpm: r.bpm } } } : d), { history: false });
      } finally { dismiss(tid); }
    }
    return beatsOnTimeline(beats ?? [], music.start, ed.musicDuration || Infinity, tl.duration, music.loop);
  };

  const apply = async (item: Applyable, at: ApplyAt = {}) => {
    if (busy) return;
    setBusy(item.name);
    const req = requirements(item.action);
    const tid = req.music.size ? toast({ kind: "busy", title: "Composing music…", message: "Made on your device, free to use" }) : null;
    try {
      const sounds: Record<string, PreparedSound> = {};
      for (const id of req.sfx) { const a = await ensureSfx(id); sounds[id] = { assetId: a.id, name: a.name.replace(/\.wav$/, ""), duration: a.duration ?? 1 }; }
      const musicPrep: Env["music"] = {};
      for (const id of req.music) { const a = await ensureMusic(id); musicPrep[id] = { assetId: a.id, name: a.name.replace(/\.wav$/, ""), beats: a.beats, bpm: a.bpm, duration: a.duration ?? 30 }; }
      const beats = req.beats && !req.music.size ? await currentBeats() : [];
      // keywords: highlighted words, or pick them automatically
      let words = doc.words;
      let keywords: number[] = [];
      if (req.keywords) {
        if (!words.some((w) => w.emphasis)) words = autoKeywords(words, lines.map((l) => ({ ...l, words: l.words.map((w) => ({ ...w, id: baseWordId(w.id) })) })));
        const emph = new Set(words.filter((w) => w.emphasis).map((w) => w.id));
        keywords = outWords.filter((w) => emph.has(baseWordId(w.id))).map((w) => w.start);
      }
      const selectedClipId = at.clipId !== undefined ? at.clipId : selection?.kind === "clip" ? selection.id : null;
      const env: Env = { time: at.time ?? time, duration: tl.duration, clips, selectedClipId, beats, keywords, sounds, music: musicPrep };
      let notes: string[] = [];
      project.update((d) => { const r = applyAction({ ...d, words }, item.action, env); notes = r.notes; return r.doc; });
      if (tid) dismiss(tid);
      const failed = notes.find((n) => /first|No highlighted/.test(n));
      toast(failed ? { kind: "info", title: item.name, message: failed } : { kind: "success", title: `${item.name} added`, message: notes.join(" ") || "Undo with Ctrl+Z.", duration: 2200 });
    } catch (e) {
      if (tid) dismiss(tid);
      toast({ kind: "error", title: `Couldn't add ${item.name}`, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return { apply, busy };
}

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
/** Display name of a transition kind, from the core pack. */
export function transitionName(kind: string): string {
  const it = itemsIn("transitions").find((x) => x.action.type === "transition" && x.action.kind === kind);
  return it?.name ?? kind;
}

export function loadImportedPacks() {
  for (const p of LS.get<unknown[]>("acg:packs", [])) { try { registerPack(validatePack(p)); } catch { /* skip broken pack */ } }
}

export function EffectsPanel() {
  const ed = useEditor();
  const time = useTime();
  const { doc, project, toast, dismiss, selection, setSelection, tl, clips } = ed;
  const [cat, setCat] = useState<EffectCategory>("trending");
  const [q, setQ] = useState("");
  const { apply, busy } = useApplyEffect();
  const [beatFx, setBeatFx] = useState<FxType>("zoom-punch");
  const [every, setEvery] = useState(2);
  const [beatIntensity, setBeatIntensity] = useState(0.7);
  const [packsTick, setPacksTick] = useState(0);
  const stopPreview = useRef<(() => void) | null>(null);
  const packInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => stopPreview.current?.(), []);
  // the timeline's cut buttons can ask for a category
  useEffect(() => {
    const on = (c: EffectCategory) => { setCat(c); setQ(""); pendingCategory = null; };
    if (pendingCategory) on(pendingCategory);
    categoryListeners.add(on);
    return () => { categoryListeners.delete(on); };
  }, []);

  const items = useMemo(() => {
    const list = q.trim()
      ? CATEGORIES.flatMap((c) => itemsIn(c.id)).filter((it, i, arr) => arr.findIndex((x) => x.id === it.id && x.pack === it.pack) === i).filter((it) => `${it.name} ${it.desc ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
      : itemsIn(cat);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, q, packsTick]);

  const music = doc.audio?.music;

  const preview = async (it: EffectItem) => {
    stopPreview.current?.();
    try {
      if (it.action.type === "sfx") { const a = await ensureSfx(it.action.sfx); stopPreview.current = await previewAsset(a.id, 4); }
      else if (it.action.type === "music") {
        const tid = toast({ kind: "busy", title: "Composing a preview…" });
        const a = await ensureMusic(it.action.style);
        dismiss(tid);
        stopPreview.current = await previewAsset(a.id, 10);
      }
    } catch (e) { toast({ kind: "error", title: "Preview failed", message: (e as Error).message }); }
  };

  /* ---------- selected effect / sound ---------- */
  const selFx = selection?.kind === "fx" ? doc.effects?.find((f) => f.id === selection.id) : undefined;
  const selSound = selection?.kind === "sound" ? doc.sounds?.find((s) => s.id === selection.id) : undefined;
  const updFx = (p: Partial<NonNullable<typeof selFx>>) => selFx && project.update((d) => ({ ...d, effects: (d.effects ?? []).map((f) => (f.id === selFx.id ? { ...f, ...p } : f)) }), { coalesce: `fx:${selFx.id}:${Object.keys(p).join(",")}` });
  const updSound = (p: Partial<NonNullable<typeof selSound>>) => selSound && project.update((d) => ({ ...d, sounds: (d.sounds ?? []).map((s) => (s.id === selSound.id ? { ...s, ...p } : s)) }), { coalesce: `snd:${selSound.id}:${Object.keys(p).join(",")}` });

  /** Play a little before to a little after a span, then stop. */
  const previewTimer = useRef<number | null>(null);
  const previewAt = (a: number, b: number) => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    ed.playback.seek(Math.max(0, a - 0.4));
    ed.playback.play();
    previewTimer.current = window.setTimeout(() => ed.playback.pause(), (Math.min(6, b - a) + 0.9) * 1000 / Math.max(0.25, ed.playback.rate));
  };
  const nFx = doc.effects?.length ?? 0;
  const nSnd = doc.sounds?.length ?? 0;

  return (
    <>
      {selFx ? (
        <Section title={`Editing: ${fxMeta(selFx.type)?.label ?? "Effect"}`} right={<button className="btn small ghost danger" onClick={() => { project.update((d) => ({ ...d, effects: (d.effects ?? []).filter((f) => f.id !== selFx.id) })); setSelection(null); }}><IconTrash size={14} /> Remove</button>}>
          <div className="row-btns wrap">
            <button className="btn small" onClick={() => previewAt(selFx.start, selFx.end)}><IconPlay size={13} /> Preview</button>
            <button className="btn small ghost" onClick={() => setSelection(null)}>Done</button>
          </div>
          <Select label="Effect" value={selFx.type} options={FX.map((f) => ({ value: f.type, label: f.label }))} onChange={(v) => updFx({ type: v })} hint="swap for another effect" />
          <Slider label="Strength" value={selFx.intensity} min={0.05} max={1} step={0.05} onChange={(v) => updFx({ intensity: v })} />
          <div className="time-row"><span>In</span><input type="number" step={0.05} min={0} value={+selFx.start.toFixed(2)} onChange={(e) => updFx({ start: Math.max(0, Math.min(selFx.end - 0.05, Number(e.target.value))) })} aria-label="Effect start" /><button className="btn small ghost" onClick={() => updFx({ start: Math.min(time, selFx.end - 0.05) })}>To playhead</button></div>
          <div className="time-row"><span>Out</span><input type="number" step={0.05} value={+selFx.end.toFixed(2)} onChange={(e) => updFx({ end: Math.max(selFx.start + 0.05, Number(e.target.value)) })} aria-label="Effect end" /><button className="btn small ghost" onClick={() => updFx({ end: Math.max(time, selFx.start + 0.05) })}>To playhead</button></div>
          {selFx.group ? <p className="muted">Part of “{selFx.group.replace(/^beat:/, "beat sync: ").replace(/^whole:/, "whole video: ")}”.</p> : null}
        </Section>
      ) : null}
      {selSound ? (
        <Section title={`Editing: ${selSound.name}`} right={<button className="btn small ghost danger" onClick={() => { project.update((d) => ({ ...d, sounds: (d.sounds ?? []).filter((s) => s.id !== selSound.id) })); setSelection(null); }}><IconTrash size={14} /> Remove</button>}>
          <Slider label="Volume" value={selSound.volume} min={0} max={2} step={0.05} unit="×" onChange={(v) => updSound({ volume: v })} />
          <div className="time-row"><span>At</span><input type="number" step={0.05} min={0} value={+selSound.start.toFixed(2)} onChange={(e) => updSound({ start: Math.max(0, Number(e.target.value)) })} aria-label="Sound start" /><button className="btn small ghost" onClick={() => updSound({ start: +time.toFixed(2) })}>To playhead</button></div>
          <button className="btn small ghost" onClick={async () => { stopPreview.current?.(); stopPreview.current = await previewAsset(selSound.assetId, 5); }}><IconPlay size={14} /> Listen</button>
        </Section>
      ) : null}

      <div className="fx-tabs" role="tablist" aria-label="Effect categories">
        {CATEGORIES.map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id && !q} className={`pchip ${cat === c.id && !q ? "on" : ""}`} onClick={() => { setCat(c.id); setQ(""); }}>{c.label}</button>
        ))}
      </div>
      <label className="pp-search fx-search">
        <IconSearch size={15} />
        <input placeholder="Search effects, sounds, music" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search effects" />
        {q ? <button className="btn icon small ghost" onClick={() => setQ("")} aria-label="Clear search"><IconX size={13} /></button> : null}
      </label>

      {(cat === "trending" || cat === "reels" || cat === "music") && !q ? (
        <Section title="Beat sync">
          {music ? (
            <p className="muted"><IconMusic size={13} /> {music.name}{music.bpm ? ` · ${Math.round(music.bpm)} BPM` : ""}{music.beats?.length ? ` · ${music.beats.length} beats` : " · beats found when you sync"}</p>
          ) : <p className="muted">Pick a track in Music (or add your own in Audio); effects can then land on its beats.</p>}
          <div className="beat-row">
            <Select label="Effect" value={beatFx} options={BEAT_FX.map((f) => ({ value: f.type, label: f.label }))} onChange={setBeatFx} />
            <Select label="On" value={every} options={[{ value: 1, label: "every beat" }, { value: 2, label: "every 2nd beat" }, { value: 4, label: "every bar (4)" }, { value: 8, label: "every 2 bars" }]} onChange={setEvery} />
            <Slider label="Strength" value={beatIntensity} min={0.1} max={1} step={0.05} onChange={setBeatIntensity} />
          </div>
          <div className="row-btns wrap">
            <button className="btn small primary" disabled={!music || !!busy} onClick={() => void apply({ name: "Beat sync", action: { type: "beat-sync", fx: beatFx, every, intensity: beatIntensity } })}>🥁 Sync to beats</button>
            <button className="btn small ghost" disabled={!doc.effects?.some((f) => f.group?.startsWith("beat:"))} onClick={() => project.update((d) => ({ ...d, effects: (d.effects ?? []).filter((f) => !f.group?.startsWith("beat:")), sounds: (d.sounds ?? []).filter((s) => !s.group?.startsWith("beat:")) }))}>Clear beat effects</button>
          </div>
        </Section>
      ) : null}

      <Section title={q ? `Results (${items.length})` : CATEGORIES.find((c) => c.id === cat)!.label}>
        {cat === "transitions" && !q ? (() => {
          if (clips.length < 2) return <p className="muted">Split the video first (S) to make cuts. Then click the ＋ on a cut in the timeline, or drag a transition onto it.</p>;
          const it = selection?.kind === "clip" ? tl.items.find((x) => x.clip.id === selection.id && x.index > 0) : undefined;
          if (!it) return <p className="muted">Applies to every cut ({clips.length - 1} now). To change one cut, click its ＋ on the timeline or drag a transition onto it.</p>;
          const cur = it.clip.transition;
          return (
            <div className="cut-note">
              <span>Cut at <b>{fmtClock(it.outStart)}</b>: {cur && cur.kind !== "none" ? <>now <b>{transitionName(cur.kind)}</b></> : "no transition"}. Pick one below.</span>
              <button className="btn small ghost" onClick={() => setSelection(null)}>Every cut</button>
            </div>
          );
        })() : null}
        {(cat === "trending" || cat === "reels") && !q ? <p className="muted">Effects start at the playhead; looks cover the whole video. Everything is on the timeline to adjust.</p> : null}
        <div className="fx-grid">
          {items.map((it) => (
            <div key={`${it.pack}:${it.id}`} className={`fx-tile ${busy === it.name ? "busy" : ""}`}>
              <button className="fx-main" onClick={() => void apply(it)} disabled={!!busy} title={`${it.desc ?? it.name}. Click to add, or drag onto the timeline.`}
                draggable={!busy} onDragStart={(e) => { e.dataTransfer.setData(FX_DRAG_TYPE, JSON.stringify({ pack: it.pack, id: it.id })); e.dataTransfer.setData("text/plain", it.name); e.dataTransfer.effectAllowed = "copy"; }}>
                {(() => { const k = FX_KIND[it.action.type] ?? FX_KIND.fx; return <span className="fx-ico" aria-hidden="true" style={{ background: k.bg }}><k.Icon size={18} /></span>; })()}
                <b>{it.name}</b>
                {it.desc ? <em>{it.desc}</em> : null}
                {it.badge ? <i className={`fx-badge ${it.badge}`}>{it.badge === "hot" ? "Trending" : "New"}</i> : null}
              </button>
              {it.action.type === "sfx" || it.action.type === "music" ? (
                <button className="btn icon small ghost fx-play" onClick={() => void preview(it)} aria-label={`Preview ${it.name}`}><IconPlay size={13} /></button>
              ) : null}
            </div>
          ))}
        </div>
        {!items.length ? <p className="muted">Nothing found.</p> : null}
      </Section>

      <Section title={`On this video (${nFx + nSnd})`}>
        {nFx + nSnd === 0 ? <p className="muted">Nothing added yet. Effects you add show up here and on the Effects and Sounds tracks of the timeline.</p> : (
          <ul className="onvid-list">
            {[...(doc.effects ?? []).map((f) => ({ id: f.id, kind: "fx" as const, name: fxMeta(f.type)?.label ?? f.type, start: f.start, end: f.end })),
              ...(doc.sounds ?? []).map((x) => ({ id: x.id, kind: "sound" as const, name: x.name, start: x.start, end: x.start + x.duration }))]
              .sort((a, b) => a.start - b.start)
              .map((r) => {
                const on = selection?.kind === r.kind && selection.id === r.id;
                return (
                  <li key={r.id} className={`onvid-row ${on ? "on" : ""}`}>
                    <button className="onvid-main" onClick={() => { setSelection({ kind: r.kind, id: r.id }); ed.playback.seek(Math.max(0, r.start)); document.querySelector(".ws-panel-body")?.scrollTo({ top: 0, behavior: "smooth" }); }} aria-pressed={on}>
                      <span className={`onvid-ico ${r.kind}`} aria-hidden="true">{r.kind === "fx" ? <IconSparkle size={14} /> : <IconVolume size={14} />}</span>
                      <span><b>{r.name}</b><em>{fmtClock(r.start)}–{fmtClock(r.end)}{on ? " · editing" : ""}</em></span>
                    </button>
                    <button className="btn icon small ghost" aria-label={`Preview ${r.name}`} onClick={() => previewAt(r.start, r.end)}><IconPlay size={13} /></button>
                    <button className="btn icon small ghost" aria-label={`Remove ${r.name}`} onClick={() => { project.update((d) => (r.kind === "fx" ? { ...d, effects: (d.effects ?? []).filter((f) => f.id !== r.id) } : { ...d, sounds: (d.sounds ?? []).filter((x) => x.id !== r.id) })); if (on) setSelection(null); }}><IconTrash size={14} /></button>
                  </li>
                );
              })}
          </ul>
        )}
        {nFx + nSnd > 1 ? (
          <div className="row-btns wrap">
            <button className="btn small ghost" disabled={!nFx} onClick={() => { project.update((d) => ({ ...d, effects: [] })); setSelection(null); }}>Remove all effects</button>
            <button className="btn small ghost" disabled={!nSnd} onClick={() => { project.update((d) => ({ ...d, sounds: [] })); setSelection(null); }}>Remove all sounds</button>
          </div>
        ) : null}
      </Section>

      <Section title="Effect packs" right={
        <>
          <button className="btn small ghost" onClick={() => packInput.current?.click()}><IconUpload size={14} /> Import pack</button>
          <input ref={packInput} type="file" accept=".json,application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const p = validatePack(JSON.parse(await f.text()));
              registerPack(p);
              LS.set("acg:packs", [...LS.get<{ id: string }[]>("acg:packs", []).filter((x) => x.id !== p.id), p]);
              setPacksTick((n) => n + 1);
              toast({ kind: "success", title: `${p.name} added`, message: `${p.items.length} items.` });
            } catch (err) { toast({ kind: "error", title: "Couldn't import that pack", message: (err as Error).message }); }
          }} />
        </>
      }>
        <ul className="kit-list">
          {allPacks().map((p) => (
            <li key={p.id} className="kit-row">
              <span className="kit-name"><b>{p.name}</b><em>{p.items.length} items · v{p.version} · {p.license}</em></span>
              {p.id !== CORE_PACK.id ? <button className="btn icon small ghost" aria-label={`Remove ${p.name}`} onClick={() => { unregisterPack(p.id); LS.set("acg:packs", LS.get<{ id: string }[]>("acg:packs", []).filter((x) => x.id !== p.id)); setPacksTick((n) => n + 1); }}><IconTrash size={14} /></button> : null}
            </li>
          ))}
        </ul>
        <p className="muted">All built-in sounds and music are generated by the app, so they&apos;re free to use in your videos. For your own music or sound effects, add files you have the rights to in Audio.</p>
      </Section>
    </>
  );
}
