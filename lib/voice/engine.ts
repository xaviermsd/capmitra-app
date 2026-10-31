/**
 * Loads the shared voice engine (public/voice/voice-dsp.js) for the export.
 * The live preview loads the same file inside an AudioWorklet.
 */
import { resolveVoice, type VoiceChain, type VoiceSettings } from "./presets";

export const VOICE_RATE = 48000;

export interface VoiceProcessor {
  process: (mono: Float32Array) => Float32Array;
  set: (chain?: VoiceChain, intensity?: number) => void;
  setBypass: (b: boolean) => void;
}
interface Dsp {
  loadRnnoise: (wasm: ArrayBuffer) => Promise<() => (frame: Float32Array) => void>;
  createProcessor: (makeRnn: (() => (frame: Float32Array) => void) | null, chain: VoiceChain, intensity: number) => VoiceProcessor;
}

let wasm: Promise<ArrayBuffer> | null = null;
/** RNNoise WebAssembly (112 KB), fetched once. */
export function rnnoiseWasm(): Promise<ArrayBuffer> {
  wasm ??= fetch("/voice/rnnoise.wasm").then((r) => {
    if (!r.ok) throw new Error("Couldn't load the voice enhancer.");
    return r.arrayBuffer();
  });
  return wasm;
}

let dsp: Promise<Dsp> | null = null;
function loadDsp(): Promise<Dsp> {
  dsp ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "/voice/voice-dsp.js" as string) as Promise<Dsp>;
  return dsp;
}

/** A processor for the whole export (keeps its state across mix windows), or null when the enhancer is off. */
export async function createVoiceProcessor(v: VoiceSettings | undefined): Promise<VoiceProcessor | null> {
  const r = resolveVoice(v);
  if (!r) return null;
  const [d, bin] = await Promise.all([loadDsp(), rnnoiseWasm()]);
  const makeRnn = r.chain.denoise ? await d.loadRnnoise(bin) : null;
  return d.createProcessor(makeRnn, r.chain, r.intensity);
}

/** Run a 48 kHz buffer through the voice processor (mono speech, written back to every channel). */
export function processVoiceBuffer(proc: VoiceProcessor, buf: AudioBuffer): AudioBuffer {
  const n = buf.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += ch[i] / buf.numberOfChannels;
  }
  const out = proc.process(mono);
  for (let c = 0; c < buf.numberOfChannels; c++) buf.copyToChannel(out, c);
  return buf;
}
