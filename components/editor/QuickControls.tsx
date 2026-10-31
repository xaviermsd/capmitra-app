"use client";
/**
 * Quick controls right under the player, so the things people change most
 * don't hide in panels:
 *   Speed  – speed of the clip at the playhead (exported, pitch kept)
 *   Sound  – mute / volume of the original sound, background music from the
 *            device with volume and fades, noise reduction
 *   Cut    – the transition on a cut between two clips: preview, replace,
 *            change, remove, or join the clips back together
 * On phones they open as a bottom sheet; on desktop as a popover by the button.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditor, useTime } from "./EditorContext";
import { Slider, Toggle } from "@/components/Controls";
import { IconJoin, IconMic, IconMusic, IconMute, IconPlay, IconSpeed, IconTrash, IconUpload, IconVolume, IconX } from "@/components/Icons";
import { buildTimeline, canMerge, itemAt, mergeWithNext, outToSrc, SPEEDS, speedOf, splitAt, srcToOut } from "@/lib/edl";
import { VOICE_PRESETS } from "@/lib/voice/presets";
import { AUDIO_ACCEPT, useAudioControls } from "./hooks/useAudioControls";
import type { Clip, TransitionKind } from "@/lib/project";

const clock = (s: number) => `${Math.floor(s / 60)}:${(Math.max(0, s) % 60).toFixed(1).padStart(4, "0")}`;
const speedLabel = (k: number) => `${k}×`;

/* ---------- popover / sheet ---------- */

