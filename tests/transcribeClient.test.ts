import { describe, expect, it, vi } from "vitest";
import { TranscribeError, planPieces, runTranscription, type SourceAudio } from "@/lib/transcribeClient";
import type { Word } from "@/lib/types";

const blobOf = (bytes: number) => new Blob([new Uint8Array(bytes)]);
const src = (minutes: number, bytesPerSec = 6000): SourceAudio => ({
  blob: blobOf(Math.round(minutes * 60 * bytesPerSec)),
  name: "audio.ogg",
  duration: minutes * 60,
  bytesPerSec,
  waveform: null,
});

/** Fake Scribe: one word every 2 s of the piece. */
function fakeSend(durationOf: (b: Blob) => number) {
  return vi.fn(async (b: Blob) => {
    const d = durationOf(b);
    const words: Word[] = [];
    for (let t = 0.2; t < d; t += 2) words.push({ id: `w${t}`, text: `w`, start: t, end: t + 0.5 });
    return { words, language: "gu" };
  });
}

describe("planPieces", () => {
  it("uploads short audio in one go", () => {
    expect(planPieces(src(5))).toBeNull();
  });
  it("splits audio larger than the upload limit", () => {
    const p = planPieces(src(30));
    expect(p!.length).toBeGreaterThanOrEqual(3);
  });
  it("uses shorter pieces for bulky WAV audio", () => {
    const p = planPieces(src(10, 32000))!;
    for (const r of p) expect((r.end - r.start) * 32000).toBeLessThan(4_000_000 * 1.05);
  });
});

describe("runTranscription", () => {
  const sleep = async () => {};

  it("merges pieces onto the original timeline in order", async () => {
    const s = src(25);
    const pieceLen = new Map<Blob, number>();
    const cut = vi.fn(async (a: number, b: number) => {
      const blob = blobOf(Math.round((b - a) * 6000));
      pieceLen.set(blob, b - a);
      return { blob, name: "p.ogg", offset: a };
    });
    const send = fakeSend((b) => pieceLen.get(b) ?? 0);
    const r = await runTranscription(s, "k", { send, cut, sleep });
    expect(r.parts).toBeGreaterThan(1);
    for (let i = 1; i < r.words.length; i++) expect(r.words[i].start).toBeGreaterThanOrEqual(r.words[i - 1].start);
    expect(r.words[r.words.length - 1].start).toBeGreaterThan(24 * 60);
    expect(new Set(r.words.map((w) => w.id)).size).toBe(r.words.length);
  });

  it("retries temporary failures, then succeeds", async () => {
    let calls = 0;
    const send = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new TranscribeError("busy", 503);
      return { words: [{ id: "a", text: "હા", start: 0, end: 0.4 }] };
    });
    const r = await runTranscription(src(2), "k", { send, cut: vi.fn(), sleep });
    expect(calls).toBe(3);
    expect(r.words).toHaveLength(1);
  });

  it("does not retry a refused API key", async () => {
    const send = vi.fn(async () => { throw new TranscribeError("bad key", 401); });
    await expect(runTranscription(src(2), "k", { send, cut: vi.fn(), sleep })).rejects.toMatchObject({ status: 401 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps the status of other errors (all keys used up isn't a network problem)", async () => {
    const send = vi.fn(async () => { throw Object.assign(new Error("All 2 ElevenLabs keys were tried"), { status: 402 }); });
    await expect(runTranscription(src(2), "k", { send, cut: vi.fn(), sleep })).rejects.toMatchObject({ status: 402 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("switches keys between pieces of a long video and keeps finished pieces", async () => {
    const { createKeyPool } = await import("@/lib/keyPool");
    const s = src(25);
    const cut = vi.fn(async (a: number, b: number) => ({ blob: blobOf(Math.round((b - a) * 6000)), name: "p.ogg", offset: a }));
    const used: string[] = [];
    let aLeft = 1; // key "a" has credit for one piece
    const pool = createKeyPool(["a", "b"]);
    const send = (blob: Blob) => pool.run(async (k) => {
      used.push(k);
      if (k === "a" && aLeft-- <= 0) throw new TranscribeError("out of credits", 402, "quota_exceeded");
      return { words: [{ id: "w", text: "w", start: 0.2, end: 0.6 }] };
    });
    const r = await runTranscription(s, "k", { send, cut, sleep });
    expect(r.parts).toBeGreaterThan(2);
    expect(used.slice(0, 3)).toEqual(["a", "a", "b"]);
    expect(used.slice(3).every((k) => k === "b")).toBe(true);
  });

  it("resumes from cached pieces without paying for them again", async () => {
    const store = new Map<string, Word[]>();
    const cacheGet = async (k: string) => store.get(k) ?? null;
    const cacheSet = async (k: string, w: Word[]) => { store.set(k, w); };
    const cut = async (a: number, b: number) => ({ blob: blobOf(Math.round((b - a) * 6000)), name: "p", offset: a });
    let n = 0;
    const failing = vi.fn(async () => {
      n++;
      if (n === 2) throw new TranscribeError("bad request", 400); // second piece fails for good
      return { words: [{ id: "x", text: "ok", start: 1, end: 1.5 }] };
    });
    await expect(runTranscription(src(25), "run", { send: failing, cut, cacheGet, cacheSet, sleep })).rejects.toBeTruthy();
    expect(store.size).toBe(1);

    const ok = vi.fn(async () => ({ words: [{ id: "y", text: "ok", start: 1, end: 1.5 }] }));
    const r = await runTranscription(src(25), "run", { send: ok, cut, cacheGet, cacheSet, sleep });
    expect(r.reused).toBe(1);
    expect(ok).toHaveBeenCalledTimes(r.parts - 1);
  });
});
