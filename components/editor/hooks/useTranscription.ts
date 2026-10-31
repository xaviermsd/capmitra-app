"use client";
/**
 * Captioning in the editor: confirmation prompts, progress UI and storing the
 * result on the project. The pipeline itself is lib/transcribeFile.ts (shared
 * with batch processing).
 */
import { useCallback, useRef, useState } from "react";
import { getCachedTranscript } from "@/lib/library";
import { applyRules, parseRules } from "@/lib/keywords";
import { languageName, AUTO } from "@/lib/languages";
import { transcribeFile, scribeCode, TranscribeFileError } from "@/lib/transcribeFile";
import { resyncWords } from "@/lib/resync";
import { elevenKeys, keyOptions, type Settings } from "@/lib/settings";
import type { Word } from "@/lib/types";
import type { Waveform } from "@/lib/media";
import type { ProjectApi } from "./useProject";
import type { ToastInput } from "@/components/Toaster";

export const SPEAKER_COLORS = ["#22D3EE", "#FFD43B", "#FF6B9A", "#7CFF6B", "#B892FF", "#FF8A00"];

const mins = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);

interface Deps {
  project: ProjectApi;
  settings: Settings;
  setSettings: (f: (s: Settings) => Settings) => void;
  serverHasKey: boolean;
  toast: (t: ToastInput) => string;
  dismiss: (id: string) => void;
  confirm: (o: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>;
  openKeySetup: () => void;
  setWork: (w: { label: string; progress?: number } | null) => void;
  setWaveform: (w: Waveform) => void;
  onDone: () => void;
  videoDuration: () => number;
  /** Ask the server again whether its key may be used (e.g. right after signing in on /admin). */
  recheckServer: () => Promise<boolean>;
  /** Called when captioning stopped only because no key was available. */
  onWaitingForKey: () => void;
}

/** Name and colour new speakers; keep existing names. */
export function withSpeakers(words: Word[], existing: Record<string, { name: string; color: string }> | undefined) {
  const ids = [...new Set(words.map((w) => w.speaker).filter((s): s is string => !!s))];
  if (!ids.length) return existing;
  const out = { ...(existing ?? {}) };
  ids.forEach((id, i) => { if (!out[id]) out[id] = { name: `Speaker ${i + 1}`, color: SPEAKER_COLORS[i % SPEAKER_COLORS.length] }; });
  return out;
}

export { scribeCode };

export function useTranscription(d: Deps) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const resumeKey = useRef<string | null>(null);
  const depsRef = useRef(d);
  depsRef.current = d;

