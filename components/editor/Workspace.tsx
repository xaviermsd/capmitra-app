"use client";
/**
 * The editing workspace: top bar, tool rail, collapsible side panel, centre
 * preview with transport, and the multi-track timeline. Panels and timeline
 * are resizable; on phones the rail becomes a bottom bar and panels a sheet.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, useTime, type PanelId } from "./EditorContext";
import { Stage } from "./Stage";
import { ExportOverlay } from "./ExportOverlay";
import { PrepareMedia } from "./PrepareMedia";
import { Tour } from "./Tour";
import { MultiTrackTimeline } from "@/components/timeline/MultiTrackTimeline";
import { ProjectsView } from "@/components/ProjectsView";
import { BatchView } from "./BatchView";
import { Wordmark } from "@/components/Logo";
import { StatusBadge } from "@/components/ui";
import { Credit } from "@/components/Credit";
import { PanelHost } from "./panels/PanelHost";
import { removeClip } from "@/lib/edl";
import { platformById } from "@/lib/frame";
import type { AspectId } from "@/lib/types";
import { SoundButton, SoundPop, SpeedButton, SpeedPop, splitHere } from "./QuickControls";
import {
  IconExport, IconFolder, IconFrame, IconGrid, IconMotion, IconPalette, IconPause, IconPlay, IconRedo, IconScissors, IconSettings,
  IconType, IconUndo, IconUpload, IconWords, IconMic, IconLogout, IconMenu, IconLanguage, IconShapes, IconMusic,
  IconBrand, IconChevronLeft, IconChevronRight, IconStack, IconKeyboard, IconSparkle, IconDots, IconX, IconFullscreen, IconFullscreenExit, IconTranscript, IconShorts,
  IconTarget,
} from "@/components/Icons";

export const RAIL: { id: PanelId; label: string; title?: string; Icon: (p: { size?: number }) => React.ReactElement; group: number }[] = [
  { id: "effects", label: "Effects", Icon: IconSparkle, group: 0 },
  { id: "templates", label: "Templates", Icon: IconGrid, group: 0 },
  { id: "text", label: "Text", Icon: IconType, group: 0 },
  { id: "style", label: "Style", Icon: IconPalette, group: 0 },
  { id: "motion", label: "Motion", Icon: IconMotion, group: 0 },
  { id: "captions", label: "Captions", Icon: IconWords, group: 1 },
  { id: "transcript", label: "Transcript", title: "Edit by text", Icon: IconTranscript, group: 1 },
  { id: "language", label: "Language", Icon: IconLanguage, group: 1 },
  { id: "graphics", label: "Graphics", Icon: IconShapes, group: 2 },
  { id: "edit", label: "Edit", Icon: IconScissors, group: 2 },
  { id: "audio", label: "Audio", title: "Audio Studio", Icon: IconMusic, group: 2 },
  { id: "frame", label: "Frame", Icon: IconFrame, group: 2 },
  { id: "shorts", label: "Shorts", title: "Long video to shorts", Icon: IconShorts, group: 3 },
  { id: "brand", label: "Brand", Icon: IconBrand, group: 3 },
  { id: "export", label: "Export", Icon: IconExport, group: 3 },
  { id: "settings", label: "Settings", Icon: IconSettings, group: 3 },
];

/** Phone bottom bar: the four most-used tools, everything else lives in the "More" drawer. */
const MOBILE_PRIMARY: PanelId[] = ["captions", "templates", "edit", "audio"];
const RAIL_GROUPS = ["Look", "Words", "Edit & sound", "Finish"];

