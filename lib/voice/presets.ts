/**
 * Voice enhancer presets. Each preset is plain data describing a processing
 * chain for public/voice/voice-dsp.js, so new presets (or new engines) can be
 * added here without touching captions or editing.
 */
export interface VoiceSettings {
  /** Preset id, or "off". */
  preset: string;
  /** 0..1: how much of the processed sound is used. */
  intensity: number;
  /** Auto level: target loudness in LUFS (e.g. -14 for Reels/Shorts); undefined = off. */
  level?: number;
}

type Band = { type: "peak" | "lowshelf" | "highshelf" | "lowpass" | "highpass"; f: number; g?: number; q?: number };
export interface VoiceChain {
  /** RNNoise noise removal, 0..1. */
  denoise?: number;
  highpass?: number;
  eq?: Band[];
  effect?: { kind: "drive"; amount: number } | { kind: "robot"; freq?: number; mix?: number } | { kind: "echo"; delays?: number[]; feedback?: number; mix?: number };
  expander?: { threshold: number; floor: number; attack?: number; release?: number };
  comp?: { threshold: number; ratio: number; attack: number; release: number; makeup: number };
  /** Output gain in dB. */
  gain?: number;
  /** Slow automatic level towards a loudness target. */
  level?: { target: number; maxBoost?: number; maxCut?: number };
}

export interface VoicePreset {
  id: string;
  name: string;
  group: "enhance" | "effect";
  description: string;
  intensity: number;
  chain: VoiceChain;
}

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: "clean", name: "Clean voice", group: "enhance", intensity: 0.9,
    description: "Removes background noise (fans, traffic, hum, room hiss) and gently clears up speech.",
    chain: { denoise: 1, highpass: 80, eq: [{ type: "peak", f: 3000, g: 2, q: 1 }], comp: { threshold: -24, ratio: 2, attack: 10, release: 150, makeup: 2 } },
  },
  {
    id: "studio", name: "Studio voice", group: "enhance", intensity: 0.9,
    description: "Noise removed, warmer lows, less boxiness, crisp presence and air, smooth levels.",
    chain: {
      denoise: 0.9, highpass: 70,
      eq: [{ type: "lowshelf", f: 150, g: 2.5 }, { type: "peak", f: 350, g: -2.5, q: 1 }, { type: "peak", f: 3500, g: 3, q: 0.9 }, { type: "highshelf", f: 10000, g: 2.5 }],
      comp: { threshold: -22, ratio: 3, attack: 5, release: 120, makeup: 4 },
    },
  },
  {
    id: "podcast", name: "Podcast voice", group: "enhance", intensity: 1,
    description: "Close, loud and even: noise removed, quiet gaps between words, strong compression.",
    chain: {
      denoise: 1, highpass: 90,
      eq: [{ type: "lowshelf", f: 120, g: 1.5 }, { type: "peak", f: 300, g: -3, q: 1 }, { type: "peak", f: 2800, g: 3.5, q: 0.9 }, { type: "highshelf", f: 8000, g: 1.5 }],
      expander: { threshold: -46, floor: -16 },
      comp: { threshold: -26, ratio: 4, attack: 4, release: 100, makeup: 6 }, gain: -0.5,
    },
  },
  {
    id: "echo", name: "Less echo", group: "enhance", intensity: 0.9,
    description: "For roomy recordings: noise removed and the room's echo tails pulled down between words.",
    chain: {
      denoise: 1, highpass: 90, eq: [{ type: "peak", f: 500, g: -2, q: 1 }, { type: "peak", f: 3000, g: 1.5, q: 1 }],
      expander: { threshold: -38, floor: -20, attack: 2, release: 60 },
      comp: { threshold: -24, ratio: 2.5, attack: 6, release: 120, makeup: 3 },
    },
  },
  {
    id: "radio", name: "Radio", group: "effect", intensity: 1,
    description: "Old AM radio: narrow band, a little grit.",
    chain: { denoise: 0.8, highpass: 400, eq: [{ type: "lowpass", f: 4000 }, { type: "peak", f: 1500, g: 6, q: 0.8 }], effect: { kind: "drive", amount: 2 }, comp: { threshold: -20, ratio: 3, attack: 5, release: 100, makeup: 3 } },
  },
  {
    id: "phone", name: "Phone call", group: "effect", intensity: 1,
    description: "Sounds like it's coming through a phone.",
    chain: { denoise: 0.8, highpass: 300, eq: [{ type: "lowpass", f: 3400 }, { type: "peak", f: 1800, g: 4, q: 1 }], effect: { kind: "drive", amount: 1.5 }, comp: { threshold: -20, ratio: 3, attack: 5, release: 100, makeup: 3 } },
  },
  {
    id: "megaphone", name: "Megaphone", group: "effect", intensity: 1,
    description: "Loud, harsh announcement voice.",
    chain: { denoise: 0.8, highpass: 600, eq: [{ type: "lowpass", f: 3000 }, { type: "peak", f: 1800, g: 8, q: 2 }], effect: { kind: "drive", amount: 6 }, gain: -3 },
  },
  {
    id: "robot", name: "Robot", group: "effect", intensity: 1,
    description: "Metallic robot voice.",
    chain: { denoise: 0.9, highpass: 100, effect: { kind: "robot", freq: 55, mix: 0.85 }, comp: { threshold: -22, ratio: 3, attack: 5, release: 100, makeup: 3 } },
  },
  {
    id: "hall", name: "Stage echo", group: "effect", intensity: 0.8,
    description: "Speaking on a stage in a large hall.",
    chain: { denoise: 0.9, highpass: 90, effect: { kind: "echo", delays: [170, 290], feedback: 0.35, mix: 0.32 } },
  },
];

export const VOICE_OFF: VoiceSettings = { preset: "off", intensity: 0.9 };

/** Loudness targets offered for Auto level. */
export const LEVEL_TARGETS = [
  { value: -14, label: "Reels, Shorts, YouTube (−14 LUFS)" },
  { value: -16, label: "Podcast (−16 LUFS)" },
  { value: -20, label: "Quiet / background (−20 LUFS)" },
];

/** The chain to run for these settings (preset + auto level), or null when nothing is switched on. */
export function resolveVoice(v: VoiceSettings | undefined): { chain: VoiceChain; intensity: number } | null {
  const p = voicePreset(v?.preset);
  const level = v?.level !== undefined ? { target: v.level } : undefined;
  if (!p && !level) return null;
  if (!p) return { chain: { level }, intensity: 1 };
  return { chain: { ...p.chain, level }, intensity: v?.intensity ?? p.intensity };
}

export function voicePreset(id: string | undefined): VoicePreset | undefined {
  return VOICE_PRESETS.find((p) => p.id === id);
}
