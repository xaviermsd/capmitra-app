/**
 * Indian scripts → English letters, locally (no API, instant, free).
 *
 *   Gujarati   નમસ્તે મિત્રો  → namaste mitro          (Gujlish)
 *   Hindi      नमस्ते दोस्तों  → namaste doston        (Hinglish / Roman Hindi)
 *
 * Two styles:
 *   casual: the way people type on WhatsApp/Instagram: long vowels mostly
 *            single (khana, nahi), "aa" only where it's heard long in a closed
 *            syllable (kaam, aaj), and English loanwords written in English
 *            (वीडियो → video, લાઇક → like). Used for Gujlish and Hinglish.
 *   roman: strict: every long vowel doubled (aa, ee, oo), no loanword swaps.
 *
 * Hindi drops the inherent "a" inside words (कमरा → kamra, समझना → samajhna)
 * by the usual rule (a → ∅ / VC_CV, applied right to left, plus word-final).
 * Gujarati follows the same rule (આપણે → aapne); well-known names keep their usual
 * spelling (ગુજરાત → Gujarat). Casual Gujlish also drops a final nasal (કરીશું → karishu).
 *
 * Users can fix any word in Settings → "English-letter spellings"; a word's
 * own `roman` field (edited in the word editor) wins over everything.
 */
import type { Script, Word } from "./types";

type Style = "casual" | "roman";

interface Table {
  cons: Record<string, string>;
  nukta: Record<string, string>;
  vowels: Record<string, [string, string]>; // [casual, strict]
  matras: Record<string, [string, string]>;
  virama: string;
  nuktaSign: string;
  signs: Record<string, string>;
  digits: string;
  medialSchwaDeletion: boolean;
  /** Matra for long ā (shortened in casual style). */
  longA: string;
  /** Casual style keeps "aa" in a closed first syllable (Hindi: kaam, baat). */
  closedLongA: boolean;
  /** Casual style drops a word-final nasal (Gujlish: karishu, ma, chhu). */
  dropFinalNasal: boolean;
}

const GUJ: Table = {
  cons: {
    "ક": "k", "ખ": "kh", "ગ": "g", "ઘ": "gh", "ઙ": "n", "ચ": "ch", "છ": "chh", "જ": "j", "ઝ": "jh", "ઞ": "n",
    "ટ": "t", "ઠ": "th", "ડ": "d", "ઢ": "dh", "ણ": "n", "ત": "t", "થ": "th", "દ": "d", "ધ": "dh", "ન": "n",
    "પ": "p", "ફ": "f", "બ": "b", "ભ": "bh", "મ": "m", "ય": "y", "ર": "r", "લ": "l", "વ": "v", "શ": "sh",
    "ષ": "sh", "સ": "s", "હ": "h", "ળ": "l",
  },
  nukta: { "જ": "z", "ફ": "f" },
  vowels: {
    "અ": ["a", "a"], "આ": ["aa", "aa"], "ઇ": ["i", "i"], "ઈ": ["i", "ee"], "ઉ": ["u", "u"], "ઊ": ["u", "oo"], "ઋ": ["ru", "ru"],
    "એ": ["e", "e"], "ઐ": ["ai", "ai"], "ઓ": ["o", "o"], "ઔ": ["au", "au"], "ઍ": ["e", "e"], "ઑ": ["o", "o"],
  },
  matras: {
    "ા": ["a", "aa"], "િ": ["i", "i"], "ી": ["i", "ee"], "ુ": ["u", "u"], "ૂ": ["u", "oo"], "ૃ": ["ru", "ru"],
    "ે": ["e", "e"], "ૈ": ["ai", "ai"], "ો": ["o", "o"], "ૌ": ["au", "au"], "ૅ": ["e", "e"], "ૉ": ["o", "o"],
  },
  virama: "્",
  nuktaSign: "઼",
  signs: { "ં": "n", "ઁ": "n", "ઃ": "h", "ઽ": "" },
  digits: "૦૧૨૩૪૫૬૭૮૯",
  medialSchwaDeletion: true,
  longA: "ા",
  closedLongA: false,
  dropFinalNasal: true,
};

