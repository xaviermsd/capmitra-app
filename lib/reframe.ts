/**
 * Keep the speaker in frame: sample frames of a clip, find faces with
 * MediaPipe's BlazeFace (Apache-2.0, self-hosted in /public/vision, runs in
 * the browser), and return the pan that centres the main face for the
 * chosen aspect ratio. Loaded only when used (about 9 MB, once).
 */
import type { FaceDetector } from "@mediapipe/tasks-vision";

let detector: Promise<FaceDetector> | null = null;

/** MediaPipe prints harmless "INFO: …" lines through console.error; keep them out of the console. */
function quietInfo() {
  const orig = console.error;
  if ((orig as { __cmQuiet?: boolean }).__cmQuiet) return;
  const f = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith("INFO:")) return; orig(...a); };
  (f as { __cmQuiet?: boolean }).__cmQuiet = true;
  console.error = f;
}
function getDetector(): Promise<FaceDetector> {
  detector ??= (async () => {
    quietInfo();
    const { FaceDetector } = await import("@mediapipe/tasks-vision");
    const fileset = { wasmLoaderPath: "/vision/vision_wasm_internal.js", wasmBinaryPath: "/vision/vision_wasm_internal.wasm" };
    return FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "/vision/blaze_face_short_range.tflite", delegate: "CPU" },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.5,
    });
  })();
  detector.catch(() => { detector = null; });
  return detector;
}

export interface Framing { panX: number; panY: number; faces: number; samples: number }

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    const done = () => { v.removeEventListener("seeked", done); res(); };
    v.addEventListener("seeked", done);
    v.currentTime = t;
    setTimeout(done, 3000);
  });
}

/**
 * Pan (0–100 %, as the Frame panel uses) that keeps the main face centred
 * for a crop to `aspect` (width / height) of a source of `srcW`×`srcH`.
 * The median face position over `samples` frames is used, so a quick turn
 * of the head doesn't throw the crop off.
 */
export async function findFraming(file: File | Blob, start: number, end: number, aspect: number, opts: { samples?: number; signal?: AbortSignal } = {}): Promise<Framing> {
  const samples = opts.samples ?? 8;
  const det = await getDetector();
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  try {
    await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error("Couldn't read the video.")); });
    const W = v.videoWidth, H = v.videoHeight;
    // BlazeFace is made for faces near the camera, so besides the whole frame we
    // also look at square tiles (left / middle / right, or top / middle / bottom),
    // where a smaller face appears bigger.
    const side = Math.min(W, H);
    const tiles: [number, number, number, number][] = [[0, 0, W, H]];
    if (Math.abs(W - H) > 8) for (let k = 0; k < 3; k++) {
      const off = ((Math.max(W, H) - side) * k) / 2;
      tiles.push(W > H ? [off, 0, side, side] : [0, off, side, side]);
    }
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < samples; i++) {
      if (opts.signal?.aborted) break;
      const t = start + ((end - start) * (i + 0.5)) / samples;
      await seek(v, Math.min(t, (v.duration || t) - 0.05));
      let best: { x: number; y: number; area: number } | null = null;
      for (const [sx, sy, sw, sh] of tiles) {
        const k = Math.min(1, 640 / Math.max(sw, sh));
        c.width = Math.round(sw * k); c.height = Math.round(sh * k);
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
        for (const d of det.detect(c).detections) {
          const b = d.boundingBox;
          if (!b) continue;
          const area = (b.width / k) * (b.height / k); // the biggest face is the speaker
          if (!best || area > best.area) best = { x: (sx + (b.originX + b.width / 2) / k) / W, y: (sy + (b.originY + b.height * 0.45) / k) / H, area };
        }
        if (best && tiles.length > 1 && sx === 0 && sy === 0 && sw === W) break; // found on the whole frame: done
      }
      if (best) { xs.push(best.x); ys.push(best.y); }
    }
    const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    if (!xs.length) return { panX: 50, panY: 50, faces: 0, samples };
    return { panX: panFor(med(xs), W / H, aspect), panY: panFor(med(ys), H / W, 1 / aspect), faces: xs.length, samples };
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute("src"); v.load();
  }
}

/**
 * Convert a face centre (0..1 across the source) into the crop pan (0..100 %).
 * `srcRatio`/`outRatio` are width/height (or height/width for the vertical axis).
 * When the crop is as wide as the source on this axis, there's nothing to pan: 50.
 */
export function panFor(centre: number, srcRatio: number, outRatio: number): number {
  const visible = Math.min(1, outRatio / srcRatio); // share of the source width kept by the crop
  if (visible >= 0.999) return 50;
  const left = Math.min(1 - visible, Math.max(0, centre - visible / 2));
  return +((left / (1 - visible)) * 100).toFixed(1);
}