const fmt = (s: number) => {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.max(0, s) - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
};

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"], ["← / →", "Back / forward 1 s (Shift: 5 s)"], [", / .", "Previous / next frame"],
  ["Home / End", "Start / end"], ["S", "Split the clip at the playhead"], ["E", "★ Emphasise the selected word (or remove it)"], ["Del", "Delete the selected graphic or clip"],
  ["Ctrl+D", "Duplicate the selected graphic"], ["Alt + arrows", "Nudge the selected graphic"], ["Ctrl+Z", "Undo"],
  ["Ctrl+Shift+Z / Ctrl+Y", "Redo"], ["\\", "Show / hide the side panel"], ["Esc", "Deselect"], ["Ctrl + scroll", "Zoom the timeline"], ["?", "This list"],
];

/**
 * Full-screen preview of the stage + playback controls. Uses the browser's
 * full-screen mode where it exists, and a full-window view where it doesn't
 * (iPhone Safari only allows videos, not pages, to go full screen).
 */
function useFullscreen() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const isOn = () => !!document.fullscreenElement || !!document.querySelector(".ws-center.fake-fs");
    const sync = () => {
      const now = isOn();
      setOn(now);
      // left full screen some other way (Esc, the phone's own gesture): drop our history step too
      if (!now && (history.state as { capmitraFs?: number } | null)?.capmitraFs) history.back();
    };
    const exitAll = () => {
      document.querySelector(".ws-center")?.classList.remove("fake-fs");
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      setOn(false);
    };
    // the phone's Back button leaves full screen instead of leaving the editor
    const pop = () => { if (isOn()) exitAll(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && document.querySelector(".ws-center.fake-fs")) { document.querySelector(".ws-center")?.classList.remove("fake-fs"); sync(); } };
    document.addEventListener("fullscreenchange", sync);
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("fullscreenchange", sync); window.removeEventListener("popstate", pop); window.removeEventListener("keydown", esc); };
  }, []);
  const exit = useCallback(async () => {
    if ((history.state as { capmitraFs?: number } | null)?.capmitraFs) { history.back(); return; } // popstate does the rest
    document.querySelector(".ws-center")?.classList.remove("fake-fs");
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    setOn(false);
  }, []);
  const toggle = useCallback(async () => {
    const el = document.querySelector<HTMLElement>(".ws-center");
    if (!el) return;
    if (document.fullscreenElement || el.classList.contains("fake-fs")) { await exit(); return; }
    try {
      if (!el.requestFullscreen) throw new Error("no fullscreen");
      await el.requestFullscreen({ navigationUI: "hide" });
    } catch {
      el.classList.add("fake-fs");
      setOn(true);
    }
    history.pushState({ ...(history.state ?? {}), capmitraFs: 1 }, "");
    // phones show their own "how to exit full screen" notice along the bottom for a few
    // seconds: lift the controls above it until it has gone
    if (window.matchMedia("(pointer: coarse)").matches) {
      el.classList.add("fs-fresh");
      window.setTimeout(() => el.classList.remove("fs-fresh"), 4500);
    }
  }, [exit]);
  return { on, toggle, exit };
}

/** Shape of the video, with a platform that matches it when the current one doesn't. */
const ASPECT_BAR: { id: AspectId; label: string; title: string; platform: string }[] = [
  { id: "original", label: "Original", title: "As filmed", platform: "original" },
  { id: "9:16", label: "9:16", title: "Vertical: Reels, Shorts, TikTok", platform: "ig-reel" },
  { id: "16:9", label: "16:9", title: "Landscape: YouTube", platform: "youtube" },
  { id: "1:1", label: "1:1", title: "Square post", platform: "square" },
  { id: "4:5", label: "4:5", title: "Portrait feed post", platform: "ig-feed" },
];