const DEVA: Table = {
  cons: {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
    "ष": "sh", "स": "s", "ह": "h", "ळ": "l",
  },
  nukta: { "क": "q", "ख": "kh", "ग": "gh", "ज": "z", "ड": "d", "ढ": "dh", "फ": "f", "य": "y" },
  vowels: {
    "अ": ["a", "a"], "आ": ["aa", "aa"], "इ": ["i", "i"], "ई": ["i", "ee"], "उ": ["u", "u"], "ऊ": ["u", "oo"], "ऋ": ["ri", "ri"],
    "ए": ["e", "e"], "ऐ": ["ai", "ai"], "ओ": ["o", "o"], "औ": ["au", "au"], "ऍ": ["e", "e"], "ऑ": ["o", "o"],
  },
  matras: {
    "ा": ["a", "aa"], "ि": ["i", "i"], "ी": ["i", "ee"], "ु": ["u", "u"], "ू": ["u", "oo"], "ृ": ["ri", "ri"],
    "े": ["e", "e"], "ै": ["ai", "ai"], "ो": ["o", "o"], "ौ": ["au", "au"], "ॅ": ["e", "e"], "ॉ": ["o", "o"],
  },
  virama: "्",
  nuktaSign: "़",
  signs: { "ं": "n", "ँ": "n", "ः": "h", "ऽ": "" },
  digits: "०१२३४५६७८९",
  medialSchwaDeletion: true,
  longA: "ा",
  closedLongA: true,
  dropFinalNasal: false,
};

export const hasGujarati = (s: string) => /[઀-૿]/.test(s);
export const hasDevanagari = (s: string) => /[ऀ-ॿ]/.test(s);

/* ---------- syllable analysis ---------- */

type Unit =
  | { k: "C"; roman: string; vowel: string | null; vowelKey: string | null; schwa: boolean } // consonant (+ matra / inherent a / none)
  | { k: "V"; roman: string; key: string } // independent vowel
  | { k: "S"; roman: string; key: string } // sign (anusvara, visarga)
  | { k: "X"; roman: string }; // anything else

function parse(word: string, t: Table, style: Style): Unit[] {
  const chars = Array.from(word.normalize("NFD"));
  const units: Unit[] = [];
  const si = style === "casual" ? 0 : 1;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (t.cons[c] !== undefined) {
      let roman = t.cons[c];
      let j = i + 1;
      if (chars[j] === t.nuktaSign) {
        roman = t.nukta[c] ?? roman;
        j++;
      }
      const next = chars[j];
      if (next === t.virama) {
        units.push({ k: "C", roman, vowel: null, vowelKey: null, schwa: false });
        i = j;
        continue;
      }
      if (next && t.matras[next]) {
        units.push({ k: "C", roman, vowel: t.matras[next][si], vowelKey: next, schwa: false });
        i = j;
        continue;
      }
      units.push({ k: "C", roman, vowel: "a", vowelKey: null, schwa: true });
      i = j - 1;
      continue;
    }
    if (t.vowels[c]) units.push({ k: "V", roman: t.vowels[c][si], key: c });
    else if (t.signs[c] !== undefined) units.push({ k: "S", roman: t.signs[c], key: c });
    else if (t.digits.includes(c)) units.push({ k: "X", roman: String(t.digits.indexOf(c)) });
    else if (c === "।" || c === "॥") units.push({ k: "X", roman: "." });
    else if (c === t.virama || c === t.nuktaSign || c === "‌" || c === "‍") continue;
    else units.push({ k: "X", roman: c });
  }
  return units;
}

const hasVowel = (u: Unit | undefined) => !!u && ((u.k === "C" && u.vowel !== null) || u.k === "V");

function deleteSchwas(units: Unit[], t: Table) {
  // word-final inherent a is silent (ગુજરાત → gujarat, भारत → bharat) unless the word is one letter
  let last = units.length - 1;
  while (last >= 0 && units[last].k === "X") last--;
  const lu = units[last];
  if (lu && lu.k === "C" && lu.schwa && units.filter((u) => u.k === "C" || u.k === "V").length > 1) lu.vowel = null;
  if (!t.medialSchwaDeletion) return;
  // a → ∅ / VC_CV, right to left (कमरा → kamra, समझना → samajhna, अपना → apna)
  for (let i = last - 1; i > 0; i--) {
    const u = units[i];
    if (u.k !== "C" || !u.schwa || u.vowel === null) continue;
    const prev = units[i - 1];
    const next = units[i + 1];
    if (!next || next.k !== "C" || next.vowel === null) continue;
    if (!hasVowel(prev)) continue;
    u.vowel = null;
  }
}

