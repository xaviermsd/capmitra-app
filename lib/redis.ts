/**
 * Tiny Upstash Redis REST client (no dependency). Used for watermark-code
 * history, admin sessions and sign-in rate limits.
 *
 * Configured by KV_REST_API_URL + KV_REST_API_TOKEN (Vercel's Upstash
 * integration) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
 * Server-only.
 */

export function redisConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export const hasRedis = () => redisConfig() !== null;

/** Run one Redis command, e.g. redis(["INCR", "key"]). Throws when Redis isn't set up or fails. */
export async function redis<T>(cmd: (string | number)[]): Promise<T> {
  const c = redisConfig();
  if (!c) throw new Error("Redis is not configured");
  const r = await fetch(c.url, {
    method: "POST",
    headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  const d = (await r.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!r.ok || d.error) throw new Error(d.error || `Redis error ${r.status}`);
  return d.result as T;
}

/** Several commands in one round trip. */
export async function redisPipeline<T extends unknown[]>(cmds: (string | number)[][]): Promise<T> {
  const c = redisConfig();
  if (!c) throw new Error("Redis is not configured");
  const r = await fetch(`${c.url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
    cache: "no-store",
  });
  const d = (await r.json().catch(() => [])) as { result?: unknown; error?: string }[];
  if (!r.ok || !Array.isArray(d)) throw new Error(`Redis error ${r.status}`);
  const bad = d.find((x) => x.error);
  if (bad) throw new Error(bad.error);
  return d.map((x) => x.result) as T;
}