/** Quick frame controls above the video: aspect ratio, grid, safe area and full screen. */
function AspectBar() {
  const ed = useEditor();
  const { doc, project, settings, setSettings } = ed;
  const fs = useFullscreen();
  const frame = doc.frame;
  const plat = platformById(frame.platform);
  const setAspect = (b: (typeof ASPECT_BAR)[number]) => project.update((d) => ({
    ...d,
    frame: { ...d.frame, aspect: b.id, platform: platformById(d.frame.platform).aspect === b.id ? d.frame.platform : b.platform },
  }));
  return (
    <div className="aspect-bar" role="toolbar" aria-label="Video shape and guides">
      <div className="seg" role="group" aria-label="Aspect ratio">
        {ASPECT_BAR.map((b) => (
          <button key={b.id} className={frame.aspect === b.id ? "on" : ""} aria-pressed={frame.aspect === b.id} data-tip={b.title} onClick={() => setAspect(b)}>{b.label}</button>
        ))}
      </div>
      <span className="divider" aria-hidden="true" />
      <button className={`btn ghost icon small ${settings.showGrid ? "on" : ""}`} aria-pressed={settings.showGrid} aria-label="Rule-of-thirds grid" data-tip="Rule-of-thirds grid (preview only)" onClick={() => setSettings({ showGrid: !settings.showGrid })}><IconGrid size={16} /></button>
      <button className={`btn ghost icon small ${frame.showSafeZone && plat.safe ? "on" : ""}`} aria-pressed={frame.showSafeZone && !!plat.safe} aria-label="Safe area" disabled={!plat.safe}
        data-tip={plat.safe ? `Safe area: where ${plat.label} draws its own buttons (preview only)` : "Safe area: pick 9:16 to see where Reels, Shorts and TikTok draw their buttons"}
        onClick={() => project.update((d) => ({ ...d, frame: { ...d.frame, showSafeZone: !d.frame.showSafeZone } }))}><IconTarget size={16} /></button>
      <button className="btn ghost icon small" aria-label="Full screen preview" data-tip="Full screen preview" onClick={() => void fs.toggle()}><IconFullscreen size={16} /></button>
    </div>
  );
}

/** One-line reminder of the main shortcuts, under the player (desktop only). */
const HINTS: [string, string][] = [["Space", "play"], ["← →", "1 s"], [", .", "frame"], ["S", "split"], ["E", "★ word"], ["Del", "delete"], ["Ctrl+Z", "undo"]];

function ShortcutHints({ onAll }: { onAll: () => void }) {
  const { settings, setSettings } = useEditor();
  if (!settings.showHints) return null;
  return (
    <div className="kbd-hints" aria-label="Keyboard shortcuts">
      {HINTS.map(([k, v]) => <span key={k}><kbd>{k}</kbd> {v}</span>)}
      <button className="kbd-hints-all" onClick={onAll}><kbd>?</kbd> all</button>
      <button className="kbd-hints-x" aria-label="Hide shortcut hints" data-tip="Hide (turn back on in Settings)" onClick={() => setSettings({ showHints: false })}><IconX size={12} /></button>
    </div>
  );
}

function Transport() {
  const ed = useEditor();
  const time = useTime();
  const { playback, tl } = ed;
  const fs = useFullscreen();
  const [pop, setPop] = useState<{ kind: "speed" | "sound"; el: HTMLElement } | null>(null);
  return (
    <>
    {fs.on ? (
      <div className="fs-bar">
        <span className="fs-title"><img src="/brand/icon-96.png" alt="" width={24} height={24} />Preview</span>
        <button className="btn fs-exit" onClick={() => void fs.exit()} aria-label="Exit full screen"><IconFullscreenExit size={18} /> Exit full screen</button>
      </div>
    ) : null}
    <div className="transport" role="group" aria-label="Playback">
      <button className="btn icon play" onClick={playback.toggle} aria-label={playback.playing ? "Pause" : "Play"} data-tip="Play / pause (Space)">
        {playback.playing ? <IconPause /> : <IconPlay />}
      </button>
      <span className="tc" aria-live="off">{fmt(time)} <em>/ {fmt(tl.duration)}</em></span>
      <span className="transport-spacer" />
      <SpeedButton onOpen={(el) => setPop({ kind: "speed", el })} />
      <SoundButton onOpen={(el) => setPop({ kind: "sound", el })} />
      <label className="transport-field tq" data-tip="Preview quality (export is always full quality)">
        <span className="sr-only">Preview quality</span>
        <select className="rate" value={ed.settings.previewQuality} onChange={(e) => ed.setSettings({ previewQuality: e.target.value as "auto" | "full" | "half" })}>
          <option value="auto">Preview: auto</option>
          <option value="half">Preview: fast</option>
          <option value="full">Preview: full</option>
        </select>
      </label>
      <button className="btn icon fs-btn" onClick={() => void fs.toggle()} aria-label={fs.on ? "Exit full screen" : "Full screen"} aria-pressed={fs.on} data-tip={fs.on ? "Exit full screen (Esc)" : "Full screen"}>
        {fs.on ? <IconFullscreenExit size={18} /> : <IconFullscreen size={18} />}
      </button>
      {pop?.kind === "speed" ? <SpeedPop anchor={pop.el} onClose={() => setPop(null)} /> : null}
      {pop?.kind === "sound" ? <SoundPop anchor={pop.el} onClose={() => setPop(null)} /> : null}
    </div>
    </>
  );
}