  const transcribe = useCallback(async (f: File, force = false, resume = false) => {
    if (busyRef.current) return;
    const { settings, serverHasKey, confirm, openKeySetup, toast, dismiss, setWork, project } = depsRef.current;
    if (!elevenKeys(settings).length && !serverHasKey && !(await getCachedTranscript(f, settings.language)) && !(await depsRef.current.recheckServer())) {
      depsRef.current.onWaitingForKey();
      const go = await confirm({
        title: "Add your ElevenLabs API key",
        message: "Captions are written by ElevenLabs using your own free account. It takes about 2 minutes to get a key, and you only do it once on this device.",
        confirmLabel: "Set up my key",
        cancelLabel: "Later",
      });
      if (go) openKeySetup();
      return;
    }
    if (force && project.docRef.current.words.length && !resume) {
      const ok = await confirm({ title: "Replace the current captions?", message: "Your edits to this video's captions will be replaced by a fresh transcript. You can undo with Ctrl+Z.", confirmLabel: "Transcribe again" });
      if (!ok) return;
    }
    const dur = depsRef.current.videoDuration();
    if (dur && dur > settings.confirmMinutes * 60 && !resume && (force || !(await getCachedTranscript(f, settings.language)))) {
      const ok = await confirm({
        title: `Transcribe ${mins(dur)} of audio?`,
        message: "This uses ElevenLabs credits for the whole length. Cut the parts you don't need on the timeline first if you only need part of it.",
        confirmLabel: "Transcribe",
      });
      if (!ok) return;
    }
    busyRef.current = true;
    setBusy(true);
    const tid = "transcribe";
    try {
      const lang = scribeCode(settings.language);
      const terms = settings.useKeyterms ? settings.keyterms.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).slice(0, 1000) : [];
      const r = await transcribeFile(f, {
        language: settings.language, model: settings.model, keyterms: terms, diarize: settings.diarize,
        ...keyOptions(settings, depsRef.current.setSettings, (m) => toast({ kind: "info", ...m, duration: 6000 })),
        force, resumeKey: resume ? resumeKey.current : null, durationHint: dur,
        onWaveform: depsRef.current.setWaveform,
        onStage: ({ label, detail, progress }) => {
          setWork({ label, progress });
          toast({ id: tid, kind: "busy", title: label, message: detail ?? `${dur ? mins(dur) + " of " : ""}${lang === AUTO ? "speech" : languageName(lang) + " speech"} with ElevenLabs Scribe`, progress });
        },
      });
      dismiss(tid);
      resumeKey.current = null;
      const { words: fixed, changed } = applyRules(r.words, parseRules(settings.rules));
      project.update((doc) => ({ ...doc, words: fixed, language: r.language ?? doc.language, speakers: withSpeakers(fixed, doc.speakers) }));
      const nSpeakers = new Set(fixed.map((w) => w.speaker).filter(Boolean)).size;
      const note = r.fromCache
        ? " from the saved transcript (no credits spent)"
        : `${r.parts > 1 ? ` from ${r.parts} parts${r.reused ? ` (${r.reused} reused, no credits spent)` : ""}` : ""}${lang === AUTO && r.language ? `, detected ${languageName(r.language)}` : ""}`;
      toast({
        kind: "success",
        title: "Captions ready",
        message: `${fixed.length} words${note}${changed ? `, ${changed} fixed by your word list` : ""}${nSpeakers > 1 ? `, ${nSpeakers} speakers` : ""}.`,
        action: r.fromCache ? { label: "Transcribe again", onClick: () => void transcribeRef.current?.(f, true) } : undefined,
        duration: r.fromCache ? 7000 : undefined,
      });
      depsRef.current.onDone();
    } catch (e) {
      dismiss(tid);
      const err = e as TranscribeFileError;
      resumeKey.current = err.resumeKey ?? null;
      const msg = err.message;
      const keyProblem = /API key|invalid_api_key|unauthor|keys were tried|credits have run out/i.test(msg) || err.status === 401 || err.status === 402;
      toast({
        kind: "error",
        title: "Transcription didn't finish",
        message: resumeKey.current ? `${msg} Finished parts are saved; trying again continues from where it stopped.` : msg,
        action: keyProblem ? { label: elevenKeys(depsRef.current.settings).length ? "Manage my keys" : "Fix my API key", onClick: () => depsRef.current.openKeySetup() } : { label: "Try again", onClick: () => void transcribeRef.current?.(f, true, !!resumeKey.current) },
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
      setWork(null);
    }
  }, []);
  const transcribeRef = useRef(transcribe);
  transcribeRef.current = transcribe;

  /**
   * Listen to the audio again and move the current (edited) words onto the fresh
   * timings: fixes drift without losing spellings, ★ words, emoji or line breaks.
   */
  const resync = useCallback(async (f: File) => {
    if (busyRef.current) return;
    const { settings, serverHasKey, confirm, toast, dismiss, setWork, project } = depsRef.current;
    if (!project.docRef.current.words.length) return;
    if (!elevenKeys(settings).length && !serverHasKey && !(await depsRef.current.recheckServer())) {
      depsRef.current.onWaitingForKey();
      toast({ kind: "warning", title: "Re-sync needs an ElevenLabs key", action: { label: "Set up my key", onClick: () => depsRef.current.openKeySetup() } });
      return;
    }
    const dur = depsRef.current.videoDuration();
    const ok = await confirm({
      title: "Re-sync captions to the audio?",
      message: `CapMitra listens to the video again${dur ? ` (${mins(dur)}, uses ElevenLabs credits)` : " (uses ElevenLabs credits)"} and pins every word back onto the speech. Your spellings, ★ words, emoji and line breaks stay as they are.`,
      confirmLabel: "Re-sync",
    });
    if (!ok) return;
    busyRef.current = true;
    setBusy(true);
    const tid = "resync";
    try {
      const terms = settings.useKeyterms ? settings.keyterms.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).slice(0, 1000) : [];
      const r = await transcribeFile(f, {
        language: project.docRef.current.language ?? settings.language, model: settings.model, keyterms: terms, diarize: false,
        ...keyOptions(settings, depsRef.current.setSettings, (m) => toast({ kind: "info", ...m, duration: 6000 })),
        force: true, resumeKey: null, durationHint: dur,
        onWaveform: depsRef.current.setWaveform,
        onStage: ({ label, progress }) => {
          setWork({ label: `Re-sync: ${label}`, progress });
          toast({ id: tid, kind: "busy", title: "Re-syncing to the audio", message: label, progress });
        },
      });
      dismiss(tid);
      const res = resyncWords(project.docRef.current.words, r.words);
      project.update((doc) => ({ ...doc, words: res.words, offset: 0 }));
      const pct = Math.round((res.matched / Math.max(1, res.total)) * 100);
      toast({
        kind: pct >= 70 ? "success" : "warning",
        title: "Captions re-synced",
        message: `${res.matched} of ${res.total} words pinned to the speech (${pct}%); the rest were spaced between them. Caption delay reset to 0. Undo with Ctrl+Z.`,
        duration: 7000,
      });
    } catch (e) {
      dismiss(tid);
      toast({ kind: "error", title: "Re-sync didn't finish", message: (e as Error).message, action: { label: "Try again", onClick: () => void resyncRef.current?.(f) } });
    } finally {
      busyRef.current = false;
      setBusy(false);
      setWork(null);
    }
  }, []);
  const resyncRef = useRef(resync);
  resyncRef.current = resync;

  return { transcribe, resync, busy };
}
