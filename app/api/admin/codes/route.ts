import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { cleanName, createCode, unlockConfigured } from "@/lib/unlock";
import { getCode, listCodes, removeCode, saveCode, storageKind, type CodeRecord } from "@/lib/codeStore";

export const dynamic = "force-dynamic";

const deny = () => NextResponse.json({ error: "Please sign in again." }, { status: 401 });
const MAX_HOURS = 24 * 366 * 5;

/** Every code ever made, newest first. */
export async function GET(req: Request) {
  if (!(await isAdmin(req))) return deny();
  try {
    return NextResponse.json({ codes: await listCodes(), storage: storageKind(), now: Date.now() });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't read the history: ${(e as Error).message}` }, { status: 500 });
  }
}

/** Create a code: { name, note?, hours } (hours 0 = never expires). */
export async function POST(req: Request) {
  if (!(await isAdmin(req))) return deny();
  if (!unlockConfigured()) return NextResponse.json({ error: "Set WATERMARK_SECRET (16+ characters) first." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { name?: string; note?: string; hours?: number };
  const name = cleanName(body.name ?? "");
  if (!name) return NextResponse.json({ error: "Enter the person's name (letters or numbers)." }, { status: 400 });
  const hours = Number(body.hours ?? 24);
  if (!Number.isFinite(hours) || hours < 0 || hours > MAX_HOURS) return NextResponse.json({ error: "Pick a valid expiry." }, { status: 400 });
  const info = await createCode(name, hours);
  const rec: CodeRecord = {
    code: info.code, name: info.name, label: (body.name ?? "").trim().slice(0, 40) || undefined, note: (body.note ?? "").trim().slice(0, 120) || undefined,
    createdAt: Date.now(), expiresAt: info.expiresAt, revokedAt: null, uses: 0, lastUsedAt: null,
  };
  let saved = true;
  try { await saveCode(rec); } catch { saved = false; }
  return NextResponse.json({ ...rec, saved });
}

/** { code, action: "revoke" | "restore" } */
export async function PATCH(req: Request) {
  if (!(await isAdmin(req))) return deny();
  const { code, action } = (await req.json().catch(() => ({}))) as { code?: string; action?: string };
  const rec = code ? await getCode(code) : null;
  if (!rec) return NextResponse.json({ error: "Code not found in the history." }, { status: 404 });
  if (action !== "revoke" && action !== "restore") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const next = { ...rec, revokedAt: action === "revoke" ? Date.now() : null };
  await saveCode(next);
  return NextResponse.json(next);
}

/** Remove from the history. Only for expired or revoked codes (so an active code can't be "forgotten" while still working). */
export async function DELETE(req: Request) {
  if (!(await isAdmin(req))) return deny();
  const code = new URL(req.url).searchParams.get("code") ?? "";
  const rec = await getCode(code);
  if (!rec) return NextResponse.json({ ok: true });
  const expired = rec.expiresAt !== null && rec.expiresAt <= Date.now();
  if (!rec.revokedAt && !expired) return NextResponse.json({ error: "Revoke the code before deleting it." }, { status: 400 });
  await removeCode(code);
  return NextResponse.json({ ok: true });
}
