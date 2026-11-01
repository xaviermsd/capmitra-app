"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowLeft, IconCopy, IconDownload, IconEdit, IconEye, IconFolder, IconPause, IconPlay, IconPlus, IconSearch, IconTrash, IconUpload, IconX } from "./Icons";
import { useDialog } from "./Dialog";
import { useToast } from "./Toaster";
import { BrandedLoader, EmptyState } from "./ui";
import { Credit } from "./Credit";
import {
  backupProjects, deleteProject, duplicateProject, getProjectVideo, listProjects, requestPersistentStorage, restoreProjects, saveProject, storageStatus,
  type ProjectRecord, type StorageStatus,
} from "@/lib/library";
import { groupWords } from "@/lib/grouping";
import { drawCaptions } from "@/lib/render";
import { composeFrame, outputSize, platformById, DEFAULT_FRAME } from "@/lib/frame";
import { loadFont } from "@/lib/fonts";
import { download } from "@/lib/subtitles";

const mb = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0, Math.round(b / 1e6))} MB`);
const when = (t: number) => {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};
const dur = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");

type Sort = "recent" | "name" | "oldest" | "longest";

export function ProjectsView({
  currentId, onEdit, onNew, onClose, onDeleted,
}: {
  currentId: string | null;
  onEdit: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [items, setItems] = useState<ProjectRecord[] | null>(null);
  const [usage, setUsage] = useState<StorageStatus | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const dialog = useDialog();
  const { toast } = useToast();

  const refresh = useCallback(() => {
    void listProjects().then(setItems);
    void storageStatus().then(setUsage);
  }, []);
  useEffect(refresh, [refresh]);

  const shown = useMemo(() => {
    if (!items) return null;
    const f = q.trim().toLowerCase();
    const list = f ? items.filter((p) => p.name.toLowerCase().includes(f) || p.words.some((w) => w.text.toLowerCase().includes(f))) : items.slice();
    list.sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : sort === "oldest" ? a.created - b.created : sort === "longest" ? (b.duration ?? 0) - (a.duration ?? 0) : b.updated - a.updated,
    );
    return list;
  }, [items, q, sort]);

  const rename = async (p: ProjectRecord) => {
    const n = await dialog.prompt({ title: "Rename project", input: { value: p.name }, confirmLabel: "Rename" });
    if (!n || n === p.name) return;
    const ok = await saveProject({ ...p, name: n, updated: Date.now() });
    toast(ok ? { kind: "success", title: "Project renamed", message: n } : { kind: "error", title: "Couldn't rename", message: "Browser storage refused the change." });
    refresh();
  };

  const remove = async (p: ProjectRecord) => {
    const ok = await dialog.confirm({
      title: "Delete this project?",
      message: `“${p.name}”: its captions, styling and the saved copy of the video are removed from this browser. Your original video file is not touched.`,
      confirmLabel: "Delete project",
      danger: true,
    });
    if (!ok) return;
    await deleteProject(p.id);
    onDeleted(p.id);
    toast({ kind: "success", title: "Project deleted", message: p.name });
    refresh();
  };

  const duplicate = async (p: ProjectRecord) => {
    const c = await duplicateProject(p.id);
    toast(c ? { kind: "success", title: "Project duplicated", message: c.name } : { kind: "error", title: "Couldn't duplicate" });
    refresh();
  };

  return (
    <div className="projects-page" role="dialog" aria-modal="true" aria-labelledby="projects-title" onKeyDown={(e) => e.key === "Escape" && !previewId && onClose()}>
      <header className="pp-head">
        <button className="btn ghost" onClick={onClose} data-tip="Back to the editor (Esc)"><IconArrowLeft /> <span className="lbl">Editor</span></button>
        <h1 id="projects-title">Projects</h1>
        <button className="btn primary" onClick={onNew}><IconPlus /> New project</button>
      </header>

      <div className="pp-tools">
        <label className="pp-search">
          <IconSearch size={16} />
          <input placeholder="Search names and captions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
          {q ? <button className="btn icon small ghost" onClick={() => setQ("")} aria-label="Clear search"><IconX size={14} /></button> : null}
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort projects">
          <option value="recent">Recently edited</option>
          <option value="name">Name (A to Z)</option>
          <option value="oldest">Oldest first</option>
          <option value="longest">Longest video</option>
        </select>
        <div className="pp-backup">
          <button className="btn small ghost" disabled={!items?.length} data-tip="Download captions and styles of every project as one file"
            onClick={async () => { download(`capmitra-backup-${new Date().toISOString().slice(0, 10)}.json`, await backupProjects(), "application/json"); toast({ kind: "success", title: "Backup downloaded", message: "Videos aren't included; keep your original files." }); }}>
            <IconDownload size={15} /> Back up all
          </button>
          <button className="btn small ghost" onClick={() => restoreRef.current?.click()}><IconUpload size={15} /> Restore</button>
          <input ref={restoreRef} type="file" accept=".json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const n = await restoreProjects(await f.text());
              toast({ kind: "success", title: `${n} projects restored`, message: "Drop each video again to see captions on it." });
              refresh();
            } catch (err) {
              toast({ kind: "error", title: "Couldn't restore", message: (err as Error).message });
            }
          }} />
        </div>
      </div>

      <StorageMeter
        status={usage}
        onPersist={async () => {
          const ok = await requestPersistentStorage();
          toast(ok
            ? { kind: "success", title: "Projects protected", message: "This browser will keep your projects even when the disk is low." }
            : { kind: "warning", title: "The browser said not yet", message: "Chrome allows this for sites you use often or add to your home screen / install. Keep backups meanwhile." });
          refresh();
        }}
      />

      {shown === null ? (
        <div className="proj-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="proj skeleton" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState art="projects" big title={q ? "No projects match your search" : "No projects yet"}
          action={!q ? <button className="btn primary" onClick={onNew}><IconPlus /> Start a project</button> : null}>
          {q ? "Try another word, or clear the search." : "Drop a video into the editor and it will be saved here automatically."}
        </EmptyState>
      ) : (
        <div className="proj-grid">
          {shown.map((p) => (
            <article key={p.id} className={`proj ${p.id === currentId ? "current" : ""}`}>
              <button className="proj-thumb" onClick={() => setPreviewId(p.id)} aria-label={`Preview ${p.name}`}>
                {p.thumb ? <img src={p.thumb} alt="" /> : <IconFolder size={30} />}
                <span className="proj-play"><IconPlay size={20} /></span>
                {p.duration ? <em>{dur(p.duration)}</em> : null}
                {p.id === currentId ? <strong className="badge">Open now</strong> : null}
              </button>
              <div className="proj-info">
                <h3 title={p.name}>{p.name}</h3>
                <p>{platformById(p.frame?.platform ?? "original").label}, {p.words.length} words</p>
                <p className="muted">Edited {when(p.updated)}</p>
              </div>
              <div className="proj-actions">
                <button className="btn small primary" onClick={() => onEdit(p.id)}><IconEdit size={14} /> Edit</button>
                <button className="btn icon small ghost" onClick={() => setPreviewId(p.id)} data-tip="View" aria-label={`View ${p.name}`}><IconEye size={16} /><span className="lbl-m">View</span></button>
                <button className="btn icon small ghost" onClick={() => rename(p)} data-tip="Rename" aria-label={`Rename ${p.name}`}><span className="txt-ico">Aa</span><span className="lbl-m">Rename</span></button>
                <button className="btn icon small ghost" onClick={() => duplicate(p)} data-tip="Duplicate" aria-label={`Duplicate ${p.name}`}><IconCopy size={16} /><span className="lbl-m">Duplicate</span></button>
                <button className="btn icon small ghost" data-tip="Download project file" aria-label={`Download ${p.name}`}
                  onClick={() => download(`${p.name}.capmitra.json`, JSON.stringify({ app: "capmitra", version: 2, ...p }, null, 1), "application/json")}><IconDownload size={16} /><span className="lbl-m">Save file</span></button>
                <button className="btn icon small ghost danger" onClick={() => remove(p)} data-tip="Delete" aria-label={`Delete ${p.name}`}><IconTrash size={16} /><span className="lbl-m">Delete</span></button>
              </div>
            </article>
          ))}
        </div>
      )}

      <footer className="pp-foot"><Credit /></footer>

      {previewId ? (
        <PreviewModal
          project={items?.find((x) => x.id === previewId) ?? null}
          onClose={() => setPreviewId(null)}
          onEdit={() => { const id = previewId; setPreviewId(null); onEdit(id); }}
        />
      ) : null}
    </div>
  );
}

/** Plays a saved project with its captions, exactly as it would export. */
function PreviewModal({ project, onClose, onEdit }: { project: ProjectRecord | null; onClose: () => void; onEdit: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "novideo">("loading");
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);

  const lines = useMemo(() => (project ? groupWords(project.words, project.style) : []), [project]);

  useEffect(() => {
    if (!project) return;
    let u: string | null = null;
    void loadFont(project.style.font, project.style.weight);
    void getProjectVideo(project.id).then((f) => {
      if (!f) return setState("novideo");
      u = URL.createObjectURL(f);
      setUrl(u);
      setState("ready");
    });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [project]);

  useEffect(() => {
    if (!project || state !== "ready") return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c && v.videoWidth) {
        const frame = { ...DEFAULT_FRAME, ...(project.frame ?? {}) };
        const { w, h } = outputSize(v.videoWidth, v.videoHeight, frame.aspect, Math.min(720, Math.min(v.videoWidth, v.videoHeight)));
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const ctx = c.getContext("2d")!;
        composeFrame(ctx, v, v.videoWidth, v.videoHeight, w, h, frame);
        drawCaptions(ctx, w, h, lines, v.currentTime - (project.offset ?? 0), project.style, project.overrides ?? {});
        setT(v.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [project, state, lines]);

  if (!project) return null;
  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play(); else v.pause();
  };

  return (
    <div className="modal-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="preview-sheet" role="dialog" aria-modal="true" aria-label={`Preview of ${project.name}`} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
        <header>
          <h2>{project.name}</h2>
          <button className="btn small primary" onClick={onEdit}><IconEdit size={14} /> Edit</button>
          <button className="btn icon small ghost" onClick={onClose} aria-label="Close preview" autoFocus><IconX /></button>
        </header>
        <div className="preview-stage" onClick={toggle}>
          {state === "loading" ? <BrandedLoader label="Loading project…" /> : null}
          {state === "novideo" ? (
            <div className="empty">
              <p>The video wasn&apos;t kept with this project (browser storage was full or it came from a backup). Open it in the editor and drop the video again.</p>
            </div>
          ) : null}
          {url ? <video ref={videoRef} src={url} playsInline className="source-video" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} /> : null}
          {state === "ready" ? <canvas ref={canvasRef} /> : null}
        </div>
        {state === "ready" ? (
          <div className="preview-bar">
            <button className="btn icon play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>{playing ? <IconPause /> : <IconPlay />}</button>
            <input type="range" min={0} max={videoRef.current?.duration || project.duration || 1} step={0.01} value={t}
              onChange={(e) => { if (videoRef.current) videoRef.current.currentTime = Number(e.target.value); }} aria-label="Seek" />
            <span className="tc">{dur(t) || "0:00"} <em>/ {dur(project.duration)}</em></span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StorageMeter({ status, onPersist }: { status: StorageStatus | null; onPersist: () => void }) {
  if (!status) {
    return <p className="pp-storage">Projects are saved in this browser on this device. Use “Back up all” to move them to another computer.</p>;
  }
  const pct = status.quota > 0 ? Math.min(100, (status.used / status.quota) * 100) : 0;
  const tone = pct > 90 ? "bad" : pct > 75 ? "warn" : "ok";
  return (
    <section className={`pp-storage-card ${tone}`} aria-label="Browser storage">
      <div className="pp-storage-row">
        <strong>{mb(status.used)} used</strong>
        <span>of {mb(status.quota)} available in this browser</span>
        <span className={`pp-persist ${status.persisted ? "on" : "off"}`}>
          {status.persisted ? "Protected from automatic clean-up" : "Not protected: the browser may clear projects when the disk is full"}
        </span>
        {!status.persisted && status.canPersist ? <button className="btn small ghost" onClick={onPersist}>Protect my projects</button> : null}
      </div>
      <div className="pp-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Storage used">
        <span style={{ width: `${pct}%` }} />
      </div>
      {tone !== "ok" ? <p className="pp-storage">Storage is {Math.round(pct)}% full. Delete projects you no longer need, or back them up first.</p> : <p className="pp-storage">Use “Back up all” to move projects to another computer. Videos stay on this device.</p>}
    </section>
  );
}