function render(units: Unit[], t: Table, style: Style): string {
  let out = "";
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.k === "C") {
      let v = u.vowel ?? "";
      if (style === "casual" && t.closedLongA && u.vowelKey === t.longA) {
        // Hindi long ā in the first syllable: "aa" when the syllable is closed (kaam, baat, pyaar),
        // otherwise "a" (khana, karna, gujarat)
        const next = units[i + 1];
        const firstSyllable = !units.slice(0, i).some(hasVowel);
        v = firstSyllable && next?.k === "C" && next.vowel === null ? "aa" : "a";
      }
      out += u.roman + v;
    } else if (u.k === "V") {
      // ए after an i-sound reads "ye" (लिए → liye)
      if ((u.key === "ए" || u.key === "એ") && /i$/.test(out)) out += "y";
      let v = u.roman;
      if (style === "casual" && (u.key === "आ" || u.key === "આ") && i > 0) {
        const next = units[i + 1];
        v = next && next.k === "C" && next.vowel === null ? "aa" : "a";
      }
      out += v;
    } else if (u.k === "S") {
      // anusvara before p/b/m sounds like m (अंबर → ambar)
      const next = units[i + 1];
      if (style === "casual" && t.dropFinalNasal && (u.key === "ં" || u.key === "ઁ") && !units.slice(i + 1).some((x) => x.k !== "X")) continue;
      if ((u.key === "ं" || u.key === "ં") && next?.k === "C" && /^(p|b|bh|m)$/.test(next.roman)) out += "m";
      else out += u.roman;
    } else out += u.roman;
  }
  // special clusters
  return out.replace(/jny/g, "gy").replace(/jn(?=[aeiou])/g, "gn");
}

function romanizeWith(word: string, t: Table, style: Style): string {
  const units = parse(word, t, style);
  deleteSchwas(units, t);
  return render(units, t, style);
}

/* ---------- English loanwords (casual style) ---------- */

