/**
 * Watermark-removal codes, e.g. AC-RAVI-M8K2QZ-7K2P9QXA
 *
 *   AC - <NAME> - <EXPIRY> - <SIGNATURE>
 *
 * NAME       who the code is for (A–Z, 0–9, up to 16 characters)
 * EXPIRY     when it stops working, in minutes since 1970, base 36 ("0" = never)
 * SIGNATURE  HMAC-SHA256 of NAME.EXPIRY with WATERMARK_SECRET, so nobody can invent
 *            or edit a code without the secret, which only the server knows.
 *
 * Revoke codes with WATERMARK_REVOKED: a comma-separated list of names or full codes.
 * Server-only: never import this from a client component.
 */
import { getCode } from "./codeStore";

export const UNLOCK_COOKIE = "cm_wm";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base 32: no I, L, O, U

export interface UnlockInfo {
  name: string;
  /** ms since epoch, or null for a code that never expires */
  expiresAt: number | null;
  code: string;
}

export type VerifyResult = { ok: true; info: UnlockInfo } | { ok: false; reason: "setup" | "format" | "signature" | "expired" | "revoked" };

const secret = () => process.env.WATERMARK_SECRET?.trim() || "";
export const unlockConfigured = () => secret().length >= 16;
/** Can people enter a code here at all (signed codes or the master code)? */
export const unlockAvailable = () => unlockConfigured() || normaliseCode(process.env.WATERMARK_MASTER_CODE ?? "").length >= 6;

export function cleanName(raw: string): string {
  return raw.normalize("NFKD").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`acg-wm:${payload}`)));
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[mac[i] % 32];
  return out;
}

/** Create a code. `hours` = 0 means it never expires. */
export async function createCode(name: string, hours: number): Promise<UnlockInfo> {
  const n = cleanName(name);
  const exp = hours > 0 ? Math.ceil((Date.now() + hours * 3_600_000) / 60_000).toString(36).toUpperCase() : "0";
  const code = `AC-${n}-${exp}-${await sign(`${n}.${exp}`)}`;
  return { name: n, expiresAt: exp === "0" ? null : parseInt(exp, 36) * 60_000, code };
}

/** Accepts what people paste: lower case, spaces, missing dashes around words are fine. */
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "").replace(/[–—_]/g, "-");
}

function revoked(info: { name: string; code: string }): boolean {
  const list = (process.env.WATERMARK_REVOKED || "").split(",").map((s) => normaliseCode(s)).filter(Boolean);
  return list.includes(info.name) || list.includes(info.code);
}

/** Owner's master code (WATERMARK_MASTER_CODE): unlocks forever, never shown in the app's code. */
function isMaster(code: string): boolean {
  const m = normaliseCode(process.env.WATERMARK_MASTER_CODE ?? "");
  if (m.length < 6 || code.length !== m.length) return false;
  let d = 0;
  for (let i = 0; i < m.length; i++) d |= m.charCodeAt(i) ^ code.charCodeAt(i);
  return d === 0;
}

export async function verifyCode(raw: string): Promise<VerifyResult> {
  const code = normaliseCode(raw);
  if (isMaster(code)) return { ok: true, info: { name: "OWNER", expiresAt: null, code } };
  if (!unlockConfigured()) return { ok: false, reason: "setup" };
  const m = /^AC-([A-Z0-9]{1,16})-([0-9A-Z]{1,9})-([0-9A-Z]{8})$/.exec(code);
  if (!m) return { ok: false, reason: "format" };
  const [, name, exp, sig] = m;
  const want = await sign(`${name}.${exp}`);
  let diff = 0;
  for (let i = 0; i < 8; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return { ok: false, reason: "signature" };
  const expiresAt = exp === "0" ? null : parseInt(exp, 36) * 60_000;
  const info = { name, expiresAt, code };
  if (revoked(info)) return { ok: false, reason: "revoked" };
  const rec = await getCode(code); // revoked from the admin page?
  if (rec?.revokedAt) return { ok: false, reason: "revoked" };
  if (expiresAt !== null && expiresAt <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, info };
}

export const REASON_TEXT: Record<Exclude<VerifyResult, { ok: true }>["reason"], string> = {
  setup: "Watermark removal isn't set up on this server yet.",
  format: "That doesn't look like a CapMitra code. It should look like AC-NAME-XXXXX-XXXXXXXX.",
  signature: "That code isn't valid. Check for typos, or ask Harsh for a new one.",
  expired: "That code has expired. Ask Harsh for a new one.",
  revoked: "That code has been switched off. Contact Harsh if you think this is a mistake.",
};
