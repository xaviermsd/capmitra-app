"use client";
/**
 * Playback on the *output* timeline.
 *
 * The clock is output time (after cuts, reordering and title cards). While a
 * video clip plays, the <video> element is the source of truth and the clock
 * follows it; at a clip's end we jump the video to the next clip; during a
 * card or image (or with no video loaded) a virtual clock runs. Extra videos
 * added as clips each have their own hidden <video> (see `extras`). Background music is a
 * separate <audio> element kept in sync. Volumes come from lib/audioMix.ts,
 * the same formulas the exporter uses.
 */
import { useCallback, useRef, useState } from "react";
import { itemAt, speedOf, srcAt, type EditTimeline } from "@/lib/edl";
import { musicGainAt, musicTimeAt, sourceGainAt, speechAt } from "@/lib/audioMix";
import { DEFAULT_AUDIO, type AudioSettings, type Clip, type SoundClip } from "@/lib/project";
import type { Word } from "@/lib/types";

export interface PlaybackInputs {
  tl: EditTimeline;
  audio?: AudioSettings;
  /** Output-time words (for music ducking). */
  words: Word[];
  hasVideo: boolean;
  musicDuration: number;
  /** Sound effects on the timeline, with decoded audio by asset id. */
  sounds?: SoundClip[];
  soundBuffers?: Map<string, AudioBuffer>;
}

const EPS = 1 / 60;