/** Devanagari spellings; Gujarati spellings are derived (same letters, shifted block) plus a few extras below. */
const LOANS_DEVA: Record<string, string> = {
  "वीडियो": "video", "विडियो": "video", "वीडियोज़": "videos", "वीडियोज": "videos", "लाइक": "like", "लाइक्स": "likes", "शेयर": "share",
  "सब्सक्राइब": "subscribe", "चैनल": "channel", "कमेंट": "comment", "कमेंट्स": "comments", "फोन": "phone", "फ़ोन": "phone", "मोबाइल": "mobile",
  "ऑफिस": "office", "ऑफ़िस": "office", "स्कूल": "school", "कॉलेज": "college", "टाइम": "time", "प्लीज़": "please", "प्लीज": "please",
  "थैंक्यू": "thank you", "थैंक्स": "thanks", "सॉरी": "sorry", "ओके": "ok", "हेलो": "hello", "हैलो": "hello", "बाय": "bye",
  "लव": "love", "बेस्ट": "best", "टिप्स": "tips", "ट्रिक": "trick", "ट्रिक्स": "tricks", "ट्रिप": "trip", "कार": "car", "बाइक": "bike",
  "बिज़नेस": "business", "बिजनेस": "business", "मार्केट": "market", "प्रोडक्ट": "product", "ऑर्डर": "order", "डिलीवरी": "delivery",
  "ऑनलाइन": "online", "ऑफलाइन": "offline", "इंटरनेट": "internet", "ऐप": "app", "एप": "app", "वेबसाइट": "website", "लिंक": "link",
  "बायो": "bio", "पोस्ट": "post", "रील": "reel", "रील्स": "reels", "स्टोरी": "story", "फॉलो": "follow", "फॉलोअर्स": "followers",
  "लाइव": "live", "फ्री": "free", "ऑफर": "offer", "सेल": "sale", "प्राइस": "price", "क्वालिटी": "quality", "डिज़ाइन": "design",
  "डिजाइन": "design", "फैशन": "fashion", "स्टाइल": "style", "मेकअप": "makeup", "जिम": "gym", "फिटनेस": "fitness", "डाइट": "diet",
  "रेसिपी": "recipe", "टेस्टी": "tasty", "सुपर": "super", "न्यू": "new", "फैमिली": "family", "फ्रेंड": "friend", "फ्रेंड्स": "friends",
  "पार्टी": "party", "म्यूजिक": "music", "म्यूज़िक": "music", "सॉन्ग": "song", "डांस": "dance", "मूवी": "movie", "फिल्म": "film",
  "न्यूज़": "news", "न्यूज": "news", "अपडेट": "update", "कैमरा": "camera", "फोटो": "photo", "कंटेंट": "content", "क्रिएटर": "creator",
  "यूट्यूब": "YouTube", "इंस्टाग्राम": "Instagram", "व्हाट्सएप": "WhatsApp", "व्हाट्सऐप": "WhatsApp", "फेसबुक": "Facebook", "गूगल": "Google",
  "मैडम": "madam", "टीचर": "teacher", "डॉक्टर": "doctor", "हॉस्पिटल": "hospital", "बैंक": "bank", "पेमेंट": "payment", "कैश": "cash",
  "कार्ड": "card", "नंबर": "number", "एग्जाम": "exam", "रिजल्ट": "result", "क्लास": "class", "होमवर्क": "homework", "प्रोजेक्ट": "project",
  "टीम": "team", "मैच": "match", "गेम": "game", "लेवल": "level", "प्लान": "plan", "आइडिया": "idea", "स्टेप": "step", "टॉपिक": "topic",
  "पार्ट": "part", "फर्स्ट": "first", "लास्ट": "last", "नेक्स्ट": "next", "जॉब": "job", "सैलरी": "salary", "मीटिंग": "meeting",
  "प्रॉब्लम": "problem", "सॉल्यूशन": "solution", "सिंपल": "simple", "इजी": "easy", "हार्ड": "hard", "वर्क": "work", "होम": "home",
};
const LOANS_GUJ_EXTRA: Record<string, string> = {
  "શેર": "share", "સબ્સ્ક્રાઇબ": "subscribe", "સબસ્ક્રાઇબ": "subscribe", "કોમેન્ટ": "comment", "કમેન્ટ": "comment", "ચેનલ": "channel",
  "ફોલો": "follow", "રીલ": "reel", "રીલ્સ": "reels", "ઓકે": "ok", "થેંક્યુ": "thank you", "થેન્ક્યુ": "thank you", "બિઝનેસ": "business",
  "ઓનલાઇન": "online", "ઓનલાઈન": "online", "ઓર્ડર": "order", "ડિલિવરી": "delivery", "વેબસાઇટ": "website", "ઇન્સ્ટાગ્રામ": "Instagram",
  "યુટ્યુબ": "YouTube", "વોટ્સએપ": "WhatsApp", "વ્હોટ્સએપ": "WhatsApp", "ફેસબુક": "Facebook", "ગૂગલ": "Google", "ઓફર": "offer",
  "પ્રોડક્ટ": "product", "ક્વોલિટી": "quality", "ડિઝાઇન": "design", "ફેશન": "fashion", "સ્ટાઇલ": "style", "રેસીપી": "recipe", "રેસિપી": "recipe",
  "ટીપ્સ": "tips", "ટ્રીક": "trick", "ટ્રિક": "trick", "સિમ્પલ": "simple", "ઇઝી": "easy", "પ્રોબ્લેમ": "problem", "આઇડિયા": "idea",
};

/** Fuzzy key: same for both scripts and for common spelling variants (ि/ी, ु/ू, ँ/ं, nukta). */
function loanKey(w: string): string {
  let s = w.normalize("NFC");
  // Gujarati → Devanagari block (the letters line up 0x180 apart)
  s = Array.from(s, (ch) => {
    const cp = ch.codePointAt(0)!;
    return cp >= 0x0a80 && cp <= 0x0aff ? String.fromCodePoint(cp - 0x180) : ch;
  }).join("");
  return s.normalize("NFD").replace(/़/g, "").replace(/ी/g, "ि").replace(/ू/g, "ु").replace(/ँ/g, "ं").replace(/ॉ/g, "ो").replace(/ै/g, "े");
}

const LOANS = new Map<string, string>();
for (const [k, v] of Object.entries(LOANS_DEVA)) LOANS.set(loanKey(k), v);
for (const [k, v] of Object.entries(LOANS_GUJ_EXTRA)) LOANS.set(loanKey(k), v);