function TopBar({ onMenu, onShortcuts }: { onMenu: () => void; onShortcuts: () => void }) {
  const ed = useEditor();
  const { project, file, transcription, needsKey } = ed;
  const s = project.saveState;
  return (
    <header className="ws-top">
      <Wordmark />
      <button className="project-pill" onClick={() => ed.setShowProjects(true)} data-tip="All projects">
        <IconFolder size={15} />
        <span>{ed.meta.name}</span>
        <i className={`save-dot ${s}`} aria-label={s === "saving" ? "Saving" : s === "saved" ? "Saved" : s === "error" ? "Not saved" : ""} />
      </button>
      <StatusBadge kind={s === "saving" ? "busy" : s === "saved" ? "success" : s === "error" ? "error" : "idle"}>
        {s === "saving" ? "Saving…" : s === "saved" ? "All changes saved" : "Changes not saved"}
      </StatusBadge>
      <div className="top-actions">
        <button className="btn ghost" onClick={() => ed.setShowProjects(true)} data-tip="View, edit, rename and delete projects"><IconGrid /><span className="lbl">Projects</span></button>
        <button className="btn ghost" onClick={() => ed.setShowBatch(true)} data-tip="Caption many videos with one style"><IconStack /><span className="lbl">Batch</span></button>
        <button className="btn ghost" onClick={() => ed.fileInput.current?.click()} data-tip="Open a video (or drag it in)"><IconUpload /><span className="lbl">Open video</span></button>
        {file ? (
          <button className={`btn ghost ${needsKey ? "needs-key" : ""}`} onClick={() => (needsKey ? ed.openKeySetup() : void transcription.transcribe(file, ed.doc.words.length > 0))} disabled={transcription.busy} data-tip={needsKey ? "Add your ElevenLabs key first" : "Write captions from the speech"}>
            <IconMic /><span className="lbl">{transcription.busy ? "Captioning…" : ed.doc.words.length ? "Caption again" : "Auto caption"}</span>
          </button>
        ) : null}
        <button className="btn icon ghost" onClick={ed.undo} disabled={!project.canUndo} aria-label="Undo" data-tip="Undo (Ctrl+Z)"><IconUndo /></button>
        <button className="btn icon ghost" onClick={ed.redo} disabled={!project.canRedo} aria-label="Redo" data-tip="Redo (Ctrl+Shift+Z)"><IconRedo /></button>
        <button className="btn icon ghost hide-sm" onClick={onShortcuts} aria-label="Keyboard shortcuts" data-tip="Keyboard shortcuts (?)"><IconKeyboard /></button>
        {ed.locked ? <SignOutButton /> : null}
        <span className="divider" aria-hidden="true" />
        <button className="btn export" disabled={!ed.canExport || ed.exporter.exporting} onClick={() => ed.setPanel("export", true)} aria-disabled={!ed.canExport} data-tip={ed.exporter.exporting ? "Exporting…" : ed.canExport ? "Export video or subtitles" : ed.isEmpty ? "Add a video first" : "Open this project's video first"}><IconExport /><span className="lbl">Export</span></button>
        <button className="btn icon ghost top-more" onClick={onMenu} aria-label="Menu" aria-haspopup="dialog"><IconMenu /></button>
      </div>
    </header>
  );
}

