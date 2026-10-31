"use client";
/**
 * Royalty-free background music, generated in the browser.
 *
 * Every track is composed by this code (drums, bass, chords, melody) for a
 * style and tempo, so there's nothing to license and beats are known exactly
 * (perfect for beat-synced effects). Tracks are seamless loops.
 */
import { capPeak } from "./sfx";

export interface MusicStyle {
  id: string;
  label: string;
  mood: string;
  bpm: number;
  /** Beats per bar (4, or 6 for 6/8 feels). */
  meter: 4 | 6;
  bars: number;
  /** Chord roots in semitones from A2, one per bar (repeats). */
  chords: number[];
  minor: boolean;
  swing: number;
  drums: "lofi" | "pop" | "boombap" | "four" | "trap" | "cinematic" | "dhol" | "garba" | "corporate" | "none";
  pad: boolean;
  arp: boolean;
  /** Bass style. */
  bass: "sub" | "pulse" | "walk" | "none";
  vinyl?: boolean;
  pump?: boolean;
}

export const MUSIC_STYLES: MusicStyle[] = [
  { id: "lofi", label: "Lo-fi chill", mood: "Calm · study · vlog", bpm: 82, meter: 4, bars: 16, chords: [0, 5, 3, 7], minor: true, swing: 0.18, drums: "lofi", pad: true, arp: false, bass: "sub", vinyl: true },
  { id: "pop", label: "Upbeat pop", mood: "Happy · lifestyle", bpm: 116, meter: 4, bars: 16, chords: [0, 7, 9, 5], minor: false, swing: 0, drums: "pop", pad: true, arp: true, bass: "pulse" },
  { id: "hiphop", label: "Boom bap", mood: "Street · storytelling", bpm: 90, meter: 4, bars: 16, chords: [0, 0, 3, 5], minor: true, swing: 0.12, drums: "boombap", pad: false, arp: true, bass: "walk" },
  { id: "edm", label: "EDM drive", mood: "Hype · gym · sports", bpm: 128, meter: 4, bars: 16, chords: [0, 8, 3, 10], minor: true, swing: 0, drums: "four", pad: true, arp: true, bass: "pulse", pump: true },
  { id: "trap", label: "Trap", mood: "Bold · flex", bpm: 140, meter: 4, bars: 16, chords: [0, 0, 8, 7], minor: true, swing: 0, drums: "trap", pad: true, arp: false, bass: "sub" },
  { id: "cinematic", label: "Cinematic pulse", mood: "Epic · trailer", bpm: 100, meter: 4, bars: 16, chords: [0, 8, 3, 10], minor: true, swing: 0, drums: "cinematic", pad: true, arp: true, bass: "sub" },
  { id: "dhol", label: "Desi dhol", mood: "Wedding · festive", bpm: 104, meter: 4, bars: 16, chords: [0, 5, 7, 5], minor: false, swing: 0.1, drums: "dhol", pad: false, arp: true, bass: "pulse" },
  { id: "garba", label: "Garba groove", mood: "Navratri · dandiya", bpm: 132, meter: 6, bars: 16, chords: [0, 5, 7, 0], minor: false, swing: 0, drums: "garba", pad: true, arp: true, bass: "pulse" },
  { id: "corporate", label: "Bright corporate", mood: "Business · explainer", bpm: 110, meter: 4, bars: 16, chords: [0, 7, 9, 5], minor: false, swing: 0, drums: "corporate", pad: true, arp: true, bass: "pulse" },
  { id: "piano", label: "Emotional piano", mood: "Heartfelt · story", bpm: 72, meter: 4, bars: 12, chords: [0, 8, 3, 10], minor: true, swing: 0, drums: "none", pad: true, arp: true, bass: "none" },
];

const A2 = 110;
const hz = (semi: number) => A2 * Math.pow(2, semi / 12);

type Ctx = OfflineAudioContext;

function noiseBuffer(ctx: Ctx, seconds: number): AudioBuffer {
  const len = Math.round(seconds * ctx.sampleRate);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let x = 12345;
  for (let i = 0; i < len; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; d[i] = (x / 0x7fffffff) * 2 - 1; }
  return b;
}

