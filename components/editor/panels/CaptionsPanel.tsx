"use client";
/**
 * Caption editor: words, punctuation, timing, caption and row breaks,
 * per-caption looks and duration, translations and speakers.
 *
 * Times shown are on the edited (output) timeline; edits are applied to the
 * underlying source words, so they survive later cuts and re-ordering.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, useTime } from "../EditorContext";
import { Color, Section, Select, Slider } from "@/components/Controls";
import { EmptyState } from "@/components/ui";
import { CorrectionsSection } from "./CorrectionsSection";
import { useStylePatch } from "./LookPanels";
import { fontByFamily, nearestWeight } from "@/lib/fonts";
import { IconMotion, IconPalette, IconType } from "@/components/Icons";
import { IconEyeOff, IconMic, IconRefresh, IconSparkle, IconTrash } from "@/components/Icons";
import { baseWordId } from "@/lib/edl";
import { ALL_FONTS } from "@/lib/fonts";
import { normaliseScript } from "@/lib/languages";
import { displayWord, romanizeWord } from "@/lib/translit";
import { autoEmoji, autoKeywords } from "@/lib/keywords";
import { isStale, lineText, translationFor } from "@/lib/bilingual";
import { splitClusters } from "@/lib/animation";
import type { LineOverride, Word } from "@/lib/types";

const fmt = (s: number) => {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.max(0, s) - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, "0")}`;
};

const QUICK_EMOJI = ["🔥", "❤️", "😂", "😍", "✨", "👀", "💰", "✅", "❌", "🙏", "💡", "🎉", "👍", "😮", "⭐", "🛍️"];

export function CaptionsPanel() {
  const ed = useEditor();
  const time = useTime();
  const { doc, lines, outWords, project, playback, selection, setSelection, selectedWordId, setSelectedWordId, newId } = ed;
  const patch = useStylePatch();
  const style = doc.style;
  const fontInfo = fontByFamily(style.font);
  const [find, setFind] = useState("");
  const [repl, setRepl] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const script = normaliseScript(doc.style.script);

  const outById = useMemo(() => new Map(outWords.map((w) => [w.id, w])), [outWords]);
  const sel = selectedWordId ? outById.get(selectedWordId) : undefined;
  const srcIdx = sel ? doc.words.findIndex((w) => w.id === baseWordId(sel.id)) : -1;
  const src = srcIdx >= 0 ? doc.words[srcIdx] : undefined;
  const selKey = selection?.kind === "caption" ? selection.key : null;
  const selLine = selKey ? lines.find((l) => l.key === selKey) : undefined;

  const activeId = useMemo(() => outWords.find((w) => time >= w.start && time < w.end)?.id, [outWords, time]);
  useEffect(() => {
    if (!activeId || !listRef.current || !playback.playing) return;
    const el = listRef.current.querySelector(`[data-id="${CSS.escape(activeId)}"]`) as HTMLElement | null;
    if (el) {
      const box = listRef.current.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeId, playback.playing]);

  const setWords = (fn: (ws: Word[]) => Word[], coalesce?: string) => project.update((d) => ({ ...d, words: fn(d.words) }), coalesce ? { coalesce } : undefined);
  const upd = (p: Partial<Word>, coalesce?: string) => { if (src) setWords((ws) => ws.map((w) => (w.id === src.id ? { ...w, ...p } : w)), coalesce); };

  /** Output-time edit → same shift on the source word. */
  const setTime = (field: "start" | "end", outValue: number) => {
    if (!sel || !src) return;
    const delta = outValue - sel[field];
    const v = +(src[field] + delta).toFixed(3);
    upd(field === "start" ? { start: Math.min(v, src.end - 0.02) } : { end: Math.max(v, src.start + 0.02) }, `time:${src.id}:${field}`);
  };

  const ops = {
    del() {
      if (!src) return;
      const words = doc.words;
      setWords((ws) => ws.filter((w) => w.id !== src.id));
      const next = words[srcIdx + 1] ?? words[srcIdx - 1];
      setSelectedWordId(next ? next.id : null);
    },
    insertAfter() {
      if (!src) return;
      const next = doc.words[srcIdx + 1];
      const start = src.end;
      const end = next ? Math.max(start + 0.05, Math.min(next.start, start + 0.4)) : start + 0.4;
      const w: Word = { id: newId(), text: "…", start, end, speaker: src.speaker };
      setWords((ws) => { const i = ws.findIndex((x) => x.id === src.id); return [...ws.slice(0, i + 1), w, ...ws.slice(i + 1)]; });
      setSelectedWordId(w.id);
    },
    split() {
      if (!src) return;
      const parts = src.text.split(/\s+/).filter(Boolean);
      const g = splitClusters(src.text);
      const pieces = parts.length > 1 ? parts : [g.slice(0, Math.ceil(g.length / 2)).join(""), g.slice(Math.ceil(g.length / 2)).join("")].filter(Boolean);
      if (pieces.length < 2) return;
      const total = pieces.reduce((n, p) => n + splitClusters(p).length, 0);
      let t = src.start;
      const made = pieces.map((p, i) => {
        const d = ((src.end - src.start) * splitClusters(p).length) / total;
        const w: Word = { ...src, id: i ? newId() : src.id, text: p, start: t, end: t + d, breakBefore: i ? false : src.breakBefore, roman: undefined };
        t += d;
        return w;
      });
      setWords((ws) => { const i = ws.findIndex((x) => x.id === src.id); return [...ws.slice(0, i), ...made, ...ws.slice(i + 1)]; });
    },
    mergeNext() {
      if (!src || srcIdx >= doc.words.length - 1) return;
      const n = doc.words[srcIdx + 1];
      setWords((ws) => { const i = ws.findIndex((x) => x.id === src.id); return [...ws.slice(0, i), { ...src, text: `${src.text} ${n.text}`, end: n.end, roman: undefined }, ...ws.slice(i + 2)]; });
    },
    punct(p: string) {
      if (!src) return;
      upd({ text: src.text.replace(/[.,!?।॥:;…]+$/, "") + p });
    },
    shiftAll(d: number) { setWords((ws) => ws.map((w) => ({ ...w, start: Math.max(0, w.start + d), end: Math.max(0.02, w.end + d) }))); },
    replaceAll() {
      if (!find) return;
      setWords((ws) => ws.map((w) => (w.text.includes(find) ? { ...w, text: w.text.split(find).join(repl) } : w)).filter((w) => w.text.trim()));
    },
  };

  if (!doc.words.length) {
    if (ed.file) {
      const busy = ed.transcription.busy;
      return (
        <EmptyState art="video" title={busy ? "Writing your captions…" : "Ready to caption this video"}
          action={
            <div className="empty-actions">
              <button className="btn primary" disabled={busy} onClick={() => void ed.transcription.transcribe(ed.file!)}><IconMic size={16} /> {busy ? "Captioning…" : "Auto caption"}</button>
              {ed.needsKey ? <button className="btn" onClick={ed.openKeySetup}>Add API key</button> : null}
            </div>
          }>
          {busy ? "This usually takes under a minute." : ed.needsKey ? "Add your free ElevenLabs key first. It takes about 2 minutes, and you only do it once." : "Turns the speech into word-timed captions. You can also import an SRT/VTT file (Settings → Import)."}
        </EmptyState>
      );
    }
    return (
      <EmptyState art="video" title="No captions yet">
        Drop a video to caption it automatically, or import an SRT/VTT file (Settings → Import).
      </EmptyState>
    );
  }

  const ov: LineOverride = selKey ? doc.overrides[selKey] ?? {} : {};
  const setOv = (p: Partial<LineOverride>) => {
    if (!selKey) return;
    const next: LineOverride = { ...ov, ...p };
    (Object.keys(next) as (keyof LineOverride)[]).forEach((k) => next[k] === undefined && delete next[k]);
    project.update((d) => {
      const o = { ...d.overrides };
      if (Object.keys(next).length) o[selKey] = next; else delete o[selKey];
      return { ...d, overrides: o };
    }, { coalesce: `ov:${selKey}:${Object.keys(p).join(",")}` });
  };
  const speakers = doc.speakers ?? {};
  const speakerIds = Object.keys(speakers);
  const tr = selLine ? translationFor(selLine, doc.translations) : undefined;
  const setTranslation = (text: string) => {
    if (!selLine) return;
    project.update((d) => {
      const all = { ...(d.translations ?? {}) };
      const prev = translationFor(selLine, d.translations);
      if (text.trim()) all[selLine.key] = { text, source: lineText(selLine), lang: prev?.lang ?? ed.settings.translateTo, manual: true };
      else delete all[selLine.key];
      return { ...d, translations: all };
    }, { coalesce: `tr:${selLine.key}` });
  };
  const setLineSpeaker = (sp: string) => {
    if (!selLine) return;
    const ids = new Set(selLine.words.map((w) => baseWordId(w.id)));
    setWords((ws) => ws.map((w) => (ids.has(w.id) ? { ...w, speaker: sp || undefined } : w)));
  };
  const matches = find ? doc.words.filter((w) => w.text.includes(find)).length : 0;

  return (
    <>
      {outWords.length ? (
        <Section title="Caption look" right={<span className="muted">{style.name}</span>}>
          <Slider label="Size" value={style.sizeVh} min={2} max={16} step={0.1} unit="% of height" onChange={(v) => patch({ sizeVh: v })} />
          <Select label="Weight" value={nearestWeight(style.font, style.weight)} options={fontInfo.weights.map((w) => ({ value: w, label: String(w) }))} onChange={(v) => patch({ weight: v })} />
          <Select label="Font" value={style.font} options={ALL_FONTS.map((f) => ({ value: f.family, label: f.family }))} onChange={(v) => patch({ font: v, weight: nearestWeight(v, style.weight) })} />
          <div className="row-btns wrap">
            <button className="btn small ghost" onClick={() => ed.setPanel("text", true)}><IconType size={14} /> Fonts &amp; spacing</button>
            <button className="btn small ghost" onClick={() => ed.setPanel("style", true)}><IconPalette size={14} /> Colours &amp; template</button>
            <button className="btn small ghost" onClick={() => ed.setPanel("motion", true)}><IconMotion size={14} /> Animation</button>
          </div>
        </Section>
      ) : null}
      {selLine ? (
        <Section title="This caption" right={Object.keys(ov).length ? <button className="btn small ghost" onClick={() => project.update((d) => { const o = { ...d.overrides }; delete o[selKey!]; return { ...d, overrides: o }; })}><IconRefresh size={14} /> Reset</button> : null}>
          <p className="caption-quote guj">“{selLine.words.map((w) => displayWord(w, doc.style.script)).join(" ")}”</p>
          <label className="field stack">
            <span className="field-label">Translation<em>{tr && isStale(selLine, tr) ? "the caption changed since it was translated" : "shown as the second line when it's turned on (Style)"}</em></span>
            <textarea rows={2} value={tr?.text ?? ""} placeholder="Type or generate in Language" onChange={(e) => setTranslation(e.target.value)} aria-label="Translation of this caption" />
          </label>
          {speakerIds.length ? (
            <Select label="Speaker" value={selLine.words[0]?.speaker ?? ""} options={[{ value: "", label: "None" }, ...speakerIds.map((id) => ({ value: id, label: speakers[id].name }))]} onChange={setLineSpeaker} />
          ) : null}
          <Color label="Text colour" value={ov.fill} allowNone onChange={(v) => setOv({ fill: v })} />
          <Color label="Highlight colour" value={ov.activeFill} allowNone onChange={(v) => setOv({ activeFill: v })} />
          <Select label="Font" value={ov.font ?? ""} options={[{ value: "", label: "Same as all captions" }, ...ALL_FONTS.map((f) => ({ value: f.family, label: f.family }))]} onChange={(v) => setOv({ font: v || undefined })} />
          {ov.sizeVh !== undefined ? <Slider label="Size" value={ov.sizeVh} min={2} max={16} step={0.1} onChange={(v) => setOv({ sizeVh: v })} /> : null}
          <Slider label="Hold longer" value={ov.extend ?? 0} min={0} max={3} step={0.05} unit="s" onChange={(v) => setOv({ extend: v || undefined })} hint="never overlaps the next caption" />
          <div className="row-btns wrap">
            <button className={`btn small ${ov.hidden ? "on" : ""}`} onClick={() => setOv({ hidden: ov.hidden ? undefined : true })}><IconEyeOff size={14} /> {ov.hidden ? "Hidden in video" : "Hide this caption"}</button>
            {ov.posX !== undefined || ov.posY !== undefined ? (
              <button className="btn small ghost" onClick={() => setOv({ posX: undefined, posY: undefined, sizeVh: undefined })}>Use shared position</button>
            ) : <span className="muted">Tip: choose “This caption” on the video, then drag it.</span>}
          </div>
        </Section>
      ) : null}

      {sel && src ? (
        <Section title="Selected word">
          <div className="sel-word">
            <input className="word-input" value={src.text} onChange={(e) => upd({ text: e.target.value }, `text:${src.id}`)} aria-label="Word text" />
            {script !== "native" ? (
              <label className="field">
                <span className="field-label">English letters<em>auto: {romanizeWord(src.text, script === "roman" ? "roman" : "casual")}</em></span>
                <span className="field-input"><input className="txt grow" value={src.roman ?? ""} placeholder="(automatic)" onChange={(e) => upd({ roman: e.target.value || undefined }, `roman:${src.id}`)} /></span>
              </label>
            ) : null}
            <div className="row-btns wrap" role="group" aria-label="Punctuation">
              {[".", ",", "?", "!", "।", "…"].map((p) => <button key={p} className="btn small ghost punct" onClick={() => ops.punct(p)} aria-label={`End with ${p}`}>{p}</button>)}
              <button className="btn small ghost" onClick={() => ops.punct("")}>No mark</button>
            </div>
            {(["start", "end"] as const).map((field) => (
              <div className="time-row" key={field}>
                <span>{field === "start" ? "Start" : "End"}</span>
                <button className="btn icon small" onClick={() => setTime(field, sel[field] - 0.05)} aria-label={`${field} earlier`}>−</button>
                <input type="number" step={0.01} value={+sel[field].toFixed(3)} onChange={(e) => setTime(field, Number(e.target.value))} aria-label={`${field} time`} />
                <button className="btn icon small" onClick={() => setTime(field, sel[field] + 0.05)} aria-label={`${field} later`}>+</button>
                <button className="btn small ghost" onClick={() => setTime(field, field === "start" ? Math.min(time, sel.end - 0.02) : Math.max(time, sel.start + 0.02))}>To playhead</button>
              </div>
            ))}
            <div className="emoji-row" role="group" aria-label="Emoji after this word">
              <button className={`emoji-btn ${!src.emoji ? "on" : ""}`} onClick={() => upd({ emoji: undefined })} title="No emoji">∅</button>
              {QUICK_EMOJI.map((e) => <button key={e} className={`emoji-btn ${src.emoji === e ? "on" : ""}`} onClick={() => upd({ emoji: src.emoji === e ? undefined : e })}>{e}</button>)}
            </div>
            <div className="row-btns wrap">
              <button className={`btn small ${src.emphasis ? "on" : ""}`} aria-pressed={!!src.emphasis} onClick={() => upd({ emphasis: !src.emphasis })}>★ Emphasis</button>
              <button className={`btn small ${src.breakBefore ? "on" : ""}`} aria-pressed={!!src.breakBefore} onClick={() => upd({ breakBefore: !src.breakBefore })}>New caption here</button>
              <button className={`btn small ${src.lineBreak ? "on" : ""}`} aria-pressed={!!src.lineBreak} onClick={() => upd({ lineBreak: !src.lineBreak || undefined })}>New row here</button>
              <button className="btn small" onClick={ops.insertAfter}>Insert after</button>
              <button className="btn small" onClick={ops.split}>Split</button>
              <button className="btn small" onClick={ops.mergeNext}>Merge next</button>
              <button className="btn small danger" onClick={ops.del}><IconTrash size={14} /> Delete</button>
            </div>
          </div>
        </Section>
      ) : null}

      <Section title={`Transcript (${outWords.length} words, ${lines.length} captions)`}>
        <div className="lines" ref={listRef}>
          {lines.map((l) => {
            const t = translationFor(l, doc.translations);
            const sp = l.words[0]?.speaker ? speakers[l.words[0].speaker] : undefined;
            return (
              <div key={l.id} className={`line ${time >= l.start && time < l.end ? "now" : ""} ${l.key === selKey ? "picked" : ""} ${doc.overrides[l.key]?.hidden ? "muted-line" : ""}`}>
                <button className="line-time" onClick={() => { setSelection({ kind: "caption", key: l.key }); playback.seek(Math.min(l.start + 0.3, (l.start + l.end) / 2)); }} aria-label={`Caption at ${fmt(l.start)}`}>
                  {sp ? <i className="sp-dot" style={{ background: sp.color }} title={sp.name} /> : null}{fmt(l.start)}
                </button>
                <div className="line-body">
                  <div className="chips">
                    {l.words.map((w) => (
                      <button key={w.id} data-id={w.id}
                        className={`chip ${w.id === selectedWordId ? "sel" : ""} ${w.id === activeId ? "act" : ""} ${w.emphasis ? "emph" : ""} ${w.lineBreak ? "br" : ""}`}
                        onClick={() => { setSelectedWordId(w.id); setSelection({ kind: "caption", key: l.key }); playback.seek((w.start + w.end) / 2); }}>
                        {displayWord(w, doc.style.script)}
                        {w.emoji ? <span className="chip-emoji">{w.emoji}</span> : null}
                      </button>
                    ))}
                  </div>
                  {t?.text ? <p className={`line-tr ${isStale(l, t) ? "stale" : ""}`}>{t.text}</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {speakerIds.length ? (
        <Section title="Speakers">
          {speakerIds.map((id) => (
            <div className="speaker-row" key={id}>
              <input type="color" value={speakers[id].color} aria-label={`${speakers[id].name} colour`} onChange={(e) => project.update((d) => ({ ...d, speakers: { ...d.speakers, [id]: { ...speakers[id], color: e.target.value } } }), { coalesce: `spc:${id}` })} />
              <input className="txt grow" value={speakers[id].name} aria-label="Speaker name" onChange={(e) => project.update((d) => ({ ...d, speakers: { ...d.speakers, [id]: { ...speakers[id], name: e.target.value } } }), { coalesce: `spn:${id}` })} />
              <span className="muted">{doc.words.filter((w) => w.speaker === id).length} words</span>
            </div>
          ))}
          <p className="muted">Turn on “Colour words by speaker” in Style, or add a Speaker label in Graphics.</p>
        </Section>
      ) : null}

      <CorrectionsSection />
      <Section title="Smart tools">
        <div className="row-btns wrap">
          <button className="btn small" onClick={() => { project.update((d) => ({ ...d, words: autoKeywords(d.words, lines.map((l) => ({ ...l, words: l.words.map((w) => ({ ...w, id: baseWordId(w.id) })) }))) })); ed.toast({ kind: "success", title: "Keywords highlighted", message: "One word per caption. Change any with ★ Emphasis." }); }}><IconSparkle size={15} /> Highlight keywords</button>
          <button className="btn small" onClick={() => {
            const before = doc.words;
            const next = autoEmoji(before, lines.map((l) => ({ ...l, words: l.words.map((w) => ({ ...w, id: baseWordId(w.id) })) })));
            const n = next.filter((w, i) => w.emoji && w.emoji !== before[i].emoji).length;
            project.update((d) => ({ ...d, words: next }));
            ed.toast(n ? { kind: "success", title: `${n} emoji added` } : { kind: "info", title: "No matching words", message: "Add emoji by hand from the selected word." });
          }}>😀 Add emoji</button>
          <button className="btn small ghost" onClick={() => project.update((d) => ({ ...d, words: d.words.map((w) => ({ ...w, emphasis: false, emoji: undefined })) }))}>Clear highlights and emoji</button>
        </div>
      </Section>

      <Section title="Find and replace">
        <div className="find">
          <input placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find" />
          <input placeholder="Replace with (empty deletes)" value={repl} onChange={(e) => setRepl(e.target.value)} aria-label="Replace with" />
          <button className="btn small" onClick={ops.replaceAll} disabled={!matches}>Replace {matches || ""}</button>
        </div>
      </Section>

      <Section title="Timing">
        <Slider label="Caption delay" value={doc.offset} min={-2} max={2} step={0.01} unit="s" hint="+ shows captions later" onChange={(v) => project.update((d) => ({ ...d, offset: v }), { coalesce: "offset" })} />
        <div className="row-btns">
          <span className="muted">Shift every word</span>
          <button className="btn small" onClick={() => ops.shiftAll(-0.1)}>−0.1 s</button>
          <button className="btn small" onClick={() => ops.shiftAll(0.1)}>+0.1 s</button>
        </div>
        {ed.file && doc.words.length ? (
          <>
            <p className="muted">Drifting more the further it plays? Re-sync listens again and pins every word back onto the speech, keeping your edits.</p>
            <button className="btn small" onClick={() => void ed.transcription.resync(ed.file!)} disabled={ed.transcription.busy}>Re-sync to audio</button>
          </>
        ) : null}
      </Section>
    </>
  );
}
