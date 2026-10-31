/**
 * Per-IP limits on failed sign-in attempts (team passcode, watermark codes, /admin).
 *
 * Each failed attempt adds 1 to a counter that lives for `windowSec`. Once the
 * counter reaches `max`, every further attempt from that IP is refused with
 * HTTP 429 until the window ends, even with the right answer, so guessing in
 * parallel no longer helps. A successful sign-in clears the counter.
 *
 * Counters live in Upstash Redis when it's configured (shared by every Vercel
 * instance). Without Redis they live in this server's memory, which is fine on
 * your own computer.
 * Server-only.
 */
import { hasRedis, redisPipeline } from "./redis";

export type Bucket = "passcode" | "unlock" | "admin";

export interface LimitRule {
  /** Failed attempts allowed per window. */
  max: number;
  /** Window length in seconds. */
  windowSec: number;
}

export const RULES: Record<Bucket, LimitRule> = {
  passcode: { max: 8, windowSec: 15 * 60 },
  unlock: { max: 10, windowSec: 15 * 60 },
  admin: { max: 5, windowSec: 30 * 60 },
};

export interface LimitState {
  ok: boolean;
  /** Failed attempts left before the block starts. */
  remaining: number;
  /** Seconds until attempts are allowed again (0 when ok). */
  retryAfter: number;
}

/** Where counters are kept. Swappable for tests. */
export interface CounterStore {
  get(key: string): Promise<{ count: number; ttl: number }>;
  incr(key: string, ttlSec: number): Promise<{ count: number; ttl: number }>;
  del(key: string): Promise<void>;
}

export function memoryStore(now: () => number = Date.now): CounterStore {
  const m = new Map<string, { count: number; until: number }>();
  const live = (key: string) => {
    const v = m.get(key);
    if (v && v.until <= now()) {
      m.delete(key);
      return undefined;
    }
    return v;
  };
  return {
    async get(key) {
      const v = live(key);
      return v ? { count: v.count, ttl: Math.ceil((v.until - now()) / 1000) } : { count: 0, ttl: 0 };
    },
    async incr(key, ttlSec) {
      const v = live(key) ?? { count: 0, until: now() + ttlSec * 1000 };
      v.count++;
      m.set(key, v);
      if (m.size > 10_000) {
        // keep memory bounded: drop expired entries
        for (const k of m.keys()) live(k);
      }
      return { count: v.count, ttl: Math.ceil((v.until - now()) / 1000) };
    },
    async del(key) {
      m.delete(key);
    },
  };
}

export const redisStore: CounterStore = {
  async get(key) {
    const [count, ttl] = await redisPipeline<[string | null, number]>([["GET", key], ["TTL", key]]);
    return { count: Number(count) || 0, ttl: Math.max(0, ttl ?? 0) };
  },
  async incr(key, ttlSec) {
    // EXPIRE ... NX: start the window on the first failure only
    const [count, , ttl] = await redisPipeline<[number, number, number]>([["INCR", key], ["EXPIRE", key, ttlSec, "NX"], ["TTL", key]]);
    return { count, ttl: Math.max(0, ttl) };
  },
  async del(key) {
    await redisPipeline([["DEL", key]]);
  },
};

const memory = memoryStore();
let override: CounterStore | null = null;
/** For tests. */
export function setCounterStore(s: CounterStore | null) {
  override = s;
}
function store(): CounterStore {
  return override ?? (hasRedis() ? redisStore : memory);
}

/** The visitor's IP as reported by the host (Vercel sets x-forwarded-for / x-real-ip). */
export function clientIp(req: Request): string {
  const h = req.headers;
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip")?.trim() || h.get("cf-connecting-ip")?.trim() || "local";
}

const keyFor = (bucket: Bucket, ip: string) => `acg:rl:${bucket}:${ip.slice(0, 64)}`;

/** Is this IP allowed to try now? Never throws: if storage is down, fall back to memory. */
export async function checkLimit(bucket: Bucket, ip: string): Promise<LimitState> {
  const rule = RULES[bucket];
  let v: { count: number; ttl: number };
  try {
    v = await store().get(keyFor(bucket, ip));
  } catch {
    v = await memory.get(keyFor(bucket, ip));
  }
  if (v.count >= rule.max) return { ok: false, remaining: 0, retryAfter: v.ttl || rule.windowSec };
  return { ok: true, remaining: rule.max - v.count, retryAfter: 0 };
}

/** Count a failed attempt. Returns the state after counting it. */
export async function recordFailure(bucket: Bucket, ip: string): Promise<LimitState> {
  const rule = RULES[bucket];
  let v: { count: number; ttl: number };
  try {
    v = await store().incr(keyFor(bucket, ip), rule.windowSec);
  } catch {
    v = await memory.incr(keyFor(bucket, ip), rule.windowSec);
  }
  const remaining = Math.max(0, rule.max - v.count);
  return { ok: remaining > 0, remaining, retryAfter: remaining > 0 ? 0 : v.ttl || rule.windowSec };
}

export async function clearFailures(bucket: Bucket, ip: string): Promise<void> {
  try {
    await store().del(keyFor(bucket, ip));
  } catch {
    /* ignore */
  }
  await memory.del(keyFor(bucket, ip));
}

/** "Too many attempts" response body + headers. */
export function tooMany(state: LimitState): Response {
  const mins = Math.max(1, Math.ceil(state.retryAfter / 60));
  return new Response(
    JSON.stringify({ error: `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, reason: "rate_limited", retryAfter: state.retryAfter }),
    { status: 429, headers: { "content-type": "application/json", "retry-after": String(state.retryAfter) } },
  );
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let d = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