class Kit {
  noise: AudioBuffer;
  constructor(private ctx: Ctx, private out: AudioNode) { this.noise = noiseBuffer(ctx, 1); }
  private g(at: number, peak: number, dur: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    g.connect(this.out);
    return g;
  }
  kick(at: number, v = 1, low = 45) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, at);
    o.frequency.exponentialRampToValueAtTime(low, at + 0.12);
    o.connect(this.g(at, 0.95 * v, 0.45));
    o.start(at); o.stop(at + 0.5);
  }
  snare(at: number, v = 1) {
    const n = this.ctx.createBufferSource(); n.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200;
    n.connect(hp).connect(this.g(at, 0.45 * v, 0.2)); n.start(at, Math.random() * 0.5, 0.25);
    const o = this.ctx.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(220, at); o.frequency.exponentialRampToValueAtTime(160, at + 0.1);
    o.connect(this.g(at, 0.3 * v, 0.12)); o.start(at); o.stop(at + 0.15);
  }
  clap(at: number, v = 1) {
    for (let i = 0; i < 3; i++) {
      const n = this.ctx.createBufferSource(); n.buffer = this.noise;
      const bp = this.ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.8;
      n.connect(bp).connect(this.g(at + i * 0.012, 0.4 * v, 0.14)); n.start(at + i * 0.012, i * 0.1, 0.2);
    }
  }
  hat(at: number, v = 1, open = false) {
    const n = this.ctx.createBufferSource(); n.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
    n.connect(hp).connect(this.g(at, 0.18 * v, open ? 0.25 : 0.05)); n.start(at, Math.random() * 0.5, 0.3);
  }
  tom(at: number, f: number, v = 1, dur = 0.35) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(f * 1.6, at); o.frequency.exponentialRampToValueAtTime(f, at + 0.06);
    o.connect(this.g(at, 0.7 * v, dur)); o.start(at); o.stop(at + dur + 0.05);
    const n = this.ctx.createBufferSource(); n.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f * 3; bp.Q.value = 2;
    n.connect(bp).connect(this.g(at, 0.15 * v, 0.06)); n.start(at, 0.2, 0.08);
  }
  shaker(at: number, v = 1) {
    const n = this.ctx.createBufferSource(); n.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 6000; bp.Q.value = 1;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.1 * v, at + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    n.connect(bp).connect(g).connect(this.out); n.start(at, 0.3, 0.1);
  }
}

function note(ctx: Ctx, out: AudioNode, type: OscillatorType, f: number, at: number, dur: number, peak: number, attack = 0.01, cutoff = 4000, detune = 0) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = cutoff;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.setValueAtTime(peak, at + Math.max(attack, dur - 0.08));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.15);
  o.connect(lp).connect(g).connect(out);
  o.start(at); o.stop(at + dur + 0.2);
}

const triad = (minor: boolean) => (minor ? [0, 3, 7] : [0, 4, 7]);

export interface GeneratedMusic {
  buffer: AudioBuffer;
  bpm: number;
  beats: number[];
  duration: number;
}

