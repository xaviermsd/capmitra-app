/**
 * Applying effect-pack actions to a project, as pure document transforms
 * (one undo step per click, unit-tested). Anything that needs the browser
 * (generating sounds/music, analysing beats) is prepared first and passed in
 * through `Env`.
 */
import { buildTimeline } from "../edl";
import { uid, type Clip, type Music, type ProjectDoc, type SoundClip, type TransitionKind } from "../project";
import { FX, fxMeta, type FxClip, type FxType } from "./fx";
import type { EffectAction } from "./packs";
import type { CaptionStyle } from "../types";

export interface PreparedSound { assetId: string; name: string; duration: number }

export interface Env {
  /** Playhead (output seconds). */
  time: number;
  /** Output duration. */
  duration: number;
  /** Current clips (effective). */
  clips: Clip[];
  /** Selected clip, if any (transitions go there). */
  selectedClipId?: string | null;
  /** Beat times on the output timeline (from the music after any music step). */
  beats: number[];
  /** Start times (output) of highlighted words, for keyword sync. */
  keywords: number[];
  /** Sounds already generated, by SFX id. */
  sounds: Record<string, PreparedSound>;
  /** Music prepared for "music" actions, by style id. */
  music: Record<string, Omit<Music, "start" | "fadeIn" | "fadeOut" | "loop" | "duck" | "volume"> & { duration: number }>;
}

/** What an action needs prepared (sounds/music to generate, beats to analyse). */
export function requirements(a: EffectAction, out: { sfx: Set<string>; music: Set<string>; beats: boolean; keywords: boolean } = { sfx: new Set(), music: new Set(), beats: false, keywords: false }) {
  switch (a.type) {
    case "fx": if (a.sfx) out.sfx.add(a.sfx); break;
    case "transition": if (a.sfx) out.sfx.add(a.sfx); break;
    case "sfx": out.sfx.add(a.sfx); break;
    case "music": out.music.add(a.style); break;
    case "beat-sync": out.beats = true; if (a.sfx) out.sfx.add(a.sfx); break;
    case "keyword-sync": out.keywords = true; if (a.sfx) out.sfx.add(a.sfx); break;
    case "preset": a.steps.forEach((s) => requirements(s, out)); break;
  }
  return out;
}

const r3 = (x: number) => +x.toFixed(3);

function sound(env: Env, id: string, at: number, group?: string, volume = 0.9): SoundClip | null {
  const s = env.sounds[id];
  if (!s) return null;
  return { id: uid("snd"), assetId: s.assetId, name: s.name, start: r3(Math.max(0, at)), duration: s.duration, volume, group };
}

export function addFx(doc: ProjectDoc, type: FxType, start: number, end: number, intensity: number, group?: string): ProjectDoc {
  const f: FxClip = { id: uid("fx"), type, start: r3(Math.max(0, start)), end: r3(Math.max(start + 0.05, end)), intensity, group };
  return { ...doc, effects: [...(doc.effects ?? []), f] };
}

/** Effects on every `every`-th beat, replacing earlier beat-sync effects of the same type. */
export function beatSync(doc: ProjectDoc, beats: number[], o: { fx: FxType; every: number; intensity?: number; alternate?: FxType; sfx?: PreparedSound | null }): ProjectDoc {
  const group = `beat:${o.fx}${o.alternate ? `+${o.alternate}` : ""}`;
  const len = fxMeta(o.fx).length;
  const keep = (doc.effects ?? []).filter((f) => f.group !== group);
  const keepSounds = (doc.sounds ?? []).filter((s) => s.group !== group);
  const every = Math.max(1, Math.round(o.every));
  const picked = beats.filter((_, i) => i % every === 0);
  const fx: FxClip[] = picked.map((b, i) => {
    const type = o.alternate && i % 2 === 1 ? o.alternate : o.fx;
    const l = fxMeta(type).length;
    return { id: uid("fx"), type, start: r3(b), end: r3(b + Math.min(l, len * 1.5)), intensity: o.intensity ?? 0.7, group };
  });
  const sounds: SoundClip[] = o.sfx ? picked.map((b) => ({ id: uid("snd"), assetId: o.sfx!.assetId, name: o.sfx!.name, start: r3(b), duration: o.sfx!.duration, volume: 0.7, group })) : [];
  return { ...doc, effects: [...keep, ...fx], sounds: [...keepSounds, ...sounds] };
}

/** Effect (and sound) on each keyword, replacing an earlier keyword sync. */
export function keywordSync(doc: ProjectDoc, times: number[], o: { fx: FxType; intensity?: number; sfx?: PreparedSound | null }): ProjectDoc {
  const group = "keywords";
  const len = fxMeta(o.fx).length;
  const keep = (doc.effects ?? []).filter((f) => f.group !== group);
  const keepSounds = (doc.sounds ?? []).filter((s) => s.group !== group);
  // at most one every 0.6 s
  const ts: number[] = [];
  for (const t of times.slice().sort((a, b) => a - b)) if (!ts.length || t - ts[ts.length - 1] >= 0.6) ts.push(t);
  return {
    ...doc,
    effects: [...keep, ...ts.map((t) => ({ id: uid("fx"), type: o.fx, start: r3(t), end: r3(t + len), intensity: o.intensity ?? 0.8, group }))],
    sounds: [...keepSounds, ...(o.sfx ? ts.map((t) => ({ id: uid("snd"), assetId: o.sfx!.assetId, name: o.sfx!.name, start: r3(Math.max(0, t - 0.03)), duration: o.sfx!.duration, volume: 0.8, group })) : [])],
  };
}

