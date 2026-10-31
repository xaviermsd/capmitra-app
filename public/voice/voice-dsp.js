// CapMitra voice enhancer: one DSP engine shared by the live preview
// (voice-worklet.js) and the export (lib/voice/engine.ts), so both sound the same.
//
// Chain (mono, 48 kHz): RNNoise noise removal → high-pass → EQ → effect →
// expander (quiets gaps) → compressor → output gain → soft limiter,
// then mixed with the untouched sound by "intensity".
//
// RNNoise: https://github.com/xiph/rnnoise (BSD-3-Clause), WebAssembly build
// from @jitsi/rnnoise-wasm (Apache-2.0). See RNNOISE-NOTICE.txt.

export const FRAME = 480; // 10 ms at 48 kHz
const SR = 48000;
const SCALE = 32768;
const dbToLin = (db) => Math.pow(10, db / 20);

/* ---------- RNNoise (minimal loader for the Emscripten build) ---------- */
// exports are minified: c = memory, d = init, f = create, g = malloc, j = process_frame
export async function loadRnnoise(wasmBytes) {
  let memory;
  const imports = { a: {
    a: (size) => { const need = Math.ceil((size - memory.buffer.byteLength) / 65536); try { if (need > 0) memory.grow(need); return 1; } catch { return 0; } },
    b: (d, s, n) => { new Uint8Array(memory.buffer).copyWithin(d, s, s + n); },
  } };
  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  const ex = instance.exports;
  memory = ex.c;
  ex.d();
  return () => {
    const st = ex.f(0);
    const inPtr = ex.g(FRAME * 4);
    const outPtr = ex.g(FRAME * 4);
    return (frame) => {
      const h = new Float32Array(memory.buffer);
      for (let i = 0; i < FRAME; i++) h[(inPtr >> 2) + i] = frame[i] * SCALE;
      ex.j(st, outPtr, inPtr);
      const h2 = new Float32Array(memory.buffer);
      for (let i = 0; i < FRAME; i++) frame[i] = h2[(outPtr >> 2) + i] / SCALE;
    };
  };
}