/** Compose and render a loop for a style. */
export async function generateMusic(style: MusicStyle, sampleRate = 44100): Promise<GeneratedMusic> {
  const spb = 60 / style.bpm; // seconds per beat (eighth note for 6/8)
  const beatsPerBar = style.meter;
  const duration = style.bars * beatsPerBar * spb;
  const ctx = new OfflineAudioContext(2, Math.ceil((duration + 0.01) * sampleRate), sampleRate);

  const master = ctx.createGain(); master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  const drums = ctx.createGain(); drums.gain.value = style.drums === "lofi" ? 0.7 : 0.9; drums.connect(master);
  const music = ctx.createGain(); music.gain.value = 0.55;
  if (style.drums === "lofi") { const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600; music.connect(lp).connect(master); }
  else music.connect(master);
  // stereo width for pads/arps
  const wide = ctx.createChannelMerger(2);
  const wideIn = ctx.createGain();
  const dl = ctx.createDelay(0.05); dl.delayTime.value = 0.017;
  wideIn.connect(wide, 0, 0); wideIn.connect(dl).connect(wide, 0, 1); wide.connect(music);

  const kit = new Kit(ctx, drums);
  const sw = (i: number) => (i % 2 === 1 ? style.swing * spb * 0.5 : 0); // swing on off-beats (eighths)
  const beats: number[] = [];
  for (let b = 0; b < style.bars * beatsPerBar; b++) beats.push(+(b * spb).toFixed(4));

  for (let bar = 0; bar < style.bars; bar++) {
    const t0 = bar * beatsPerBar * spb;
    const root = style.chords[bar % style.chords.length];
    // diatonic chord quality: minor key → i, iv, v minor; III, VI, VII major. Major key → ii, iii, vi minor.
    const deg = ((root % 12) + 12) % 12;
    const chord = triad(style.minor ? [0, 5, 7].includes(deg) : [2, 4, 9].includes(deg));
    const fill = bar % 4 === 3;

    // ---- drums
    for (let i = 0; i < beatsPerBar * 2; i++) {
      const at = t0 + i * spb * 0.5 + sw(i);
      const beat = i / 2;
      switch (style.drums) {
        case "lofi":
          if (i === 0 || i === 5) kit.kick(at, 0.9);
          if (i === 4 || i === 12) kit.snare(at, 0.7);
          if (i % 2 === 0 || i === 7) kit.hat(at, 0.6);
          break;
        case "pop": case "corporate":
          if (i % 4 === 0 || (style.drums === "pop" && i === 10)) kit.kick(at);
          if (i === 4 || i === 12) (style.drums === "pop" ? kit.clap(at) : kit.snare(at, 0.7));
          kit.hat(at, i % 2 ? 0.5 : 0.8);
          break;
        case "boombap":
          if (i === 0 || i === 3 || i === 10) kit.kick(at);
          if (i === 4 || i === 12) kit.snare(at);
          kit.hat(at, i % 2 ? 0.4 : 0.7);
          break;
        case "four":
          if (i % 2 === 0) kit.kick(at, 1, 40);
          if (i === 4 || i === 12) kit.clap(at, 0.9);
          if (i % 2 === 1) kit.hat(at, 1, true);
          break;
        case "trap": {
          if (i === 0 || i === 7 || (i === 11 && bar % 2)) kit.kick(at, 1, 35);
          if (i === 8) kit.clap(at);
          kit.hat(at, 0.7);
          if (fill && i >= 12) for (let r = 1; r < 3; r++) kit.hat(at + r * spb * 0.5 / 3, 0.5);
          break;
        }
        case "cinematic":
          if (i === 0 || i === 6) kit.tom(at, 60, 1, 0.8);
          if (i === 4 || i === 12) kit.tom(at, 90, 0.7, 0.5);
          if (fill && i >= 8) kit.tom(at, 110, 0.6, 0.3);
          break;
        case "dhol":
          // dha-dhin-dhin-dha: low on the beat, high on the "and"
          if (i % 4 === 0 || i === 6) kit.tom(at, 70, 1, 0.4);
          if (i % 2 === 1 || i === 10) kit.tom(at, 210, 0.6, 0.15);
          if (i % 2 === 0) kit.shaker(at, 0.8);
          break;
        case "garba":
          // 6/8 taali feel: strong on 1 and 4 (of 6 eighths), claps on 3 and 6
          if (i % 6 === 0) kit.tom(at, 75, 1, 0.4);
          if (i % 6 === 3) kit.tom(at, 85, 0.8, 0.35);
          if (i % 6 === 2 || i % 6 === 5) kit.clap(at, 0.6);
          kit.shaker(at, 0.6);
          break;
      }
      void beat;
    }

    // ---- bass
    const bassF = hz(root - 12);
    if (style.bass === "sub") note(ctx, music, "sine", bassF, t0, beatsPerBar * spb * 0.95, 0.5, 0.02, 400);
    else if (style.bass === "pulse") for (let i = 0; i < beatsPerBar; i++) note(ctx, music, "sawtooth", bassF, t0 + i * spb, spb * 0.45, 0.22, 0.005, 600);
    else if (style.bass === "walk") [0, 7, 12, 10].forEach((s, i) => note(ctx, music, "triangle", hz(root - 12 + s), t0 + i * spb, spb * 0.8, 0.35, 0.005, 900));

    // ---- chords (pad) and piano-ish voicing for "piano"
    if (style.pad) {
      chord.forEach((s, k) => {
        const f = hz(root + s + 12);
        note(ctx, wideIn, style.id === "piano" ? "triangle" : "sawtooth", f, t0, beatsPerBar * spb * 0.98, style.id === "piano" ? 0.08 : 0.05, style.id === "piano" ? 0.01 : 0.3, style.id === "piano" ? 2500 : 1600, k * 6 - 6);
      });
    }
    // ---- arp / melody
    if (style.arp) {
      const steps = beatsPerBar * 2;
      const pattern = [0, 1, 2, 1, 2, 3, 2, 1, 0, 2, 1, 3];
      for (let i = 0; i < steps; i++) {
        if (style.id === "piano" && i % 2) continue;
        const idx = pattern[(i + bar) % pattern.length];
        const semi = idx === 3 ? 12 : chord[idx];
        const f = hz(root + semi + 24);
        note(ctx, wideIn, style.id === "dhol" || style.id === "garba" ? "square" : "triangle", f, t0 + i * spb * 0.5 + sw(i), spb * 0.42, style.id === "piano" ? 0.12 : 0.07, 0.004, style.id === "edm" ? 3500 : 2800);
      }
    }
  }

  // EDM sidechain "pump" on the music bus
  if (style.pump) {
    for (const b of beats) {
      music.gain.setValueAtTime(0.18, b);
      music.gain.linearRampToValueAtTime(0.55, b + spb * 0.6);
    }
  }
  // vinyl crackle for lo-fi
  if (style.vinyl) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx, duration);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 3000;
    const g = ctx.createGain(); g.gain.value = 0.012;
    n.connect(hp).connect(g).connect(master); n.start(0);
  }

  const buffer = capPeak(await ctx.startRendering());
  return { buffer, bpm: style.bpm, beats, duration };
}
