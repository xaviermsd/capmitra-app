"use client";
/**
 * Media the user adds to projects and brand kits: logos and images, SVG
 * graphics and background music. Stored in this browser (IndexedDB), never
 * uploaded. Blob URLs are created on demand and shared with the layer renderer.
 */
import { tx } from "./library";
import { registerAssetUrl } from "./layers";
import { uid } from "./project";

export type AssetKind = "image" | "svg" | "audio" | "font" | "video";

export interface AssetRecord {
  id: string;
  kind: AssetKind;
  name: string;
  type: string;
  size: number;
  added: number;
  blob: Blob;
  /** Seconds, for audio. */
  duration?: number;
  /** Pixels, for images. */
  width?: number;
  height?: number;
  /** Built-in generated audio, e.g. "sfx:whoosh" or "music:lofi". */
  builtin?: string;
  /** Generator version of a built-in sound; older ones are re-made in place. */
  gen?: number;
  /** Beat analysis for music. */
  beats?: number[];
  bpm?: number;
}

const urls = new Map<string, string>();

export async function putAsset(blob: Blob, name: string, kind: AssetKind, extra: Partial<AssetRecord> = {}): Promise<AssetRecord> {
  const rec: AssetRecord = { id: uid("a"), kind, name, type: blob.type, size: blob.size, added: Date.now(), blob, ...extra };
  await tx("assets", "readwrite", (s) => s.put(rec));
  return rec;
}

/** Replace an asset's file but keep its id, so projects using it pick up the new version. */
export async function replaceAsset(id: string, blob: Blob, name: string, kind: AssetKind, extra: Partial<AssetRecord> = {}): Promise<AssetRecord> {
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
  for (const k of [...decoded.keys()]) if (k.startsWith(`${id}@`)) decoded.delete(k);
  const rec: AssetRecord = { id, kind, name, type: blob.type, size: blob.size, added: Date.now(), blob, ...extra };
  await tx("assets", "readwrite", (s) => s.put(rec));
  return rec;
}

export async function getAsset(id: string): Promise<AssetRecord | undefined> {
  try {
    return await tx<AssetRecord | undefined>("assets", "readonly", (s) => s.get(id));
  } catch {
    return undefined;
  }
}

export async function listAssets(kind?: AssetKind): Promise<Omit<AssetRecord, "blob">[]> {
  try {
    const all = await tx<AssetRecord[]>("assets", "readonly", (s) => s.getAll());
    return all.filter((a) => !kind || a.kind === kind).sort((a, b) => b.added - a.added).map(({ blob: _b, ...rest }) => rest);
  } catch {
    return [];
  }
}

/** Update stored facts about an asset (e.g. beats after analysis). */
export async function patchAsset(id: string, p: Partial<Omit<AssetRecord, "id" | "blob">>): Promise<void> {
  const a = await getAsset(id);
  if (!a) return;
  await tx("assets", "readwrite", (s) => s.put({ ...a, ...p }));
}

export async function deleteAsset(id: string): Promise<void> {
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
  await tx("assets", "readwrite", (s) => s.delete(id));
}

/** Blob URL for an asset (cached), also registered with the layer renderer. */
export async function assetUrl(id: string): Promise<string | null> {
  const hit = urls.get(id);
  if (hit) return hit;
  const a = await getAsset(id);
  if (!a) return null;
  const u = URL.createObjectURL(a.blob);
  urls.set(id, u);
  registerAssetUrl(id, u);
  return u;
}

/** Make sure every asset id is loaded and known to the renderer. Returns missing ids. */
export async function ensureAssets(ids: (string | undefined)[]): Promise<string[]> {
  const missing: string[] = [];
  for (const id of new Set(ids.filter((x): x is string => !!x))) if (!(await assetUrl(id))) missing.push(id);
  return missing;
}

/** The stored file as a File (for export decoding). */
export async function assetFile(id: string): Promise<File | null> {
  const a = await getAsset(id);
  return a ? new File([a.blob], a.name, { type: a.type }) : null;
}

/** Read basic facts about an image, audio or video file before storing it. */
export async function probeMedia(file: Blob): Promise<{ duration?: number; width?: number; height?: number }> {
  if (file.type.startsWith("audio/")) {
    const u = URL.createObjectURL(file);
    try {
      const a = new Audio();
      a.preload = "metadata";
      a.src = u;
      await new Promise<void>((res, rej) => { a.onloadedmetadata = () => res(); a.onerror = () => rej(new Error("This audio file can't be played in this browser.")); });
      return { duration: a.duration };
    } finally {
      URL.revokeObjectURL(u);
    }
  }
  if (file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test((file as File).name ?? "")) {
    const u = URL.createObjectURL(file);
    try {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.src = u;
      await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error("This browser can't play that video. Try an H.264 MP4.")); });
      return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
    } finally {
      URL.revokeObjectURL(u);
    }
  }
  if (file.type.startsWith("image/")) {
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) throw new Error("This image can't be read.");
    const r = { width: bmp.width, height: bmp.height };
    bmp.close();
    return r;
  }
  return {};
}

const decoded = new Map<string, Promise<AudioBuffer>>();
/** Decoded music for export mixing (cached). */
export function decodeAudioAsset(id: string, sampleRate = 48000): Promise<AudioBuffer> {
  const key = `${id}@${sampleRate}`;
  let p = decoded.get(key);
  if (!p) {
    p = (async () => {
      const a = await getAsset(id);
      if (!a) throw new Error("The music file is missing from this browser. Add it again in the Audio panel.");
      const ctx = new OfflineAudioContext(2, 1, sampleRate);
      return await ctx.decodeAudioData(await a.blob.arrayBuffer());
    })();
    p.catch(() => decoded.delete(key));
    decoded.set(key, p);
  }
  return p;
}
