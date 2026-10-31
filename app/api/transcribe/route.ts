import { NextResponse } from "next/server";
import { serverKey } from "@/lib/serverKeys";

export const runtime = "nodejs";
export const maxDuration = 300;

interface ScribeWord {
  text: string;
  start: number;
  end: number;
  type: "word" | "spacing" | "audio_event" | string;
  speaker_id?: string | null;
}

/**
 * Receives the extracted WAV from the browser and forwards it to ElevenLabs
 * Scribe (POST /v1/speech-to-text) with word-level timestamps.
 * Docs: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 */
export async function POST(req: Request) {
  // The visitor's own key (saved in their browser) wins. The server key is only for the owner (see lib/serverKeys.ts).
  const key = req.headers.get("x-elevenlabs-key")?.trim() || (await serverKey(req, "ELEVENLABS_API_KEY"));
  if (!key) {
    return NextResponse.json(
      { error: "No ElevenLabs API key yet. Add your own key in Settings → Your API key.", code: "no_key" },
      { status: 401 },
    );
  }

  const len = Number(req.headers.get("content-length") || 0);
  if (len > 4_400_000 && process.env.VERCEL) {
    return NextResponse.json({ error: "This audio piece is too large to upload (over 4.4 MB).", code: "too_large" }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "The upload was cut off or too large. Try again.", code: "bad_upload" }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) return NextResponse.json({ error: "Missing audio" }, { status: 400 });

  const language = String(form.get("language") ?? "gu");
  const model = String(form.get("model") ?? "scribe_v2");
  const diarize = form.get("diarize") === "true";

  const body = new FormData();
  body.append("file", audio, audio instanceof File && audio.name ? audio.name : "audio.ogg");
  body.append("model_id", model);
  if (language && language !== "auto") body.append("language_code", language);
  body.append("timestamps_granularity", "word");
  body.append("tag_audio_events", "false");
  if (diarize) body.append("diarize", "true");
  // optional custom vocabulary (ElevenLabs bills ~20% extra when used)
  const kt = form.get("keyterms");
  if (typeof kt === "string" && kt) {
    try {
      const terms = (JSON.parse(kt) as string[])
        .map((t) => t.replace(/[<>{}\[\]\\]/g, "").trim())
        .filter((t) => t && t.length < 50 && t.split(/\s+/).length <= 5)
        .slice(0, 1000);
      for (const t of terms) body.append("keyterms", t);
    } catch {
      /* ignore malformed list */
    }
  }

  let res: Response;
  try {
    res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key },
      body,
    });
  } catch {
    return NextResponse.json({ error: "Couldn't reach ElevenLabs. Try again in a moment.", code: "upstream_network" }, { status: 503 });
  }
  if (!res.ok) {
    const text = await res.text();
    // pass through what the user can act on; everything else is a temporary upstream problem
    const status = res.status === 401 || res.status === 403 ? 401 : res.status === 429 ? 429 : res.status === 400 || res.status === 422 ? 400 : 502;
    const hint =
      status === 401 ? "Your ElevenLabs API key was refused. Check it in Settings → Your API key." :
      status === 429 ? "ElevenLabs is busy or your plan's limit was reached. Wait a minute and try again." :
      /quota|credits/i.test(text) ? "Your ElevenLabs credits have run out." : "";
    const quota = /quota|credits/i.test(text);
    return NextResponse.json(
      { error: `${hint ? hint + " " : ""}(ElevenLabs ${res.status}: ${text.slice(0, 300)})`, code: quota ? "quota_exceeded" : status === 401 ? "invalid_api_key" : undefined },
      { status: quota ? 402 : status },
    );
  }
  const data = (await res.json()) as { language_code?: string; text?: string; words?: ScribeWord[] };
  const words = (data.words ?? [])
    .filter((w) => w.type === "word" && w.text.trim())
    .map((w, i) => ({
      id: `s${i}`,
      text: w.text.trim(),
      start: w.start,
      end: Math.max(w.end, w.start + 0.05),
      ...(diarize && w.speaker_id ? { speaker: String(w.speaker_id) } : {}),
    }));

  return NextResponse.json({ language: data.language_code, text: data.text, words });
}
