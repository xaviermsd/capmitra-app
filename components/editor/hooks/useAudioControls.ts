"use client";
/**
 * Sound settings shared by the Audio panel and the quick Sound controls under
 * the player: original sound (mute, volume, fades), background music from the
 * device (volume, fades), and the voice enhancer / noise reduction.
 */
import { useCallback } from "react";
import { useEditor } from "../EditorContext";
import { putAsset, probeMedia, type AssetRecord } from "@/lib/assets";
import { DEFAULT_AUDIO, type AudioSettings, type Music } from "@/lib/project";
import { resolveVoice, voicePreset } from "@/lib/voice/presets";

export const AUDIO_ACCEPT = "audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac";

export function useAudioControls() {
  const ed = useEditor();
  const { doc, project, toast } = ed;
  const audio: AudioSettings = { ...DEFAULT_AUDIO, ...(doc.audio ?? {}) };
  const music = audio.music;

  const setAudio = useCallback((p: Partial<AudioSettings>, key?: string) =>
    project.update((d) => ({ ...d, audio: { ...DEFAULT_AUDIO, ...(d.audio ?? {}), ...p } }), { coalesce: key ?? `audio:${Object.keys(p).join(",")}` }), [project]);
  const setMusic = (p: Partial<Music>) => music && setAudio({ music: { ...music, ...p } }, `music:${Object.keys(p).join(",")}`);

  const chooseAsset = (a: Omit<AssetRecord, "blob">) => {
    setAudio({ music: { assetId: a.id, name: a.name.replace(/\.[^.]+$/, ""), volume: 0.35, start: 0, fadeIn: 1, fadeOut: 2, loop: true, duck: 0.6 } });
    toast({ kind: "success", title: "Music added", message: "It lowers itself automatically while someone speaks.", duration: 2500 });
  };

  /** Add a music file from the device and use it as the background music. */
  const uploadMusic = async (f: File): Promise<Omit<AssetRecord, "blob"> | null> => {
    try {
      if (!f.type.startsWith("audio/") && !/\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(f.name)) throw new Error("Choose an audio file (MP3, M4A, WAV, OGG…).");
      if (f.size > 60e6) throw new Error("Music files up to 60 MB, please.");
      const meta = await probeMedia(f.type ? f : new File([f], f.name, { type: "audio/mpeg" }));
      const a = await putAsset(f, f.name, "audio", meta);
      chooseAsset(a);
      return a;
    } catch (e) {
      toast({ kind: "error", title: "Couldn't add that music", message: (e as Error).message });
      return null;
    }
  };

  const voice = audio.voice;
  const vp = voicePreset(voice?.preset);
  const pickVoice = (id: string) => {
    const p = voicePreset(id);
    const next = { ...(voice ?? { intensity: 0.9 }), preset: p ? p.id : "off", intensity: p ? (voice?.preset === p.id ? voice.intensity : p.intensity) : voice?.intensity ?? 0.9 };
    setAudio({ voice: next }, "voice");
    if (!resolveVoice(next)) ed.setVoiceOriginal(false);
  };

  return { audio, music, voice, vp, setAudio, setMusic, chooseAsset, uploadMusic, pickVoice };
}
