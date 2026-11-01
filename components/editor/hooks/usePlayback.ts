"use client";
/**
 * Playback on the *output* timeline.
 *
 * The clock is output time (after cuts, reordering and title cards). It runs
 * on the display clock and is gently locked to the playing video's media time
 * (see tick). Every source has two players (the visible element and a twin),
 * scheduled by lib/overlap.ts: the next clip is parked on its first frame well
 * before its cut and both clips run together through a transition, so a cut
 * never waits on a seek. Extra videos added as clips each have their own hidden
 * <video> (see `extras`). Background music is a
 * separate <audio> element kept in sync. Volumes come from lib/audioMix.ts,
 * the same formulas the exporter uses.
 */
import { useCallback, useRef, useState } from "react";
import { itemAt, speedOf, type EditTimeline } from "@/lib/edl";
import { slotNeeds, slotsFor, sourceKey, type SlotNeed } from "@/lib/overlap";
import { musicGainAt, musicTimeAt, sourceGainAt, speechAt } from "@/lib/audioMix";
import { DEFAULT_AUDIO, type AudioSettings, type SoundClip, type VideoClip } from "@/lib/project";
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

export function usePlayback(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  musicRef: React.RefObject<HTMLAudioElement | null>,
  extras?: React.RefObject<Map<string, HTMLVideoElement>>,
  /** A second player per source ("main" or the source id), so neighbouring clips never wait on a seek. */
  twins?: React.RefObject<Map<string, HTMLVideoElement>>,
) {
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

  /* ---------- players ---------- */

  /** Smooth media time per player: anchored on each presented frame, interpolated in between. */
  const anchors = useRef(new WeakMap<HTMLVideoElement, { media: number; perf: number; ct: number }>());
  const watched = useRef(new WeakSet<HTMLVideoElement>());
  const watch = useCallback((el: HTMLVideoElement) => {
    if (watched.current.has(el)) return;
    watched.current.add(el);
    const rvfc = (el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, md: { mediaTime: number; expectedDisplayTime: number }) => void) => number }).requestVideoFrameCallback;
    if (!rvfc) return;
    const cb = (now: number, md: { mediaTime: number; expectedDisplayTime: number }) => {
      anchors.current.set(el, { media: md.mediaTime, perf: md.expectedDisplayTime || now, ct: el.currentTime });
      rvfc.call(el, cb);
    };
    rvfc.call(el, cb);
  }, []);
  /** Where this player's picture is right now, in source seconds. */
  const mediaNow = useCallback((el: HTMLVideoElement, now: number): number => {
    if (el.paused || el.seeking) return el.currentTime;
    let a = anchors.current.get(el);
    // no frame callbacks (or a stale anchor after a seek): anchor on currentTime changes instead
    if (!a || Math.abs(a.ct - el.currentTime) > 0.3) {
      a = { media: el.currentTime, perf: now, ct: el.currentTime };
      anchors.current.set(el, a);
    }
    const ahead = Math.max(0, (now - a.perf) / 1000) * el.playbackRate;
    return a.media + Math.min(ahead, 0.12);
  }, []);

  /** Player for a key `${source}:${slot}` (slot 0 = the visible element, 1 = its twin). */
  const playerFor = useCallback((key: string): HTMLVideoElement | null => {
    const [src, slot] = key.split(":");
    const el = slot === "1" ? twins?.current?.get(src) ?? null
      : src === "main" ? (inputs.current.hasVideo ? videoRef.current : null)
      : extras?.current?.get(src) ?? null;
    if (el) watch(el);
    return el;
  }, [videoRef, extras, twins, watch]);

  /** Every video element (main, extras and twins). */
  const allEls = useCallback((): HTMLVideoElement[] => {
    const out: HTMLVideoElement[] = [];
    if (videoRef.current) out.push(videoRef.current);
    if (extras?.current) out.push(...extras.current.values());
    if (twins?.current) out.push(...twins.current.values());
    return out;
  }, [videoRef, extras, twins]);

  const durationOf = useCallback((c: VideoClip): number => {
    const el = playerFor(`${sourceKey(c)}:0`);
    return el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : Infinity;
  }, [playerFor]);

  /** Which player shows which item right now, and the source time it should be at. */
  const assigned = useRef(new Map<number, { key: string; time: number; role: SlotNeed["role"] }>());
  const slotCache = useRef<{ items: EditTimeline["items"] | null; slots: number[] }>({ items: null, slots: [] });

  /**
   * Point every player at what output time t needs: the playing clip, the next
   * clip parked (or running through its handle), the previous clip's tail.
   * `strict` (paused / scrubbing) seeks on any difference; while playing only
   * real drift is corrected so the players are never fighting the clock.
   */
  const syncPlayers = useCallback((t: number, playing: boolean, now: number) => {
    const { tl, audio } = inputs.current;
    if (slotCache.current.items !== tl.items) slotCache.current = { items: tl.items, slots: slotsFor(tl.items) };
    const needs = slotNeeds(tl, t, playing, durationOf, slotCache.current.slots);
    const used = new Set<HTMLVideoElement>();
    const muted = !!(audio ?? DEFAULT_AUDIO).muted;
    assigned.current.clear();
    for (const n of needs) {
      const el = playerFor(n.key);
      if (!el) continue;
      used.add(el);
      assigned.current.set(n.index, { key: n.key, time: n.time, role: n.role });
      const clip = tl.items[n.index].clip as VideoClip;
      let r = rateRef.current * speedOf(clip);
      // only the playing clip is heard (twins share the main element's volume)
      const mute = muted || n.role !== "main";
      if (el.muted !== mute) el.muted = mute;
      if (el.readyState < 1) { if (Math.abs(el.playbackRate - r) > 1e-3) el.playbackRate = r; continue; }
      if (n.play) {
        if (el.paused) {
          if (!el.seeking && Math.abs(el.currentTime - n.time) > 0.04) el.currentTime = n.time;
          void el.play().catch(() => {});
        } else if (!el.seeking) {
          const drift = mediaNow(el, now) - n.time;
          if (Math.abs(drift) > (n.role === "main" ? 0.3 : 0.5)) el.currentTime = n.time;
          // a silent player running beside the playing clip catches up by speed, never by a seek
          // (a seek would blank it for a few frames right in the middle of the transition)
          else if (n.role !== "main" && Math.abs(drift) > 0.02) r *= 1 - Math.max(-0.3, Math.min(0.3, drift * 3));
        }
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - n.time) > EPS / 2) el.currentTime = n.time;
      }
      if (Math.abs(el.playbackRate - r) > 1e-3) el.playbackRate = r;
    }
    for (const el of allEls()) if (!used.has(el) && !el.paused) el.pause();
  }, [durationOf, playerFor, allEls, mediaNow]);

  /**
   * The picture for timeline item `index` at source time `srcTime`, or null
   * when its player isn't on that frame yet (then the caller draws without it).
   */
  const frameFor = useCallback((index: number, srcTime?: number): { image: HTMLVideoElement; w: number; h: number } | null => {
    const a = assigned.current.get(index);
    if (!a) return null;
    const el = playerFor(a.key);
    if (!el || el.readyState < 2 || el.seeking || !el.videoWidth) return null;
    const want = srcTime ?? a.time;
    const off = Math.abs(mediaNow(el, performance.now()) - want);
    const tol = a.role === "main" ? 0.35 : el.paused ? 0.045 : 0.25;
    if (off > tol) return null;
    return { image: el, w: el.videoWidth, h: el.videoHeight };
  }, [playerFor, mediaNow]);

  const seek = useCallback((t: number) => {
    const d = inputs.current.tl.duration;
    const nt = Math.max(0, Math.min(d > 0 ? d - 0.001 : t, t));
    clock.current.t = nt;
    clock.current.last = 0;
    stopSounds();
    syncPlayers(nt, playingRef.current, performance.now());
    const m = musicRef.current;
    if (m && !playingRef.current) m.pause();
  }, [syncPlayers, musicRef, stopSounds]);
  /** Kept for callers that only want the players lined up on t. */
  const cueVideo = useCallback((t: number) => syncPlayers(t, playingRef.current, performance.now()), [syncPlayers]);

  const pause = useCallback(() => {
    for (const el of allEls()) if (!el.paused) el.pause();
    musicRef.current?.pause();
    stopSounds();
    setPlaying(false);
    playingRef.current = false;
    syncPlayers(clock.current.t, false, performance.now());
  }, [allEls, musicRef, stopSounds, syncPlayers]);

  const play = useCallback(() => {
    const { tl } = inputs.current;
    if (tl.duration > 0 && clock.current.t >= tl.duration - 0.05) seek(0);
    clock.current.last = 0;
    playingRef.current = true;
    syncPlayers(clock.current.t, true, performance.now()); // play() inside the click, for autoplay rules
    setPlaying(true);
  }, [seek, syncPlayers]);

  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);

  const setRate = useCallback((r: number) => {
    rateRef.current = r;
    setRateState(r);
    syncPlayers(clock.current.t, playingRef.current, performance.now());
    if (musicRef.current) musicRef.current.playbackRate = r;
  }, [syncPlayers, musicRef]);

  /**
   * Advance the clock and keep media elements in sync. Call once per animation frame.
   *
   * The clock runs on the display clock (rAF time x rate), so every animation
   * frame gets its own time even when the video only presents a new frame every
   * other refresh. It is pulled gently toward the playing video's media time
   * (anchored on presented frames) so sound and picture stay locked, and it
   * holds still only while that video is really buffering.
   */
  const tick = useCallback((now: number) => {
    const c = clock.current;
    const { tl, hasVideo } = inputs.current;
    const dt = c.last ? Math.min(0.1, Math.max(0, (now - c.last) / 1000)) : 0;
    c.last = now;

    if (playingRef.current && tl.duration > 0) {
      const step = dt * rateRef.current;
      let nt = c.t + step;
      const it = itemAt(tl, Math.min(nt, tl.duration - 1e-6));
      const a = it ? assigned.current.get(it.index) : undefined;
      const el = a && a.role === "main" ? playerFor(a.key) : null;
      if (it && it.clip.kind === "video" && el) {
        const clip = it.clip;
        if (el.seeking || (el.readyState < 3 && !el.paused && !el.ended)) {
          nt = c.t; // buffering: hold the picture rather than run ahead of it
        } else if (!el.paused) {
          const tv = it.outStart + (mediaNow(el, now) - clip.srcStart) / speedOf(clip);
          // a dead band of a few video frames: inside it the clock runs exactly on display time
          const err = tv - nt;
          if (Math.abs(err) > 0.04 && Math.abs(err) < 0.3) nt += Math.max(-0.12 * step, Math.min(0.12 * step, err * 0.03));
        }
      }
      c.t = Math.max(c.t, nt);
      if (c.t >= tl.duration) {
        if (hasVideo || tl.items.some((x) => x.clip.kind === "image" || (x.clip.kind === "video" && x.clip.sourceId))) {
          c.t = tl.duration;
          playingRef.current = false;
          setPlaying(false);
          musicRef.current?.pause();
        } else c.t = 0; // sample captions loop
      }
    }
    syncPlayers(Math.min(c.t, Math.max(0, tl.duration - 1e-6)), playingRef.current, now);

    syncSounds(c.t, playingRef.current);

    // volumes (HTML media volume is 0..1)
    const { audio, words, musicDuration } = inputs.current;
    const a = audio ?? DEFAULT_AUDIO;
    const g = sourceGainAt(Math.min(c.t, Math.max(0, tl.duration - 0.001)), tl, a);
    const vol = Math.max(0, Math.min(1, g));
    for (const el of allEls()) if (Math.abs(el.volume - vol) > 0.01) el.volume = vol;
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
  }, [syncPlayers, playerFor, mediaNow, allEls, musicRef, syncSounds]);

  return { playing, setPlaying, rate, setRate, getTime, seek, play, pause, toggle, tick, setInputs, cueVideo, frameFor };
}

export type PlaybackApi = ReturnType<typeof usePlayback>;
