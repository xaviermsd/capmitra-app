"use client";
/**
 * Generated sounds and music as reusable assets (made once per browser,
 * then reused), and beat analysis for uploaded music.
 */
import { decodeAudioAsset, getAsset, listAssets, patchAsset, putAsset, replaceAsset, type AssetRecord } from "../assets";
import { detectBeats, toMono } from "./beats";
import { MUSIC_STYLES, generateMusic } from "./music";
import { SFX, encodeWav, renderSfx } from "./sfx";

const pending = new Map<string, Promise<Omit<AssetRecord, "blob">>>();

/**
 * Bump when generated sounds change. Older copies in a browser are re-made
 * under the same id, so existing projects get the new sound too.
 * 2: peaks capped at −1 dBFS (some hits and one music style used to clip).
 */
const GEN = 2;

async function findBuiltin(key: string): Promise<Omit<AssetRecord, "blob"> | undefined> {
  return (await listAssets("audio")).find((a) => a.builtin === key);
}

type Store = (blob: Blob, name: string, extra: Partial<AssetRecord>) => Promise<AssetRecord>;

function once(key: string, make: (store: Store) => Promise<Omit<AssetRecord, "blob">>) {
  let p = pending.get(key);
  if (!p) {
    p = (async () => {
      const found = await findBuiltin(key);
      if (found && (found.gen ?? 1) >= GEN) return found;
      const store: Store = (blob, name, extra) =>
        found ? replaceAsset(found.id, blob, name, "audio", { ...extra, gen: GEN }) : putAsset(blob, name, "audio", { ...extra, gen: GEN });
      return make(store);
    })();
    p.catch(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

/** A built-in sound effect as an asset. */
export function ensureSfx(id: string): Promise<Omit<AssetRecord, "blob">> {
  return once(`sfx:${id}`, async (store) => {
    const def = SFX.find((s) => s.id === id);
    if (!def) throw new Error(`Unknown sound “${id}”.`);
    const buf = await renderSfx(def);
    const { blob: _b, ...rec } = await store(encodeWav(buf), `${def.label}.wav`, { duration: buf.duration, builtin: `sfx:${id}` });
    return rec;
  });
}

/** A generated music track as an asset (with exact beats). */
export function ensureMusic(styleId: string): Promise<Omit<AssetRecord, "blob">> {
  return once(`music:${styleId}`, async (store) => {
    const style = MUSIC_STYLES.find((m) => m.id === styleId);
    if (!style) throw new Error(`Unknown music style “${styleId}”.`);
    const g = await generateMusic(style);
    const { blob: _b, ...rec } = await store(encodeWav(g.buffer), `${style.label}.wav`, { duration: g.duration, builtin: `music:${styleId}`, beats: g.beats, bpm: g.bpm });
    return rec;
  });
}

/** Beats for any music asset (analysed once and remembered). */
export async function beatsFor(assetId: string): Promise<{ beats: number[]; bpm: number }> {
  const a = await getAsset(assetId);
  if (a?.beats?.length) return { beats: a.beats, bpm: a.bpm ?? 0 };
  const buf = await decodeAudioAsset(assetId, 22050);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const r = detectBeats(toMono(chans), buf.sampleRate);
  await patchAsset(assetId, { beats: r.beats, bpm: r.bpm });
  return { beats: r.beats, bpm: r.bpm };
}

/** Play a short preview of an audio asset (returns a stop function). */
let previewCtx: AudioContext | null = null;
let previewNode: AudioBufferSourceNode | null = null;
export async function previewAsset(assetId: string, seconds = 8): Promise<() => void> {
  previewNode?.stop();
  previewCtx ??= new AudioContext();
  await previewCtx.resume();
  const buf = await decodeAudioAsset(assetId);
  const n = previewCtx.createBufferSource();
  n.buffer = buf;
  const g = previewCtx.createGain();
  g.gain.value = 0.8;
  n.connect(g).connect(previewCtx.destination);
  n.start(0, 0, Math.min(seconds, buf.duration));
  previewNode = n;
  return () => { try { n.stop(); } catch { /* already stopped */ } };
}