/** Transition on the selected cut, or on every cut. Optional sound at each cut. */
export function setTransitions(doc: ProjectDoc, clips: Clip[], kind: TransitionKind, duration: number, selected: string | null | undefined, sfx?: PreparedSound | null): { doc: ProjectDoc; count: number } {
  const targets = new Set<string>();
  if (selected && clips.some((c) => c.id === selected)) targets.add(selected);
  else clips.forEach((c, i) => { if (i > 0) targets.add(c.id); });
  const next = clips.map((c) => (targets.has(c.id) ? { ...c, transition: kind === "none" ? undefined : { kind, duration } } : c));
  const tl = buildTimeline(next);
  const group = "transitions";
  // replace transition sounds only at the cuts being changed (other cuts keep theirs)
  const cutTimes = tl.items.filter((it) => it.index > 0 && targets.has(it.clip.id)).map((it) => it.outStart);
  const atTarget = (t: number) => cutTimes.some((c) => t >= c - 1 && t <= c + 0.5);
  let sounds = (doc.sounds ?? []).filter((s) => s.group !== group || !atTarget(s.start));
  if (sfx && kind !== "none") {
    for (const it of tl.items) {
      if (!targets.has(it.clip.id) || it.index === 0) continue;
      sounds = [...sounds, { id: uid("snd"), assetId: sfx.assetId, name: sfx.name, start: r3(Math.max(0, it.outStart - Math.min(0.25, duration / 2))), duration: sfx.duration, volume: 0.8, group }];
    }
  }
  return { doc: { ...doc, clips: next, sounds }, count: targets.size };
}

export interface ApplyResult { doc: ProjectDoc; notes: string[] }

/** Apply one action (presets run their steps in order). */
export function applyAction(doc: ProjectDoc, a: EffectAction, env: Env): ApplyResult {
  const notes: string[] = [];
  const run = (d: ProjectDoc, act: EffectAction, e: Env): ProjectDoc => {
    switch (act.type) {
      case "fx": {
        const meta = FX.find((f) => f.type === act.fx);
        if (!meta) return d;
        const whole = act.whole;
        const start = whole ? 0 : e.time;
        const end = whole ? Math.max(e.duration, 0.1) : Math.min(e.duration || Infinity, e.time + (act.length ?? meta.length));
        let out = addFx(d, act.fx, start, end, act.intensity ?? 0.8, whole ? `whole:${act.fx}` : undefined);
        if (whole) out = { ...out, effects: (out.effects ?? []).filter((f, i, arr) => f.group !== `whole:${act.fx}` || i === arr.length - 1) };
        const snd = act.sfx ? sound(e, act.sfx, e.time) : null;
        if (snd && !whole) out = { ...out, sounds: [...(out.sounds ?? []), snd] };
        return out;
      }
      case "sfx": {
        const snd = sound(e, act.sfx, e.time);
        return snd ? { ...d, sounds: [...(d.sounds ?? []), snd] } : d;
      }
      case "music": {
        const m = e.music[act.style];
        if (!m) return d;
        const music: Music = { assetId: m.assetId, name: m.name, beats: m.beats, bpm: m.bpm, volume: act.volume ?? 0.35, start: 0, fadeIn: 0.5, fadeOut: 2, loop: true, duck: 0.6 };
        const audio = { volume: 1, fadeIn: 0, fadeOut: 0, ...(d.audio ?? {}), music };
        // beats for later steps of a preset
        const beats: number[] = [];
        if (m.beats?.length && m.duration > 0) for (let r = 0; r * m.duration < e.duration; r++) for (const b of m.beats) { const t = r * m.duration + b; if (t < e.duration) beats.push(r3(t)); }
        e.beats = beats;
        return { ...d, audio };
      }
      case "text": {
        const st = act.style as Partial<CaptionStyle>;
        return { ...d, style: { ...d.style, ...st, active: st.active ? { ...d.style.active, ...st.active } : d.style.active } };
      }
      case "transition": {
        const clips = d.clips?.length ? d.clips : e.clips;
        if (clips.length < 2) { notes.push("Split the video into clips first (S on the timeline) to add transitions between them."); return d; }
        const r = setTransitions(d, clips, act.kind, act.duration, e.selectedClipId, act.sfx ? e.sounds[act.sfx] : null);
        notes.push(r.count === 1 ? "Transition set on the selected cut." : `Transition set on ${r.count} cuts.`);
        return r.doc;
      }
      case "beat-sync": {
        if (!e.beats.length) { notes.push("Add music first (Music tab) so effects can follow its beats."); return d; }
        return beatSync(d, e.beats, { fx: act.fx, every: act.every, intensity: act.intensity, alternate: act.alternate, sfx: act.sfx ? e.sounds[act.sfx] : null });
      }
      case "keyword-sync": {
        if (!e.keywords.length) { notes.push("No highlighted words yet: use Captions → Highlight keywords, or star (★) words."); return d; }
        return keywordSync(d, e.keywords, { fx: act.fx, intensity: act.intensity, sfx: act.sfx ? e.sounds[act.sfx] : null });
      }
      case "preset":
        return act.steps.reduce((acc, step) => run(acc, step, e), d);
    }
  };
  const envCopy = { ...env };
  return { doc: run(doc, a, envCopy), notes };
}
