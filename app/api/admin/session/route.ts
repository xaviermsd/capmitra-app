import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE, SESSION_HOURS, adminConfigured, adminSessionId, cookieOptions, createSession,
  listSessions, revokeAllSessions, revokeSession, samePassword, sessionsRevocable,
} from "@/lib/adminAuth";
import { unlockConfigured } from "@/lib/unlock";
import { storageKind } from "@/lib/codeStore";
import { checkLimit, clearFailures, clientIp, recordFailure, tooMany } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** Setup status + whether this browser is signed in as admin (+ its sessions). No secrets are returned. */
export async function GET(req: Request) {
  const current = await adminSessionId(req);
  let sessions: { id: string; createdAt: number; expiresAt: number; ip?: string; device?: string; current: boolean }[] = [];
  if (current) {
    try {
      sessions = (await listSessions()).map((s) => ({ ...s, id: s.id.slice(0, 8), current: s.id === current }));
    } catch { /* storage down */ }
  }
  return NextResponse.json({
    adminReady: adminConfigured(),
    secretReady: unlockConfigured(),
    storage: storageKind(),
    authed: !!current,
    sessions,
    revocable: sessionsRevocable(),
    sessionHours: SESSION_HOURS,
  });
}

/** Sign in. */
export async function POST(req: Request) {
  if (!adminConfigured()) return NextResponse.json({ error: "Set ADMIN_PASSWORD in .env.local (or on Vercel) first." }, { status: 503 });
  const ip = clientIp(req);
  const limit = await checkLimit("admin", ip);
  if (!limit.ok) return tooMany(limit);
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!samePassword(password)) {
    const after = await recordFailure("admin", ip);
    await new Promise((r) => setTimeout(r, 500));
    if (!after.ok) return tooMany(after);
    return NextResponse.json({ error: "Wrong admin password.", remaining: after.remaining }, { status: 401 });
  }
  await clearFailures("admin", ip);
  const ua = req.headers.get("user-agent") ?? "";
  const device = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : "Browser";
  try {
    const { token } = await createSession({ ip: ip === "local" ? undefined : ip, device });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, token, cookieOptions(req, SESSION_HOURS * 3600));
    return res;
  } catch (e) {
    return NextResponse.json({ error: `Couldn't start a session: ${(e as Error).message}` }, { status: 500 });
  }
}

/**
 * Sign out.
 *   DELETE /api/admin/session            this device
 *   DELETE /api/admin/session?all=1      every other device too
 *   DELETE /api/admin/session?id=abcd1234  one listed session (by its short id)
 */
export async function DELETE(req: Request) {
  const current = await adminSessionId(req);
  const q = new URL(req.url).searchParams;
  if (current && q.get("all")) {
    const n = await revokeAllSessions(current);
    return NextResponse.json({ ok: true, revoked: n });
  }
  const short = q.get("id");
  if (current && short) {
    const s = (await listSessions()).find((x) => x.id.startsWith(short) && x.id !== current);
    if (s) await revokeSession(s.id);
    return NextResponse.json({ ok: true, revoked: s ? 1 : 0 });
  }
  if (current) await revokeSession(current).catch(() => {});
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", cookieOptions(req, 0));
  return res;
}
