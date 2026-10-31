/**
 * Languages, kept as three separate choices:
 *
 *   1. Transcription language: what is spoken (sent to ElevenLabs Scribe).
 *   2. Caption script:         how captions are written (native script, or
 *                              English letters: Gujlish / Roman Hindi / Hinglish).
 *   3. Translation language:   the optional second line (Sarvam AI).
 *
 * Only options the providers support are listed:
 *  - Scribe v2 languages: https://elevenlabs.io/docs/overview/capabilities/speech-to-text
 *    (codes are ISO 639-3; the API also accepts the 2-letter codes this app has always
 *    sent for gu/hi/en, which are kept so saved transcripts stay valid).
 *  - Sarvam translate: https://docs.sarvam.ai/api-reference-docs/text/translate-text
 *    mayura:v1 = 11 languages (+ auto-detect, roman output); sarvam-translate:v1 = 22.
 */

export type ScriptId = "Gujr" | "Deva" | "Latn" | "Beng" | "Taml" | "Telu" | "Knda" | "Mlym" | "Guru" | "Orya" | "Arab" | "Thai" | "Jpan" | "Hans" | "Kore" | "Cyrl" | "Grek" | "Hebr" | "Other";

export interface Language {
  /** Value stored in settings and sent to Scribe as language_code. */
  code: string;
  /** English name. */
  name: string;
  /** Name in its own script. */
  native: string;
  /** Main writing system. */
  script: ScriptId;
  /** Sarvam code (e.g. "gu-IN") when Sarvam can translate it. */
  sarvam?: string;
  /** Sarvam model that supports it. */
  sarvamModel?: "mayura:v1" | "sarvam-translate:v1";
  /** Can captions be shown in English letters? (local romaniser available) */
  roman?: boolean;
  /** Scribe accuracy tier, for an honest hint in the UI. */
  tier: "excellent" | "high" | "good" | "moderate";
  group: "india" | "world";
}

export const LANGUAGES: Language[] = [
  // India first
  { code: "gu", name: "Gujarati", native: "ગુજરાતી", script: "Gujr", sarvam: "gu-IN", sarvamModel: "mayura:v1", roman: true, tier: "high", group: "india" },
  { code: "hi", name: "Hindi", native: "हिन्दी", script: "Deva", sarvam: "hi-IN", sarvamModel: "mayura:v1", roman: true, tier: "high", group: "india" },
  { code: "en", name: "English", native: "English", script: "Latn", sarvam: "en-IN", sarvamModel: "mayura:v1", tier: "excellent", group: "india" },
  { code: "mar", name: "Marathi", native: "मराठी", script: "Deva", sarvam: "mr-IN", sarvamModel: "mayura:v1", roman: true, tier: "high", group: "india" },
  { code: "ben", name: "Bengali", native: "বাংলা", script: "Beng", sarvam: "bn-IN", sarvamModel: "mayura:v1", tier: "high", group: "india" },
  { code: "tam", name: "Tamil", native: "தமிழ்", script: "Taml", sarvam: "ta-IN", sarvamModel: "mayura:v1", tier: "high", group: "india" },
  { code: "tel", name: "Telugu", native: "తెలుగు", script: "Telu", sarvam: "te-IN", sarvamModel: "mayura:v1", tier: "high", group: "india" },
  { code: "kan", name: "Kannada", native: "ಕನ್ನಡ", script: "Knda", sarvam: "kn-IN", sarvamModel: "mayura:v1", tier: "excellent", group: "india" },
  { code: "mal", name: "Malayalam", native: "മലയാളം", script: "Mlym", sarvam: "ml-IN", sarvamModel: "mayura:v1", tier: "excellent", group: "india" },
  { code: "pan", name: "Punjabi", native: "ਪੰਜਾਬੀ", script: "Guru", sarvam: "pa-IN", sarvamModel: "mayura:v1", tier: "good", group: "india" },
  { code: "ori", name: "Odia", native: "ଓଡ଼ିଆ", script: "Orya", sarvam: "od-IN", sarvamModel: "mayura:v1", tier: "high", group: "india" },
  { code: "nep", name: "Nepali", native: "नेपाली", script: "Deva", sarvam: "ne-IN", sarvamModel: "sarvam-translate:v1", roman: true, tier: "high", group: "india" },
  { code: "asm", name: "Assamese", native: "অসমীয়া", script: "Beng", sarvam: "as-IN", sarvamModel: "sarvam-translate:v1", tier: "good", group: "india" },
  { code: "urd", name: "Urdu", native: "اردو", script: "Arab", sarvam: "ur-IN", sarvamModel: "sarvam-translate:v1", tier: "moderate", group: "india" },
  { code: "snd", name: "Sindhi", native: "سنڌي", script: "Arab", sarvam: "sd-IN", sarvamModel: "sarvam-translate:v1", tier: "moderate", group: "india" },
  // World (Scribe only; translation of these is not offered by Sarvam)
  { code: "spa", name: "Spanish", native: "Español", script: "Latn", tier: "excellent", group: "world" },
  { code: "fra", name: "French", native: "Français", script: "Latn", tier: "excellent", group: "world" },
  { code: "deu", name: "German", native: "Deutsch", script: "Latn", tier: "excellent", group: "world" },
  { code: "por", name: "Portuguese", native: "Português", script: "Latn", tier: "excellent", group: "world" },
  { code: "ita", name: "Italian", native: "Italiano", script: "Latn", tier: "excellent", group: "world" },
  { code: "ind", name: "Indonesian", native: "Bahasa Indonesia", script: "Latn", tier: "excellent", group: "world" },
  { code: "tur", name: "Turkish", native: "Türkçe", script: "Latn", tier: "excellent", group: "world" },
  { code: "rus", name: "Russian", native: "Русский", script: "Cyrl", tier: "excellent", group: "world" },
  { code: "jpn", name: "Japanese", native: "日本語", script: "Jpan", tier: "excellent", group: "world" },
  { code: "vie", name: "Vietnamese", native: "Tiếng Việt", script: "Latn", tier: "excellent", group: "world" },
  { code: "cmn", name: "Mandarin Chinese", native: "中文", script: "Hans", tier: "high", group: "world" },
  { code: "fas", name: "Persian", native: "فارسی", script: "Arab", tier: "high", group: "world" },
  { code: "fil", name: "Filipino", native: "Filipino", script: "Latn", tier: "high", group: "world" },
  { code: "swa", name: "Swahili", native: "Kiswahili", script: "Latn", tier: "high", group: "world" },
  { code: "ara", name: "Arabic", native: "العربية", script: "Arab", tier: "good", group: "world" },
  { code: "kor", name: "Korean", native: "한국어", script: "Kore", tier: "good", group: "world" },
  { code: "tha", name: "Thai", native: "ไทย", script: "Thai", tier: "good", group: "world" },
  { code: "heb", name: "Hebrew", native: "עברית", script: "Hebr", tier: "good", group: "world" },
];

