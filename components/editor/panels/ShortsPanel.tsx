"use client";
/**
 * Long video → shorts. Finds the strongest moments from the transcript and the
 * soundtrack (lib/shorts.ts), keeps the speaker in frame (lib/reframe.ts), and
 * exports through the normal export pipeline. Everything runs on the device.
 */
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../EditorContext";
import { Section, Select, Toggle } from "@/components/Controls";
import { EmptyState, ProgressIndicator } from "@/components/ui";
import { IconDownload, IconEdit, IconMinus, IconPause, IconPlay, IconPlus } from "@/components/Icons";
import { findHighlights, type Highlight } from "@/lib/shorts";
import { srcToOut } from "@/lib/edl";
import { ASPECTS, outputSize } from "@/lib/frame";
import { deriveProject } from "@/lib/derive";
import { makeMeasure } from "@/lib/measure";
import { uid, type ProjectDoc } from "@/lib/project";
import { saveProject, saveProjectVideo } from "@/lib/library";
import { blankRecord } from "../hooks/useProject";
import { renderExport } from "../hooks/useExport";
import type { AspectId } from "@/lib/types";

const LENGTHS = [
  { value: "15-30", label: "15 to 30 s", min: 15, max: 30 },
  { value: "30-60", label: "30 to 60 s", min: 30, max: 60 },
  { value: "45-90", label: "45 to 90 s", min: 45, max: 90 },
];
const FORMATS: AspectId[] = ["9:16", "1:1", "16:9"];
const t2 = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

interface Clip extends Highlight { panX?: number; panY?: number; framed?: boolean; checked: boolean; status?: string; progress?: number }

