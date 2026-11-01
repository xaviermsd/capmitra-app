/**
 * "Captions behind the person": find the people in a frame with MediaPipe's
 * Selfie Segmenter (Apache-2.0, self-hosted in /public/vision, runs in the
 * browser, about 0.25 MB) and return a soft mask of them.
 * The frame is segmented at a small size, then the mask is scaled up, which
 * keeps it fast enough for live preview and gives naturally soft edges.
 */
import type { ImageSegmenter } from "@mediapipe/tasks-vision";

let seg: ImageSegmenter | null = null;
let loading: Promise<boolean> | null = null;

/** MediaPipe prints harmless "INFO: …" lines through console.error; keep them out of the console. */
function quietInfo() {
  const orig = console.error;
  if ((orig as { __cmQuiet?: boolean }).__cmQuiet) return;
  const f = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith("INFO:")) return; orig(...a); };
  (f as { __cmQuiet?: boolean }).__cmQuiet = true;
  console.error = f;
}

/** Load the segmenter once. Resolves false if this browser can't run it. */
export function loadSegmenter(): Promise<boolean> {
  if (seg) return Promise.resolve(true);
  loading ??= (async () => {
    try {
      quietInfo();
      const { ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const fileset = { wasmLoaderPath: "/vision/vision_wasm_internal.js", wasmBinaryPath: "/vision/vision_wasm_internal.wasm" };
      const make = (delegate: "GPU" | "CPU") => ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/vision/selfie_segmenter.tflite", delegate },
        runningMode: "IMAGE",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      seg = await make("GPU").catch(() => make("CPU"));
      return true;
    } catch {
      loading = null;
      return false;
    }
  })();
  return loading;
}

export const segmenterReady = () => !!seg;

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
const makeCanvas = (w: number, h: number): AnyCanvas =>
  typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });

let small: AnyCanvas | null = null;
let mask: AnyCanvas | null = null;
let person: AnyCanvas | null = null;

/** Longest side the frame is segmented at. */
const SEG_SIZE = 320;

function sized(c: AnyCanvas | null, w: number, h: number): AnyCanvas {
  const out = c ?? makeCanvas(w, h);
  if (out.width !== w) out.width = w;
  if (out.height !== h) out.height = h;
  return out;
}

/** Soft mask of the people in `frame` (W×H), or null while the segmenter is loading. */
function personMask(frame: CanvasImageSource, W: number, H: number): AnyCanvas | null {
  if (!seg) { void loadSegmenter(); return null; }
  const k = SEG_SIZE / Math.max(W, H);
  const w = Math.max(16, Math.round(W * k));
  const h = Math.max(16, Math.round(H * k));
  small = sized(small, w, h);
  const sctx = small.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  sctx.drawImage(frame, 0, 0, w, h);
  let result;
  try { result = seg.segment(small as TexImageSource); } catch { return null; }
  try {
    const m = result.confidenceMasks?.[0];
    if (!m) return null;
    const conf = m.getAsFloat32Array();
    mask = sized(mask, m.width, m.height);
    const mctx = mask.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const img = mctx.createImageData(m.width, m.height);
    for (let i = 0; i < conf.length; i++) {
      // smoothstep 0.35 to 0.75: firm inside the person, soft at the edge
      const x = Math.min(1, Math.max(0, (conf[i] - 0.35) / 0.4));
      img.data[i * 4 + 3] = Math.round(x * x * (3 - 2 * x) * 255);
    }
    mctx.putImageData(img, 0, 0);
    return mask;
  } finally {
    result.close();
  }
}

/**
 * Copy of the people in the frame currently drawn on `ctx`, cut out with their
 * mask. Draw it again after the captions so the captions sit behind them.
 * Null while the segmenter is loading or when nobody is found.
 */
export function cutOutPeople(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, W: number, H: number): AnyCanvas | null {
  const m = personMask(ctx.canvas, W, H);
  if (!m) return null;
  person = sized(person, W, H);
  const p = person.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  p.globalCompositeOperation = "copy";
  p.drawImage(ctx.canvas, 0, 0);
  p.globalCompositeOperation = "destination-in";
  p.imageSmoothingEnabled = true;
  p.imageSmoothingQuality = "high";
  p.drawImage(m, 0, 0, W, H);
  p.globalCompositeOperation = "source-over";
  return person;
}
