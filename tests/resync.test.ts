import { describe, expect, it } from "vitest";
import { resyncWords } from "@/lib/resync";
import type { Word } from "@/lib/types";

const w = (id: string, text: string, start: number, end: number, extra: Partial<Word> = {}): Word => ({ id, text, start, end, ...extra });

describe("re-sync to audio", () => {
  it("moves edited words onto new timings and keeps the edits", () => {
    const edited = [w("a", "Toh", 0, 0.2), w("b", "aaj", 0.2, 0.4, { emphasis: true }), w("c", "sundar", 0.4, 0.8, { emoji: "✨" })];
    const fresh = [w("x", "toh", 1, 1.2), w("y", "aaj,", 1.25, 1.5), w("z", "Sundar", 1.6, 2)];
    const r = resyncWords(edited, fresh);
    expect(r.matched).toBe(3);
    expect(r.words.map((x) => [x.id, x.start, x.end])).toEqual([["a", 1, 1.2], ["b", 1.25, 1.5], ["c", 1.6, 2]]);
    expect(r.words[1].emphasis).toBe(true);
    expect(r.words[2].emoji).toBe("✨");
  });
  it("spreads corrected words between their matched neighbours", () => {
    const edited = [w("a", "hello", 0, 1), w("b", "CapMitra", 1, 2), w("c", "friends", 2, 3)];
    const fresh = [w("x", "hello", 5, 5.4), w("y", "cap", 5.5, 5.7), w("z", "mitra", 5.7, 6), w("q", "friends", 6.2, 6.6)];
    const r = resyncWords(edited, fresh);
    expect(r.matched).toBe(2);
    expect(r.words[1].start).toBeCloseTo(5.4);
    expect(r.words[1].end).toBeCloseTo(6.2);
  });
  it("keeps going after a missing word", () => {
    const edited = [w("a", "one", 0, 1), w("b", "two", 1, 2), w("c", "three", 2, 3), w("d", "four", 3, 4)];
    const fresh = [w("x", "one", 10, 10.5), w("y", "three", 11, 11.5), w("z", "four", 12, 12.5)];
    const r = resyncWords(edited, fresh);
    expect(r.matched).toBe(3);
    expect(r.words[3].start).toBe(12);
  });
});
