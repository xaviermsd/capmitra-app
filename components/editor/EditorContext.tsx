"use client";
/**
 * All editor state and actions, shared with every panel through useEditor().
 *
 *   project     the document + undo/redo + autosave           (useProject)
 *   playback    output-timeline clock and media sync          (usePlayback)
 *   transcribe  captioning                                    (useTranscription)
 *   exporter    MP4 / WebM export                             (useExport)
 *
 * Derived each render: the edit timeline, captions on the output timeline,
 * and helpers to edit source words from output-time gestures.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useToast } from "@/components/Toaster";
import { useDialog } from "@/components/Dialog";
import { useProject, blankRecord, NO_TRIM, type ProjectApi } from "./hooks/useProject";
import { usePlayback, type PlaybackApi } from "./hooks/usePlayback";
import { useVoiceEnhancer } from "./hooks/useVoiceEnhancer";
import type { ExportView } from "./ExportOverlay";
import { useTranscription } from "./hooks/useTranscription";
import { useExport } from "./hooks/useExport";
import { DEFAULT_SETTINGS, LS, elevenKeys, type Settings } from "@/lib/settings";
import { groupWords } from "@/lib/grouping";
import { buildTimeline, mapWords, baseWordId, itemAt, insertClip, type EditTimeline, type InsertWhere } from "@/lib/edl";
import { effectiveClips, DEFAULT_AUDIO, DEFAULT_MOTION, CAPTION_Z, uid, type Clip, type ImageClip, type Layer, type ProjectDoc, type VideoClip } from "@/lib/project";
import { sanitizeSvg, UnsafeSvgError } from "@/lib/svgSafe";
import { putAsset, probeMedia } from "@/lib/assets";
import { makeMeasure, clearMeasureCache } from "@/lib/measure";
import { outputSize } from "@/lib/frame";
import { setRomanRules } from "@/lib/translit";
import { assetUrl, decodeAudioAsset, getAsset } from "@/lib/assets";
import { getProject, getProjectVideo, listProjects, saveProjectVideo, takeLegacyVideo, type ProjectRecord } from "@/lib/library";
import { parseSubtitles, newId } from "@/lib/subtitles";
import { restoreUnlock, loadWatermark, type UnlockStatus } from "@/lib/watermark";
import { applyRules, parseRules } from "@/lib/keywords";
import { migrate } from "@/lib/project";
import { loadImportedPacks } from "./panels/EffectsPanel";
import type { Waveform } from "@/lib/media";
import type { CaptionLine, CaptionStyle, ProjectFile, Word } from "@/lib/types";

export type PanelId =
  | "effects" | "templates" | "text" | "style" | "motion" | "captions" | "transcript" | "shorts" | "language" | "graphics" | "edit" | "audio" | "frame" | "brand" | "export" | "settings";

export type Selection =
  | { kind: "caption"; key: string }
  | { kind: "layer"; id: string }
  | { kind: "clip"; id: string }
  | { kind: "fx"; id: string }
  | { kind: "sound"; id: string }
  | null;

export interface ServerInfo { serverElevenLabs: boolean; serverSarvam: boolean; keyReason?: "admin" | "master" | "everyone" | null }

const baseName = (n: string) => n.replace(/\.[^.]+$/, "");

function useEditorState() {
  const { toast, dismiss } = useToast();
  const dialog = useDialog();

  /* ---------- device settings ---------- */
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [presets, setPresets] = useState<CaptionStyle[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">("light"); // CapMitra ships one light theme
  const [ready, setReady] = useState(false);
  const setSettings = useCallback((p: Partial<Settings> | ((s: Settings) => Settings)) => {
    setSettingsState((s) => (typeof p === "function" ? p(s) : { ...s, ...p }));
  }, []);
  useEffect(() => { if (ready) LS.set("acg:settings", settings); }, [settings, ready]);
  useEffect(() => { setRomanRules(settings.romanRules); }, [settings.romanRules]);
  useEffect(() => { if (ready) LS.set("acg:presets", presets); }, [presets, ready]);
  useEffect(() => {
    document.documentElement.dataset.theme = "light";
    if (ready) LS.set("acg:theme", "light");
  }, [theme, ready]);

  /* ---------- media ---------- */
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  /** Hidden <video> elements for extra videos added as clips, by asset id (filled in by the stage). */
  const extraVideos = useRef(new Map<string, HTMLVideoElement>());
  /** Blob URLs for those extra videos. */
  const [sourceUrls, setSourceUrls] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [srcDims, setSrcDims] = useState({ w: 0, h: 0 });
  const [videoDuration, setVideoDuration] = useState(0);
  /** A new video waiting on "Prepare your video" before it is captioned. */
  const [prepareFile, setPrepareFile] = useState<File | null>(null);
  const [waveform, setWaveform] = useState<Waveform | null>(null);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicDuration, setMusicDuration] = useState(0);

  const project = useProject({
    ready,
    hasVideo: !!file,
    onSaveError: () => toast({ id: "save-fail", kind: "warning", title: "Couldn't save the project", message: "Browser storage may be full. Delete old projects or save a project file from Export.", action: { label: "Open projects", onClick: () => setShowProjects(true) } }),
  });
  const { doc, meta } = project;

  const setVideo = useCallback((f: File | null) => {
    setVideoUrl((old) => { if (old) URL.revokeObjectURL(old); return f ? URL.createObjectURL(f) : null; });
    setFile(f);
    setWaveform(null);
    setSrcDims({ w: 0, h: 0 });
    setVideoDuration(0);
    if (f) {
      project.setMeta({ videoName: f.name, videoSize: f.size });
      void import("@/lib/media").then((m) => m.computeWaveform(f)).then((w) => w && setWaveform(w));
    }
  }, [project]);

  // background music element source
  const musicId = doc.audio?.music?.assetId;
  useEffect(() => {
    let live = true;
    if (!musicId) { setMusicUrl(null); setMusicDuration(0); return; }
    void assetUrl(musicId).then((u) => live && setMusicUrl(u));
    void getAsset(musicId).then((a) => live && setMusicDuration(a?.duration ?? 0));
    return () => { live = false; };
  }, [musicId]);

  /* ---------- derived timeline ---------- */
  const srcDuration = videoDuration || meta.duration || 0;
  const lastWordEnd = doc.words.length ? doc.words[doc.words.length - 1].end + doc.offset : 0;
  const clips: Clip[] = useMemo(() => {
    const d = srcDuration > 0 ? srcDuration : Math.max(1, lastWordEnd + 1);
    return effectiveClips(doc, d);
  }, [doc, srcDuration, lastWordEnd]);
  const tl: EditTimeline = useMemo(() => buildTimeline(clips), [clips]);
  const outWords = useMemo(() => mapWords(doc.words, doc.offset, tl), [doc.words, doc.offset, tl]);
  const aspect = useMemo(() => {
    const sw = srcDims.w || 1080;
    const sh = srcDims.h || 1920;
    const o = outputSize(sw, sh, doc.frame.aspect, 0);
    return o.w / o.h;
  }, [srcDims, doc.frame.aspect]);
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    const f = () => { clearMeasureCache(); setFontsTick((n) => n + 1); };
    document.fonts?.addEventListener?.("loadingdone", f);
    return () => document.fonts?.removeEventListener?.("loadingdone", f);
  }, []);
  const s = doc.style;
  const lines: CaptionLine[] = useMemo(() => {
    const measure = makeMeasure(s);
    const ls = groupWords(outWords, s, { measure, aspect });
    // per-caption "hold longer"
    for (let i = 0; i < ls.length; i++) {
      const ext = doc.overrides[ls[i].key]?.extend;
      if (ext) ls[i].end = Math.min(ls[i].end + ext, ls[i + 1] ? ls[i + 1].start - 0.01 : ls[i].end + ext);
    }
    return ls;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outWords, s.maxWords, s.maxRows, s.breakOnPause, s.minDuration, s.maxWidthPct, s.sizeVh, s.wordGap, s.font, s.weight, s.letterSpacing, aspect, doc.overrides, fontsTick]);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  // extra videos and image clips: make their files available to the player and renderer
  const mediaIds = useMemo(() => [...new Set(clips.flatMap((c) => (c.kind === "video" && c.sourceId ? [c.sourceId] : c.kind === "image" ? [c.assetId] : [])))].sort().join(","), [clips]);
  useEffect(() => {
    let live = true;
    const ids = mediaIds ? mediaIds.split(",") : [];
    void Promise.all(ids.map(async (id) => [id, await assetUrl(id)] as const)).then((pairs) => {
      if (!live) return;
      setSourceUrls((old) => {
        const next: Record<string, string> = {};
        for (const [id, u] of pairs) if (u) next[id] = u;
        const same = Object.keys(next).length === Object.keys(old).length && Object.keys(next).every((k) => old[k] === next[k]);
        return same ? old : next;
      });
    });
    return () => { live = false; };
  }, [mediaIds]);

  /* ---------- playback ---------- */
  const playback: PlaybackApi = usePlayback(videoRef, musicRef, extraVideos);
  /** Voice enhancer A/B: true plays the untouched sound (not saved). */
  const [voiceOriginal, setVoiceOriginal] = useState(false);
  /** Full-screen export screen (null = closed). */
  const [exportView, setExportView] = useState<ExportView | null>(null);
  // decoded sound effects for live preview
  const [soundBuffers, setSoundBuffers] = useState<Map<string, AudioBuffer>>(() => new Map());
  const soundIds = useMemo(() => [...new Set((doc.sounds ?? []).map((x) => x.assetId))].sort().join(","), [doc.sounds]);
  useEffect(() => {
    let live = true;
    const ids = soundIds ? soundIds.split(",") : [];
    const missing = ids.filter((id) => !soundBuffers.has(id));
    if (!missing.length) return;
    void Promise.all(missing.map((id) => decodeAudioAsset(id).then((b) => [id, b] as const).catch(() => null))).then((res) => {
      if (!live) return;
      setSoundBuffers((m) => { const n = new Map(m); for (const r of res) if (r) n.set(r[0], r[1]); return n; });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundIds]);
  useEffect(() => {
    playback.setInputs({ tl, audio: doc.audio ?? DEFAULT_AUDIO, words: outWords, hasVideo: !!videoUrl, musicDuration, sounds: doc.sounds, soundBuffers });
  }, [playback, tl, doc.audio, outWords, videoUrl, musicDuration, doc.sounds, soundBuffers]);
  const timeStore = useRef(createTimeStore()).current;

  /* ---------- UI state ---------- */
  const [panel, setPanelState] = useState<PanelId>("templates");
  const [flashPanel, setFlashPanel] = useState<PanelId | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "line">("all");
  const [showProjects, setShowProjects] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [work, setWork] = useState<{ label: string; progress?: number } | null>(null);
  const [server, setServer] = useState<ServerInfo>({ serverElevenLabs: false, serverSarvam: false });
  const [serverLoaded, setServerLoaded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [wm, setWm] = useState<UnlockStatus>({ unlocked: false, available: true });
  const [recent, setRecent] = useState<ProjectRecord[]>([]);
  const [translating, setTranslating] = useState(false);

  const setPanel = useCallback((id: PanelId, flash = false) => {
    setPanelState(id);
    if (settings.panelCollapsed) setSettings({ panelCollapsed: false });
    if (flash) { setFlashPanel(id); window.setTimeout(() => setFlashPanel((p) => (p === id ? null : p)), 1400); }
  }, [settings.panelCollapsed, setSettings]);

  const openKeySetup = useCallback(() => {
    setPanel("settings", true);
    window.setTimeout(() => {
      const el = document.getElementById("elevenlabs-key-input") as HTMLInputElement | null;
      el?.closest(".section, .key-card, section")?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
    }, 350);
  }, [setPanel]);

  /* ---------- transcription ---------- */
  const refreshServer = useCallback(async (): Promise<ServerInfo | null> => {
    try {
      const r = await fetch("/api/config", { cache: "no-store" });
      if (!r.ok) return null;
      const c = (await r.json()) as ServerInfo;
      setServer(c);
      return c;
    } catch { return null; }
  }, []);
  const WAITING = "acg:captionWaitingForKey";
  const transcription = useTranscription({
    project, settings, setSettings, serverHasKey: server.serverElevenLabs, toast, dismiss,
    confirm: dialog.confirm, openKeySetup, setWork, setWaveform,
    onDone: () => { try { sessionStorage.removeItem(WAITING); } catch { /* ignore */ } setPanel("captions"); },
    videoDuration: () => videoRef.current?.duration || videoDuration,
    recheckServer: async () => !!(await refreshServer())?.serverElevenLabs,
    onWaitingForKey: () => { try { sessionStorage.setItem(WAITING, project.meta.videoName || "1"); } catch { /* ignore */ } },
  });

  /* ---------- export ---------- */
  const exporter = useExport();

  /* ---------- word editing through the edit list ---------- */
  /** Shift source words so an output-time gesture lands where the user dropped it. */
  const retimeLine = useCallback((key: string, start: number, end: number, mode: "move" | "start" | "end") => {
    const line = linesRef.current.find((l) => l.key === key);
    if (!line) return;
    const it = itemAt(tl, (line.start + line.end) / 2);
    const clip = it?.clip.kind === "video" ? it.clip : null;
    const ids = line.words.map((w) => baseWordId(w.id));
    project.update((d) => {
      const words = d.words;
      const first = words.findIndex((w) => w.id === ids[0]);
      const last = words.findIndex((w) => w.id === ids[ids.length - 1]);
      if (first < 0 || last < 0) return d;
      const prevEnd = first > 0 ? words[first - 1].end : 0;
      const nextStart = last < words.length - 1 ? words[last + 1].start : Infinity;
      const lo = clip ? clip.srcStart - d.offset : -Infinity;
      const hi = clip ? clip.srcEnd - d.offset : Infinity;
      const next = words.slice();
      if (mode === "move") {
        let delta = start - line.start;
        delta = Math.max(delta, Math.max(prevEnd, lo) - words[first].start);
        delta = Math.min(delta, Math.min(nextStart, hi) - words[last].end);
        for (let i = first; i <= last; i++) next[i] = { ...words[i], start: +(words[i].start + delta).toFixed(3), end: +(words[i].end + delta).toFixed(3) };
      } else if (mode === "start") {
        const delta = start - line.start;
        const ns = Math.min(Math.max(words[first].start + delta, prevEnd, lo), words[first].end - 0.05);
        next[first] = { ...words[first], start: +ns.toFixed(3) };
      } else {
        const delta = end - line.end;
        const ne = Math.max(Math.min(words[last].end + delta, nextStart, hi), words[last].start + 0.05);
        next[last] = { ...words[last], end: +ne.toFixed(3) };
      }
      return { ...d, words: next };
    }, { history: false });
  }, [project, tl]);

  /** Apply a change to one source word (by output or source id). */
  const updateWord = useCallback((id: string, p: Partial<Word> | ((w: Word) => Partial<Word>), coalesce?: string) => {
    const bid = baseWordId(id);
    project.update((d) => ({ ...d, words: d.words.map((w) => (w.id === bid ? { ...w, ...(typeof p === "function" ? p(w) : p) } : w)) }), { coalesce });
  }, [project]);

  /* ---------- layers & clips ---------- */
  const addLayer = useCallback((l: Layer) => {
    project.update((d) => ({ ...d, layers: [...(d.layers ?? []), l] }));
    setSelection({ kind: "layer", id: l.id });
    // show it settled: on its first frame an entrance animation is still at 0 % opacity,
    // so a paused playhead sitting exactly on `start` would show nothing until it moved
    const m = { ...DEFAULT_MOTION, ...l.motion };
    const settled = l.start + m.delay + (m.in === "none" ? 0 : m.duration) + 0.05;
    const t = playback.getTime();
    if (!playback.playing && t >= l.start - 0.01 && t < settled && settled < l.end) playback.seek(Math.min(settled, l.end - 0.05));
  }, [project, playback]);
  const updateLayer = useCallback((id: string, p: Partial<Layer>, coalesce?: string) => {
    project.update((d) => ({ ...d, layers: (d.layers ?? []).map((l) => (l.id === id ? { ...l, ...p } : l)) }), { coalesce: coalesce ?? `layer:${id}:${Object.keys(p).join(",")}` });
  }, [project]);
  const removeLayer = useCallback((id: string) => {
    project.update((d) => ({ ...d, layers: (d.layers ?? []).filter((l) => l.id !== id) }));
    setSelection(null);
  }, [project]);
  const setClips = useCallback((next: Clip[], coalesce?: string) => {
    project.update((d) => ({ ...d, clips: next }), coalesce ? { coalesce } : undefined);
  }, [project]);
  const nextZ = useCallback(() => Math.max(CAPTION_Z, ...(project.docRef.current.layers ?? []).map((l) => l.z)) + 1, [project]);

  /* ---------- adding media ---------- */
  const isVideoFile = (f: File) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name);
  const isImageFile = (f: File) => /^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(f.type) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name);

  /** Put a clip on the timeline and move the playhead to it. `t` defaults to the playhead. */
  const placeClip = useCallback((clip: Clip, where: InsertWhere, t?: number) => {
    const at0 = t ?? playback.getTime();
    // an empty project has a stand-in main clip with no file behind it: start the timeline from the new media instead
    const base = project.docRef.current.clips?.length || file || project.docRef.current.words.length ? clips : [];
    const r = insertClip(base, clip, where, at0, () => uid("c"));
    setClips(r.clips);
    setSelection({ kind: "clip", id: clip.id });
    playback.pause();
    playback.seek(r.at + 0.01);
    return r.at;
  }, [clips, setClips, playback, project, file]);

  /**
   * Add a video or image file as a clip on the timeline (stored in this browser as an asset).
   * Videos keep their own sound; images show for 4 s and can be trimmed like any clip.
   */
  const addMediaClip = useCallback(async (f: File, where: InsertWhere, t?: number): Promise<boolean> => {
    try {
      if (isVideoFile(f)) {
        if (f.size > 800e6) throw new Error("Added videos up to 800 MB, please. Trim it first or use it as the main video.");
        setWork({ label: `Adding ${f.name}…` });
        const meta = await probeMedia(f);
        const a = await putAsset(f, f.name, "video", meta);
        await assetUrl(a.id);
        const dur = meta.duration && Number.isFinite(meta.duration) ? meta.duration : 5;
        const clip: VideoClip = { id: uid("c"), kind: "video", sourceId: a.id, srcDuration: dur, name: baseName(f.name), srcStart: 0, srcEnd: dur };
        placeClip(clip, where, t);
        toast({ kind: "success", title: "Video added to the timeline", message: "Drag its edges to trim it, or drag the clip to move it.", duration: 3000 });
      } else if (isImageFile(f) && !/svg/.test(f.type) && !/\.svg$/i.test(f.name)) {
        if (f.size > 25e6) throw new Error("Images up to 25 MB, please.");
        const meta = await probeMedia(f);
        const a = await putAsset(f, f.name, "image", meta);
        await assetUrl(a.id);
        const clip: ImageClip = { id: uid("c"), kind: "image", assetId: a.id, name: baseName(f.name), duration: 4, kenBurns: 1.08 };
        placeClip(clip, where, t);
        toast({ kind: "success", title: "Image added to the timeline", message: "It shows for 4 s. Drag its edge to change that.", duration: 3000 });
      } else throw new Error("Use a video (MP4, MOV, WebM) or an image (PNG, JPG, WebP, GIF).");
      return true;
    } catch (e) {
      toast({ kind: "error", title: "Couldn't add that file", message: (e as Error).message });
      return false;
    } finally {
      setWork(null);
    }
  }, [placeClip, toast]);

  /** Add an image, logo or SVG as a graphic layer on top of the video (at the playhead, 4 s). */
  const addGraphicFile = useCallback(async (f: File, pos?: { x: number; y: number }): Promise<boolean> => {
    try {
      const d = project.docRef.current;
      const dur = buildTimeline(effectiveClips(d, srcDuration > 0 ? srcDuration : Math.max(1, lastWordEnd + 1))).duration;
      const time = playback.getTime();
      const at = Math.max(0, Math.min(time, Math.max(0, dur - 0.5)));
      const end = Math.max(at + 3, Math.min(dur || at + 4, at + 4));
      const x = pos?.x ?? 50, y = pos?.y ?? 40;
      if (f.type === "image/svg+xml" || /\.svg$/i.test(f.name)) {
        const r = sanitizeSvg(await f.text());
        const ratio = r.height / r.width;
        const w = 40;
        addLayer({ id: uid("L"), kind: "svg", name: baseName(f.name), svg: r.svg, start: at, end, x, y, w, h: Math.min(80, w * ratio * aspect), rotation: 0, opacity: 1, z: nextZ(), motion: { ...DEFAULT_MOTION, in: "pop", easing: "back" } });
        if (r.removed.length) toast({ kind: "info", title: "SVG cleaned for safety", message: `Removed: ${r.removed.join(", ")}.` });
      } else if (isImageFile(f)) {
        if (f.size > 15e6) throw new Error("Images up to 15 MB, please.");
        const meta = await probeMedia(f);
        const a = await putAsset(f, f.name, "image", meta);
        await assetUrl(a.id);
        const ratio = (meta.height ?? 1) / (meta.width ?? 1);
        const w = 40;
        addLayer({ id: uid("L"), kind: "image", name: baseName(f.name), assetId: a.id, start: at, end, x, y, w, h: Math.min(80, w * ratio * aspect), rotation: 0, opacity: 1, z: nextZ(), motion: { ...DEFAULT_MOTION } });
      } else throw new Error("Use an SVG, PNG, JPG, WebP or GIF image.");
      setPanel("graphics");
      toast({ kind: "success", title: "Image added on top of the video", message: "Drag it to move, use the corner to resize. Its text, size and timing are in the Graphics panel.", duration: 3200 });
      return true;
    } catch (e) {
      toast({ kind: "error", title: "Couldn't add that image", message: e instanceof UnsafeSvgError ? e.message : (e as Error).message });
      return false;
    }
  }, [project, srcDuration, lastWordEnd, playback, aspect, addLayer, nextZ, toast, setPanel]);

  /* ---------- files ---------- */
  const fileInput = useRef<HTMLInputElement | null>(null);

  const loadVideo = useCallback(async (f: File) => {
    const hasContent = !!file || project.docRef.current.words.length > 0;
    let id = meta.id;
    if (hasContent || !id) {
      const rec = blankRecord();
      rec.name = baseName(f.name);
      // keep the current look for the next video
      rec.style = project.docRef.current.style;
      rec.frame = project.docRef.current.frame;
      project.apply(rec);
      id = rec.id;
    } else {
      project.setMeta({ name: baseName(f.name) });
    }
    setVideo(f);
    project.setMeta({ thumb: undefined, videoName: f.name, videoSize: f.size });
    project.update((d) => ({ ...d, trim: NO_TRIM, clips: undefined }), { history: false });
    playback.seek(0);
    const saved = await saveProjectVideo(id, f);
    if (!saved) toast({ kind: "info", title: "Video not kept for later", message: "Browser storage is full, so this video won't come back after a refresh. Delete old projects to free space." });
    if (settings.autoTranscribe) {
      if (settings.askBeforeCaptioning) setPrepareFile(f);
      else void transcription.transcribe(f);
    } else toast({ kind: "info", title: "Video loaded", message: "Choose “Auto caption” to transcribe it." });
  }, [file, meta.id, project, setVideo, settings.autoTranscribe, settings.askBeforeCaptioning, transcription, toast, playback]);

  const openProjectFile = useCallback(async (f: File) => {
    try {
      const p = migrate(JSON.parse(await f.text()) as ProjectFile & Partial<ProjectDoc>);
      if (p.app !== "capmitra") throw new Error("This isn't a CapMitra project file.");
      project.update((d) => ({
        ...d, words: p.words, style: p.style, offset: p.offset ?? 0, overrides: p.overrides ?? {},
        frame: p.frame ? { ...d.frame, ...p.frame } : d.frame, trim: p.trim ?? d.trim,
        clips: p.clips, layers: p.layers, audio: p.audio, translations: p.translations, speakers: p.speakers, language: p.language,
      }));
      toast({ kind: "success", title: "Project file opened", message: p.videoName ? `Drop ${p.videoName} to see it with the video.` : undefined });
    } catch (e) {
      toast({ kind: "error", title: "Couldn't open that file", message: (e as Error).message });
    }
  }, [project, toast]);

  const importSubs = useCallback(async (f: File) => {
    const p = parseSubtitles(await f.text());
    if (!p.words.length) return toast({ kind: "error", title: "No captions found", message: `${f.name} has no subtitle cues.` });
    const speakers = p.speakers.length ? Object.fromEntries(p.speakers.map((n, i) => [n, { name: n, color: ["#22D3EE", "#FFD43B", "#FF6B9A", "#7CFF6B"][i % 4] }])) : undefined;
    project.update((d) => ({ ...d, words: p.words, speakers: speakers ?? d.speakers }));
    setPanel("captions");
    toast({ kind: "success", title: "Subtitles imported", message: `${p.cueCount} captions, ${p.words.length} words from ${f.name}.${p.wordTimed ? " Word timing came from the file." : " Word timing is estimated."}` });
  }, [project, toast, setPanel]);

  const handleFiles = useCallback((files: File[]) => {
    if (!files.length) {
      return toast({ kind: "error", title: "Nothing to open", message: "That item isn't a file. Drag the video from File Explorer, or choose it with Open video." });
    }
    const hasContent = !!file || project.docRef.current.words.length > 0;
    const videos = files.filter(isVideoFile);
    const asBefore = () => {
      // the original behaviour: one video opens a project, several open the batch view
      if (videos.length > 1) { setBatchSeed(files); setShowBatch(true); return; }
      const f = videos[0];
      toast({ kind: "info", title: "Video added", message: `${f.name} (${(f.size / 1e6).toFixed(1)} MB)`, duration: 2500 });
      void loadVideo(f);
    };
    if (videos.length && hasContent) {
      // more video while a project is open: add it to this timeline, or keep the old behaviour
      void dialog.confirm({
        title: videos.length > 1 ? `Add ${videos.length} videos to the timeline?` : "Add this video to the timeline?",
        message: videos.length > 1
          ? "They'll go at the end, one after another. You can move, trim and reorder them after."
          : `${videos[0].name} will go at the end of this video as a new clip (you can move or trim it after). Or open it as a separate project.`,
        confirmLabel: "Add to timeline", cancelLabel: videos.length > 1 ? "Open batch export" : "Open as a new project",
      }).then(async (add) => { if (add) { for (const f of videos) await addMediaClip(f, "end"); } else asBefore(); });
    } else if (videos.length) asBefore();
    for (const f of files) {
      if (isVideoFile(f)) continue;
      const n = f.name.toLowerCase();
      if (/\.(srt|vtt)$/.test(n)) void importSubs(f);
      else if (n.endsWith(".json")) void openProjectFile(f);
      else if (isImageFile(f)) {
        // an image dropped anywhere becomes a graphic on top of the video (an empty project gets it as a clip)
        if (hasContent) void addGraphicFile(f); else void addMediaClip(f, "end");
      } else if (f.type.startsWith("audio/") || /\.(avi|3gp|mpeg|mpg|ts|wmv)$/.test(n) || !f.type) {
        toast({ kind: "info", title: "Video added", message: `${f.name} (${(f.size / 1e6).toFixed(1)} MB)`, duration: 2500 });
        void loadVideo(f);
      } else toast({ kind: "error", title: "Unsupported file", message: `${f.name} isn't a video, image, subtitle or project file.` });
    }
  }, [file, project, dialog, loadVideo, importSubs, openProjectFile, addGraphicFile, addMediaClip, toast]);
  const [batchSeed, setBatchSeed] = useState<File[]>([]);

  /* ---------- projects ---------- */
  const openProject = useCallback(async (id: string) => {
    setWork({ label: "Loading project…" });
    const p = await getProject(id);
    if (!p) { setWork(null); return toast({ kind: "error", title: "Project not found", message: "It may have been deleted in another tab." }); }
    playback.pause();
    project.apply(p);
    const f = await getProjectVideo(id);
    setVideo(f);
    playback.seek(0);
    setSelection(null);
    setShowProjects(false);
    setShowBatch(false);
    setWork(null);
    toast({ kind: "success", title: `Opened “${p.name}”`, message: f ? undefined : "The video wasn't saved with this project. Drop it again to keep editing." });
  }, [project, setVideo, toast, playback]);

  const startNewProject = useCallback(() => {
    playback.pause();
    project.apply(blankRecord());
    setVideo(null);
    playback.seek(0);
    setSelection(null);
    setShowProjects(false);
  }, [project, setVideo, playback]);

  /* ---------- restore on load ---------- */
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    setSettingsState({ ...DEFAULT_SETTINGS, ...LS.get<Partial<Settings>>("acg:settings", {}) });
    setPresets(LS.get<CaptionStyle[]>("acg:presets", []));
    loadImportedPacks();
    void fetch("/api/login").then((r) => (r.ok ? r.json() : null)).then((d) => d && setLocked(!!d.locked)).catch(() => {});
    void loadWatermark().catch(() => {});
    void restoreUnlock().then((st) => {
      setWm(st);
      if (st.lapsed) toast({ id: "wm", kind: "warning", title: st.lapsed === "expired" ? "Your watermark code has expired" : "Your watermark code was switched off", message: "Exports include the watermark again. Ask Harsh for a new code in Export → Watermark." });
    });
    (async () => {
      const lastId = LS.get<string | null>("acg:lastProject", null);
      const p = lastId ? await getProject(lastId) : undefined;
      if (p) {
        project.apply(p);
        const f = await getProjectVideo(p.id);
        if (f) setVideo(f);
      } else {
        const legacy = LS.get<ProjectFile | null>("acg:project", null);
        const legacyVideo = await takeLegacyVideo();
        const rec = blankRecord();
        if (legacy?.words?.length || legacyVideo) {
          rec.words = legacy?.words ?? [];
          rec.style = legacy?.style ?? rec.style;
          rec.offset = legacy?.offset ?? 0;
          rec.videoName = legacyVideo?.name ?? legacy?.videoName;
          rec.name = baseName(rec.videoName ?? "Untitled");
          const { saveProject } = await import("@/lib/library");
          await saveProject(rec);
          if (legacyVideo) await saveProjectVideo(rec.id, legacyVideo);
          project.apply(rec);
          if (legacyVideo) setVideo(legacyVideo);
          try { localStorage.removeItem("acg:project"); } catch { /* ignore */ }
        } else project.apply(rec);
      }
      if (!window.isSecureContext) {
        toast({ kind: "info", title: "Opened from a network address", message: "Captioning works here, but video export needs http://localhost:3000 or an https:// link.", duration: 9000 });
      }
      await document.fonts?.ready;
      setReady(true);
      try {
        if (sessionStorage.getItem("acg:justUnlocked")) {
          sessionStorage.removeItem("acg:justUnlocked");
          toast({ kind: "success", title: "Studio unlocked", message: "Drop a video to get started.", duration: 3000 });
        }
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    const sp = document.getElementById("splash");
    if (sp) { sp.classList.add("done"); setTimeout(() => sp.remove(), 500); }
  }, [ready]);

  useEffect(() => {
    void refreshServer().finally(() => setServerLoaded(true));
    // coming back from /admin (or another tab) can change which keys this visitor may use
    const again = () => { if (document.visibilityState === "visible") void refreshServer(); };
    window.addEventListener("pageshow", again);
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => { window.removeEventListener("pageshow", again); window.removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); };
  }, [wm.unlocked, wm.name, refreshServer]);

  useVoiceEnhancer(videoRef, doc.audio?.voice, videoUrl, voiceOriginal);

  const isEmpty = !videoUrl && doc.words.length === 0 && !(doc.clips?.some((c) => c.kind !== "video" || c.sourceId));
  useEffect(() => {
    if (!ready || !isEmpty || showProjects) return;
    void listProjects().then((all) => setRecent(all.filter((p) => p.id !== meta.id && (p.words.length || p.videoName)).slice(0, 6)));
  }, [ready, isEmpty, showProjects, meta.id]);

  const showWm = !wm.unlocked || settings.keepWatermark;
  /** Something to export: a loaded video, or captions/graphics/title cards that don't need one. */
  const needsVideoFile = clips.some((c) => c.kind === "video" && !c.sourceId) && !file;
  const canExport = !isEmpty && !needsVideoFile && (!!file || lines.length > 0 || !!doc.layers?.length || !!doc.clips?.some((c) => c.kind !== "video" || c.sourceId));
  const needsKey = ready && serverLoaded && !elevenKeys(settings).length && !server.serverElevenLabs;
  const hasKey = ready && serverLoaded && (elevenKeys(settings).length > 0 || server.serverElevenLabs);

  // A video was added before a key was available (no key yet, or not signed in on /admin).
  // As soon as a key is available, caption it without asking again.
  useEffect(() => {
    if (!hasKey || !file || doc.words.length || transcription.busy) return;
    let waiting: string | null = null;
    try { waiting = sessionStorage.getItem(WAITING); } catch { /* ignore */ }
    if (!waiting || (waiting !== "1" && waiting !== meta.videoName)) return;
    try { sessionStorage.removeItem(WAITING); } catch { /* ignore */ }
    toast({ kind: "info", title: "Key ready", message: "Writing the captions for your video now.", duration: 3000 });
    void transcription.transcribe(file);
  }, [hasKey, file, doc.words.length, transcription, toast, meta.videoName]);
  const rules = useMemo(() => parseRules(settings.rules), [settings.rules]);

  /* ---------- undo / redo with feedback ---------- */
  const undo = useCallback(() => {
    if (!project.undo()) toast({ id: "undo", kind: "info", title: "Nothing to undo", duration: 1500 });
  }, [project, toast]);
  const redo = useCallback(() => { project.redo(); }, [project]);

  const name = baseName(meta.videoName || meta.name || "captions");

  return {
    toast, dismiss, dialog,
    settings, setSettings, presets, setPresets, theme, setTheme, ready,
    project, doc, meta, undo, redo,
    videoRef, musicRef, extraVideos, sourceUrls, file, videoUrl, setVideo, srcDims, setSrcDims, videoDuration, setVideoDuration, waveform, setWaveform,
    musicUrl, musicDuration,
    clips, tl, outWords, lines, aspect, srcDuration,
    playback, timeStore,
    panel, setPanel, flashPanel, selection, setSelection, selectedWordId, setSelectedWordId, scope, setScope,
    showProjects, setShowProjects, showBatch, setShowBatch, batchSeed, setBatchSeed,
    work, setWork, server, serverLoaded, locked, wm, setWm, recent, translating, setTranslating,
    transcription, exporter,
    retimeLine, updateWord, addLayer, updateLayer, removeLayer, setClips, nextZ, placeClip, addMediaClip, addGraphicFile,
    fileInput, loadVideo, openProjectFile, importSubs, handleFiles, openProject, startNewProject, openKeySetup,
    isEmpty, showWm, needsKey, rules, applyRules, name, newId, uid,
    voiceOriginal, setVoiceOriginal, exportView, setExportView, canExport,
    prepareFile, setPrepareFile,
  };
}

export type Editor = ReturnType<typeof useEditorState>;

const Ctx = createContext<Editor | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
  const v = useEditorState();
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

/** Playhead time (output timeline), updated ~12×/s by the stage's render loop. */
export function createTimeStore() {
  let t = 0;
  const subs = new Set<() => void>();
  return {
    get: () => t,
    set: (v: number) => { if (Math.abs(v - t) > 1e-4) { t = v; subs.forEach((f) => f()); } },
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}

export function useTime(): number {
  const { timeStore } = useEditor();
  return useSyncExternalStore(timeStore.subscribe, timeStore.get, () => 0);
}

export function useEditor(): Editor {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditor outside EditorProvider");
  return v;
}

export type { ProjectApi };
