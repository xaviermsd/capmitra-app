/**
 * Per-device settings (saved in this browser's localStorage).
 */
import type { KeyStatus } from "@/components/ApiKeyManager";
import type { WatermarkCorner } from "./watermark";
import { keyLabel, type KeyProblem } from "./keyPool";

/** What happened to a key, keyed by its last 6 characters (keys are never shown in full). */
export interface KeyNote { problem: KeyProblem; at: number }

export interface Settings {
  apiKey: string;
  keyStatus?: KeyStatus;
  /** More ElevenLabs keys, used in order when the one in use runs out of credits or is refused. */
  backupKeys: string[];
  /** Index (in elevenKeys()) of the key that worked last. */
  activeKey: number;
  keyNotes: Record<string, KeyNote>;
  sarvamKey: string;
  /** Spoken (transcription) language code, or "auto". */
  language: string;
  model: string;
  autoTranscribe: boolean;
  /** Show "Prepare your video" (language + writing system) before captioning a new video. */
  askBeforeCaptioning: boolean;
  /** "wrong = right" fixes applied to every transcript. */
  rules: string;
  /** "native = English letters" spellings for Gujlish / Hinglish. */
  romanRules: string;
  keyterms: string;
  useKeyterms: boolean;
  confirmMinutes: number;
  /** Ask ElevenLabs to tell speakers apart. */
  diarize: boolean;
  /** Default translation target for the second line. */
  translateTo: string;
  /** Translation style (Sarvam mayura only). */
  translateMode: "formal" | "modern-colloquial" | "code-mixed";
  /** unlocked users only: keep the watermark anyway */
  keepWatermark: boolean;
  wmCorner: WatermarkCorner;
  /** Workspace layout. */
  panelWidth: number;
  timelineHeight: number;
  /** Space kept free to the right of the timeline (px), set by dragging its right edge. 0 = full width. */
  timelineInset: number;
  /** Timeline scale in pixels per second (0 = choose automatically). */
  timelinePps: number;
  panelCollapsed: boolean;
  previewQuality: "auto" | "full" | "half";
  /** Rule-of-thirds grid over the preview (editor only). */
  showGrid: boolean;
  /** The one-line shortcut reminder under the player. */
  showHints: boolean;
  /** The first-run tour has been seen (or skipped). */
  tourDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "", backupKeys: [], activeKey: 0, keyNotes: {}, sarvamKey: "", language: "gu", model: "scribe_v2", autoTranscribe: true, askBeforeCaptioning: true,
  rules: "", romanRules: "", keyterms: "", useKeyterms: false, confirmMinutes: 5, diarize: false,
  translateTo: "en-IN", translateMode: "modern-colloquial",
  keepWatermark: false, wmCorner: "br",
  panelWidth: 380, timelineHeight: 210, timelineInset: 0, timelinePps: 0, panelCollapsed: false, previewQuality: "auto", showGrid: false, showHints: true, tourDone: false,
};

export const LS = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage blocked */
    }
  },
};

/** Every ElevenLabs key on this device, main key first, without duplicates. */
export function elevenKeys(s: Pick<Settings, "apiKey" | "backupKeys">): string[] {
  return [s.apiKey, ...(s.backupKeys ?? [])].map((k) => k.trim()).filter((k, i, a) => k && a.indexOf(k) === i);
}

const tail = (k: string) => k.slice(-6);

/**
 * Transcription options for the keys on this device: with one key it is used
 * as before; with several, the next one takes over when one runs out, and the
 * one that worked is remembered for next time.
 */
export function keyOptions(
  settings: Settings,
  setSettings: (f: (s: Settings) => Settings) => void,
  notify?: (msg: { title: string; message: string }) => void,
) {
  const keys = elevenKeys(settings);
  if (keys.length < 2) return { apiKey: keys[0] || undefined };
  return {
    apiKeys: keys,
    keyStart: Math.min(settings.activeKey ?? 0, keys.length - 1),
    onKeyProblem: ({ index, problem }: { index: number; problem: KeyProblem }) => {
      setSettings((s) => ({ ...s, keyNotes: { ...(s.keyNotes ?? {}), [tail(keys[index])]: { problem, at: Date.now() } } }));
    },
    onKeySwitch: ({ from, to, problem }: { from: number; to: number; problem: KeyProblem }) => {
      setSettings((s) => ({ ...s, activeKey: to }));
      notify?.({
        title: `Switched to key ${keyLabel(keys[to])}`,
        message: `Key ${keyLabel(keys[from])} ${problem === "quota" ? "ran out of credits" : "was refused"}. Continuing with the next key.`,
      });
    },
    onKeyWorked: (index: number) => {
      setSettings((s) => {
        const notes = { ...(s.keyNotes ?? {}) };
        const had = tail(keys[index]) in notes;
        delete notes[tail(keys[index])];
        return s.activeKey === index && !had ? s : { ...s, activeKey: index, keyNotes: notes };
      });
    },
  };
}
