/** "Made with CapMitra" badge, drawn on the preview and burned into exports. */
import { platformById } from "./frame";
import type { FrameSettings } from "./types";

export type WatermarkCorner = "br" | "bl" | "tr" | "tl";
export const WATERMARK_SRC = "/brand/watermark.png";

let img: HTMLImageElement | null = null;
let loading: Promise<HTMLImageElement> | null = null;

export function loadWatermark(): Promise<HTMLImageElement> {
  if (img) return Promise.resolve(img);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const el = new Image();
      el.decoding = "async";
      el.onload = () => { img = el; resolve(el); };
      el.onerror = () => { loading = null; reject(new Error("The watermark image couldn't be loaded. Check your connection and try again.")); };
      el.src = WATERMARK_SRC;
    });
  }
  return loading;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Bottom-right by default, kept inside the platform's safe zone so app buttons never cover it. */
export function drawWatermark(ctx: Ctx, W: number, H: number, frame: FrameSettings, corner: WatermarkCorner = "br"): void {
  if (!img) return;
  const short = Math.min(W, H);
  const w = Math.min(short * 0.36, W * 0.3);
  const h = w * (img.naturalHeight / img.naturalWidth);
  const m = short * 0.03;
  const [t, r, b, l] = platformById(frame.platform).safe ?? [0, 0, 0, 0];
  const x = corner.endsWith("r") ? W * (1 - r) - m - w : W * l + m;
  const y = corner.startsWith("b") ? H * (1 - b) - m - h : H * t + m;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

/* ---------- unlock status (client) ---------- */

export interface UnlockStatus {
  unlocked: boolean;
  /** false when the server has no WATERMARK_SECRET */
  available: boolean;
  name?: string;
  expiresAt?: number | null;
  lapsed?: "expired" | "revoked";
}

export async function fetchUnlock(): Promise<UnlockStatus> {
  try {
    const r = await fetch("/api/unlock", { cache: "no-store" });
    if (!r.ok) return { unlocked: false, available: true };
    return (await r.json()) as UnlockStatus;
  } catch {
    return { unlocked: false, available: true };
  }
}

const SAVED = "acg:wmCode";
export function rememberCode(code: string | null): void {
  try { if (code) localStorage.setItem(SAVED, code); else localStorage.removeItem(SAVED); } catch { /* ignore */ }
}

/** Check this device; if the cookie is gone but a code is saved in local storage, redeem it again quietly. */
export async function restoreUnlock(): Promise<UnlockStatus> {
  const s = await fetchUnlock();
  if (s.unlocked) return s;
  let saved: string | null = null;
  try { saved = localStorage.getItem(SAVED); } catch { /* ignore */ }
  if (!saved) return s;
  try {
    const r = await fetch("/api/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: saved }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) return { unlocked: true, available: true, name: d.name, expiresAt: d.expiresAt };
    if (d.reason === "expired" || d.reason === "revoked" || d.reason === "signature" || d.reason === "format") {
      rememberCode(null);
      return { ...s, lapsed: d.reason === "revoked" ? "revoked" : "expired" };
    }
  } catch { /* offline: keep the saved code */ }
  return s;
}

export function formatExpiry(ms: number | null | undefined): string {
  if (ms == null) return "never expires";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(ms);
}

export const CONTACT = {
  instagram: "https://ig.me/m/harshprajapatiofficial",
  whatsappNumber: "+91 98985 28376",
  whatsapp: (msg: string) => `https://wa.me/919898528376?text=${encodeURIComponent(msg)}`,
  request: (name: string) =>
    `Hi Harsh! I'm ${name.trim()} and I'm using CapMitra. Could you please send me a code to remove the watermark from my exports?`,
};
