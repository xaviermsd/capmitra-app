/**
 * Change the speed of audio without changing its pitch (WSOLA: waveform-similarity
 * overlap-add). Used by the export for clips played faster or slower, so a 2×
 * clip sounds like quick speech, not chipmunks. The preview gets the same
 * effect from the browser (video playbackRate keeps the pitch).
 *
 * Short Hann-windowed grains are taken from the input every `hop × speed`
 * samples and laid down every `hop` samples; each grain is nudged by up to
 * `TOL` samples to where it best lines up with the sound already written,
 * which avoids the warble of plain overlap-add.
 */

const N = 1536;        // grain length (32 ms at 48 kHz)
const HOP = N / 2;     // output hop: 50 % overlap, Hann windows sum to 1
const TOL = 384;       // how far a grain may move to line up (8 ms)

let WIN: Float32Array | null = null;
const hann = () => {
  if (WIN) return WIN;
  WIN = new Float32Array(N);
  for (let i = 0; i < N; i++) WIN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  return WIN;
};

/** Stretch every channel by the same grain positions. Output length = input length / speed. */
export function stretchChannels(chs: Float32Array[], speed: number): Float32Array[] {
  const len = chs[0]?.length ?? 0;
  const outLen = Math.max(1, Math.round(len / speed));
  if (Math.abs(speed - 1) < 1e-3) return chs.map((c) => c.slice(0, outLen));
  const out = chs.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  const win = hann();
  // a mono guide for lining grains up
  const mono = new Float32Array(len);
  for (const c of chs) for (let i = 0; i < len; i++) mono[i] += c[i] / chs.length;
  const at = (i: number) => (i >= 0 && i < len ? mono[i] : 0);

  let prev = -1; // input position of the previous grain
  for (let o = 0; o < outLen; o += HOP) {
    const nominal = Math.round(o * speed);
    let pos = nominal;
    if (prev >= 0) {
      // the sound that would naturally follow the previous grain
      const target = prev + HOP;
      let best = -Infinity;
      const lo = Math.max(-TOL, -nominal), hi = Math.min(TOL, len - nominal - 1);
      for (let d = lo; d <= hi; d += 2) {
        let s = 0;
        const p = nominal + d;
        for (let i = 0; i < HOP; i += 2) s += at(p + i) * at(target + i);
        if (s > best) { best = s; pos = p; }
      }
    }
    for (let ch = 0; ch < chs.length; ch++) {
      const src = chs[ch], dst = out[ch];
      for (let i = 0; i < N; i++) {
        const k = pos + i;
        if (k >= 0 && k < len) dst[o + i] += src[k] * win[i];
      }
    }
    for (let i = 0; i < N; i++) norm[o + i] += win[i];
    prev = pos;
  }
  // even out the edges where fewer windows overlap
  for (let ch = 0; ch < out.length; ch++) {
    const d = out[ch];
    for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) d[i] /= Math.max(norm[i], 0.5);
  }
  return out.map((d) => d.subarray(0, outLen).slice());
}

/** AudioBuffer version: returns a new buffer `speed` times shorter (or longer), same pitch. */
export function timeStretch(buf: AudioBuffer, speed: number, ctx: BaseAudioContext): AudioBuffer {
  const chs = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const out = stretchChannels(chs, speed);
  const res = ctx.createBuffer(out.length, out[0].length, buf.sampleRate);
  out.forEach((d, i) => res.copyToChannel(d as Float32Array<ArrayBuffer>, i));
  return res;
}
