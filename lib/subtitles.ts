/**
 * SRT / WebVTT import and export.
 *
 * Export: UTF-8 (SRT with a byte-order mark so Windows editors and Premiere
 * read Gujarati/Hindi correctly), cues sorted and never overlapping, VTT text
 * escaped, optional bilingual second line and speaker voices.
 *
 * Import: handles BOMs, CRLF, VTT headers / NOTE / STYLE / REGION blocks, cue
 * ids and settings, hours-less stamps, HTML entities, <i>/<b>/<font> tags,
 * {\an8} positioning tags, <v Speaker> voices, and karaoke word stamps
 * (<00:00:01.200>), which give exact per-word timing. Otherwise each cue's
 * time is shared out across its words by visible characters (graphemes), so
 * Gujarati vowel signs don't skew it.
 */
import { splitClusters } from "./animation";
import type { CaptionLine, Translations, Word } from "./types";
import { translationFor } from "./bilingual";

function stamp(sec: number, sep: "," | "."): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

export interface SubtitleOptions {
  /** How each word is written (e.g. romanised). Defaults to the word text. */
  text?: (w: Word) => string;
  /** Add each caption's translation as a second line. */
  translations?: Translations;
  /** Speaker names for VTT <v> voices. */
  speakers?: Record<string, { name: string }>;
  /** SRT only: start with a UTF-8 byte-order mark (default true). */
  bom?: boolean;
}

const wordText = (o: SubtitleOptions | undefined) => (w: Word) => (o?.text ? o.text(w) : w.text);
const lineText = (l: CaptionLine, o?: SubtitleOptions) => l.words.map(wordText(o)).join(" ");

/** Cues in order, each at least 0.1 s, never overlapping the next. */
function cues(lines: CaptionLine[], offset: number): { line: CaptionLine; start: number; end: number }[] {
  const sorted = lines.slice().sort((a, b) => a.start - b.start);
  return sorted.map((l, i) => {
    const start = Math.max(0, l.start + offset);
    let end = Math.max(start + 0.1, l.end + offset);
    const next = sorted[i + 1];
    if (next) end = Math.max(start + 0.05, Math.min(end, next.start + offset - 0.001));
    return { line: l, start, end };
  });
}

const escVtt = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toSRT(lines: CaptionLine[], offset = 0, o?: SubtitleOptions): string {
  const body = cues(lines, offset)
    .map(({ line, start, end }, i) => {
      const tr = o?.translations ? translationFor(line, o.translations)?.text : undefined;
      return `${i + 1}\n${stamp(start, ",")} --> ${stamp(end, ",")}\n${lineText(line, o)}${tr ? `\n${tr}` : ""}\n`;
    })
    .join("\n");
  return (o?.bom === false ? "" : "﻿") + body;
}

function voice(line: CaptionLine, o?: SubtitleOptions): string {
  const sp = line.words.find((w) => w.speaker)?.speaker;
  if (!sp) return "";
  const name = o?.speakers?.[sp]?.name ?? sp;
  return `<v ${escVtt(name).replace(/>/g, "")}>`;
}

export function toVTT(lines: CaptionLine[], offset = 0, o?: SubtitleOptions): string {
  return (
    "WEBVTT\n\n" +
    cues(lines, offset)
      .map(({ line, start, end }) => {
        const tr = o?.translations ? translationFor(line, o.translations)?.text : undefined;
        return `${stamp(start, ".")} --> ${stamp(end, ".")}\n${voice(line, o)}${escVtt(lineText(line, o))}${tr ? `\n${escVtt(tr)}` : ""}\n`;
      })
      .join("\n")
  );
}

/** VTT with per-word karaoke timestamps (<00:00:01.200>word), handy for players that support it. */
export function toWordVTT(lines: CaptionLine[], offset = 0, o?: SubtitleOptions): string {
  const t = wordText(o);
  return (
    "WEBVTT\n\n" +
    cues(lines, offset)
      .map(({ line, start, end }) => {
        const body = line.words
          .map((w, i) => {
            const ws = Math.min(end, Math.max(start, w.start + offset));
            return i === 0 ? escVtt(t(w)) : `<${stamp(ws, ".")}>${escVtt(t(w))}`;
          })
          .join(" ");
        return `${stamp(start, ".")} --> ${stamp(end, ".")}\n${voice(line, o)}${body}\n`;
      })
      .join("\n")
  );
}

