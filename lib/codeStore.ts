/**
 * History of watermark codes (who, when, expiry, revoked, uses).
 *
 * Where it's kept:
 *  - Upstash Redis when KV_REST_API_URL + KV_REST_API_TOKEN (Vercel's Upstash
 *    integration) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set.
 *    Free tier is plenty. Needed on Vercel, where files can't be written.
 *  - Otherwise a JSON file in .data/ (perfect on your own computer).
 * Server-only.
 */
import { promises as fs } from "fs";
import path from "path";
import { redis, redisConfig } from "./redis";

export interface CodeRecord {
  code: string;
  name: string;
  /** the name as typed, e.g. "Ravi Patel" */
  label?: string;
  note?: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt?: number | null;
  uses: number;
  lastUsedAt?: number | null;
}

export type StorageKind = "redis" | "file" | "none";

const KEY = "acg:wm-codes";

export function storageKind(): StorageKind {
  if (redisConfig()) return "redis";
  if (process.env.VERCEL) return "none"; // Vercel's disk is read-only
  return "file";
}

const FILE = path.join(process.cwd(), ".data", "watermark-codes.json");

async function readFile(): Promise<Record<string, CodeRecord>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, CodeRecord>;
  } catch {
    return {};
  }
}

async function writeFile(all: Record<string, CodeRecord>): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(all, null, 2));
  await fs.rename(tmp, FILE);
}

export async function listCodes(): Promise<CodeRecord[]> {
  const kind = storageKind();
  let rows: CodeRecord[] = [];
  if (kind === "redis") {
    const flat = await redis<string[]>(["HGETALL", KEY]);
    for (let i = 1; i < flat.length; i += 2) {
      try { rows.push(JSON.parse(flat[i]) as CodeRecord); } catch { /* skip */ }
    }
  } else if (kind === "file") {
    rows = Object.values(await readFile());
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getCode(code: string): Promise<CodeRecord | null> {
  const kind = storageKind();
  try {
    if (kind === "redis") {
      const v = await redis<string | null>(["HGET", KEY, code]);
      return v ? (JSON.parse(v) as CodeRecord) : null;
    }
    if (kind === "file") return (await readFile())[code] ?? null;
  } catch {
    /* storage down: fall back to the signature alone */
  }
  return null;
}

export async function saveCode(rec: CodeRecord): Promise<void> {
  const kind = storageKind();
  if (kind === "redis") {
    await redis(["HSET", KEY, rec.code, JSON.stringify(rec)]);
  } else if (kind === "file") {
    const all = await readFile();
    all[rec.code] = rec;
    await writeFile(all);
  } else {
    throw new Error("No storage set up for code history.");
  }
}

export async function removeCode(code: string): Promise<void> {
  const kind = storageKind();
  if (kind === "redis") await redis(["HDEL", KEY, code]);
  else if (kind === "file") {
    const all = await readFile();
    delete all[code];
    await writeFile(all);
  }
}

/** Count a redemption (best effort; never blocks unlocking). */
export async function recordUse(code: string): Promise<void> {
  try {
    const rec = await getCode(code);
    if (rec) await saveCode({ ...rec, uses: (rec.uses || 0) + 1, lastUsedAt: Date.now() });
  } catch {
    /* ignore */
  }
}
