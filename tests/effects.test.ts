import { describe, expect, it } from "vitest";
import { fxStateAt, NO_FX, type FxClip } from "@/lib/effects/fx";
import { beatsOnTimeline, detectBeats } from "@/lib/effects/beats";
import { applyAction, beatSync, keywordSync, requirements, setTransitions, type Env } from "@/lib/effects/apply";
import { CATEGORIES, CORE_PACK, itemsIn, validatePack } from "@/lib/effects/packs";
import type { Clip, ProjectDoc } from "@/lib/project";
import { templateById } from "@/lib/templates";
import { DEFAULT_FRAME } from "@/lib/frame";

const fx = (type: FxClip["type"], start: number, end: number, intensity = 1): FxClip => ({ id: type, type, start, end, intensity });

describe("effect maths", () => {
  it("is neutral without effects", () => {
    expect(fxStateAt([], 1)).toBe(NO_FX);
    expect(fxStateAt([fx("zoom-punch", 5, 6)], 1).scale).toBe(1);
  });
  it("zoom punch peaks early and settles", () => {
    const peak = fxStateAt([fx("zoom-punch", 0, 1)], 0.18).scale;
    expect(peak).toBeGreaterThan(1.15);
    expect(fxStateAt([fx("zoom-punch", 0, 1)], 0.95).scale).toBeLessThan(1.02);
  });
  it("shake is deterministic per frame (preview = export)", () => {
    const a = fxStateAt([fx("shake", 0, 1)], 0.5, 15);
    const b = fxStateAt([fx("shake", 0, 1)], 0.5, 15);
    expect(a.dx).toBe(b.dx);
    expect(a.dx).not.toBe(0);
  });
  it("combines grades into one filter and adds overlays", () => {
    const s = fxStateAt([fx("grade-mono", 0, 10), fx("bars", 0, 10), fx("flash", 4.9, 5.2)], 5);
    expect(s.filter).toMatch(/grayscale/);
    expect(s.bars).toBeGreaterThan(0.9);
    expect(s.flash?.alpha).toBeGreaterThan(0);
  });
});

describe("beat detection", () => {
  it("finds 120 BPM in a click track", () => {
    const sr = 22050;
    const secs = 12;
    const x = new Float32Array(sr * secs);
    for (let b = 0.25; b < secs; b += 0.5) {
      const i0 = Math.round(b * sr);
      for (let j = 0; j < 400; j++) x[i0 + j] += Math.sin(j * 0.3) * Math.exp(-j / 80);
    }
    const r = detectBeats(x, sr);
    expect(Math.abs(r.bpm - 120)).toBeLessThan(3);
    expect(r.beats.length).toBeGreaterThan(18);
    const near = r.beats.filter((t) => Math.abs(((t - 0.25) / 0.5) - Math.round((t - 0.25) / 0.5)) * 0.5 < 0.05);
    expect(near.length / r.beats.length).toBeGreaterThan(0.85);
  });
  it("places looped beats on the timeline", () => {
    expect(beatsOnTimeline([0, 1], 2, 2, 7, true)).toEqual([2, 3, 4, 5, 6]);
    expect(beatsOnTimeline([0, 1], 2, 2, 7, false)).toEqual([2, 3]);
  });
});

const baseDoc = (): ProjectDoc => ({ words: [], style: templateById("spotlight"), offset: 0, overrides: {}, frame: DEFAULT_FRAME, trim: { start: 0, end: null } });
const clips: Clip[] = [{ id: "a", kind: "video", srcStart: 0, srcEnd: 5 }, { id: "b", kind: "video", srcStart: 6, srcEnd: 10 }, { id: "c", kind: "video", srcStart: 12, srcEnd: 15 }];
const snd = { assetId: "s1", name: "Whoosh", duration: 0.6 };
const env = (p: Partial<Env> = {}): Env => ({ time: 1, duration: 12, clips, beats: [0, 0.5, 1, 1.5, 2, 2.5], keywords: [1, 1.2, 3], sounds: { whoosh: snd, pop: snd }, music: {}, ...p });

