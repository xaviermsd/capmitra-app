import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Checks an ElevenLabs key without spending credits (GET /v1/user).
 * A key restricted to Speech-to-Text has no "user_read" permission, so
 * ElevenLabs answers "missing permissions": that still proves the key is real.
 */
export async function POST(req: Request) {
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  const k = (key ?? "").trim();
  if (!k) return NextResponse.json({ ok: false, reason: "empty" }, { status: 400 });
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": k } });
    if (res.ok) {
      const u = (await res.json().catch(() => ({}))) as { subscription?: { tier?: string } };
      return NextResponse.json({ ok: true, tier: u.subscription?.tier ?? null });
    }
    const text = await res.text();
    if (/missing_permissions|permission/i.test(text) && !/invalid_api_key/i.test(text)) {
      return NextResponse.json({ ok: true, limited: true });
    }
    return NextResponse.json({ ok: false, reason: /invalid_api_key|unauthor/i.test(text) ? "invalid" : `status ${res.status}` });
  } catch {
    return NextResponse.json({ ok: false, reason: "network" }, { status: 502 });
  }
}