/* ---------- building blocks ---------- */
// RBJ "Audio EQ Cookbook" biquad
function biquad(type, f, q = 0.707, gainDb = 0) {
  const w = (2 * Math.PI * f) / SR, cw = Math.cos(w), sw = Math.sin(w);
  const A = Math.pow(10, gainDb / 40), al = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === "highpass") { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === "lowpass") { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === "peak") { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
  else {
    const s = 2 * Math.sqrt(A) * al;
    if (type === "lowshelf") { b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; }
    else { b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; }
  }
  const c = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => { const y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
const coef = (ms) => Math.exp(-1 / ((ms / 1000) * SR));

function compressor({ threshold = -24, ratio = 3, attack = 8, release = 150, makeup = 0 }) {
  const ca = coef(attack), cr = coef(release), mk = dbToLin(makeup);
  let env = 0;
  return (x) => {
    const a = Math.abs(x);
    env = a > env ? ca * env + (1 - ca) * a : cr * env + (1 - cr) * a;
    const db = 20 * Math.log10(env + 1e-9);
    const over = db - threshold;
    const red = over > 0 ? over * (1 - 1 / ratio) : 0;
    return x * dbToLin(-red) * mk;
  };
}
// downward expander: quiets the room between words, never fully mutes
function expander({ threshold = -45, floor = -14, attack = 3, release = 120 }) {
  const ca = coef(attack), cr = coef(release), fl = dbToLin(floor);
  let env = 0, g = 1;
  return (x) => {
    const a = Math.abs(x);
    env = a > env ? ca * env + (1 - ca) * a : cr * env + (1 - cr) * a;
    const target = 20 * Math.log10(env + 1e-9) > threshold ? 1 : fl;
    g = target > g ? ca * g + (1 - ca) * target : cr * g + (1 - cr) * target;
    return x * g;
  };
}
function effect(e) {
  if (!e) return null;
  if (e.kind === "drive") { const k = e.amount ?? 3, n = Math.tanh(k); return (x) => Math.tanh(k * x) / n; }
  if (e.kind === "robot") { let ph = 0; const inc = (2 * Math.PI * (e.freq ?? 55)) / SR, mix = e.mix ?? 0.85; return (x) => { ph += inc; if (ph > 2 * Math.PI) ph -= 2 * Math.PI; return x * (1 - mix) + x * Math.sin(ph) * mix * 1.6; }; }
  if (e.kind === "echo") {
    const taps = (e.delays ?? [170, 290]).map((ms) => Math.round((ms / 1000) * SR));
    const len = Math.max(...taps) + 1, buf = new Float32Array(len), fb = e.feedback ?? 0.35, mix = e.mix ?? 0.3;
    let w = 0;
    return (x) => {
      let wet = 0;
      for (const t of taps) wet += buf[(w - t + len) % len];
      wet /= taps.length;
      buf[w] = x + wet * fb;
      w = (w + 1) % len;
      return x + wet * mix;
    };
  }
  return null;
}
// slow automatic level: K-weighted loudness (as LUFS meters measure it) steered towards a target.
// Silence (below -50 LUFS) is left alone so pauses are not pumped up.
function leveler({ target = -14, maxBoost = 15, maxCut = 12 }) {
  const k1 = biquad("highshelf", 1500, 0.707, 4), k2 = biquad("highpass", 38, 0.5);
  const cw = coef(3000), cg = coef(1500);
  let ms = 1e-6, g = 1;
  return (x) => {
    const y = k2(k1(x));
    ms = cw * ms + (1 - cw) * y * y;
    const lufs = -0.691 + 10 * Math.log10(ms + 1e-12);
    const want = lufs > -50 ? dbToLin(Math.max(-maxCut, Math.min(maxBoost, target - lufs))) : g;
    g = cg * g + (1 - cg) * want;
    return x * g;
  };
}
const limit = (x) => { const a = Math.abs(x); return a <= 0.8 ? x : Math.sign(x) * (0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18)); };

/* ---------- the processor ---------- */
/**
 * makeRnn: from loadRnnoise(); params: a preset's chain; intensity 0..1.
 * process(input) returns the same number of samples, delayed by one frame (10 ms).
 */
export function createProcessor(makeRnn, params, intensity) {
  let rnn = null, chain = null, mix = intensity, bypass = false, den = 0;
  const build = (p) => {
    den = p.denoise ?? 0;
    if (den > 0 && !rnn && makeRnn) rnn = makeRnn();
    const stages = [];
    if (p.highpass) stages.push(biquad("highpass", p.highpass, 0.707));
    for (const b of p.eq ?? []) stages.push(biquad(b.type, b.f, b.q ?? 0.9, b.g ?? 0));
    const fx = effect(p.effect); if (fx) stages.push(fx);
    if (p.expander) stages.push(expander(p.expander));
    if (p.comp) stages.push(compressor(p.comp));
    if (p.level) stages.push(leveler(p.level));
    const out = dbToLin(p.gain ?? 0);
    chain = (x) => { for (const s of stages) x = s(x); return limit(x * out); };
  };
  build(params || {});
  const inBuf = new Float32Array(FRAME), dry = new Float32Array(FRAME), ready = new Float32Array(FRAME), readyDry = new Float32Array(FRAME);
  let fill = 0;
  return {
    set(p, i) { if (p) build(p); if (typeof i === "number") mix = i; },
    setBypass(b) { bypass = b; },
    process(input) {
      const out = new Float32Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const p = fill;
        out[i] = bypass ? readyDry[p] : ready[p] * mix + readyDry[p] * (1 - mix);
        inBuf[p] = input[i];
        dry[p] = input[i];
        if (++fill === FRAME) {
          if (rnn && den > 0) { rnn(inBuf); if (den < 1) for (let k = 0; k < FRAME; k++) inBuf[k] = inBuf[k] * den + dry[k] * (1 - den); }
          for (let k = 0; k < FRAME; k++) { ready[k] = chain(inBuf[k]); readyDry[k] = dry[k]; }
          fill = 0;
        }
      }
      return out;
    },
  };
}
