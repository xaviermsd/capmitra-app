/**
 * Real overlap for transitions and gap-free cuts (pure, unit-tested in
 * tests/overlap.test.ts).
 *
 * Every source video has two players ("slots"). Neighbouring clips from the
 * same source always get different slots, so while one clip plays the next one
 * is already parked on its first frame, and during a transition both clips can
 * move at once:
 *
 *   outgoing clip after the cut:  srcEnd   + (t - cut) * speed   (its tail handle)
 *   incoming clip before the cut: srcStart - (cut - t) * speed   (its head handle)
 *
 * When a handle runs off the start or end of the source the player holds the
 * nearest real frame instead.
 */
import { speedOf, srcAt, type EditTimeline, type Placed } from "./edl";
import { transitionHalf } from "./transitions";
import type { VideoClip } from "./project";

/** Seconds before a cut window that the next clip's player is parked and decoded. */
export const PREROLL = 1.6;
/** Even a hard cut starts the next player this early (muted) so it is moving at the cut. */
export const LEAD = 0.1;
/** Keep handle reads this far inside the end of the source. */
const END_PAD = 0.04;

export type SlotRole = "main" | "out" | "in" | "pre";

export interface SlotNeed {
  /** Player key: `${source}:${slot}`. */
  key: string;
  index: number;
  role: SlotRole;
  /** Source time the player should show. */
  time: number;
  /** Whether the player should be running (false = parked on `time`). */
  play: boolean;
}

export const sourceKey = (c: VideoClip) => c.sourceId ?? "main";

/** Half-length of the transition into item i (0 when there is none). */
export function halfInto(tl: EditTimeline, i: number): number {
  const it = tl.items[i];
  const prev = tl.items[i - 1];
  const tr = it?.clip.transition;
  if (!it || !prev || !tr || tr.kind === "none" || tr.duration <= 0) return 0;
  return transitionHalf(tr.duration, prev.outEnd - prev.outStart, it.outEnd - it.outStart);
}

/**
 * Source time of the clip that is not "live" during a transition, unclamped.
 * `side` "in": the incoming clip before its cut; "out": the outgoing clip after it.
 */
export function handleTimeRaw(clip: VideoClip, side: "in" | "out", t: number, cut: number): number {
  const k = speedOf(clip);
  return side === "in" ? clip.srcStart - (cut - t) * k : clip.srcEnd + (t - cut) * k;
}

/** The same, kept inside the source (0..duration). */
export function handleTime(clip: VideoClip, side: "in" | "out", t: number, cut: number, srcDuration = Infinity): number {
  const raw = handleTimeRaw(clip, side, t, cut);
  const hi = Number.isFinite(srcDuration) ? Math.max(0, srcDuration - END_PAD) : Infinity;
  return Math.max(0, Math.min(hi, raw));
}

/**
 * Player slot for every item. A clip never shares a player with the clip right
 * before it from the same source, nor (when something else sits between them)
 * with the one before that, so a short clip in between never forces a seek at a cut.
 */
export function slotsFor(items: Placed[]): number[] {
  const out: number[] = [];
  items.forEach((it, i) => {
    if (it.clip.kind !== "video") { out.push(-1); return; }
    const key = sourceKey(it.clip);
    const same = (j: number) => { const p = items[j]; return !!p && p.clip.kind === "video" && sourceKey(p.clip) === key; };
    out.push(same(i - 1) ? 1 - out[i - 1] : same(i - 2) ? 1 - out[i - 2] : 0);
  });
  return out;
}

const PRIORITY: Record<SlotRole, number> = { main: 0, out: 1, in: 2, pre: 3 };

/**
 * What every player should be doing at output time t. At most one need per
 * player; the playing clip always wins, then a running transition, then parking.
 */
export function slotNeeds(tl: EditTimeline, t: number, playing: boolean, durationOf: (c: VideoClip) => number = () => Infinity, slots = slotsFor(tl.items)): SlotNeed[] {
  const items = tl.items;
  if (!items.length) return [];
  let i = items.findIndex((x) => t >= x.outStart && t < x.outEnd);
  if (i < 0) i = t < items[0].outStart ? 0 : items.length - 1;
  const needs: SlotNeed[] = [];
  const keyOf = (j: number) => {
    const c = items[j].clip as VideoClip;
    return `${sourceKey(c)}:${slots[j]}`;
  };

  const cur = items[i];
  if (cur.clip.kind === "video") {
    const c = cur.clip;
    needs.push({ key: keyOf(i), index: i, role: "main", time: Math.min(c.srcEnd, srcAt(c, t - cur.outStart)), play: playing });
  }

  // the clip after this one: parked well ahead, running through its head handle
  const nx = items[i + 1];
  if (nx && nx.clip.kind === "video") {
    const c = nx.clip;
    const cut = nx.outStart;
    const half = halfInto(tl, i + 1);
    const lead = Math.max(half, LEAD);
    if (t >= cut - lead) {
      const raw = handleTimeRaw(c, "in", t, cut);
      needs.push({ key: keyOf(i + 1), index: i + 1, role: "in", time: handleTime(c, "in", t, cut, durationOf(c)), play: playing && raw >= 0 });
    } else if (t >= cut - lead - PREROLL) {
      needs.push({ key: keyOf(i + 1), index: i + 1, role: "pre", time: handleTime(c, "in", cut - lead, cut, durationOf(c)), play: false });
    }
  }

  // the clip before this one, still running through its tail handle
  const pv = items[i - 1];
  if (pv && pv.clip.kind === "video") {
    const c = pv.clip;
    const cut = cur.outStart;
    const half = halfInto(tl, i);
    if (half > 0 && t < cut + half) {
      const d = durationOf(c);
      const raw = handleTimeRaw(c, "out", t, cut);
      needs.push({ key: keyOf(i - 1), index: i - 1, role: "out", time: handleTime(c, "out", t, cut, d), play: playing && raw < d - END_PAD });
    }
  }

  needs.sort((a, b) => PRIORITY[a.role] - PRIORITY[b.role]);
  const seen = new Set<string>();
  return needs.filter((n) => (seen.has(n.key) ? false : (seen.add(n.key), true)));
}
