/**
 * Who may use the API keys set on the server (ELEVENLABS_API_KEY, SARVAM_API_KEY)?
 *
 * SHARED_KEYS=owner     (default) only you: a device unlocked with WATERMARK_MASTER_CODE,
 *                       or signed in on /admin. Everyone else must add their own key.
 * SHARED_KEYS=everyone  anyone who opens the app (billed to you).
 * SHARED_KEYS=off       nobody; the server keys are ignored.
 * Server-only.
 */
import { isAdmin } from "./adminAuth";
import { UNLOCK_COOKIE, verifyCode } from "./unlock";

function cookie(req: Request, name: string): string | undefined {
  const m = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

export type KeyReason = "admin" | "master" | "everyone" | null;

/** Why this visitor may use the server keys (null = they may not). */
export async function serverKeyReason(req: Request): Promise<KeyReason> {
  const mode = (process.env.SHARED_KEYS || "owner").trim().toLowerCase();
  if (mode === "off") return null;
  if (mode === "everyone") return "everyone";
  if (await isAdmin(req)) return "admin";
  const c = cookie(req, UNLOCK_COOKIE);
  if (!c) return null;
  const r = await verifyCode(c);
  return r.ok && r.info.name === "OWNER" ? "master" : null;
}

export async function mayUseServerKeys(req: Request): Promise<boolean> {
  return (await serverKeyReason(req)) !== null;
}

export async function serverKey(req: Request, envName: "ELEVENLABS_API_KEY" | "SARVAM_API_KEY"): Promise<string> {
  const k = process.env[envName]?.trim();
  if (!k) return "";
  return (await mayUseServerKeys(req)) ? k : "";
}