export function ShortsPanel() {
  const ed = useEditor();
  const { doc, file, toast, playback, settings } = ed;
  const [len, setLen] = useState("30-60");
  const [count, setCount] = useState(6);
  const [aspect, setAspect] = useState<AspectId>("9:16");
  const [reframe, setReframe] = useState(true);
  const [clips, setClips] = useState<Clip[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const stop = useRef(false);

  // stop the preview at the end of the clip
  useEffect(() => {
    if (!playing) return;
    const c = clips.find((x) => x.id === playing);
    if (!c) return;
    const end = srcToOut(ed.tl, c.end - 0.01) ?? Infinity;
    return ed.timeStore.subscribe(() => { if (ed.timeStore.get() >= end) { playback.pause(); setPlaying(null); } });
  }, [playing, clips, ed.tl, ed.timeStore, playback]);
  useEffect(() => { if (!playback.playing) setPlaying(null); }, [playback.playing]);

  const srcDur = ed.srcDuration || ed.videoDuration || 0;
  if (!doc.words.length || !file) {
    return <EmptyState art="video" title="Shorts from a long video">Open a long video and caption it first. Then CapMitra finds the best moments and turns them into Reels and Shorts.</EmptyState>;
  }

  const find = () => {
    const L = LENGTHS.find((x) => x.value === len)!;
    const found = findHighlights(doc.words, { offset: doc.offset, minLen: L.min, maxLen: L.max, count, peaks: ed.waveform?.peaks, rate: ed.waveform?.rate })
      .map((h) => ({ ...h, end: Math.min(h.end, srcDur || h.end), checked: true }));
    setClips(found);
    if (!found.length) toast({ kind: "info", title: "No clips that long", message: "Try a shorter length; the video may be too short for these settings." });
    else if (reframe && FORMATS.includes(aspect)) void frameAll(found);
  };

  const ratio = (a: AspectId) => ASPECTS.find((x) => x.id === a)?.ratio ?? 9 / 16;
  const frameAll = async (list: Clip[]) => {
    const { findFraming } = await import("@/lib/reframe");
    setBusy("Finding the speaker…");
    stop.current = false;
    try {
      for (let i = 0; i < list.length; i++) {
        if (stop.current) break;
        setBusy(`Finding the speaker… ${i + 1} of ${list.length}`);
        const f = await findFraming(file, list[i].start, list[i].end, ratio(aspect));
        setClips((cs) => cs.map((c) => (c.id === list[i].id ? { ...c, panX: f.panX, panY: f.panY, framed: f.faces > 0 } : c)));
      }
    } catch (e) {
      toast({ kind: "warning", title: "Couldn't track the speaker", message: `${(e as Error).message} The clips stay centred.` });
    } finally { setBusy(null); }
  };

  const upd = (id: string, p: Partial<Clip>) => setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const nudge = (c: Clip, edge: "start" | "end", d: number) => {
    const v = Math.max(0, Math.min(srcDur || Infinity, c[edge] + d));
    if (edge === "start" && v < c.end - 3) upd(c.id, { start: v });
    if (edge === "end" && v > c.start + 3) upd(c.id, { end: v });
  };
  const preview = (c: Clip) => {
    if (playing === c.id) { playback.pause(); setPlaying(null); return; }
    const t = srcToOut(ed.tl, c.start);
    if (t === null) return toast({ kind: "info", title: "That part is cut out of this edit", message: "Undo the cut to preview it, or open the clip as its own project." });
    playback.seek(t); playback.play(); setPlaying(c.id);
  };

  /** The short as a project: the same captions and look, one clip, its own framing. */
  const recordFor = (c: Clip, n: number) => {
    const rec = { ...blankRecord(), ...structuredClone(doc as ProjectDoc) };
    rec.name = `${ed.name} · Short ${n}`;
    rec.clips = [{ kind: "video", id: uid("c"), srcStart: c.start, srcEnd: c.end }];
    rec.frame = { ...doc.frame, aspect, fit: "crop", zoom: 1, panX: c.panX ?? 50, panY: c.panY ?? 50, platform: aspect === "9:16" ? "ig-reel" : aspect === "1:1" ? "square" : "youtube" };
    rec.layers = []; rec.effects = []; rec.sounds = []; rec.overrides = {};
    rec.videoName = file.name; rec.videoSize = file.size; rec.duration = srcDur;
    return rec;
  };

  const openAsProject = async (c: Clip, n: number) => {
    const rec = recordFor(c, n);
    await saveProject(rec);
    await saveProjectVideo(rec.id, file);
    await ed.openProject(rec.id);
  };

  const exportClips = async (list: Clip[]) => {
    if (!list.length) return;
    if (!window.isSecureContext) return toast({ kind: "error", title: "Export needs a secure address", message: "Open the app at http://localhost:3000 or your https:// link." });
    let dir: FileSystemDirectoryHandle | null = null;
    if (list.length > 1 && "showDirectoryPicker" in window) {
      try { dir = await (window as unknown as { showDirectoryPicker: (o: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: "readwrite" }); }
      catch (e) { if ((e as Error).name === "AbortError") return; }
    }
    playback.pause();
    stop.current = false;
    const media = await import("@/lib/media");
    setBusy(`Exporting ${list.length} short${list.length === 1 ? "" : "s"}…`);
    let done = 0;
    for (const c of list) {
      if (stop.current) break;
      const n = clips.indexOf(c) + 1;
      upd(c.id, { status: "Exporting…", progress: 0 });
      try {
        const rec = recordFor(c, n);
        const o = outputSize(1080, 1920, aspect, 0);
        const d = deriveProject(rec, srcDur, { measure: makeMeasure(rec.style), aspect: o.w / o.h });
        const name = `${ed.name}-short-${n}.mp4`;
        const writable = dir ? await (await dir.getFileHandle(name, { create: true })).createWritable() : null;
        const r = await renderExport(
          { file, doc: rec, clips: d.clips, lines: d.lines, outWords: d.outWords, watermark: ed.showWm ? { corner: settings.wmCorner } : null },
          { writable, onProgress: (p) => upd(c.id, { progress: p }) },
        );
        if (r.blob) media.downloadBlob(name, r.blob);
        upd(c.id, { status: "Exported", progress: undefined });
        done++;
      } catch (e) {
        upd(c.id, { status: `Export failed: ${(e as Error).message}`, progress: undefined });
      }
    }
    setBusy(null);
    toast({ kind: done ? "success" : "error", title: done ? `${done} short${done === 1 ? "" : "s"} exported` : "Nothing exported", message: dir ? "Saved to the folder you chose." : undefined });
  };

  const picked = clips.filter((c) => c.checked);

  return (
    <>
      <Section title="Find the best moments">
        <Select label="Length" value={len} options={LENGTHS.map(({ value, label }) => ({ value, label }))} onChange={setLen} />
        <Select label="How many" value={count} options={[3, 6, 10].map((v) => ({ value: v, label: `Up to ${v}` }))} onChange={setCount} />
        <Select label="Format" value={aspect} options={FORMATS.map((a) => ({ value: a, label: ASPECTS.find((x) => x.id === a)!.label }))} onChange={(v) => { setAspect(v); setClips((cs) => cs.map((c) => ({ ...c, panX: undefined, panY: undefined, framed: undefined }))); }} />
        <Toggle label="Keep the speaker in frame" value={reframe} onChange={setReframe} hint="tracks the face on this device" />
        <button className="btn primary wide shorts-go" disabled={!!busy} onClick={find}>{clips.length ? "Find again" : "Find shorts"}</button>
        <p className="muted">Picks complete sentences with a strong opening, questions, numbers and lively delivery. Check and trim each one before exporting.</p>
      </Section>

      {busy ? (
        <div className="shorts-busy"><ProgressIndicator label={busy} /><button className="btn small" onClick={() => { stop.current = true; }}>Stop</button></div>
      ) : null}

      {clips.length ? (
        <Section title={`${clips.length} suggested short${clips.length === 1 ? "" : "s"}`} right={reframe && !busy ? <button className="btn small" onClick={() => void frameAll(clips)}>Re-frame</button> : null}>
          <ul className="shorts">
            {clips.map((c, i) => (
              <li key={c.id} className={`short ${c.checked ? "on" : ""}`}>
                <div className="short-top">
                  <label className="short-pick"><input type="checkbox" checked={c.checked} onChange={(e) => upd(c.id, { checked: e.target.checked })} aria-label={`Include short ${i + 1}`} /></label>
                  <div className="short-title">
                    <b>{i + 1}. {c.title}…</b>
                    <em>{t2(c.start)} to {t2(c.end)} · {Math.round(c.end - c.start)} s · score {c.score}{c.framed ? " · speaker tracked" : c.framed === false ? " · no face found, centred" : ""}</em>
                    {c.reasons.length ? <span className="short-why">{c.reasons.join(" · ")}</span> : null}
                  </div>
                  <button className="btn icon short-play" onClick={() => preview(c)} aria-label={playing === c.id ? "Pause" : "Preview"}>{playing === c.id ? <IconPause size={16} /> : <IconPlay size={16} />}</button>
                </div>
                <div className="short-trim">
                  <span>Start</span>
                  <button className="btn icon small" onClick={() => nudge(c, "start", -1)} aria-label="Start 1 second earlier"><IconMinus size={14} /></button>
                  <button className="btn icon small" onClick={() => nudge(c, "start", 1)} aria-label="Start 1 second later"><IconPlus size={14} /></button>
                  <span>End</span>
                  <button className="btn icon small" onClick={() => nudge(c, "end", -1)} aria-label="End 1 second earlier"><IconMinus size={14} /></button>
                  <button className="btn icon small" onClick={() => nudge(c, "end", 1)} aria-label="End 1 second later"><IconPlus size={14} /></button>
                </div>
                {c.status ? (c.progress !== undefined ? <ProgressIndicator value={c.progress} label={c.status} /> : <p className="muted short-status">{c.status}</p>) : null}
                <div className="short-actions">
                  <button className="btn small" disabled={!!busy} onClick={() => void openAsProject(c, i + 1)}><IconEdit size={14} /> Edit as project</button>
                  <button className="btn small" disabled={!!busy} onClick={() => void exportClips([c])}><IconDownload size={14} /> Export</button>
                </div>
              </li>
            ))}
          </ul>
          <div className="tx-bar on">
            <span><b>{picked.length} selected</b> · {Math.round(picked.reduce((s, c) => s + c.end - c.start, 0))} s in total</span>
            <button className="btn primary" disabled={!picked.length || !!busy} onClick={() => void exportClips(picked)}><IconDownload size={15} /> Export {picked.length}</button>
          </div>
        </Section>
      ) : null}
    </>
  );
}
