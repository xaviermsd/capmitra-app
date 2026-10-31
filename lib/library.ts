"use client";

/**
 * Local project library (IndexedDB, in this browser only):
 * - projects:    captions, style, frame, trim… + thumbnail
 * - videos:      the original video file for each project
 * - transcripts: transcription results keyed by video fingerprint, so the
 *                same video is never paid for twice
 */
import type { Word } from "./types";
import { migrate, serialiseClips, type ProjectDoc } from "./project";

const DB = "capmitra";
const VERSION = 3;

export interface ProjectRecord extends ProjectDoc {
  id: string;
  name: string;
  created: number;
  updated: number;
  videoName?: string;
  videoSize?: number;
  duration?: number;
  thumb?: string;
}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("media")) d.createObjectStore("media");
        if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" });
        if (!d.objectStoreNames.contains("videos")) d.createObjectStore("videos");
        if (!d.objectStoreNames.contains("transcripts")) d.createObjectStore("transcripts");
        // v3: media assets (logos, music, SVG), brand kits and batches
        if (!d.objectStoreNames.contains("assets")) d.createObjectStore("assets", { keyPath: "id" });
        if (!d.objectStoreNames.contains("brandkits")) d.createObjectStore("brandkits", { keyPath: "id" });
        if (!d.objectStoreNames.contains("batches")) d.createObjectStore("batches", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbp = null;
        reject(req.error);
      };
    });
  }
  return dbp;
}