describe("one-click actions", () => {
  it("beat sync places every Nth beat and replaces itself", () => {
    let d = beatSync(baseDoc(), [0, 0.5, 1, 1.5, 2], { fx: "zoom-punch", every: 2 });
    expect(d.effects!.map((f) => f.start)).toEqual([0, 1, 2]);
    d = beatSync(d, [0, 0.5, 1, 1.5, 2], { fx: "zoom-punch", every: 1 });
    expect(d.effects).toHaveLength(5);
  });
  it("keyword sync spaces effects and adds sounds", () => {
    const d = keywordSync(baseDoc(), [1, 1.2, 3], { fx: "zoom-punch", sfx: snd });
    expect(d.effects!.map((f) => f.start)).toEqual([1, 3]);
    expect(d.sounds).toHaveLength(2);
  });
  it("transitions go on every cut, with a sound before each", () => {
    const r = setTransitions(baseDoc(), clips, "whip", 0.4, null, snd);
    expect(r.count).toBe(2);
    expect(r.doc.clips![0].transition).toBeUndefined();
    expect(r.doc.clips![1].transition).toEqual({ kind: "whip", duration: 0.4 });
    expect(r.doc.sounds!.map((s) => s.start)).toEqual([4.8, 8.8]);
    expect(setTransitions(baseDoc(), clips, "fade", 0.5, "c").count).toBe(1);
  });
  it("changing one cut keeps the other cuts' transition sounds", () => {
    const all = setTransitions(baseDoc(), clips, "whip", 0.4, null, snd).doc;
    const one = setTransitions(all, all.clips!, "zoom", 0.5, "c", snd).doc;
    expect(one.clips![1].transition).toEqual({ kind: "whip", duration: 0.4 });
    expect(one.clips![2].transition).toEqual({ kind: "zoom", duration: 0.5 });
    expect(one.sounds!.map((s) => s.start).sort((a, b) => a - b)).toEqual([4.8, 8.75]);
    const cut = setTransitions(one, one.clips!, "none", 0, "b").doc;
    expect(cut.clips![1].transition).toBeUndefined();
    expect(cut.sounds!.map((s) => s.start)).toEqual([8.75]);
  });
  it("a preset uses beats from its own music step", () => {
    const e = env({ beats: [], music: { edm: { assetId: "m1", name: "EDM", beats: [0, 0.5, 1, 1.5], bpm: 120, duration: 2 } } });
    const r = applyAction(baseDoc(), { type: "preset", steps: [{ type: "music", style: "edm" }, { type: "beat-sync", fx: "flash", every: 4 }] }, e);
    expect(r.doc.audio?.music?.assetId).toBe("m1");
    expect(r.doc.effects!.map((f) => f.start)).toEqual([0, 2, 4, 6, 8, 10]);
  });
  it("explains what's missing instead of failing", () => {
    const r = applyAction(baseDoc(), { type: "beat-sync", fx: "flash", every: 1 }, env({ beats: [] }));
    expect(r.notes[0]).toMatch(/music/i);
    const t = applyAction(baseDoc(), { type: "transition", kind: "fade", duration: 1 }, env({ clips: [clips[0]] }));
    expect(t.notes[0]).toMatch(/Split/);
  });
  it("whole-video looks replace themselves", () => {
    let d = applyAction(baseDoc(), { type: "fx", fx: "grade-warm", whole: true }, env()).doc;
    d = applyAction(d, { type: "fx", fx: "grade-warm", whole: true, intensity: 0.3 }, env()).doc;
    expect(d.effects).toHaveLength(1);
    expect(d.effects![0]).toMatchObject({ start: 0, end: 12, intensity: 0.3 });
  });
  it("collects what needs generating", () => {
    const r = requirements({ type: "preset", steps: [{ type: "music", style: "lofi" }, { type: "transition", kind: "whip", duration: 0.3, sfx: "swish" }, { type: "beat-sync", fx: "flash", every: 2 }] });
    expect([...r.music]).toEqual(["lofi"]);
    expect([...r.sfx]).toEqual(["swish"]);
    expect(r.beats).toBe(true);
  });
});

describe("packs", () => {
  it("fills every category", () => {
    for (const c of CATEGORIES) expect(itemsIn(c.id).length).toBeGreaterThan(3);
    expect(new Set(CORE_PACK.items.map((i) => i.id)).size).toBe(CORE_PACK.items.length);
  });
  it("validates imported packs", () => {
    expect(() => validatePack({ id: "x" })).toThrow();
    expect(() => validatePack({ id: "p", name: "P", items: [{ id: "i", name: "I", categories: ["reels"], action: { type: "rm -rf" } }] })).toThrow();
    const ok = validatePack({ id: "p", name: "P", items: [{ id: "i", name: "I", categories: ["reels"], action: { type: "fx", fx: "flash" } }] });
    expect(ok.version).toBe("1");
  });
});