export function usePlayback(videoRef: React.RefObject<HTMLVideoElement | null>, musicRef: React.RefObject<HTMLAudioElement | null>, extras?: React.RefObject<Map<string, HTMLVideoElement>>) {
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const clock = useRef({ t: 0, last: 0, seeking: false });
  const inputs = useRef<PlaybackInputs>({ tl: { items: [], duration: 0 }, words: [], hasVideo: false, musicDuration: 0 });
  const playingRef = useRef(false);
  playingRef.current = playing;
  const rateRef = useRef(1);

  const setInputs = useCallback((i: PlaybackInputs) => { inputs.current = i; }, []);

  /* ---------- sound effects (Web Audio) ---------- */
  const audioCtx = useRef<AudioContext | null>(null);
  const live = useRef(new Map<string, { node: AudioBufferSourceNode; gain: GainNode }>());
  const stopSounds = useCallback(() => {
    for (const { node } of live.current.values()) { try { node.stop(); } catch { /* ended */ } }
    live.current.clear();
  }, []);
  const syncSounds = useCallback((t: number, playing: boolean) => {
    const { sounds, soundBuffers } = inputs.current;
    if (!sounds?.length) { if (live.current.size) stopSounds(); return; }
    for (const s of sounds) {
      const inside = t >= s.start && t < s.start + s.duration;
      const on = live.current.get(s.id);
      if (playing && inside && !on) {
        const buf = soundBuffers?.get(s.assetId);
        if (!buf) continue;
        audioCtx.current ??= new AudioContext();
        const ctx = audioCtx.current;
        if (ctx.state === "suspended") void ctx.resume();
        const node = ctx.createBufferSource();
        node.buffer = buf;
        node.playbackRate.value = rateRef.current;
        const gain = ctx.createGain();
        gain.gain.value = Math.min(2, s.volume);
        node.connect(gain).connect(ctx.destination);
        const off = t - s.start;
        if (off < buf.duration - 0.02) node.start(0, off);
        node.onended = () => { if (live.current.get(s.id)?.node === node) live.current.delete(s.id); };
        live.current.set(s.id, { node, gain });
      } else if (on && (!playing || !inside)) {
        try { on.node.stop(); } catch { /* ended */ }
        live.current.delete(s.id);
      }
    }
    // sounds removed from the timeline
    for (const [id, v] of live.current) if (!sounds.some((s) => s.id === id)) { try { v.node.stop(); } catch { /* */ } live.current.delete(id); }
  }, [stopSounds]);

  const getTime = useCallback(() => clock.current.t, []);

  /** The <video> that shows this clip: the main video, or an extra video's own element. */
  const elFor = useCallback((clip: Clip | undefined | null): HTMLVideoElement | null => {
    if (!clip || clip.kind !== "video") return null;
    if (clip.sourceId) return extras?.current?.get(clip.sourceId) ?? null;
    return inputs.current.hasVideo ? videoRef.current : null;
  }, [videoRef, extras]);
  /** Every video element (main + extras). */
  const allEls = useCallback((): HTMLVideoElement[] => {
    const out: HTMLVideoElement[] = [];
    if (videoRef.current) out.push(videoRef.current);
    if (extras?.current) out.push(...extras.current.values());
    return out;
  }, [videoRef, extras]);
  const pauseOthers = useCallback((keep: HTMLVideoElement | null) => {
    for (const el of allEls()) if (el !== keep && !el.paused) el.pause();
  }, [allEls]);

  /** Put the right video element on the frame for output time t. */
  const cueVideo = useCallback((t: number) => {
    const { tl } = inputs.current;
    const it = itemAt(tl, t);
    const v = elFor(it?.clip);
    if (!it || it.clip.kind !== "video" || !v) return;
    pauseOthers(v);
    const src = srcAt(it.clip, t - it.outStart);
    const r = rateRef.current * speedOf(it.clip);
    if (Math.abs(v.playbackRate - r) > 1e-3) v.playbackRate = r; // clip speed (pitch is kept by the browser)
    if (Math.abs(v.currentTime - src) > EPS / 2) {
      clock.current.seeking = true;
      v.currentTime = Math.max(0, src);
    }
  }, [elFor, pauseOthers]);

  const seek = useCallback((t: number) => {
    const d = inputs.current.tl.duration;
    const nt = Math.max(0, Math.min(d > 0 ? d - 0.001 : t, t));
    clock.current.t = nt;
    clock.current.last = 0;
    stopSounds();
    cueVideo(nt);
    const m = musicRef.current;
    if (m && !playingRef.current) m.pause();
  }, [cueVideo, musicRef, stopSounds]);

  const pause = useCallback(() => {
    pauseOthers(null);
    musicRef.current?.pause();
    stopSounds();
    setPlaying(false);
  }, [pauseOthers, musicRef, stopSounds]);

  const play = useCallback(() => {
    const { tl } = inputs.current;
    if (tl.duration > 0 && clock.current.t >= tl.duration - 0.05) seek(0);
    clock.current.last = 0;
    const it = itemAt(tl, clock.current.t);
    const v = elFor(it?.clip);
    if (v) {
      cueVideo(clock.current.t);
      void v.play().catch(() => {});
    }
    setPlaying(true);
  }, [cueVideo, seek, elFor]);

  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);

  const setRate = useCallback((r: number) => {
    rateRef.current = r;
    setRateState(r);
    const { tl } = inputs.current;
    const it = itemAt(tl, clock.current.t);
    for (const el of allEls()) el.playbackRate = r * (it ? speedOf(it.clip) : 1);
    if (musicRef.current) musicRef.current.playbackRate = r;
  }, [allEls, musicRef]);

  /** Advance the clock and keep media elements in sync. Call once per animation frame. */
  const tick = useCallback((now: number) => {
    const c = clock.current;
    const { tl, hasVideo, audio, words, musicDuration } = inputs.current;
    const cur = itemAt(tl, c.t);
    const v = elFor(cur?.clip);
    const dt = c.last ? Math.min(0.25, (now - c.last) / 1000) : 0;
    c.last = now;
    if (c.seeking && (!v || !v.seeking)) c.seeking = false;

    if (playingRef.current && tl.duration > 0) {
      const it = cur;
      if (it && it.clip.kind === "video" && v) {
        const clip = it.clip;
        if (v.paused && !c.seeking) { cueVideo(c.t); void v.play().catch(() => {}); }
        if (!c.seeking && !v.paused) {
          const src = v.currentTime;
          if (src >= clip.srcEnd - EPS || v.ended) {
            // end of this clip: move to the next one
            const nextT = it.outEnd;
            if (nextT >= tl.duration - EPS) { c.t = tl.duration; v.pause(); musicRef.current?.pause(); setPlaying(false); }
            else {
              c.t = nextT;
              const nx = itemAt(tl, nextT);
              const nv = elFor(nx?.clip);
              if (nv) { cueVideo(nextT); if (nv !== v) { v.pause(); void nv.play().catch(() => {}); } }
              else v.pause();
            }
          } else if (src >= clip.srcStart - 0.25) {
            const r = rateRef.current * speedOf(clip);
            if (Math.abs(v.playbackRate - r) > 1e-3) v.playbackRate = r;
            c.t = it.outStart + Math.max(0, src - clip.srcStart) / speedOf(clip);
          } else {
            cueVideo(c.t);
          }
        }
      } else {
        // title card, image, or no video: virtual clock
        pauseOthers(null);
        c.t += dt * rateRef.current;
        const nx = itemAt(tl, c.t);
        const nv = elFor(nx?.clip);
        if (nx && nx !== it && nv) { cueVideo(c.t); void nv.play().catch(() => {}); }
        if (c.t >= tl.duration) {
          if (hasVideo || tl.items.some((x) => x.clip.kind === "image" || (x.clip.kind === "video" && x.clip.sourceId))) { c.t = tl.duration; setPlaying(false); }
          else c.t = 0; // sample captions loop
        }
      }
    }

    syncSounds(c.t, playingRef.current);

    // volumes (HTML media volume is 0..1)
    const a = audio ?? DEFAULT_AUDIO;
    const g = sourceGainAt(Math.min(c.t, Math.max(0, tl.duration - 0.001)), tl, a);
    const vol = Math.max(0, Math.min(1, g));
    for (const el of allEls()) {
      if (Math.abs(el.volume - vol) > 0.01) el.volume = vol;
      if (el.muted !== !!a.muted) el.muted = !!a.muted;
    }
    const m = musicRef.current;
    const music = a.music;
    if (m && music) {
      const mt = musicTimeAt(c.t, music, musicDuration, tl.duration);
      if (playingRef.current && mt !== null) {
        if (m.paused) { m.currentTime = mt; void m.play().catch(() => {}); }
        else if (Math.abs(m.currentTime - mt) > 0.3) m.currentTime = mt;
        const g = musicGainAt(c.t, music, tl.duration, speechAt(words, c.t), musicDuration || Infinity);
        const vol = Math.max(0, Math.min(1, g));
        if (Math.abs(m.volume - vol) > 0.01) m.volume = vol;
      } else if (!m.paused) m.pause();
    }
    return c.t;
  }, [cueVideo, elFor, allEls, pauseOthers, musicRef, syncSounds]);

  return { playing, setPlaying, rate, setRate, getTime, seek, play, pause, toggle, tick, setInputs, cueVideo };
}

export type PlaybackApi = ReturnType<typeof usePlayback>;