export async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? (req.result as T) : (undefined as T));
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const newProjectId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function listProjects(): Promise<ProjectRecord[]> {
  try {
    const all = await tx<ProjectRecord[]>("projects", "readonly", (s) => s.getAll());
    return all.map((p) => migrate(p)).sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  try {
    const p = await tx<ProjectRecord | undefined>("projects", "readonly", (s) => s.get(id));
    return p ? migrate(p) : undefined;
  } catch {
    return undefined;
  }
}

export async function saveProject(p: ProjectRecord): Promise<boolean> {
  try {
    await tx("projects", "readwrite", (s) => s.put({ ...p, clips: serialiseClips(p.clips) }));
    return true;
  } catch (e) {
    console.warn("project save failed", e);
    return false;
  }
}

/** Copy a project (and its saved video) under a new id. */
export async function duplicateProject(id: string): Promise<ProjectRecord | null> {
  const p = await getProject(id);
  if (!p) return null;
  const now = Date.now();
  const copy: ProjectRecord = { ...structuredClone(p), id: newProjectId(), name: `${p.name} (copy)`, created: now, updated: now };
  await saveProject(copy);
  const v = await getProjectVideo(id);
  if (v) await saveProjectVideo(copy.id, v);
  return copy;
}

/** All projects as one JSON backup (captions, styles, frames; videos are not included). */
export async function backupProjects(): Promise<string> {
  const all = await listProjects();
  return JSON.stringify({ app: "capmitra", kind: "backup", version: 2, saved: Date.now(), projects: all }, null, 1);
}

/** Restore projects from a backup file. Existing projects with the same id are kept. */
export async function restoreProjects(json: string): Promise<number> {
  const data = JSON.parse(json) as { app?: string; kind?: string; projects?: ProjectRecord[] };
  if (data.app !== "capmitra" || data.kind !== "backup" || !Array.isArray(data.projects)) {
    throw new Error("This isn't a CapMitra backup file.");
  }
  const existing = new Set((await listProjects()).map((p) => p.id));
  let n = 0;
  for (const p of data.projects) {
    const rec = existing.has(p.id) ? { ...p, id: newProjectId(), name: `${p.name} (restored)` } : p;
    if (await saveProject(rec)) n++;
  }
  return n;
}

export async function deleteProject(id: string): Promise<void> {
  await tx("projects", "readwrite", (s) => s.delete(id));
  await tx("videos", "readwrite", (s) => s.delete(id));
}

export async function saveProjectVideo(id: string, file: File): Promise<boolean> {
  try {
    void requestPersistentStorage();
    await tx("videos", "readwrite", (s) => s.put({ blob: file, name: file.name, type: file.type, lastModified: file.lastModified }, id));
    return true;
  } catch (e) {
    console.warn("video save failed (storage full?)", e);
    return false;
  }
}

export async function getProjectVideo(id: string): Promise<File | null> {
  try {
    const v = await tx<{ blob: Blob; name: string; type: string; lastModified?: number } | undefined>("videos", "readonly", (s) => s.get(id));
    if (!v?.blob) return null;
    return new File([v.blob], v.name, { type: v.type || v.blob.type, lastModified: v.lastModified });
  } catch {
    return null;
  }
}

/* ---------- transcript cache ---------- */

export const fingerprint = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

export async function getCachedTranscript(f: File, language: string): Promise<Word[] | null> {
  try {
    const r = await tx<{ words: Word[] } | undefined>("transcripts", "readonly", (s) => s.get(`${fingerprint(f)}|${language}`));
    return r?.words?.length ? r.words : null;
  } catch {
    return null;
  }
}

export async function cacheTranscript(f: File, language: string, words: Word[]): Promise<void> {
  try {
    await tx("transcripts", "readwrite", (s) => s.put({ words, saved: Date.now() }, `${fingerprint(f)}|${language}`));
  } catch {
    /* ignore */
  }
}

/** Generic word cache (used for the pieces of long transcriptions). */
export async function getCachedWords(key: string): Promise<Word[] | null> {
  try {
    const r = await tx<{ words: Word[] } | undefined>("transcripts", "readonly", (s) => s.get(key));
    return r?.words?.length ? r.words : null;
  } catch {
    return null;
  }
}

export async function cacheWords(key: string, words: Word[]): Promise<void> {
  try {
    await tx("transcripts", "readwrite", (s) => s.put({ words, saved: Date.now() }, key));
  } catch {
    /* ignore */
  }
}

/* ---------- migration from the single "last video" store ---------- */

export async function takeLegacyVideo(): Promise<File | null> {
  try {
    const v = await tx<{ blob: Blob; name: string; type: string } | undefined>("media", "readonly", (s) => s.get("current-video"));
    if (!v?.blob) return null;
    await tx("media", "readwrite", (s) => s.delete("current-video"));
    return new File([v.blob], v.name, { type: v.type || v.blob.type });
  } catch {
    return null;
  }
}

export interface StorageStatus {
  /** Bytes this site uses. */
  used: number;
  /** Bytes this site may use. */
  quota: number;
  /** true = the browser won't clear our data when the disk gets full. */
  persisted: boolean;
  /** The browser supports asking for persistent storage. */
  canPersist: boolean;
}

export async function storageUsage(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}

export async function storageStatus(): Promise<StorageStatus | null> {
  if (typeof navigator === "undefined" || !navigator.storage) return null;
  const u = await storageUsage();
  let persisted = false;
  try { persisted = (await navigator.storage.persisted?.()) ?? false; } catch { /* ignore */ }
  return { used: u?.used ?? 0, quota: u?.quota ?? 0, persisted, canPersist: typeof navigator.storage.persist === "function" };
}

/**
 * Ask the browser to keep our projects even when the disk is low on space.
 * Chrome decides by itself (it usually agrees for sites you use often or installed
 * to the home screen); Firefox asks the user. Safe to call many times.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Would saving `bytes` more likely fail? (true when less than bytes + 50 MB is free) */
export async function nearlyFull(bytes = 0): Promise<boolean> {
  const u = await storageUsage();
  return !!u && u.quota > 0 && u.quota - u.used < bytes + 50e6;
}

/** Turn an IndexedDB error into a message people can act on. */
export function storageErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "QuotaExceededError") return "Browser storage is full. Delete old projects on the Projects page to free space.";
  if (name === "InvalidStateError" || name === "UnknownError") return "Browser storage isn't available (private window, or storage blocked in settings).";
  return (e as Error)?.message || "Browser storage refused the change.";
}

/** Small JPEG thumbnail from a video element's current frame. */
export function makeThumb(source: CanvasImageSource, w: number, h: number): string | undefined {
  try {
    const tw = 160;
    const th = Math.round((tw * h) / w);
    const c = document.createElement("canvas");
    c.width = tw;
    c.height = th;
    c.getContext("2d")!.drawImage(source, 0, 0, tw, th);
    return c.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined;
  }
}
