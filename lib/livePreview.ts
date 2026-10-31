/**
 * The frame the exporter just drew, for the export screen's live preview.
 * The exporter publishes its own canvas after each frame; the export screen
 * copies it (scaled down) on animation frames, so nothing is rendered twice
 * and the preview always shows exactly what goes into the file.
 */
type Src = OffscreenCanvas | HTMLCanvasElement;

export const live = { src: null as Src | null, t: 0, n: 0 };

export function publishFrame(src: Src, t: number) {
  live.src = src;
  live.t = t;
  live.n++;
}

export function resetLive() {
  live.src = null;
  live.t = 0;
  live.n = 0;
}

let lastYield = 0;
/**
 * Give the browser a moment to paint and handle taps. The export loop awaits
 * mostly already-resolved promises, which never let the page update, so the
 * screen looked frozen. Yields at most every `budget` ms, so export speed is
 * barely affected.
 */
export async function breathe(budget = 40): Promise<void> {
  const now = performance.now();
  if (now - lastYield < budget) return;
  await new Promise<void>((r) => setTimeout(r, 0));
  lastYield = performance.now();
}
