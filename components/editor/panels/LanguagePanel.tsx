"use client";
/**
 * Three separate language choices:
 *   1. Spoken language   → what ElevenLabs Scribe listens for (or auto-detect)
 *   2. Caption script    → how captions are written (native, Gujlish/Hinglish, Roman)
 *   3. Translation       → optional second line, by Sarvam AI
 * Only combinations the providers support are offered.
 */
import { useMemo, useState } from "react";
import { useEditor } from "../EditorContext";
import { Section, Select, Toggle } from "@/components/Controls";
import { ProgressIndicator } from "@/components/ui";
import { IconLanguage, IconMic } from "@/components/Icons";
import {
  AUTO, LANGUAGES, PRESETS, TRANSLATION_TARGETS, languageByCode, languageName, normaliseScript, scriptOptions, translationPlan,
} from "@/lib/languages";
import { linesToTranslate, mergeTranslations, DEFAULT_SECONDARY } from "@/lib/bilingual";
import { displayWord } from "@/lib/translit";

const TIER: Record<string, string> = { excellent: "excellent accuracy", high: "high accuracy", good: "good accuracy", moderate: "moderate accuracy" };

export function LanguagePanel() {
  const ed = useEditor();
  const { doc, settings, setSettings, project, lines, toast, dismiss, server } = ed;
  const [progress, setProgress] = useState<number | null>(null);
  const spoken = settings.language;
  const projectLang = doc.language;
  const effective = projectLang ?? (spoken === AUTO ? undefined : spoken);
  const script = normaliseScript(doc.style.script);
  const sOpts = scriptOptions(effective ?? spoken);
  const presetOn = (p: (typeof PRESETS)[number]) => (p.transcription === AUTO ? spoken === AUTO : languageByCode(spoken)?.code === languageByCode(p.transcription)?.code && script === p.script);

  const targets = useMemo(() => TRANSLATION_TARGETS.filter((t) => translationPlan(effective ?? AUTO, t.code)), [effective]);
  const target = targets.find((t) => t.code === settings.translateTo) ? settings.translateTo : targets[0]?.code;
  const plan = target ? translationPlan(effective ?? AUTO, target) : null;
  const pending = target ? linesToTranslate(lines, doc.translations, target) : [];
  const hasKey = !!settings.sarvamKey || server.serverSarvam;
  const translatedCount = lines.length - pending.length;

  const translate = async (all: boolean) => {
    if (!plan || !target) return;
    const todo = all ? linesToTranslate(lines, doc.translations, target, true) : pending;
    if (!todo.length) return toast({ kind: "info", title: "Everything is translated", duration: 2000 });
    if (!hasKey) {
      toast({ kind: "warning", title: "Add a Sarvam AI key", message: "Translation uses Sarvam AI. Paste a key in Settings → Translation.", action: { label: "Open Settings", onClick: () => ed.setPanel("settings", true) } });
      return;
    }
    ed.setTranslating(true);
    setProgress(0);
    const tid = toast({ kind: "busy", title: `Translating to ${TRANSLATION_TARGETS.find((t) => t.code === target)?.name}`, message: `${todo.length} captions with Sarvam AI`, progress: 0 });
    try {
      const fresh: { line: (typeof lines)[number]; text: string }[] = [];
      const BATCH = 40;
      for (let i = 0; i < todo.length; i += BATCH) {
        const chunk = todo.slice(i, i + BATCH);
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "content-type": "application/json", ...(settings.sarvamKey ? { "x-sarvam-key": settings.sarvamKey } : {}) },
          body: JSON.stringify({ texts: chunk.map((l) => l.words.map((w) => w.text).join(" ")), source: plan.source, target, model: plan.model, mode: settings.translateMode }),
        });
        const data = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        (data.translations as string[]).forEach((text, j) => fresh.push({ line: chunk[j], text }));
        const p = Math.min(1, (i + chunk.length) / todo.length);
        setProgress(p);
        toast({ id: tid, kind: "busy", title: "Translating…", message: `${i + chunk.length} of ${todo.length} captions`, progress: p });
      }
      project.update((d) => ({
        ...d,
        translations: mergeTranslations(lines, d.translations, fresh, target),
        style: d.style.secondary?.enabled ? d.style : { ...d.style, secondary: { ...(d.style.secondary ?? DEFAULT_SECONDARY), enabled: true } },
      }));
      dismiss(tid);
      toast({ kind: "success", title: "Translation added", message: "Shown as a second line under each caption. The original text is unchanged.", action: { label: "Style it", onClick: () => ed.setPanel("style") } });
    } catch (e) {
      dismiss(tid);
      toast({ kind: "error", title: "Translation didn't finish", message: (e as Error).message, action: { label: "Open settings", onClick: () => ed.setPanel("settings") } });
    } finally {
      ed.setTranslating(false);
      setProgress(null);
    }
  };

  const india = LANGUAGES.filter((l) => l.group === "india");
  const world = LANGUAGES.filter((l) => l.group === "world");
  const langInfo = languageByCode(spoken);

  return (
    <>
      <Section title="Quick setup">
        <div className="preset-chips" role="group" aria-label="Language presets">
          {PRESETS.map((p) => (
            <button key={p.id} className={`pchip ${presetOn(p) ? "on" : ""}`} aria-pressed={presetOn(p)} title={p.note}
              onClick={() => {
                setSettings({ language: p.transcription });
                project.update((d) => ({ ...d, style: { ...d.style, script: p.script } }));
              }}>{p.label}</button>
          ))}
        </div>
        <p className="muted">{PRESETS.find(presetOn)?.note ?? "Pick what's spoken and how captions should be written."}</p>
      </Section>

      <Section title="1. Spoken language">
        <label className="field">
          <span className="field-label">Transcribe as<em>{spoken === AUTO ? "Scribe picks the language" : langInfo ? TIER[langInfo.tier] : ""}</em></span>
          <span className="field-input">
            <select value={langInfo?.code ?? spoken} onChange={(e) => setSettings({ language: e.target.value })} aria-label="Spoken language">
              <option value={AUTO}>Detect automatically</option>
              <optgroup label="Indian languages">{india.map((l) => <option key={l.code} value={l.code}>{l.name} · {l.native}</option>)}</optgroup>
              <optgroup label="Other languages">{world.map((l) => <option key={l.code} value={l.code}>{l.name} · {l.native}</option>)}</optgroup>
            </select>
          </span>
        </label>
        <Toggle label="Tell speakers apart" value={settings.diarize} onChange={(v) => setSettings({ diarize: v })} hint="for interviews and podcasts" />
        {projectLang ? <p className="muted">This video was transcribed as <b>{languageName(projectLang)}</b>.</p> : null}
        {ed.file && doc.words.length && projectLang && languageByCode(spoken)?.code !== languageByCode(projectLang)?.code && spoken !== AUTO ? (
          <button className="btn small" onClick={() => void ed.transcription.transcribe(ed.file!, true)} disabled={ed.transcription.busy}><IconMic size={14} /> Caption again in {languageName(spoken)}</button>
        ) : null}
        <p className="muted">Mixed speech (e.g. Hindi with English words) is fine: choose the main language. Scribe keeps English words, and Hinglish/Gujlish spells borrowed English words the English way.</p>
      </Section>

      <Section title="2. Write captions in">
        <Select label="Script" value={script} options={sOpts.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => project.update((d) => ({ ...d, style: { ...d.style, script: v } }))} />
        {lines[0] ? <p className="caption-quote guj">“{lines[0].words.map((w) => displayWord(w, doc.style.script)).join(" ")}”</p> : null}
      </Section>

      <Section title="3. Translation (second line)">
        {!targets.length ? (
          <p className="muted">Sarvam AI can't translate {effective ? languageName(effective) : "this language"}. Translation is available for Indian languages and English.</p>
        ) : (
          <>
            <Select label="Translate to" value={target ?? ""} options={targets.map((t) => ({ value: t.code, label: t.name }))} onChange={(v) => setSettings({ translateTo: v })} />
            {plan?.model === "mayura:v1" ? (
              <Select label="Style" value={settings.translateMode} options={[{ value: "modern-colloquial", label: "Everyday (recommended)" }, { value: "formal", label: "Formal" }, { value: "code-mixed", label: "Code-mixed (keeps English words)" }]} onChange={(v) => setSettings({ translateMode: v })} />
            ) : <p className="muted">This pair uses Sarvam Translate (formal style).</p>}
            <Toggle label="Show the second line" value={!!doc.style.secondary?.enabled} onChange={(v) => project.update((d) => ({ ...d, style: { ...d.style, secondary: { ...(d.style.secondary ?? DEFAULT_SECONDARY), enabled: v } } }))} />
            {progress !== null ? <ProgressIndicator value={progress} label="Translating…" /> : (
              <div className="row-btns wrap">
                <button className="btn small primary" onClick={() => void translate(false)} disabled={ed.translating || !lines.length || !pending.length}>
                  <IconLanguage size={15} /> {pending.length ? `Translate ${pending.length} caption${pending.length === 1 ? "" : "s"}` : "All translated"}
                </button>
                {translatedCount > 0 ? <button className="btn small ghost" onClick={() => void translate(true)} disabled={ed.translating}>Translate all again</button> : null}
              </div>
            )}
            <p className="muted">{lines.length ? `${translatedCount} of ${lines.length} captions translated. ` : ""}Translations sit under your captions and never change the spoken words. Edit any translation in Captions.{!hasKey ? " Needs a Sarvam AI key (Settings)." : ""}</p>
          </>
        )}
      </Section>

      <Section title="English-letter spellings">
        <label className="field stack">
          <span className="field-label">Your spellings<em>one per line, like: ગુજરાત = Gujarat or नमस्ते = namaste. Used by Gujlish, Hinglish and Roman captions in every project.</em></span>
          <textarea rows={4} value={settings.romanRules} placeholder={"મિત્રો = mitro\nदोस्तों = doston"} onChange={(e) => setSettings({ romanRules: e.target.value })} />
        </label>
      </Section>
    </>
  );
}
