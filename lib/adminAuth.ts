/**
 * Admin sign-in for /admin (server-only).
 *
 * Each sign-in creates a random session: the cookie holds
 *   <sessionId>.<expiresAtMinutes>.<signature>
 * signed with a key derived from ADMIN_PASSWORD + WATERMARK_SECRET, so
 * changing the password signs everyone out. Sessions also expire after
 * SESSION_HOURS and are listed in a store (Upstash Redis, or a file in
 * .data/ on your own computer) so you can sign out one device or all of them.
 * On Vercel without Redis, the signature and expiry are still enforced.
 */
import { promises as fs } from "fs";
import path from "path";
import { hasRedis, redis, redisPipeline } from "./redis";
import { safeEqual } from "./rateLimit";

export const ADMIN_COOKIE = "cm_admin";
export const SESSION_HOURS = 12;

export const adminConfigured = () => !!process.env.ADMIN_PASSWORD?.trim();

export function samePassword(given: unknown): boolean {
  const pass = process.env.ADMIN_PASSWORD?.trim();
  if (!pass || typeof given !== "string") return false;
  return safeEqual(given, pass);
}

export interface AdminSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  ip?: string;
  device?: string;
}

/* ---------- signing ---------- */

const enc = new TextEncoder();
async function hmac(payload: string): Promise<string> {
  const keyMaterial = `acg-admin:${process.env.ADMIN_PASSWORD?.trim() ?? ""}:${process.env.WATERMARK_SECRET ?? ""}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(keyMaterial), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return Array.from(mac.slice(0, 20), (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomId(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function makeToken(id: string, expiresAt: number): Promise<string> {
  const exp = Math.floor(expiresAt / 60_000).toString(36);
  return `${id}.${exp}.${await hmac(`${id}.${exp}`)}`;
}

/** Checks signature + expiry only. Returns the session id and expiry, or null. */
export async function parseToken(token: string | undefined, now = Date.now()): Promise<{ id: string; expiresAt: number } | null> {
  if (!token) return null;
  const m = /^([0-9a-f]{36})\.([0-9a-z]{1,10})\.([0-9a-f]{40})$/.exec(token);
  if (!m) return null;
  const [, id, exp, sig] = m;
  if (!safeEqual(sig, await hmac(`${id}.${exp}`))) return null;
  const expiresAt = parseInt(exp, 36) * 60_000;
  if (!(expiresAt > now)) return null;
  return { id, expiresAt };
}

/* ---------- session store ---------- */

type Kind = "redis" | "file" | "none";
const kind = (): Kind => (hasRedis() ? "redis" : process.env.VERCEL ? "none" : "file");
const RKEY = (id: string) => `acg:adm:s:${id}`;
const RSET = "acg:adm:sessions";
const FILE = path.join(process.cwd(), ".data", "admin-sessions.json");

async function readFile(): Promise<Record<string, AdminSession>> {
  try {
    const all = JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, AdminSession>;
    const now = Date.now();
    for (const [k, v] of Object.entries(all)) if (v.expiresAt <= now) delete all[k];
    return all;
  } catch {
    return {};
  }
}
async function writeFile(all: Record<string, AdminSession>) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(`${FILE}.tmp`, JSON.stringify(all, null, 2));
  await fs.rename(`${FILE}.tmp`, FILE);
}

async function storeSession(s: AdminSession) {
  const k = kind();
  if (k === "redis") {
    const ttl = Math.max(60, Math.ceil((s.expiresAt - Date.now()) / 1000));
    await redisPipeline([["SET", RKEY(s.id), JSON.stringify(s), "EX", ttl], ["SADD", RSET, s.id]]);
  } else if (k === "file") {
    const all = await readFile();
    all[s.id] = s;
    await writeFile(all);
  }
}

/** Is this session still listed? ("none" storage: trust the signed token.) */
async function sessionLive(id: string): Promise<boolean> {
  const k = kind();
  try {
    if (k === "redis") return (await redis<string | null>(["GET", RKEY(id)])) !== null;
    if (k === "file") return !!(await readFile())[id];
  } catch {
    return false; // storage error: fail closed
  }
  return true;
}

export async function listSessions(): Promise<AdminSession[]> {
  const k = kind();
  if (k === "redis") {
    const ids = await redis<string[]>(["SMEMBERS", RSET]);
    if (!ids.length) return [];
    const vals = await redis<(string | null)[]>(["MGET", ...ids.map(RKEY)]);
    const dead = ids.filter((_, i) => !vals[i]);
    if (dead.length) await redis(["SREM", RSET, ...dead]);
    return vals.filter((v): v is string => !!v).map((v) => JSON.parse(v) as AdminSession).sort((a, b) => b.createdAt - a.createdAt);
  }
  if (k === "file") return Object.values(await readFile()).sort((a, b) => b.createdAt - a.createdAt);
  return [];
}

export async function revokeSession(id: string): Promise<void> {
  const k = kind();
  if (k === "redis") await redisPipeline([["DEL", RKEY(id)], ["SREM", RSET, id]]);
  else if (k === "file") {
    const all = await readFile();
    delete all[id];
    await writeFile(all);
  }
}

/** Sign out every admin device except `keep`. */
export async function revokeAllSessions(keep?: string): Promise<number> {
  const all = await listSessions();
  let n = 0;
  for (const s of all) {
    if (s.id === keep) continue;
    await revokeSession(s.id);
    n++;
  }
  return n;
}

/** Create a session and return the cookie value. */
export async function createSession(meta: { ip?: string; device?: string } = {}): Promise<{ token: string; session: AdminSession }> {
  const now = Date.now();
  const session: AdminSession = { id: randomId(), createdAt: now, expiresAt: now + SESSION_HOURS * 3_600_000, ...meta };
  await storeSession(session);
  return { token: await makeToken(session.id, session.expiresAt), session };
}

export const sessionsRevocable = () => kind() !== "none";

/* ---------- request helpers ---------- */

function readCookie(req: Request, name: string): string | undefined {
  const m = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

/** The current admin session id, or null when not signed in. */
export async function adminSessionId(req: Request): Promise<string | null> {
  if (!adminConfigured()) return null;
  const t = await parseToken(readCookie(req, ADMIN_COOKIE));
  if (!t) return null;
  return (await sessionLive(t.id)) ? t.id : null;
}

export async function isAdmin(req: Request): Promise<boolean> {
  return (await adminSessionId(req)) !== null;
}

export function cookieOptions(req: Request, maxAge: number) {
  return { httpOnly: true, sameSite: "strict" as const, secure: new URL(req.url).protocol === "https:", path: "/", maxAge };
}
