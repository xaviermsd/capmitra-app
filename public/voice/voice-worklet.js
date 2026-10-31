// CapMitra voice enhancer, live preview. Same engine as the export (voice-dsp.js).
import { createProcessor, loadRnnoise } from "./voice-dsp.js";

class CapMitraVoice extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.proc = createProcessor(null, o.params, o.intensity); // starts without RNNoise...
    this.pending = { params: o.params, intensity: o.intensity, bypass: false };
    loadRnnoise(o.wasm).then((makeRnn) => { // ...and switches it on once loaded
      this.proc = createProcessor(makeRnn, this.pending.params, this.pending.intensity);
      this.proc.setBypass(this.pending.bypass);
    }).catch(() => {});
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.params || typeof d.intensity === "number") {
        if (d.params) this.pending.params = d.params;
        if (typeof d.intensity === "number") this.pending.intensity = d.intensity;
        this.proc.set(d.params, d.intensity);
      }
      if (typeof d.bypass === "boolean") { this.pending.bypass = d.bypass; this.proc.setBypass(d.bypass); }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    if (!output || !output.length) return true;
    const n = output[0].length;
    const mono = new Float32Array(n);
    if (input && input.length) {
      for (let c = 0; c < input.length; c++) { const ch = input[c]; for (let i = 0; i < n; i++) mono[i] += ch[i] / input.length; }
    }
    const out = this.proc.process(mono);
    for (let c = 0; c < output.length; c++) output[c].set(out);
    return true;
  }
}

registerProcessor("capmitra-voice", CapMitraVoice);
