"use client";
/**
 * The open project: its document, undo/redo over the whole document, and
 * autosave to this browser.
 *
 * Every change goes through `update(fn, opts)`. Changes made in quick
 * succession with the same `coalesce` key (e.g. dragging a slider) become one
 * undo step.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { newProjectId, requestPersistentStorage, saveProject, type ProjectRecord } from "@/lib/library";
import { DEFAULT_FRAME } from "@/lib/frame";
import { templateById } from "@/lib/templates";
import { migrate, type ProjectDoc } from "@/lib/project";
import type { Trim, Word } from "@/lib/types";
import { LS } from "@/lib/settings";

export const NO_TRIM: Trim = { start: 0, end: null };

export interface ProjectMeta {
  id: string;
  name: string;
  created: number;
  thumb?: string;
  videoName: string;
  videoSize?: number;
  duration: number;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

export function blankDoc(): ProjectDoc {
  return { words: [], style: templateById("spotlight"), offset: 0, overrides: {}, frame: DEFAULT_FRAME, trim: NO_TRIM };
}

export function blankRecord(): ProjectRecord {
  const now = Date.now();
  return { id: newProjectId(), name: "Untitled", created: now, updated: now, ...blankDoc() };
}

const DOC_KEYS: (keyof ProjectDoc)[] = [
  "words", "style", "offset", "overrides", "frame", "trim", "language", "translations",
  "clips", "effects", "sounds", "layers", "audio", "speakers", "captionZ", "exportPrefs", "brandKitId", "batchId",
];

function pickDoc(r: Partial<ProjectRecord>): ProjectDoc {
  const d = blankDoc() as unknown as Record<string, unknown>;
  for (const k of DOC_KEYS) if (r[k] !== undefined) d[k] = r[k];
  const doc = d as unknown as ProjectDoc;
  return { ...doc, frame: { ...DEFAULT_FRAME, ...(doc.frame ?? {}) } };
}

export interface UpdateOptions {
  /** false = don't record an undo step (e.g. playback-driven or derived changes). */
  history?: boolean;
  /** Merge with the previous step if it had the same key and was < 700 ms ago. */
  coalesce?: string;
}

export function useProject(opts: { onSaveError: () => void; ready: boolean; hasVideo: boolean }) {
  const [doc, setDoc] = useState<ProjectDoc>(blankDoc);
  const [meta, setMeta] = useState<ProjectMeta>({ id: "", name: "Untitled", created: 0, videoName: "", duration: 0 });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const docRef = useRef(doc);
  docRef.current = doc;

  /* ---------- history ---------- */
  const past = useRef<ProjectDoc[]>([]);
  const future = useRef<ProjectDoc[]>([]);
  const last = useRef<{ key?: string; at: number }>({ at: 0 });
  const [historyTick, setHistoryTick] = useState(0);

  const update = useCallback((fn: (d: ProjectDoc) => ProjectDoc, o: UpdateOptions = {}) => {
    const prev = docRef.current;
    const next = fn(prev);
    if (next === prev) return;
    if (o.history !== false) {
      const now = performance.now();
      const merge = o.coalesce && last.current.key === o.coalesce && now - last.current.at < 700;
      if (!merge) {
        past.current.push(prev);
        if (past.current.length > 200) past.current.shift();
      }
      future.current = [];
      last.current = { key: o.coalesce, at: now };
      setHistoryTick((n) => n + 1);
    }
    docRef.current = next;
    setDoc(next);
  }, []);

  /** Mark the start of a drag so the whole drag is one undo step. */
  const checkpoint = useCallback(() => {
    past.current.push(docRef.current);
    if (past.current.length > 200) past.current.shift();
    future.current = [];
    last.current = { key: "__checkpoint", at: performance.now() };
    setHistoryTick((n) => n + 1);
  }, []);

  const undo = useCallback((): boolean => {
    const p = past.current.pop();
    if (!p) return false;
    future.current.push(docRef.current);
    last.current = { at: 0 };
    docRef.current = p;
    setDoc(p);
    setHistoryTick((n) => n + 1);
    return true;
  }, []);

  const redo = useCallback((): boolean => {
    const f = future.current.pop();
    if (!f) return false;
    past.current.push(docRef.current);
    last.current = { at: 0 };
    docRef.current = f;
    setDoc(f);
    setHistoryTick((n) => n + 1);
    return true;
  }, []);

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;

  /* ---------- convenience setters ---------- */
  const setWords = useCallback((words: Word[], o?: UpdateOptions) => update((d) => ({ ...d, words }), o), [update]);
  const patch = useCallback(<K extends keyof ProjectDoc>(key: K, value: ProjectDoc[K], o?: UpdateOptions) =>
    update((d) => (d[key] === value ? d : { ...d, [key]: value }), o), [update]);

  /* ---------- open / new ---------- */
  const apply = useCallback((rec: ProjectRecord) => {
    const r = migrate(rec);
    past.current = [];
    future.current = [];
    last.current = { at: 0 };
    const d = pickDoc(r);
    docRef.current = d;
    setDoc(d);
    setMeta({ id: r.id, name: r.name, created: r.created, thumb: r.thumb, videoName: r.videoName ?? "", videoSize: r.videoSize, duration: r.duration ?? 0 });
    setSaveState("idle");
    setHistoryTick((n) => n + 1);
    LS.set("acg:lastProject", r.id);
  }, []);

  const setMetaPart = useCallback((p: Partial<ProjectMeta>) => setMeta((m) => ({ ...m, ...p })), []);

  /* ---------- autosave ---------- */
  const askedPersist = useRef(false);
  useEffect(() => {
    if (!opts.ready || !meta.id || (!doc.words.length && !opts.hasVideo && !doc.layers?.length)) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      const ok = await saveProject({
        ...doc,
        id: meta.id, name: meta.name, created: meta.created || Date.now(), updated: Date.now(),
        videoName: meta.videoName, videoSize: meta.videoSize, duration: meta.duration, thumb: meta.thumb,
      });
      setSaveState(ok ? "saved" : "error");
      if (ok && !askedPersist.current) {
        askedPersist.current = true;
        void requestPersistentStorage();
      }
      if (!ok) opts.onSaveError();
      LS.set("acg:lastProject", meta.id);
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.ready, opts.hasVideo, doc, meta]);

  return useMemo(() => ({
    doc, meta, saveState, update, patch, setWords, checkpoint, undo, redo, canUndo, canRedo, apply, setMeta: setMetaPart, docRef, historyTick,
  }), [doc, meta, saveState, update, patch, setWords, checkpoint, undo, redo, canUndo, canRedo, apply, setMetaPart, historyTick]);
}

export type ProjectApi = ReturnType<typeof useProject>;
