import { NextResponse, type NextRequest } from "next/server";
import { recordUse } from "@/lib/codeStore";
import { checkLimit, clearFailures, clientIp, recordFailure, tooMany } from "@/lib/rateLimit";
import { REASON_TEXT, UNLOCK_COOKIE, unlockAvailable, verifyCode } from "@/lib/unlock";

const MAX_AGE = 60 * 60 * 24 * 400; // browsers cap cookies at 400 days

function cookieOpts(req: Request, maxAge: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: new URL(req.url).protocol === "https:", path: "/", maxAge };
}

/** Is watermark removal unlocked on this device? Re-checked on the server every time. */
export async function GET(req: NextRequest) {
  const raw = req.cookies.get(UNLOCK_COOKIE)?.value;
  const available = unlockAvailable();
  if (!raw) return NextResponse.json({ unlocked: false, available });
  const r = await verifyCode(raw);
  if (r.ok) return NextResponse.json({ unlocked: true, available, name: r.info.name, expiresAt: r.info.expiresAt });
  const res = NextResponse.json({ unlocked: false, available, lapsed: r.reason === "expired" || r.reason === "revoked" ? r.reason : undefined });
  res.cookies.set(UNLOCK_COOKIE, "", cookieOpts(req, 0));
  return res;
}

/** Redeem a code on this device. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const limit = await checkLimit("unlock", ip);
  if (!limit.ok) return tooMany(limit);
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const r = await verifyCode(code ?? "");
  if (!r.ok) {
    // typos in the format don't count; wrong signatures (guesses) do
    if (r.reason === "signature" || r.reason === "format") {
      const after = await recordFailure("unlock", ip);
      if (!after.ok) return tooMany(after);
    }
    await new Promise((res) => setTimeout(res, 400));
    return NextResponse.json({ error: REASON_TEXT[r.reason], reason: r.reason }, { status: r.reason === "setup" ? 503 : 400 });
  }
  await clearFailures("unlock", ip);
  const { name, expiresAt, code: clean } = r.info;
  const maxAge = expiresAt === null ? MAX_AGE : Math.max(60, Math.min(MAX_AGE, Math.floor((expiresAt - Date.now()) / 1000)));
  await recordUse(clean);
  const res = NextResponse.json({ unlocked: true, name, expiresAt });
  res.cookies.set(UNLOCK_COOKIE, clean, cookieOpts(req, maxAge));
  return res;
}

/** Forget the code on this device. */
export function DELETE(req: Request) {
  const res = NextResponse.json({ unlocked: false });
  res.cookies.set(UNLOCK_COOKIE, "", cookieOpts(req, 0));
  return res;
}
