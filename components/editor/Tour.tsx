"use client";
/**
 * First-run tour: five short steps pointing at the main areas of the editor.
 * Shown once (Settings → "Show the tour again" replays it). Steps whose target
 * isn't on screen (e.g. on a phone) are skipped.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { useEditor } from "./EditorContext";

const STEPS: { sel: string; title: string; body: string }[] = [
  { sel: ".ws-rail", title: "Your tools", body: "Templates, Text, Style, Captions and more. Each opens in the side panel." },
  { sel: ".aspect-bar", title: "Shape and guides", body: "Pick 9:16 for Reels and Shorts. The grid and safe-area buttons help you place captions." },
  { sel: ".stage", title: "Live preview", body: "What you see is exactly what exports. Click a caption to select it, drag to move it." },
  { sel: ".ws-timeline", title: "Timeline", body: "Click a word to edit it, press S to split, E to ★ a word. Space plays and pauses." },
  { sel: ".ws-top .btn.export", title: "Export", body: "Burn the captions into an MP4, or download SRT subtitles. All on your device." },
];

const visible = (el: Element | null): el is HTMLElement => !!el && (el as HTMLElement).getBoundingClientRect().width > 4 && getComputedStyle(el).visibility !== "hidden";

export function Tour() {
  const ed = useEditor();
  const { settings, setSettings } = ed;
  const active = typeof document !== "undefined" && !settings.tourDone && !ed.isEmpty && !ed.prepareFile && !ed.showProjects && !ed.exportView;
  const steps = active ? STEPS.filter((s) => visible(document.querySelector(s.sel))) : [];
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[Math.min(i, steps.length - 1)];

  useLayoutEffect(() => {
    if (!step) return;
    const place = () => { const el = document.querySelector(step.sel); setRect(el ? el.getBoundingClientRect() : null); };
    place();
    window.addEventListener("resize", place);
    const id = window.setInterval(place, 400); // panels resize and animate
    return () => { window.removeEventListener("resize", place); window.clearInterval(id); };
  }, [step]);

  useEffect(() => {
    if (!step) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setSettings({ tourDone: true }); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [step, setSettings]);

  if (!step || !rect) return null;
  const done = () => setSettings({ tourDone: true });
  const last = i >= steps.length - 1;
  const pad = 6;
  const cardW = Math.min(320, window.innerWidth - 24);
  const below = rect.bottom + 180 < window.innerHeight;
  const top = below ? rect.bottom + 12 : Math.max(12, rect.top - 12 - 170);
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - cardW / 2), window.innerWidth - cardW - 12);

  return (
    <div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      <div className="tour-ring" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div className="tour-card" style={{ left, top, width: cardW }}>
        <div className="tour-step">{i + 1} of {steps.length}</div>
        <h3 id="tour-title">{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button className="btn ghost small" onClick={done}>Skip tour</button>
          {i > 0 ? <button className="btn small" onClick={() => setI(i - 1)}>Back</button> : null}
          <button className="btn primary small" autoFocus onClick={() => (last ? done() : setI(i + 1))}>{last ? "Done" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