export function QuickPop({ title, sub, anchor, onClose, children, className = "" }: { title: string; sub?: string; anchor: HTMLElement | null; onClose: () => void; children: React.ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor || window.innerWidth <= 900) { setPos({}); return; }
      const r = anchor.getBoundingClientRect();
      const w = Math.min(380, window.innerWidth - 32);
      // opens above the button and never runs off the top of the window (the body scrolls instead)
      setPos({ left: Math.max(16, Math.min(r.right - w, window.innerWidth - w - 16)), bottom: Math.max(16, window.innerHeight - r.top + 10), width: w, maxHeight: Math.max(240, r.top - 26) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); } };
    window.addEventListener("keydown", esc, true);
    box.current?.querySelector<HTMLElement>("button, input, select")?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", esc, true);
  }, []);
  return (
    <div className="qp-wrap" onClick={onClose}>
      <div ref={box} className={`qp ${className}`} style={pos} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="sheet-grab" aria-hidden="true" />
        <header className="qp-head">
          <div><h2>{title}</h2>{sub ? <p>{sub}</p> : null}</div>
          <button className="btn icon panel-close" onClick={onClose} aria-label="Close"><IconX size={18} /></button>
        </header>
        <div className="qp-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------- speed ---------- */

/** The clip the speed control works on: the selected video clip, or the one under the playhead. */
function useSpeedTarget() {
  const ed = useEditor();
  const time = useTime();
  const s = ed.selection;
  const sel = s?.kind === "clip" ? ed.clips.find((c) => c.id === s.id) : undefined;
  if (sel?.kind === "video") return sel;
  const it = itemAt(ed.tl, time);
  return it?.clip.kind === "video" ? it.clip : undefined;
}

export function SpeedButton({ onOpen }: { onOpen: (el: HTMLElement) => void }) {
  const target = useSpeedTarget();
  const k = target ? speedOf(target) : 1;
  return (
    <button className={`btn qbtn ${k !== 1 ? "on" : ""}`} onClick={(e) => onOpen(e.currentTarget)} aria-haspopup="dialog" aria-label={`Speed: ${speedLabel(k)}`} data-tip="Clip speed">
      <IconSpeed size={18} /><span>{speedLabel(k)}</span>
    </button>
  );
}

export function SpeedPop({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const ed = useEditor();
  const time = useTime();
  const { clips, setClips, playback, toast } = ed;
  const target = useSpeedTarget();
  const videoClips = clips.filter((c) => c.kind === "video");
  const n = target ? videoClips.indexOf(target) + 1 : 0;
  const k = target ? speedOf(target) : 1;

  /** Change speeds and keep the playhead on the same moment of the video. */
  const apply = (next: Clip[]) => {
    const src = outToSrc(ed.tl, time).src;
    setClips(next, "speed");
    if (src !== null) { const t = srcToOut(buildTimeline(next), src); if (t !== null) playback.seek(t); }
  };
  const setSpeed = (s: number) => target && apply(clips.map((c) => (c.id === target.id && c.kind === "video" ? { ...c, speed: s === 1 ? undefined : s } : c)));
  const setAll = () => { apply(clips.map((c) => (c.kind === "video" ? { ...c, speed: k === 1 ? undefined : k } : c))); toast({ kind: "success", title: `Every clip at ${speedLabel(k)}`, duration: 1800 }); };

  return (
    <QuickPop title="Speed" sub={target ? `${videoClips.length > 1 ? `Clip ${n} of ${videoClips.length} · ` : ""}${ed.tl.duration ? `video now ${clock(ed.tl.duration)}` : ""}` : "Move the playhead onto a video clip"} anchor={anchor} onClose={onClose}>
      <div className="speed-chips" role="radiogroup" aria-label="Clip speed">
        {SPEEDS.map((s) => (
          <button key={s} role="radio" aria-checked={k === s} className={`pchip ${k === s ? "on" : ""}`} disabled={!target} onClick={() => setSpeed(s)}>{speedLabel(s)}</button>
        ))}
      </div>
      <p className="qp-note">Changes the exported video. Captions follow, and voices keep their pitch.{videoClips.length > 1 ? " Split the video first to change the speed of just one part." : " Split first to speed up just one part."}</p>
      {videoClips.length > 1 ? <button className="btn small ghost" disabled={!target} onClick={setAll}>Use {speedLabel(k)} on every clip</button> : null}
      <div className="qp-sep" />
      <div className="qp-row">
        <span><b>Playback while editing</b><em>Only the preview, not the export</em></span>
        <div className="seg small" role="group" aria-label="Preview playback speed">
          {[1, 1.5, 2].map((r) => <button key={r} className={playback.rate === r ? "on" : ""} aria-pressed={playback.rate === r} onClick={() => playback.setRate(r)}>{r}×</button>)}
        </div>
      </div>
    </QuickPop>
  );
}

/* ---------- sound ---------- */

export function SoundButton({ onOpen }: { onOpen: (el: HTMLElement) => void }) {
  const { audio, music, vp } = useAudioControls();
  const muted = !!audio.muted;
  return (
    <button className={`btn qbtn ${muted ? "muted" : ""} ${music || vp ? "on" : ""}`} onClick={(e) => onOpen(e.currentTarget)} aria-haspopup="dialog" aria-label={muted ? "Sound (original sound muted)" : "Sound"} data-tip="Sound, music and noise">
      {muted ? <IconMute size={18} /> : <IconVolume size={18} />}<span>Sound</span>
      {music ? <i className="qbtn-dot" aria-hidden="true" /> : null}
    </button>
  );
}

export function SoundPop({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const ed = useEditor();
  const { audio, music, vp, setAudio, setMusic, uploadMusic, pickVoice } = useAudioControls();
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const enhance = VOICE_PRESETS.filter((p) => p.group === "enhance");

  return (
    <QuickPop title="Sound" anchor={anchor} onClose={onClose} className="qp-sound">
      <section className="qp-sec">
        <div className="qp-row">
          <span className="qp-ico">{audio.muted ? <IconMute size={17} /> : <IconVolume size={17} />}</span>
          <span><b>Original sound</b><em>{audio.muted ? "Muted in the preview and the export" : "The sound recorded with your video"}</em></span>
          <button className={`btn small mute-btn ${audio.muted ? "on" : ""}`} aria-pressed={!!audio.muted} onClick={() => setAudio({ muted: !audio.muted }, "audio:muted")}>
            {audio.muted ? <><IconMute size={15} /> Unmute</> : <><IconMute size={15} /> Mute</>}
          </button>
        </div>
        {!audio.muted ? <Slider label="Volume" value={Math.round(audio.volume * 100)} min={0} max={200} step={5} unit="%" onChange={(v) => setAudio({ volume: v / 100 })} hint="above 100% applies in the export" /> : null}
      </section>

      <section className="qp-sec">
        <div className="qp-row">
          <span className="qp-ico music"><IconMusic size={17} /></span>
          <span><b>Background music</b><em>{music ? music.name : "From your phone or computer"}</em></span>
          {music ? (
            <button className="btn icon small ghost" aria-label="Remove music" onClick={() => setAudio({ music: undefined })}><IconTrash size={15} /></button>
          ) : null}
        </div>
        <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setAdding(true); await uploadMusic(f); setAdding(false); }} />
        {music ? (
          <>
            <Slider label="Music volume" value={Math.round(music.volume * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setMusic({ volume: v / 100 })} />
            <Slider label="Fade in" value={music.fadeIn} min={0} max={8} step={0.5} unit="s" onChange={(v) => setMusic({ fadeIn: v })} />
            <Slider label="Fade out" value={music.fadeOut} min={0} max={8} step={0.5} unit="s" onChange={(v) => setMusic({ fadeOut: v })} />
            <Toggle label="Lower it while someone speaks" value={music.duck > 0} onChange={(v) => setMusic({ duck: v ? 0.6 : 0 })} />
            <button className="btn small ghost" disabled={adding} onClick={() => fileRef.current?.click()}><IconUpload size={14} /> Replace music</button>
          </>
        ) : (
          <div className="row-btns wrap">
            <button className="btn small primary" disabled={adding} onClick={() => fileRef.current?.click()}><IconUpload size={14} /> {adding ? "Adding…" : "Add music from device"}</button>
            <button className="btn small ghost" onClick={() => { onClose(); ed.setPanel("effects", true); void import("./panels/EffectsPanel").then((m) => m.requestFxCategory("music")); }}>Free music</button>
          </div>
        )}
      </section>

      <section className="qp-sec">
        <div className="qp-row">
          <span className="qp-ico voice"><IconMic size={17} /></span>
          <span><b>Noise reduction</b><em>{vp ? vp.description : "Removes fans, traffic and room hiss from voices"}</em></span>
        </div>
        <div className="speed-chips" role="radiogroup" aria-label="Noise reduction">
          <button role="radio" aria-checked={!vp} className={`pchip ${!vp ? "on" : ""}`} onClick={() => pickVoice("off")}>Off</button>
          {enhance.map((p) => <button key={p.id} role="radio" aria-checked={vp?.id === p.id} className={`pchip ${vp?.id === p.id ? "on" : ""}`} onClick={() => pickVoice(p.id)}>{p.name}</button>)}
        </div>
      </section>
      <button className="btn small ghost qp-more" onClick={() => { onClose(); ed.setPanel("audio", true); }}>All sound settings</button>
    </QuickPop>
  );
}

/* ---------- a cut between two clips ---------- */

export const TRANSITION_CHOICES: { value: TransitionKind; label: string }[] = [
  { value: "none", label: "None" }, { value: "fade", label: "Fade" }, { value: "dip-white", label: "Flash" },
  { value: "zoom", label: "Zoom" }, { value: "slide-left", label: "Slide" }, { value: "slide-up", label: "Slide up" },
  { value: "wipe", label: "Wipe" }, { value: "blur", label: "Blur" }, { value: "whip", label: "Whip pan" },
  { value: "spin", label: "Spin" }, { value: "glitch", label: "Glitch" },
];

/** Edit the cut in front of clip `clipId`: transition, preview, join back. */
export function CutSheet({ clipId, anchor, onClose }: { clipId: string; anchor: HTMLElement | null; onClose: () => void }) {
  const ed = useEditor();
  const { clips, setClips, tl, playback, toast } = ed;
  const it = tl.items.find((x) => x.clip.id === clipId);
  const prev = it && it.index > 0 ? clips[it.index - 1] : undefined;
  const stopRef = useRef<number | null>(null);
  const insertRef = useRef<HTMLInputElement>(null);
  if (!it || !prev) return null;
  const tr = it.clip.transition && it.clip.transition.kind !== "none" ? it.clip.transition : null;
  const joinable = canMerge(clips, prev.id);

  const preview = () => {
    if (stopRef.current) window.clearTimeout(stopRef.current);
    const from = Math.max(0, it.outStart - 1.2);
    playback.seek(from);
    playback.play();
    stopRef.current = window.setTimeout(() => playback.pause(), 2400 / Math.max(0.25, playback.rate));
  };
  const setTr = (kind: TransitionKind) => {
    setClips(clips.map((c) => (c.id === clipId ? { ...c, transition: kind === "none" ? undefined : { kind, duration: tr?.duration ?? 0.6 } } : c)), `cut:${clipId}`);
    if (kind !== "none") setTimeout(preview, 60);
  };
  const join = () => {
    const t = it.outStart;
    setClips(mergeWithNext(clips, prev.id));
    ed.setSelection({ kind: "clip", id: prev.id });
    playback.seek(t);
    toast({ kind: "success", title: "Clips joined", message: "The cut is gone.", action: { label: "Undo", onClick: () => ed.undo() }, duration: 4000 });
    onClose();
  };

  return (
    <QuickPop title={`Cut at ${clock(it.outStart)}`} sub={tr ? `Transition: ${TRANSITION_CHOICES.find((x) => x.value === tr.kind)?.label ?? tr.kind}, ${tr.duration.toFixed(1)} s` : "No transition: a straight cut"} anchor={anchor} onClose={onClose} className="qp-cut">
      <div className="tr-grid" role="radiogroup" aria-label="Transition">
        {TRANSITION_CHOICES.map((t) => {
          const on = (tr?.kind ?? "none") === t.value;
          return (
            <button key={t.value} role="radio" aria-checked={on} className={`tr-tile ${on ? "on" : ""}`} onClick={() => setTr(t.value)}>
              <span className={`tr-art tr-${t.value}`} aria-hidden="true"><i /><i /></span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
      {tr ? (
        <>
          <Slider label="Length" value={tr.duration} min={0.2} max={2} step={0.1} unit="s" onChange={(v) => setClips(clips.map((c) => (c.id === clipId ? { ...c, transition: { ...tr, duration: v } } : c)), `cutlen:${clipId}`)} />
          <div className="row-btns wrap">
            <button className="btn small" onClick={preview}><IconPlay size={14} /> Preview</button>
            <button className="btn small ghost" onClick={() => setTr("none")}><IconTrash size={14} /> Remove transition</button>
            {clips.length > 2 ? <button className="btn small ghost" onClick={() => { setClips(clips.map((c, i) => (i === 0 ? c : { ...c, transition: tr })), "cut:all"); toast({ kind: "success", title: "Used on every cut", duration: 1800 }); }}>Use on every cut</button> : null}
          </div>
        </>
      ) : null}
      <div className="qp-sep" />
      <h4 className="qp-h">Insert here <em>a new clip goes between these two</em></h4>
      <div className="ins-grid">
        <button className="ins-tile" onClick={() => { insertRef.current?.setAttribute("accept", "video/*,.mp4,.mov,.m4v,.webm,.mkv"); insertRef.current?.click(); }}>
          <span className="ins-art video" aria-hidden="true"><IconPlay size={16} /></span><b>Video</b><em>MP4 · MOV</em>
        </button>
        <button className="ins-tile" onClick={() => { insertRef.current?.setAttribute("accept", "image/*"); insertRef.current?.click(); }}>
          <span className="ins-art image" aria-hidden="true" /><b>Image</b><em>4 s, adjustable</em>
        </button>
        <button className="ins-tile" onClick={() => { ed.placeClip({ id: ed.uid("c"), kind: "card", duration: 1, background: { kind: "color", color: "#000000" } }, "playhead", it.outStart); onClose(); }}>
          <span className="ins-art blank" aria-hidden="true" /><b>Blank</b><em>a 1 s pause</em>
        </button>
        <button className={`ins-tile join ${joinable ? "" : "off"}`} disabled={!joinable} onClick={join} title={joinable ? "" : "These clips aren't next to each other in the video (or have different speeds)"}>
          <span className="ins-art joinart" aria-hidden="true"><IconJoin size={16} /></span><b>Join</b><em>{joinable ? "remove this cut" : "can't join"}</em>
        </button>
        <input ref={insertRef} type="file" hidden multiple onChange={async (e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; onClose(); for (const f of fs) await ed.addMediaClip(f, "playhead", it.outStart); }} />
      </div>
    </QuickPop>
  );
}

/** A clip that can be joined with its neighbour: the selected one, else the cut nearest the playhead. */
export function joinTarget(clips: Clip[], selId: string | null, time: number, items: { clip: Clip; outStart: number; index: number }[]): string | null {
  if (selId) {
    if (canMerge(clips, selId)) return selId;
    const i = clips.findIndex((c) => c.id === selId);
    if (i > 0 && canMerge(clips, clips[i - 1].id)) return clips[i - 1].id;
  }
  let best: { id: string; d: number } | null = null;
  for (const it of items) {
    if (it.index === 0) continue;
    const prevId = clips[it.index - 1].id;
    if (!canMerge(clips, prevId)) continue;
    const d = Math.abs(it.outStart - time);
    if (!best || d < best.d) best = { id: prevId, d };
  }
  return best?.id ?? null;
}

/** Split at the playhead, select the new right-hand part and offer an easy way back. */
export function splitHere(ed: ReturnType<typeof useEditor>, t: number) {
  const before = ed.clips;
  const n = splitAt(before, t, () => ed.uid("c"));
  if (n === before) {
    ed.toast({ kind: "info", title: "Move the playhead inside a clip to split it", message: "A split can't be right at the start or end of a clip.", duration: 2400 });
    return;
  }
  ed.setClips(n);
  const right = n.find((c) => !before.some((b) => b.id === c.id));
  if (right) ed.setSelection({ kind: "clip", id: right.id });
  ed.toast({ kind: "success", title: `Split at ${clock(t)}`, message: "Tap the ＋ on the cut for a transition, or Join to put it back.", action: { label: "Undo split", onClick: () => ed.undo() }, duration: 4500 });
}
