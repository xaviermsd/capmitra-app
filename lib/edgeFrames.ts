"use client";
/**
 * Edge frames for the preview: the first or last frame of the clips on either
 * side of each transition, grabbed once with a hidden video element per source
 * and kept as small canvases. The exporter decodes its own (lib/exportEngine.ts).
 */
import type { Clip } from "./project";
import type { EdgeFrames, SourceFrame } from "./renderFrame";
import { edgeKey, edgeRequests, edgeTime } from "./transitions";

/** Longest side of a stored edge frame. */
const MAX_SIDE = 1920;

export interface EdgeGrabber {
  /** Grab any edge frames these clips need and forget the ones they don't. */
  sync(clips: Clip[], urlFor: (sourceId: string | undefined) => string | null): void;
  get: EdgeFrames;
  dispose(): void;
}

export function createEdgeGrabber(): EdgeGrabber {
  const frames = new Map<string, SourceFrame>();
  const videos = new Map<string, HTMLVideoElement>();
  let queue: { key: string; url: string; time: number }[] = [];
  let busy = false;
  let dead = false;

  const videoFor = (url: string): Promise<HTMLVideoElement> => {
    let v = videos.get(url);
    if (!v) {
      v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.src = url;
      videos.set(url, v);
    }
    const el = v;
    if (el.readyState >= 1) return Promise.resolve(el);
    return new Promise((res, rej) => {
      el.addEventListener("loadedmetadata", () => res(el), { once: true });
      el.addEventListener("error", () => rej(new Error("video failed to load")), { once: true });
      setTimeout(() => rej(new Error("video took too long to load")), 10000);
    });
  };

  const grab = async (url: string, time: number): Promise<SourceFrame | null> => {
    const v = await videoFor(url);
    const target = Math.max(0, Math.min(time, (Number.isFinite(v.duration) ? v.duration : time) - 0.04));
    await new Promise<void>((res) => {
      const done = () => res();
      v.addEventListener("seeked", done, { once: true });
      v.currentTime = target;
      setTimeout(done, 3000); // never wait forever on a stuck seek
    });
    if (!v.videoWidth) return null;
    const k = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(1, Math.round(v.videoWidth * k)), h = Math.max(1, Math.round(v.videoHeight * k));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(v, 0, 0, w, h);
    return { image: c, w, h };
  };

  const pump = async () => {
    if (busy) return;
    busy = true;
    while (queue.length && !dead) {
      const job = queue.shift()!;
      if (frames.has(job.key)) continue;
      try {
        const f = await grab(job.url, job.time);
        if (f && !dead) frames.set(job.key, f);
      } catch { /* that side of the transition shows black */ }
    }
    busy = false;
  };

  return {
    sync(clips, urlFor) {
      const wanted = new Map<string, { url: string; time: number }>();
      for (const r of edgeRequests(clips)) {
        const url = urlFor(r.clip.sourceId);
        if (url) wanted.set(edgeKey(r.clip, r.edge), { url, time: edgeTime(r.clip, r.edge) });
      }
      for (const k of [...frames.keys()]) if (!wanted.has(k)) frames.delete(k);
      queue = [...wanted].filter(([k]) => !frames.has(k)).map(([key, v]) => ({ key, ...v }));
      // drop helper videos no longer used
      const urls = new Set([...wanted.values()].map((w) => w.url));
      for (const [u, v] of videos) if (!urls.has(u)) { v.removeAttribute("src"); v.load(); videos.delete(u); }
      void pump();
    },
    get: (clip, edge) => frames.get(edgeKey(clip, edge)) ?? null,
    dispose() {
      dead = true;
      queue = [];
      frames.clear();
      for (const v of videos.values()) { v.removeAttribute("src"); v.load(); }
      videos.clear();
    },
  };
}