/** Older settings used these codes; map them to the list above. */
const ALIASES: Record<string, string> = {
  guj: "gu", hin: "hi", eng: "en", mr: "mar", bn: "ben", ta: "tam", te: "tel", kn: "kan", ml: "mal", pa: "pan",
  or: "ori", od: "ori", ne: "nep", as: "asm", ur: "urd", es: "spa", fr: "fra", de: "deu", pt: "por", it: "ita",
  ja: "jpn", zh: "cmn", zho: "cmn", ko: "kor", ar: "ara", ru: "rus", tr: "tur", th: "tha", vi: "vie", id: "ind",
};

export const AUTO = "auto";

export function languageByCode(code: string | undefined | null): Language | undefined {
  if (!code) return undefined;
  const c = code.toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.find((l) => l.code === c) ?? LANGUAGES.find((l) => l.code === ALIASES[c]);
}

export const isSupportedTranscription = (code: string) => code === AUTO || !!languageByCode(code);

/** Readable name, e.g. "Gujarati". */
export const languageName = (code: string | undefined | null) => (code === AUTO ? "Detected automatically" : languageByCode(code)?.name ?? code ?? "");

/* ---------- caption script ---------- */

/**
 * How caption text is written.
 *  native  – the language's own script (ગુજરાતી, हिन्दी, …)
 *  roman   – strict English-letter spelling of every word (Roman Hindi / Roman Gujarati)
 *  casual  – Hinglish / Gujlish: English letters, and English words borrowed into the
 *            speech (वीडियो, લાઇક) written the English way (video, like)
 * "gujlish" is the name older projects saved; it means "casual".
 */
export type CaptionScript = "native" | "roman" | "casual" | "gujlish";

export const normaliseScript = (s: string | undefined): "native" | "roman" | "casual" => (s === "gujlish" ? "casual" : s === "roman" || s === "casual" ? s : "native");

export interface ScriptOption { value: "native" | "roman" | "casual"; label: string; hint: string }

