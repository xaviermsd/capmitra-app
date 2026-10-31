import { NextResponse } from "next/server";
import { serverKey } from "@/lib/serverKeys";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Translates caption lines with Sarvam AI (POST https://api.sarvam.ai/translate).
 * Docs: https://docs.sarvam.ai/api-reference-docs/text/translate-text
 *
 * Body: { texts, source, target = "en-IN", model = "mayura:v1", mode }
 *  - mayura:v1          11 languages, auto-detect, modes formal / modern-colloquial / code-mixed, 1000 chars
 *  - sarvam-translate:v1 22 languages, formal only, 2000 chars
 */
const CODES = new Set(["bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN", "as-IN", "brx-IN", "doi-IN", "kok-IN", "ks-IN", "mai-IN", "mni-IN", "ne-IN", "sa-IN", "sat-IN", "sd-IN", "ur-IN"]);
const MODES = new Set(["formal", "modern-colloquial", "classic-colloquial", "code-mixed"]);

export async function POST(req: Request) {
  const key = req.headers.get("x-sarvam-key")?.trim() || (await serverKey(req, "SARVAM_API_KEY"));
  if (!key) {
    return NextResponse.json({ error: "No Sarvam API key yet. Paste your own key in Settings → Translation.", code: "no_key" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { texts?: unknown; source?: string; target?: string; model?: string; mode?: string };
  if (!Array.isArray(body.texts) || body.texts.length > 2000) return NextResponse.json({ error: "Missing or too many texts" }, { status: 400 });
  const texts = body.texts.map((t) => (typeof t === "string" ? t : ""));
  const model = body.model === "sarvam-translate:v1" ? "sarvam-translate:v1" : "mayura:v1";
  const target = CODES.has(body.target ?? "") ? body.target! : "en-IN";
  const source = body.source === "auto" && model === "mayura:v1" ? "auto" : CODES.has(body.source ?? "") ? body.source! : null;
  if (!source) return NextResponse.json({ error: "This spoken language can't be translated with Sarvam AI." }, { status: 400 });
  if (source === target) return NextResponse.json({ error: "The captions are already in that language." }, { status: 400 });
  const mode = model === "mayura:v1" && MODES.has(body.mode ?? "") ? body.mode! : "formal";
  const limit = model === "mayura:v1" ? 1000 : 2000;

  const one = async (input: string): Promise<string> => {
    if (!input.trim()) return "";
    for (let attempt = 1; ; attempt++) {
      const res = await fetch("https://api.sarvam.ai/translate", {
        method: "POST",
        headers: { "content-type": "application/json", "api-subscription-key": key },
        body: JSON.stringify({ input: input.slice(0, limit), source_language_code: source, target_language_code: target, model, mode }),
      });
      if (res.ok) {
        const data = (await res.json()) as { translated_text?: string };
        return data.translated_text ?? "";
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
        continue;
      }
      const text = (await res.text()).slice(0, 300);
      throw Object.assign(new Error(res.status === 401 || res.status === 403 ? "Your Sarvam API key was refused. Check it in Settings → Translation." : `Sarvam error ${res.status}: ${text}`), { status: res.status });
    }
  };

  try {
    const out: string[] = new Array(texts.length).fill("");
    let next = 0;
    const worker = async () => {
      while (next < texts.length) {
        const i = next++;
        out[i] = await one(texts[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
    return NextResponse.json({ translations: out, model, target });
  } catch (e) {
    const status = (e as { status?: number }).status;
    return NextResponse.json({ error: (e as Error).message }, { status: status === 401 || status === 403 ? 401 : 502 });
  }
}
