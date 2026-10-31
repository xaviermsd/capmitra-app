import { NextResponse } from "next/server";
import { AUTH_COOKIE, passToken } from "@/lib/auth";
import { checkLimit, clearFailures, clientIp, recordFailure, safeEqual, tooMany } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** Only says whether a passcode is set. Its length and type are never revealed. */
export function GET() {
  return NextResponse.json({ locked: !!process.env.APP_PASSCODE?.trim() });
}

export async function POST(req: Request) {
  const code = process.env.APP_PASSCODE?.trim();
  if (!code) return NextResponse.json({ ok: true });
  const ip = clientIp(req);
  const limit = await checkLimit("passcode", ip);
  if (!limit.ok) return tooMany(limit);

  const { passcode } = (await req.json().catch(() => ({}))) as { passcode?: string };
  if (typeof passcode !== "string" || !safeEqual(passcode.trim(), code)) {
    const after = await recordFailure("passcode", ip);
    await new Promise((r) => setTimeout(r, 400));
    if (!after.ok) return tooMany(after);
    return NextResponse.json(
      { error: "That passcode isn't right.", remaining: after.remaining },
      { status: 401 },
    );
  }
  await clearFailures("passcode", ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await passToken(code), {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(req.url).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 60,
  });
  return res;
}

/** Sign out: forget the passcode cookie on this device. */
export function DELETE(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(req.url).protocol === "https:",
    path: "/",
    maxAge: 0,
  });
  return res;
}