/** Gujarati/Hindi endings that may be glued to a loanword (વિડિયોમાં = video માં). */
const SUFFIXES = ["માં", "ને", "નો", "ની", "નું", "ના", "થી", "માંથી", "ઓ", "ों", "ओं", "में", "से", "का", "की", "के", "को"];

export function englishLoan(word: string): string | undefined {
  const bare = word.replace(/[.,!?।॥"'“”‘’:;()]/g, "");
  const hit = LOANS.get(loanKey(bare));
  if (hit) return hit;
  for (const suf of SUFFIXES) {
    if (bare.length > suf.length + 1 && bare.endsWith(suf)) {
      const stem = LOANS.get(loanKey(bare.slice(0, -suf.length)));
      if (stem) return `${stem} ${romanizeAuto(suf, "casual")}`;
    }
  }
  return undefined;
}

/** Names whose usual English spelling differs from the spoken form. */
const NAMES: Record<string, string> = {
  "ગુજરાત": "Gujarat", "गुजरात": "Gujarat", "ભારત": "Bharat", "भारत": "Bharat", "હિન્દુસ્તાન": "Hindustan", "हिंदुस्तान": "Hindustan",
  "મુંબઈ": "Mumbai", "मुंबई": "Mumbai", "દિલ્હી": "Delhi", "दिल्ली": "Delhi", "સુરત": "Surat", "सूरत": "Surat", "રાજકોટ": "Rajkot",
  "વડોદરા": "Vadodara", "અમદાવાદ": "Amdavad", "अहमदाबाद": "Ahmedabad", "ગાંધીનગર": "Gandhinagar", "કચ્છ": "Kutch", "सौराष्ट्र": "Saurashtra", "સૌરાષ્ટ્ર": "Saurashtra",
};

/* ---------- user spelling fixes ---------- */

let userRoman = new Map<string, string>();

/** Parse "native = english" lines (Settings → English-letter spellings). */
export function parseRomanRules(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split("\n")) {
    const p = line.split(/\s*(?:=|→|->)\s*/);
    if (p.length === 2 && p[0].trim() && p[1].trim()) m.set(p[0].trim().normalize("NFC"), p[1].trim());
  }
  return m;
}

/** Install the user's spelling fixes (used by every romanised display). */
export function setRomanRules(rules: Map<string, string> | string) {
  userRoman = typeof rules === "string" ? parseRomanRules(rules) : rules;
}

/* ---------- public API ---------- */

function romanizeAuto(word: string, style: Style): string {
  if (hasGujarati(word)) return romanizeWith(word, GUJ, style);
  if (hasDevanagari(word)) return romanizeWith(word, DEVA, style);
  return word;
}

/** Keep leading/trailing punctuation around the romanised word. */
function withPunct(word: string, fn: (core: string) => string): string {
  const m = /^([^\p{L}\p{M}\p{N}]*)(.*?)([^\p{L}\p{M}\p{N}]*)$/u.exec(word);
  if (!m) return fn(word);
  const tail = m[3].replace(/[।॥]/g, ".");
  return m[1] + fn(m[2]) + tail;
}

/** One word in English letters. */
export function romanizeWord(word: string, style: Style = "casual"): string {
  if (!hasGujarati(word) && !hasDevanagari(word)) return word;
  return withPunct(word, (core) => {
    const key = core.normalize("NFC");
    const fixed = userRoman.get(key);
    if (fixed) return fixed;
    if (NAMES[key]) return NAMES[key];
    if (style === "casual") {
      const loan = englishLoan(core);
      if (loan) return loan;
    }
    return romanizeAuto(core, style);
  });
}

/** Back-compat: Gujarati → casual Gujlish. */
export const gujlishWord = (word: string) => romanizeWord(word, "casual");

/** Text as it should appear for the chosen caption script. */
export function displayText(text: string, script: Script | undefined): string {
  if (!script || script === "native") return text;
  const style: Style = script === "roman" ? "roman" : "casual";
  return text.split(/(\s+)/).map((part) => (/^\s+$/.test(part) ? part : romanizeWord(part, style))).join("");
}

/** A word as displayed (its own hand-made spelling wins). */
export function displayWord(w: Pick<Word, "text" | "roman">, script: Script | undefined): string {
  if (!script || script === "native") return w.text;
  return w.roman?.trim() || displayText(w.text, script);
}
