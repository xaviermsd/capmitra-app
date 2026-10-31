"use client";
/**
 * Edit the video by editing its transcript: strike out words, sentences and
 * pauses, review suggested cuts (long pauses, filler words), then apply them
 * all as one undoable step. Cuts go through lib/textEdit.ts, which keeps
 * captions, graphics, effects and sounds in sync with the picture.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "../EditorContext";
import { Section, Select } from "@/components/Controls";
import { EmptyState } from "@/components/ui";
import { IconScissors, IconX } from "@/components/Icons";
import { applyCuts, cutSeconds, cutsFromWords, findFillers, findPauses, PAUSE_KEEP, type Cut } from "@/lib/textEdit";
import type { Word } from "@/lib/types";

const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${Math.round(s % 60).toString().padStart(2, "0")} min` : `${s.toFixed(1)} s`);
const SHOW_PAUSE = 0.4;

export function TranscriptPanel() {
  const ed = useEditor();
  const { outWords: words, project, toast, playback } = ed;
  const [cutWords, setCutWords] = useState<Set<number>>(new Set());
  const [cutPauses, setCutPauses] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<"remove" | "jump">("remove");
  const [range, setRange] = useState(false);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [minPause, setMinPause] = useState(0.6);

  // the transcript changed (cuts applied, words edited): start fresh
  const sig = useMemo(() => words.map((w) => `${w.id}:${w.start.toFixed(2)}`).join("|"), [words]);
  useEffect(() => { setCutWords(new Set()); setCutPauses(new Set()); setAnchor(null); }, [sig]);

  const pauseCut = (i: number): Cut | null => {
    const a = words[i], b = words[i + 1];
    if (!a || !b || b.start - a.end < SHOW_PAUSE) return null;
    return { id: `p${i}`, kind: "pause", from: a.end + PAUSE_KEEP, to: b.start - PAUSE_KEEP, label: `${(b.start - a.end).toFixed(1)} s pause` };
  };
  const cuts = useMemo(() => [
    ...cutsFromWords(words, [...cutWords]),
    ...[...cutPauses].map(pauseCut).filter((c): c is Cut => !!c),
  ], [words, cutWords, cutPauses]); // eslint-disable-line react-hooks/exhaustive-deps
  const saved = cutSeconds(cuts);

  const toggleWord = (i: number) => {
    if (mode === "jump") { playback.seek(words[i].start); return; }
    if (range) {
      if (anchor === null) { setAnchor(i); return; }
      const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
      setCutWords((s) => { const n = new Set(s); for (let k = a; k <= b; k++) n.add(k); return n; });
      setAnchor(null);
      return;
    }
    setCutWords((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  };
  const togglePause = (i: number) => setCutPauses((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const suggestPauses = () => {
    const found = findPauses(words, minPause);
    setCutPauses((s) => new Set([...s, ...found.map((c) => Number(c.id.slice(1)))]));
    toast({ kind: found.length ? "info" : "success", title: found.length ? `${found.length} long pauses marked` : "No long pauses", message: found.length ? "Review them in the transcript, then Apply." : undefined, duration: 2500 });
  };
  const suggestFillers = () => {
    const found = findFillers(words);
    setCutWords((s) => new Set([...s, ...found.flatMap((c) => c.words ?? [])]));
    toast({ kind: found.length ? "info" : "success", title: found.length ? `${found.length} filler words marked` : "No filler words found", message: found.length ? found.slice(0, 6).map((c) => c.label).join(", ") : undefined, duration: 3000 });
  };

  const apply = () => {
    if (!cuts.length) return;
    playback.pause();
    project.update((d) => ({ ...d, ...applyCuts(d, ed.clips, cuts, () => ed.uid("c")) }));
    toast({ kind: "success", title: `Removed ${fmt(saved)}`, message: `${cuts.length} cut${cuts.length === 1 ? "" : "s"}. Captions, graphics and sounds moved with the video.`, action: { label: "Undo", onClick: () => ed.undo() }, duration: 6000 });
  };

  if (!words.length) {
    return <EmptyState art="video" title="No transcript yet">Caption your video first (Captions → Auto caption). Then you can cut it by deleting words here.</EmptyState>;
  }

  return (
    <>
      <Section title="Cut by deleting words">
        <p className="muted">Strike out words, sentences or pauses and the video is cut to match. Nothing changes until you press Apply.</p>
        <div className="tx-tools">
          <div className="seg" role="group" aria-label="Tapping a word">
            <button className={mode === "remove" ? "on" : ""} aria-pressed={mode === "remove"} onClick={() => setMode("remove")}>Tap to remove</button>
            <button className={mode === "jump" ? "on" : ""} aria-pressed={mode === "jump"} onClick={() => setMode("jump")}>Tap to jump</button>
          </div>
          {mode === "remove" ? (
            <button className={`btn small ${range ? "on" : ""}`} aria-pressed={range} onClick={() => { setRange((r) => !r); setAnchor(null); }}>
              {range ? (anchor === null ? "Range: tap the first word" : "Range: tap the last word") : "Select a range"}
            </button>
          ) : null}
        </div>
      </Section>

      <Section title="Suggestions">
        <div className="tx-suggest">
          <Select label="Pauses longer than" value={minPause} options={[0.4, 0.6, 0.8, 1, 1.5].map((v) => ({ value: v, label: `${v} s` }))} onChange={setMinPause} />
          <div className="row-btns wrap">
            <button className="btn small" onClick={suggestPauses}>Find long pauses</button>
            <button className="btn small" onClick={suggestFillers}>Find filler words</button>
          </div>
        </div>
        <p className="muted">Suggestions are only marked. Tap any of them to keep it.</p>
      </Section>

      <Section title={`Transcript (${words.length} words)`}>
        <TranscriptWords words={words} cutWords={cutWords} cutPauses={cutPauses} anchor={anchor} onWord={toggleWord} onPause={togglePause} />
      </Section>

      <div className={`tx-bar ${cuts.length ? "on" : ""}`}>
        <span><b>{cuts.length} cut{cuts.length === 1 ? "" : "s"}</b>{cuts.length ? ` · saves ${fmt(saved)}` : " · nothing marked"}</span>
        <button className="btn small ghost" disabled={!cuts.length} onClick={() => { setCutWords(new Set()); setCutPauses(new Set()); }}><IconX size={14} /> Clear</button>
        <button className="btn primary" disabled={!cuts.length} onClick={apply}><IconScissors size={15} /> Apply</button>
      </div>
    </>
  );
}

/** The words themselves; the word being spoken is highlighted without re-rendering the list. */
const TranscriptWords = memo(function TranscriptWords({ words, cutWords, cutPauses, anchor, onWord, onPause }: {
  words: Word[]; cutWords: Set<number>; cutPauses: Set<number>; anchor: number | null; onWord: (i: number) => void; onPause: (i: number) => void;
}) {
  const ed = useEditor();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let last = -1;
    return ed.timeStore.subscribe(() => {
      const t = ed.timeStore.get();
      let i = -1;
      for (let k = 0; k < words.length; k++) { if (words[k].start <= t && t < Math.max(words[k].end, (words[k + 1]?.start ?? words[k].end))) { i = k; break; } }
      if (i === last || !box.current) return;
      box.current.querySelector(".tx-w.now")?.classList.remove("now");
      if (i >= 0) box.current.querySelector(`[data-i="${i}"]`)?.classList.add("now");
      last = i;
    });
  }, [ed.timeStore, words]);
  return (
    <div className="tx" ref={box}>
      {words.map((w, i) => {
        const gap = (words[i + 1]?.start ?? w.end) - w.end;
        return (
          <span key={`${w.id}-${i}`} className="tx-item">
            <button data-i={i} className={`tx-w ${cutWords.has(i) ? "cut" : ""} ${anchor === i ? "anchor" : ""} ${w.lineBreak ? "br" : ""}`} onClick={() => onWord(i)}>{w.text}</button>
            {gap >= SHOW_PAUSE ? (
              <button className={`tx-p ${cutPauses.has(i) ? "cut" : ""}`} onClick={() => onPause(i)} title="Tap to shorten this pause">{gap.toFixed(1)}s</button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
});
