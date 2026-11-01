/**
 * Beat detection for any music file, so effects can land on the beat.
 *
 *  1. onset strength: rise in short-time energy per 512-sample hop (spectral-flux-like)
 *  2. tempo: autocorrelation of the onset curve over 60 to 190 BPM, favouring 90 to 140
 *  3. phase: the offset whose beat grid collects the most onset energy
 *  4. beats: the grid, nudged to the strongest onset within ±60 ms
 *
 * Pure (no browser APIs): tested in tests/effects.test.ts.
 */

export interface BeatResult {
  bpm: number;
  /** Beat times in seconds from the start of the audio. */
  beats: number[];
  /** 0..1, how clearly the tempo stood out. */
  confidence: number;
}

const HOP = 512;
const WIN = 1024;

export function onsetEnvelope(samples: Float32Array, sampleRate: number): { env: Float32Array; rate: number } {
  const n = Math.max(0, Math.floor((samples.length - WIN) / HOP) + 1);
  const energy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    const o = i * HOP;
    for (let j = 0; j < WIN; j++) { const v = samples[o + j]; e += v * v; }
    energy[i] = Math.log1p(e * 100);
  }
  const env = new Float32Array(n);
  for (let i = 1; i < n; i++) env[i] = Math.max(0, energy[i] - energy[i - 1]);
  // remove slow trends: subtract a local mean
  const out = new Float32Array(n);
  const R = 8;
  let sum = 0;
  for (let i = 0; i < Math.min(n, R); i++) sum += env[i];
  for (let i = 0; i < n; i++) {
    if (i + R < n) sum += env[i + R];
    if (i - R - 1 >= 0) sum -= env[i - R - 1];
    const cnt = Math.min(n - 1, i + R) - Math.max(0, i - R) + 1;
    out[i] = Math.max(0, env[i] - sum / cnt);
  }
  return { env: out, rate: sampleRate / HOP };
}

export function detectBeats(samples: Float32Array, sampleRate: number, opts: { minBpm?: number; maxBpm?: number } = {}): BeatResult {
  const { env, rate } = onsetEnvelope(samples, sampleRate);
  const duration = samples.length / sampleRate;
  if (env.length < rate * 2) return { bpm: 0, beats: [], confidence: 0 };
  const minBpm = opts.minBpm ?? 60;
  const maxBpm = opts.maxBpm ?? 190;
  const minLag = Math.floor((60 / maxBpm) * rate);
  const maxLag = Math.ceil((60 / minBpm) * rate);

  // autocorrelation
  let best = 0, bestLag = 0, total = 0, count = 0;
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    s /= env.length - lag;
    const bpm = (60 * rate) / lag;
    // gentle preference for common tempi (log-gaussian around 120)
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = s * w;
    scores.push(score);
    total += score; count++;
    if (score > best) { best = score; bestLag = lag; }
  }
  if (!bestLag || best <= 0) return { bpm: 0, beats: [], confidence: 0 };
  // refine the period with parabolic interpolation
  const k = bestLag - minLag;
  const a = scores[k - 1] ?? best, c = scores[k + 1] ?? best;
  const denom = a - 2 * best + c;
  const lag = bestLag + (denom !== 0 ? (0.5 * (a - c)) / denom : 0);
  const period = lag / rate;

  // phase: which offset collects the most onset energy
  const steps = 48;
  let bestPhase = 0, bestPhaseScore = -1;
  for (let p = 0; p < steps; p++) {
    const off = (p / steps) * period;
    let s = 0;
    for (let t = off; t < duration; t += period) {
      const i = Math.round(t * rate);
      s += Math.max(env[i] ?? 0, env[i - 1] ?? 0, env[i + 1] ?? 0);
    }
    if (s > bestPhaseScore) { bestPhaseScore = s; bestPhase = off; }
  }

  // grid nudged to nearby onsets
  const beats: number[] = [];
  const tol = Math.round(0.06 * rate);
  for (let t = bestPhase; t < duration - 0.01; t += period) {
    const c0 = Math.round(t * rate);
    let bi = c0, bv = env[c0] ?? 0;
    for (let i = c0 - tol; i <= c0 + tol; i++) if ((env[i] ?? 0) > bv * 1.5) { bv = env[i]; bi = i; }
    beats.push(+(bi / rate).toFixed(3));
  }
  const mean = total / Math.max(1, count);
  return { bpm: +((60 / period).toFixed(1)), beats, confidence: Math.max(0, Math.min(1, (best / Math.max(1e-9, mean) - 1) / 3)) };
}

/** Down-mix an AudioBuffer-like to mono samples. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** Beat times on the output timeline for music placed at `start` (handles looping). */
export function beatsOnTimeline(beats: number[], start: number, musicDuration: number, outDuration: number, loop: boolean): number[] {
  const out: number[] = [];
  if (!beats.length) return out;
  const reps = loop && musicDuration > 0 ? Math.ceil((outDuration - start) / musicDuration) : 1;
  for (let r = 0; r < reps; r++) {
    for (const b of beats) {
      const t = start + r * musicDuration + b;
      if (t >= 0 && t < outDuration) out.push(+t.toFixed(3));
    }
  }
  return out;
}