export function toPlainText(lines: CaptionLine[], o?: SubtitleOptions): string {
  return lines
    .map((l) => {
      const tr = o?.translations ? translationFor(l, o.translations)?.text : undefined;
      return lineText(l, o) + (tr ? `\n${tr}` : "");
    })
    .join("\n");
}

/* ---------- import ---------- */

const STAMP = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

function parseStamp(s: string): number | null {
  const m = STAMP.exec(s.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0").slice(0, 3)) / 1000;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

let seq = 0;
export const newId = () => `w${Date.now().toString(36)}${(seq++).toString(36)}`;

export interface ParsedSubtitles {
  format: "srt" | "vtt";
  words: Word[];
  cueCount: number;
  /** Did the file have per-word timing (karaoke stamps)? */
  wordTimed: boolean;
  speakers: string[];
}

const visibleLength = (s: string) => Math.max(1, splitClusters(s).length);

export function parseSubtitles(text: string): ParsedSubtitles {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const format: "srt" | "vtt" = /^WEBVTT/.test(src.trimStart()) ? "vtt" : "srt";
  const words: Word[] = [];
  const speakers = new Set<string>();
  let cueCount = 0;
  let wordTimed = false;

  for (const block of src.split(/\n[ \t]*\n/)) {
    const rows = block.split("\n").filter((r) => r.trim().length);
    if (!rows.length) continue;
    const head = rows[0].trim();
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(head)) continue;
    const ti = rows.findIndex((r) => r.includes("-->"));
    if (ti < 0) continue;
    const [a, rest] = rows[ti].split("-->");
    const start = parseStamp(a);
    const end = parseStamp(rest ?? "");
    if (start === null || end === null || end < start) continue;

    let content = rows.slice(ti + 1).join("\n");
    // voice: <v Name> or <v.loud Name>
    let speaker: string | undefined;
    const vm = /<v(?:\.[^\s>]+)?\s+([^>]+)>/i.exec(content);
    if (vm) { speaker = decodeEntities(vm[1].trim()); speakers.add(speaker); }
    content = content.replace(/\{\\[^}]*\}/g, ""); // {\an8}
    // karaoke stamps → markers we can split on
    const parts: { t: number | null; text: string }[] = [];
    const tokenRe = /<(\d{0,2}:?\d{1,2}:\d{2}[.,]\d{1,3})>/g;
    let last = 0;
    let curT: number | null = null;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(content))) {
      parts.push({ t: curT, text: content.slice(last, m.index) });
      curT = parseStamp(m[1]);
      last = m.index + m[0].length;
      wordTimed = true;
    }
    parts.push({ t: curT, text: content.slice(last) });

    cueCount++;
    const cueWords: { text: string; t: number | null; br: boolean }[] = [];
    for (const p of parts) {
      const clean = decodeEntities(p.text.replace(/<[^>]+>/g, ""));
      const lines = clean.split("\n");
      lines.forEach((ln, li) => {
        ln.split(/\s+/).filter(Boolean).forEach((tok, k) => cueWords.push({ text: tok, t: k === 0 ? p.t : null, br: li > 0 && k === 0 }));
      });
    }
    if (!cueWords.length) continue;

    // timing: karaoke stamps where present, otherwise share by visible length
    const total = cueWords.reduce((n, w) => n + visibleLength(w.text), 0);
    let t = start;
    const times = cueWords.map((w) => {
      const s = w.t !== null && w.t >= start && w.t <= end ? w.t : t;
      const d = ((end - start) * visibleLength(w.text)) / total;
      t = s + d;
      return s;
    });
    cueWords.forEach((w, i) => {
      const s = Math.min(end - 0.02, times[i]);
      const e = Math.max(s + 0.02, Math.min(end, i + 1 < cueWords.length ? times[i + 1] : end));
      words.push({
        id: newId(), text: w.text, start: +s.toFixed(3), end: +e.toFixed(3),
        ...(i === 0 ? { breakBefore: true } : {}),
        ...(speaker ? { speaker } : {}),
      });
    });
  }
  words.sort((a, b) => a.start - b.start);
  return { format, words, cueCount, wordTimed, speakers: [...speakers] };
}

/** Back-compat: just the words. */
export function wordsFromSubtitles(text: string): Word[] {
  return parseSubtitles(text).words;
}

export function download(name: string, data: Blob | string, type = "text/plain;charset=utf-8") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
