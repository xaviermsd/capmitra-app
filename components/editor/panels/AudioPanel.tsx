"use client";
/** Original sound (mute, volume, fades), background music (fades, loop, ducking under speech), noise reduction and loudness. */
import { useEffect, useRef, useState } from "react";
import { useEditor, useTime } from "../EditorContext";
import { Section, Select, Slider, Toggle } from "@/components/Controls";
import { IconMusic, IconTrash, IconUpload } from "@/components/Icons";
import { listAssets, deleteAsset, type AssetRecord } from "@/lib/assets";
import { AUDIO_ACCEPT, useAudioControls } from "../hooks/useAudioControls";
import { LEVEL_TARGETS, VOICE_PRESETS, resolveVoice } from "@/lib/voice/presets";
import { IconPause, IconPlay } from "@/components/Icons";

export function AudioPanel() {
  const ed = useEditor();
  const time = useTime();
  const { toast } = ed;
  const { audio, music, voice, vp, setAudio, setMusic, chooseAsset, uploadMusic, pickVoice } = useAudioControls();
  const fileRef = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState<Omit<AssetRecord, "blob">[]>([]);
  const refresh = () => void listAssets("audio").then(setLibrary);
  useEffect(refresh, []);
  const upload = async (f: File) => { if (await uploadMusic(f)) refresh(); };

  const setLevel = (level: number | undefined) => {
    const next = { ...(voice ?? { preset: "off", intensity: 0.9 }), level };
    setAudio({ voice: next }, "voice:level");
    if (!resolveVoice(next)) ed.setVoiceOriginal(false);
  };
  const active = !!resolveVoice(voice);
  const playing = ed.playback.playing;

  return (
    <>
      <Section title="Original sound">
        <Toggle label="Mute the original sound" value={!!audio.muted} onChange={(v) => setAudio({ muted: v || undefined }, "audio:muted")} hint="for music-only videos" />
        <Slider label="Volume" value={audio.volume} min={0} max={2} step={0.05} unit="×" onChange={(v) => setAudio({ volume: v })} hint="above 1× is applied in the export" />
        <Slider label="Fade in" value={audio.fadeIn} min={0} max={5} step={0.1} unit="s" onChange={(v) => setAudio({ fadeIn: v })} />
        <Slider label="Fade out" value={audio.fadeOut} min={0} max={5} step={0.1} unit="s" onChange={(v) => setAudio({ fadeOut: v })} />
        <p className="muted">Each clip also has its own volume (Edit panel). Title cards are silent; transitions dip the sound.</p>
      </Section>

      <Section title="Background music" right={
        <>
          <button className="btn small" onClick={() => fileRef.current?.click()}><IconUpload size={14} /> Add music from device</button>
          <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        </>
      }>
        {music ? (
          <>
            <div className="music-card"><IconMusic size={18} /><b>{music.name}</b><button className="btn small ghost danger" onClick={() => setAudio({ music: undefined })}>Remove</button></div>
            <Slider label="Volume" value={music.volume} min={0} max={1} step={0.01} onChange={(v) => setMusic({ volume: v })} />
            <Slider label="Lower under speech" value={music.duck} min={0} max={1} step={0.05} onChange={(v) => setMusic({ duck: v })} hint="0 = never, 1 = silent while talking" />
            <Slider label="Starts at" value={music.start} min={0} max={Math.max(1, ed.tl.duration)} step={0.1} unit="s" onChange={(v) => setMusic({ start: v })} />
            <button className="btn small ghost" onClick={() => setMusic({ start: +time.toFixed(2) })}>Start at playhead</button>
            <Slider label="Fade in" value={music.fadeIn} min={0} max={8} step={0.1} unit="s" onChange={(v) => setMusic({ fadeIn: v })} />
            <Slider label="Fade out" value={music.fadeOut} min={0} max={8} step={0.1} unit="s" onChange={(v) => setMusic({ fadeOut: v })} />
            <Toggle label="Loop until the end" value={music.loop} onChange={(v) => setMusic({ loop: v })} />
            <div className="row-btns wrap">
              <button className="btn small ghost" onClick={async () => {
                const tid = toast({ kind: "busy", title: "Finding the beats…", message: music.name });
                try {
                  const { beatsFor } = await import("@/lib/effects/library");
                  const r = await beatsFor(music.assetId);
                  setMusic({ beats: r.beats, bpm: r.bpm });
                  ed.dismiss(tid);
                  toast({ kind: "success", title: r.bpm ? `${Math.round(r.bpm)} BPM, ${r.beats.length} beats` : "No clear beat found", message: r.bpm ? "Beat ticks are on the Music track; Effects → Beat sync uses them." : "Try a track with a steadier rhythm." });
                } catch (e) { ed.dismiss(tid); toast({ kind: "error", title: "Couldn't analyse the music", message: (e as Error).message }); }
              }}>🥁 {music.beats?.length ? `${Math.round(music.bpm ?? 0)} BPM · find again` : "Find beats"}</button>
              <button className="btn small ghost" onClick={() => ed.setPanel("effects")}>Sync effects to beats</button>
            </div>
          </>
        ) : (
          <p className="muted">Add a track you have the rights to use, or pick a free generated track in <button className="linkish" onClick={() => ed.setPanel("effects")}>Effects → Music</button>. It stays in this browser and is mixed into the export.</p>
        )}
        {library.length ? (
          <div className="asset-list">
            <h4>Your music</h4>
            {library.map((a) => (
              <div key={a.id} className="asset-row">
                <button className={`btn small ghost ${music?.assetId === a.id ? "on" : ""}`} onClick={() => chooseAsset(a)}>{a.name}</button>
                <span className="muted">{a.duration ? `${Math.floor(a.duration / 60)}:${String(Math.round(a.duration % 60)).padStart(2, "0")}` : ""}</span>
                <button className="btn icon small ghost" aria-label={`Delete ${a.name}`} onClick={async () => {
                  if (!(await ed.dialog.confirm({ title: "Delete this music?", message: "Projects using it will lose their music.", confirmLabel: "Delete", danger: true }))) return;
                  await deleteAsset(a.id);
                  if (music?.assetId === a.id) setAudio({ music: undefined });
                  refresh();
                }}><IconTrash size={14} /></button>
              </div>
            ))}
          </div>
        ) : null}
      </Section>
      <Section title="Noise reduction & voice">
        <p className="muted voice-intro">Clean up and style the voice in your video. It runs on this device, and the export sounds exactly like the preview.</p>
        <div className="voice-group" role="group" aria-label="Enhance">
          <span className="voice-label">Enhance</span>
          <div className="voice-chips">
            <button className={`pchip ${!vp ? "on" : ""}`} aria-pressed={!vp} onClick={() => pickVoice("off")}>Off</button>
            {VOICE_PRESETS.filter((p) => p.group === "enhance").map((p) => (
              <button key={p.id} className={`pchip ${vp?.id === p.id ? "on" : ""}`} aria-pressed={vp?.id === p.id} onClick={() => pickVoice(p.id)}>{p.name}</button>
            ))}
          </div>
        </div>
        <div className="voice-group" role="group" aria-label="Voice effects">
          <span className="voice-label">Effects</span>
          <div className="voice-chips">
            {VOICE_PRESETS.filter((p) => p.group === "effect").map((p) => (
              <button key={p.id} className={`pchip ${vp?.id === p.id ? "on" : ""}`} aria-pressed={vp?.id === p.id} onClick={() => pickVoice(p.id)}>{p.name}</button>
            ))}
          </div>
        </div>
        {active && voice ? (
          <div className="voice-card">
            {vp ? <p><b>{vp.name}</b> {vp.description}</p> : <p><b>Auto level</b> is on. Pick a preset above to clean up the voice too.</p>}
            {vp ? <Slider label="Intensity" value={Math.round(voice.intensity * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setAudio({ voice: { ...voice, intensity: v / 100 } }, "voice:intensity")} /> : null}
            <div className="voice-ab">
              <button className="btn icon voice-play" onClick={() => ed.playback.toggle()} aria-label={playing ? "Pause" : "Play"} disabled={!ed.file}>{playing ? <IconPause size={16} /> : <IconPlay size={16} />}</button>
              <div className="seg" role="group" aria-label="Compare">
                <button className={ed.voiceOriginal ? "on" : ""} aria-pressed={ed.voiceOriginal} onClick={() => ed.setVoiceOriginal(true)}>Before</button>
                <button className={!ed.voiceOriginal ? "on" : ""} aria-pressed={!ed.voiceOriginal} onClick={() => ed.setVoiceOriginal(false)}>After</button>
              </div>
            </div>
            <p className="muted">{ed.file ? "Play the video and switch between Before and After to hear the difference." : "Open a video to hear it."}</p>
          </div>
        ) : null}
      </Section>
      <Section title="Loudness">
        <Toggle label="Auto level" value={voice?.level !== undefined} onChange={(v) => setLevel(v ? -14 : undefined)} hint="evens out quiet and loud parts" />
        {voice?.level !== undefined ? (
          <Select label="Target" value={voice.level} options={LEVEL_TARGETS} onChange={(v) => setLevel(v)} />
        ) : null}
        <p className="muted">Clipping protection is always on in the export, and background music dips automatically while someone speaks.</p>
      </Section>
    </>
  );
}