/** Script choices that make sense for a spoken language. */
export function scriptOptions(code: string): ScriptOption[] {
  const l = languageByCode(code);
  if (!l || l.script === "Latn") return [{ value: "native", label: l ? `${l.name} as spoken` : "As spoken", hint: "" }];
  if (!l.roman) return [{ value: "native", label: `${l.native} (${l.name} script)`, hint: "" }];
  if (l.code === "gu") {
    return [
      { value: "native", label: "ગુજરાતી (Gujarati script)", hint: "નમસ્તે મિત્રો" },
      { value: "casual", label: "Gujlish (English letters)", hint: "namaste mitro, like karo" },
      { value: "roman", label: "Roman Gujarati (strict)", hint: "every word spelled out" },
    ];
  }
  if (l.code === "hi") {
    return [
      { value: "native", label: "हिन्दी (Devanagari)", hint: "नमस्ते दोस्तों" },
      { value: "casual", label: "Hinglish (English letters)", hint: "namaste doston, video like karo" },
      { value: "roman", label: "Roman Hindi (strict)", hint: "every word spelled out" },
    ];
  }
  return [
    { value: "native", label: `${l.native} (${l.name} script)`, hint: "" },
    { value: "casual", label: `${l.name} in English letters`, hint: "" },
    { value: "roman", label: `Roman ${l.name} (strict)`, hint: "" },
  ];
}

/* ---------- quick presets shown in the language picker ---------- */

export interface LanguagePreset {
  id: string;
  label: string;
  transcription: string;
  script: "native" | "roman" | "casual";
  note: string;
}

export const PRESETS: LanguagePreset[] = [
  { id: "gu", label: "Gujarati", transcription: "gu", script: "native", note: "Gujarati speech, Gujarati script" },
  { id: "gujlish", label: "Gujlish", transcription: "gu", script: "casual", note: "Gujarati speech, written in English letters" },
  { id: "hi", label: "Hindi", transcription: "hi", script: "native", note: "Hindi speech, Devanagari script" },
  { id: "hinglish", label: "Hinglish", transcription: "hi", script: "casual", note: "Hindi + English mixed, all in English letters" },
  { id: "roman-hi", label: "Roman Hindi", transcription: "hi", script: "roman", note: "Hindi speech, every word in English letters" },
  { id: "en", label: "English", transcription: "en", script: "native", note: "English speech" },
  { id: "auto", label: "Detect", transcription: AUTO, script: "native", note: "Scribe detects the spoken language" },
];

/* ---------- translation ---------- */

export interface TranslationTarget { code: string; name: string; model: "mayura:v1" | "sarvam-translate:v1" }

/** Languages Sarvam can translate into, English first. */
export const TRANSLATION_TARGETS: TranslationTarget[] = [
  { code: "en-IN", name: "English", model: "mayura:v1" },
  ...LANGUAGES.filter((l) => l.sarvam && l.sarvam !== "en-IN").map((l) => ({ code: l.sarvam!, name: l.name, model: l.sarvamModel! })),
];

/**
 * Sarvam settings for translating from `spoken` into `target`, or null when
 * the pair isn't supported (e.g. Spanish speech).
 */
export function translationPlan(spoken: string, target: string): { source: string; target: string; model: "mayura:v1" | "sarvam-translate:v1" } | null {
  const t = TRANSLATION_TARGETS.find((x) => x.code === target);
  if (!t) return null;
  if (spoken === AUTO) return t.model === "mayura:v1" ? { source: "auto", target, model: "mayura:v1" } : null;
  const s = languageByCode(spoken);
  if (!s?.sarvam || s.sarvam === target) return null;
  const model = s.sarvamModel === "mayura:v1" && t.model === "mayura:v1" ? "mayura:v1" : "sarvam-translate:v1";
  return { source: s.sarvam, target, model };
}

/* ---------- writing systems in text ---------- */

const RANGES: [ScriptId, RegExp][] = [
  ["Gujr", /[઀-૿]/],
  ["Deva", /[ऀ-ॿ꣠-ꣿ]/],
  ["Beng", /[ঀ-৿]/],
  ["Guru", /[਀-੿]/],
  ["Orya", /[଀-୿]/],
  ["Taml", /[஀-௿]/],
  ["Telu", /[ఀ-౿]/],
  ["Knda", /[ಀ-೿]/],
  ["Mlym", /[ഀ-ൿ]/],
  ["Arab", /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/],
  ["Hebr", /[֐-׿]/],
  ["Thai", /[฀-๿]/],
  ["Kore", /[가-힯ᄀ-ᇿ]/],
  ["Jpan", /[぀-ヿ]/],
  ["Hans", /[一-鿿]/],
  ["Cyrl", /[Ѐ-ӿ]/],
  ["Grek", /[Ͱ-Ͽ]/],
  ["Latn", /[A-Za-zÀ-ɏ]/],
];

/** Every writing system that appears in the text. */
export function scriptsIn(text: string): Set<ScriptId> {
  const out = new Set<ScriptId>();
  for (const [id, re] of RANGES) if (re.test(text)) out.add(id);
  return out;
}

/** Main writing system of a word. */
export function scriptOf(text: string): ScriptId {
  for (const [id, re] of RANGES) if (re.test(text)) return id;
  return "Other";
}