function useSignOut() {
  const ed = useEditor();
  return useCallback(async () => {
    const ok = await ed.dialog.confirm({
      title: "Sign out of CapMitra?",
      message: ed.exporter.exporting || ed.transcription.busy
        ? "Something is still running and will stop. Your projects stay saved on this device, and you'll need the passcode to come back."
        : "Your projects stay saved on this device. You'll need the passcode to come back in.",
      confirmLabel: "Sign out",
    });
    if (!ok) return;
    ed.exporter.cancel();
    const tid = ed.toast({ kind: "busy", title: "Signing out…" });
    try {
      const res = await fetch("/api/login", { method: "DELETE" });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      ed.toast({ id: tid, kind: "success", title: "Signed out", message: "See you soon." });
      setTimeout(() => window.location.replace("/login"), 600);
    } catch (e) {
      ed.toast({ id: tid, kind: "error", title: "Couldn't sign out", message: (e as Error).message });
    }
  }, [ed]);
}

function SignOutButton() {
  const signOut = useSignOut();
  return <button className="btn icon ghost" onClick={() => void signOut()} aria-label="Sign out" data-tip="Sign out"><IconLogout /></button>;
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="modal-veil" role="dialog" aria-modal="true" aria-labelledby="sc-title" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="dialog shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2 id="sc-title">Keyboard shortcuts</h2>
        <dl>{SHORTCUTS.map(([k, v]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
        <div className="dialog-actions"><button ref={ref} className="btn primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

export function Workspace() {
  const ed = useEditor();
  const { settings, setSettings, panel, setPanel } = ed;
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const signOut = useSignOut();
  const collapsed = settings.panelCollapsed;

  /* ---------- drag & drop files anywhere ---------- */
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); setDragOver(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragOver(false); };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragOver(false);
      const dt = e.dataTransfer;
      let files = Array.from(dt.files ?? []);
      if (!files.length && dt.items) files = Array.from(dt.items).map((i) => (i.kind === "file" ? i.getAsFile() : null)).filter((f): f is File => !!f);
      if (ed.showBatch) ed.setBatchSeed(files);
      else ed.handleFiles(files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  }, [ed]);

  /* ---------- keyboard ---------- */
  const live = useRef(ed);
  live.current = ed;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const E = live.current;
      const el = e.target as HTMLElement;
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.tagName === "SELECT" || el?.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); if (e.shiftKey) E.redo(); else E.undo(); return; }
      if (mod && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); E.redo(); return; }
      if (typing || document.querySelector(".modal-veil, .qp-wrap")) return;
      const sel = E.selection;
      const layer = sel?.kind === "layer" ? E.doc.layers?.find((l) => l.id === sel.id) : undefined;
      if (mod && e.key.toLowerCase() === "d" && layer) {
        e.preventDefault();
        E.addLayer({ ...layer, id: E.uid("L"), x: Math.min(95, layer.x + 3), y: Math.min(95, layer.y + 3), z: E.nextZ() });
        return;
      }
      if (e.key === "Escape") { E.setSelection(null); return; }
      if (e.key === "?") { setShortcuts(true); return; }
      if (e.key === "\\") { E.setSettings((s) => ({ ...s, panelCollapsed: !s.panelCollapsed })); return; }
      if (e.code === "Space") { e.preventDefault(); E.playback.toggle(); return; }
      if (layer && e.altKey && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const d = e.shiftKey ? 2 : 0.5;
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
        const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
        E.updateLayer(layer.id, { x: +(layer.x + dx).toFixed(2), y: +(layer.y + dy).toFixed(2) }, `nudge:${layer.id}`);
        return;
      }
      const t = E.playback.getTime();
      if (e.key === "ArrowLeft") E.playback.seek(t - (e.shiftKey ? 5 : 1));
      else if (e.key === "ArrowRight") E.playback.seek(t + (e.shiftKey ? 5 : 1));
      else if (e.key === ",") E.playback.seek(t - 1 / 30);
      else if (e.key === ".") E.playback.seek(t + 1 / 30);
      else if (e.key === "Home") E.playback.seek(0);
      else if (e.key === "End") E.playback.seek(E.tl.duration);
      else if (e.key.toLowerCase() === "s" && !mod) splitHere(E, t);
      else if (e.key.toLowerCase() === "e" && !mod && E.selectedWordId) {
        const id = E.selectedWordId;
        E.updateWord(id, (w) => ({ emphasis: !w.emphasis }));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (layer) E.removeLayer(layer.id);
        else if (sel?.kind === "fx") { E.project.update((d) => ({ ...d, effects: (d.effects ?? []).filter((f) => f.id !== sel.id) })); E.setSelection(null); }
        else if (sel?.kind === "sound") { E.project.update((d) => ({ ...d, sounds: (d.sounds ?? []).filter((x) => x.id !== sel.id) })); E.setSelection(null); }
        else if (sel?.kind === "clip" && E.clips.length > 1) { E.setClips(removeClip(E.clips, sel.id)); E.setSelection(null); }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  /* ---------- resizers ---------- */
  const startResize = (kind: "panel" | "timeline" | "tlwidth") => (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    const w0 = settings.panelWidth, h0 = settings.timelineHeight, i0 = settings.timelineInset;
    const moveFn = (ev: PointerEvent) => {
      if (kind === "panel") setSettings({ panelWidth: Math.round(Math.min(620, Math.max(300, w0 + (ev.clientX - x0)))) });
      else if (kind === "tlwidth") setSettings({ timelineInset: Math.round(Math.min(window.innerWidth * 0.5, Math.max(0, i0 - (ev.clientX - x0)))) });
      else setSettings({ timelineHeight: Math.round(Math.min(window.innerHeight * 0.6, Math.max(120, h0 - (ev.clientY - y0)))) });
    };
    const upFn = () => { window.removeEventListener("pointermove", moveFn); window.removeEventListener("pointerup", upFn); document.body.classList.remove("resizing"); };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", moveFn);
    window.addEventListener("pointerup", upFn);
  };

  const onRail = (id: PanelId) => {
    if (id === panel && !collapsed) setSettings({ panelCollapsed: true });
    else setPanel(id);
  };

  return (
    <div className={`ws ${ed.ready ? "ready" : ""} ${collapsed ? "panel-collapsed" : ""} ${ed.isEmpty ? "is-empty" : ""}`}
      style={{ "--panel-w": `${settings.panelWidth}px`, "--tl-h": `${settings.timelineHeight}px` } as React.CSSProperties}>
      <a className="skip-link" href="#ws-stage">Skip to the preview</a>
      <TopBar onMenu={() => setMenuOpen(true)} onShortcuts={() => setShortcuts(true)} />
      <div className="ws-body">
        <nav className="ws-rail" aria-label="Tools">
          {RAIL.map(({ id, label, Icon, group }, i) => (
            <span key={id} className="rail-slot">
              {i > 0 && RAIL[i - 1].group !== group ? <span className="rail-sep" aria-hidden="true" /> : null}
              <button
                className={`rail-btn ${panel === id && !collapsed ? "on" : ""} ${ed.flashPanel === id ? "flash" : ""} ${MOBILE_PRIMARY.includes(id) ? "" : "rail-extra"}`}
                onClick={() => onRail(id)}
                aria-pressed={panel === id && !collapsed}
                aria-label={label}
                data-tip={label}
              >
                <Icon size={19} />
                <span>{label}</span>
                {id === "settings" && ed.needsKey ? <i className="tab-dot" aria-label="Action needed: add your API key" /> : null}
              </button>
            </span>
          ))}
          <button
            className={`rail-btn rail-more ${!MOBILE_PRIMARY.includes(panel) && !collapsed ? "on" : ""}`}
            onClick={() => setToolsOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={toolsOpen}
            aria-label="All tools"
          >
            {(() => { const t = !MOBILE_PRIMARY.includes(panel) && !collapsed ? RAIL.find((r) => r.id === panel) : undefined; const I = t?.Icon ?? IconDots; return (<><I size={19} /><span>{t ? t.label : "More"}</span></>); })()}
            {ed.needsKey ? <i className="tab-dot" aria-label="Action needed: add your API key" /> : null}
          </button>
        </nav>
        <aside className="ws-panel" aria-label={RAIL.find((r) => r.id === panel)?.label} hidden={collapsed}>
          <header className="ws-panel-head">
            <h2>{(() => { const r = RAIL.find((x) => x.id === panel); return r?.title ?? r?.label; })()}</h2>
            <button className="btn icon panel-close" onClick={() => setSettings({ panelCollapsed: true })} aria-label="Hide panel" data-tip="Hide panel (\)"><IconChevronLeft size={18} className="pc-desk" /><IconX size={18} className="pc-phone" /></button>
          </header>
          <div className="ws-panel-body">
            <div className={`tab-pane ${ed.flashPanel === panel ? "flash" : ""}`} key={panel}><PanelHost id={panel} /></div>
          </div>
          <footer className="panel-foot"><Credit /></footer>
          <div className="ws-resize-x" onPointerDown={startResize("panel")} role="separator" aria-orientation="vertical" aria-label="Resize panel" />
        </aside>
        {collapsed ? (
          <button className="ws-panel-open" onClick={() => setSettings({ panelCollapsed: false })} aria-label="Show panel" data-tip="Show panel (\)"><IconChevronRight size={16} /></button>
        ) : null}
        <main className="ws-center" id="ws-stage">
          {!ed.isEmpty ? <AspectBar /> : null}
          <Stage />
          {!ed.isEmpty ? <Transport /> : null}
          {!ed.isEmpty ? <ShortcutHints onAll={() => setShortcuts(true)} /> : null}
        </main>
      </div>
      {!ed.isEmpty ? (
        <section className="ws-timeline" aria-label="Timeline" style={{ ["--tl-inset" as string]: `${settings.timelineInset}px` } as React.CSSProperties}>
          <div className="ws-resize-y" onPointerDown={startResize("timeline")} role="separator" aria-orientation="horizontal" aria-label="Resize timeline" />
          <div className="ws-resize-tl" onPointerDown={startResize("tlwidth")} onDoubleClick={() => setSettings({ timelineInset: 0 })} role="separator" aria-orientation="vertical" aria-label="Resize timeline width (double-click for full width)" data-tip="Drag to make the timeline narrower · double-click for full width" />
          <MultiTrackTimeline />
        </section>
      ) : null}

      {toolsOpen ? <ToolsDrawer current={collapsed ? null : panel} needsKey={ed.needsKey} onPick={(id) => { setToolsOpen(false); setPanel(id); if (collapsed) setSettings({ panelCollapsed: false }); }} onClose={() => setToolsOpen(false)} /> : null}
      {menuOpen ? (
        <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label="Menu" onClick={() => setMenuOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grab" aria-hidden="true" />
            <div className="sheet-row2">
              <button className="sheet-btn" onClick={ed.undo}><IconUndo /> Undo</button>
              <button className="sheet-btn" onClick={ed.redo}><IconRedo /> Redo</button>
            </div>
            <button className="sheet-item" onClick={() => { setMenuOpen(false); ed.setShowProjects(true); }}><IconGrid /><span><b>Projects</b><em>View, edit, rename and delete</em></span></button>
            <button className="sheet-item" onClick={() => { setMenuOpen(false); ed.setShowBatch(true); }}><IconStack /><span><b>Batch</b><em>Caption many videos at once</em></span></button>
            <button className="sheet-item" onClick={() => { setMenuOpen(false); ed.fileInput.current?.click(); }}><IconUpload /><span><b>Open video</b><em>Start a new captioned video</em></span></button>
            {ed.file ? (
              <button className="sheet-item" disabled={ed.transcription.busy} onClick={() => { setMenuOpen(false); void ed.transcription.transcribe(ed.file!, ed.doc.words.length > 0); }}><IconMic /><span><b>{ed.transcription.busy ? "Captioning…" : ed.doc.words.length ? "Caption again" : "Auto caption"}</b><em>Write the captions from the speech</em></span></button>
            ) : null}
            <button className="sheet-item" onClick={() => { setMenuOpen(false); setPanel("settings", true); }}><IconSettings /><span><b>Settings</b><em>API key, language, about</em></span></button>
            {ed.locked ? <button className="sheet-item danger" onClick={() => { setMenuOpen(false); void signOut(); }}><IconLogout /><span><b>Sign out</b><em>You&apos;ll need the passcode to come back</em></span></button> : null}
            <button className="btn wide sheet-close" onClick={() => setMenuOpen(false)}>Close</button>
          </div>
        </div>
      ) : null}
      {shortcuts ? <Shortcuts onClose={() => setShortcuts(false)} /> : null}

      <input ref={ed.fileInput} type="file" accept="video/*,.mp4,.mov,.webm,.mkv,.srt,.vtt,.json" multiple hidden onChange={(e) => { if (e.target.files) ed.handleFiles(Array.from(e.target.files)); e.target.value = ""; }} />

      {ed.showProjects ? (
        <ProjectsView
          currentId={ed.meta.id}
          onEdit={(id) => (id === ed.meta.id ? ed.setShowProjects(false) : void ed.openProject(id))}
          onNew={ed.startNewProject}
          onClose={() => ed.setShowProjects(false)}
          onDeleted={(id) => { if (id === ed.meta.id) ed.startNewProject(); }}
        />
      ) : null}
      <BatchView />
      <ExportOverlay />
      <PrepareMedia />
      <Tour />
      {dragOver ? (
        <div className="drag-veil">
          <div>
            <IconUpload size={34} />
            <p>Drop a video, several videos (batch), or an SRT/VTT/project file</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Phone "More" drawer: every tool in a grouped grid, no sideways scrolling. */
function ToolsDrawer({ current, needsKey, onPick, onClose }: { current: PanelId | null; needsKey: boolean; onPick: (id: PanelId) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="sheet-wrap tools-wrap" onClick={onClose}>
      <div className="sheet tools-sheet" role="dialog" aria-modal="true" aria-label="All tools" onClick={(e) => e.stopPropagation()}>
        <span className="sheet-grab" aria-hidden="true" />
        <header className="tools-head">
          <h2>Tools</h2>
          <button className="btn icon panel-close" onClick={onClose} aria-label="Close"><IconX size={18} /></button>
        </header>
        {RAIL_GROUPS.map((g, gi) => (
          <section key={g} className="tools-group" style={{ animationDelay: `${gi * 40}ms` }}>
            <h3>{g}</h3>
            <div className="tools-grid">
              {RAIL.filter((r) => r.group === gi).map(({ id, label, Icon }, i) => (
                <button key={id} ref={gi === 0 && i === 0 ? first : undefined} className={`tool-tile ${current === id ? "on" : ""}`} aria-pressed={current === id} onClick={() => onPick(id)}>
                  <span className="tool-ico"><Icon size={22} />{id === "settings" && needsKey ? <i className="tab-dot" aria-hidden="true" /> : null}</span>
                  <span className="tool-lbl">{label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
