import { splitClusters } from "./animation";
import type { CaptionLine, Word } from "./types";

/** Common Gujarati / Hinglish / English function words that should never be highlighted. */
const STOP = new Set(
  (
    "છે છો છું છીએ હતું હતો હતી હતા અને પણ તો કે જે તે આ એ એક ના ની નું નો ને નાં માં થી પર સાથે માટે હું તું તમે અમે આપણે " +
    "મારો મારી મારું મારા તમારો તમારી તમારું તમારા આપણો આપણી આપણું આપણા તેનો તેની તેનું તેના એનો એની એનું એના " +
    "શું કેમ ક્યાં ક્યારે કોણ જ હવે ત્યારે અહીં ત્યાં બહુ ખૂબ બધા બધું બધી થઈ થયું થાય કરી કરે કરો કર્યું કરવું " +
    "a an the is are am was were to of in on at for and or but so it this that i you we he she they my your " +
    "hai ho hu hun che chhe ane pan to ke je te aa e ek na ni nu no ne ma thi par sathe mate"
  ).split(/\s+/),
);

const clean = (s: string) => s.replace(/[.,!?।॥"'“”‘’:;()\-–—]/g, "").toLowerCase();

/** Pick the most important word in each caption and mark it as emphasis. */
export function autoKeywords(words: Word[], lines: CaptionLine[], perLine = 1): Word[] {
  const pick = new Set<string>();
  for (const l of lines) {
    const scored = l.words
      .map((w) => ({ w, c: clean(w.text) }))
      .filter((x) => x.c && !STOP.has(x.c) && !/^\d+$/.test(x.c))
      .map((x) => ({ id: x.w.id, score: splitClusters(x.c).length + (EMOJI_FOR(x.c) ? 2 : 0) + (x.w.end - x.w.start) }));
    scored.sort((a, b) => b.score - a.score);
    scored.slice(0, perLine).forEach((s) => pick.add(s.id));
  }
  return words.map((w) => ({ ...w, emphasis: pick.has(w.id) }));
}

/**
 * Keyword stems → emoji. A word matches when it starts with the stem, so
 * Gujarati suffixes (ના/ની/માં/થી…) still match.
 */
const EMOJI: [string[], string][] = [
  [["પ્રેમ", "પ્યાર", "love", "dil", "દિલ"], "❤️"],
  [["પૈસા", "પૈસ", "રૂપિય", "money", "paisa", "કમાણી", "કમા"], "💰"],
  [["ખુશ", "આનંદ", "happy", "મજા", "maja"], "😊"],
  [["હસ", "હાસ્ય", "laugh", "funny"], "😂"],
  [["દુઃખ", "દુખ", "sad", "રડ"], "😢"],
  [["ગુસ્સ", "angry"], "😠"],
  [["આગ", "fire", "જોરદાર", "ધમાકેદાર", "zordar"], "🔥"],
  [["સફળ", "success", "જીત", "win"], "🏆"],
  [["વિચાર", "idea", "આઈડિયા", "આઇડિયા"], "💡"],
  [["સમય", "ટાઈમ", "ટાઇમ", "time", "સમયે"], "⏰"],
  [["ખાવ", "ખાણ", "જમ", "food", "ભોજન", "નાસ્ત"], "🍽️"],
  [["ચા", "chai", "tea"], "☕"],
  [["ઘર", "home"], "🏠"],
  [["ગુજરાત", "gujarat"], "🦁"],
  [["ભારત", "india", "દેશ"], "🇮🇳"],
  [["દિવાળી", "diwali", "દીવ"], "🪔"],
  [["નવરાત્રી", "નવરાત્રિ", "ગરબ", "garba", "navratri"], "💃"],
  [["લગ્ન", "wedding", "શાદી"], "💍"],
  [["બાળક", "બાળ", "છોકર", "baby", "kids"], "👶"],
  [["મમ્મી", "માતા", "mummy", "mother"], "👩"],
  [["પપ્પા", "પિતા", "papa", "father"], "👨"],
  [["મિત્ર", "દોસ્ત", "friend", "bhaibandh"], "🤝"],
  [["ફોન", "મોબાઈલ", "મોબાઇલ", "phone", "mobile"], "📱"],
  [["વિડિયો", "વીડિયો", "video", "રીલ", "reel"], "🎬"],
  [["ફોટો", "photo", "કેમેરા", "camera"], "📸"],
  [["ગીત", "song", "music", "સંગીત"], "🎵"],
  [["કપડ", "ડ્રેસ", "dress", "સાડી", "saree", "કુર્તી", "kurti", "fashion", "ફેશન"], "👗"],
  [["મેકઅપ", "makeup", "સુંદર", "beautiful", "look", "લુક"], "✨"],
  [["ઘરેણ", "jewel", "જ્વેલ", "હાર", "બુટ્ટી"], "💎"],
  [["ખરીદ", "શોપિંગ", "shopping", "ઓર્ડર", "order", "sale", "સેલ", "offer", "ઓફર"], "🛍️"],
  [["ફ્રી", "free", "મફત"], "🆓"],
  [["નવું", "નવી", "નવો", "new"], "🆕"],
  [["સાવધાન", "ધ્યાન", "warning", "careful"], "⚠️"],
  [["yes", "સાચું", "correct", "બરાબર"], "✅"],
  [["ખોટું", "wrong"], "❌"],
  [["પ્રશ્ન", "સવાલ", "question"], "❓"],
  [["જુઓ", "જોવ", "જોઈ", "look", "see", "watch"], "👀"],
  [["ફોલો", "follow", "subscribe", "સબ્સ્ક્રાઇબ"], "🔔"],
  [["લાઈક", "લાઇક", "like"], "👍"],
  [["શેર", "share"], "📤"],
  [["કોમેન્ટ", "comment"], "💬"],
  [["પાણી", "water", "વરસાદ", "rain"], "💧"],
  [["સૂર્ય", "તડકો", "ગરમી", "sun", "summer"], "☀️"],
  [["ઠંડી", "winter", "cold"], "❄️"],
  [["ભગવાન", "god", "પ્રભુ", "મંદિર", "temple", "જય"], "🙏"],
  [["આભાર", "thank", "ધન્યવાદ", "thanks"], "🙏"],
  [["બિઝનેસ", "વેપાર", "ધંધ", "business"], "💼"],
  [["ભણ", "શાળ", "સ્કૂલ", "school", "study", "પરીક્ષ", "exam"], "📚"],
  [["ગાડી", "કાર", "car", "બાઈક", "bike"], "🚗"],
  [["ફરવા", "પ્રવાસ", "travel", "trip", "ટ્રિપ"], "✈️"],
  [["સ્વાસ્થ્ય", "health", "કસરત", "યોગ", "gym", "fitness"], "💪"],
  [["ઝડપ", "ફટાફટ", "fast", "quick", "જલ્દી"], "⚡"],
  [["ટોપ", "top", "best", "બેસ્ટ", "શ્રેષ્ઠ"], "⭐"],
  [["હેન્ડમેડ", "handmade", "બનાવ", "diy"], "🧶"],
];

export function EMOJI_FOR(text: string): string | undefined {
  const t = clean(text);
  if (t.length < 2) return undefined;
  for (const [stems, e] of EMOJI) {
    for (const s of stems) {
      const st = s.trim().toLowerCase();
      if (st.length >= 2 && (t === st || (t.startsWith(st) && st.length >= 3))) return e;
    }
  }
  return undefined;
}

/** Add at most `perLine` emoji per caption, on matching keywords. */
export function autoEmoji(words: Word[], lines: CaptionLine[], perLine = 1): Word[] {
  const add = new Map<string, string>();
  for (const l of lines) {
    let n = 0;
    for (const w of l.words) {
      if (n >= perLine) break;
      const e = EMOJI_FOR(w.text);
      if (e) {
        add.set(w.id, e);
        n++;
      }
    }
  }
  return words.map((w) => (add.has(w.id) ? { ...w, emoji: add.get(w.id) } : w));
}

/** Apply "wrong → right" fixes. Rules are one per line: `wrong = right`. */
export function parseRules(text: string): [string, string][] {
  return text
    .split("\n")
    .map((l) => l.split(/\s*(?:=|→|->)\s*/))
    .filter((p) => p.length === 2 && p[0].trim())
    .map((p) => [p[0].trim(), p[1].trim()] as [string, string]);
}

export function applyRules(words: Word[], rules: [string, string][]): { words: Word[]; changed: number } {
  let changed = 0;
  const out = words.map((w) => {
    let t = w.text;
    for (const [a, b] of rules) if (t.includes(a)) t = t.split(a).join(b);
    if (t !== w.text) changed++;
    return t === w.text ? w : { ...w, text: t };
  });
  return { words: out.filter((w) => w.text.trim()), changed };
}
