import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RULES, checkLimit, clearFailures, clientIp, memoryStore, recordFailure, safeEqual, setCounterStore } from "@/lib/rateLimit";
import { makeToken, parseToken, samePassword } from "@/lib/adminAuth";
import { createCode, normaliseCode, verifyCode } from "@/lib/unlock";

const env = { ...process.env };
beforeEach(() => {
  process.env.VERCEL = "1"; // no file writes in tests (and no Redis)
  delete process.env.KV_REST_API_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  setCounterStore(memoryStore());
});
afterEach(() => {
  process.env = { ...env };
  setCounterStore(null);
});

const post = (url: string, body: unknown, ip = "1.2.3.4") =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });

describe("rate limiter", () => {
  it("blocks after the allowed number of failures and unblocks on success", async () => {
    const max = RULES.passcode.max;
    for (let i = 0; i < max - 1; i++) expect((await recordFailure("passcode", "9.9.9.9")).ok).toBe(true);
    expect((await recordFailure("passcode", "9.9.9.9")).ok).toBe(false);
    const st = await checkLimit("passcode", "9.9.9.9");
    expect(st.ok).toBe(false);
    expect(st.retryAfter).toBeGreaterThan(0);
    // other IPs and other buckets are unaffected
    expect((await checkLimit("passcode", "8.8.8.8")).ok).toBe(true);
    expect((await checkLimit("admin", "9.9.9.9")).ok).toBe(true);
    await clearFailures("passcode", "9.9.9.9");
    expect((await checkLimit("passcode", "9.9.9.9")).ok).toBe(true);
  });

  it("forgets failures after the window", async () => {
    let now = 1_000_000;
    setCounterStore(memoryStore(() => now));
    for (let i = 0; i < RULES.admin.max; i++) await recordFailure("admin", "7.7.7.7");
    expect((await checkLimit("admin", "7.7.7.7")).ok).toBe(false);
    now += RULES.admin.windowSec * 1000 + 1;
    expect((await checkLimit("admin", "7.7.7.7")).ok).toBe(true);
  });

  it("reads the client IP from proxy headers", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "5.6.7.8, 10.0.0.1" } }))).toBe("5.6.7.8");
    expect(clientIp(new Request("http://x"))).toBe("local");
  });

  it("compares strings safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("passcode login route", () => {
  it("never reveals the passcode length", async () => {
    process.env.APP_PASSCODE = "4821";
    const { GET } = await import("@/app/api/login/route");
    const d = await GET().json();
    expect(d).toEqual({ locked: true });
  });

  it("returns 429 after too many wrong guesses, even for the right code", async () => {
    process.env.APP_PASSCODE = "4821";
    const { POST } = await import("@/app/api/login/route");
    let last = 0;
    for (let i = 0; i < RULES.passcode.max; i++) last = (await POST(post("http://localhost/api/login", { passcode: "0000" }, "2.2.2.2"))).status;
    expect(last).toBe(429);
    const right = await POST(post("http://localhost/api/login", { passcode: "4821" }, "2.2.2.2"));
    expect(right.status).toBe(429);
    const other = await POST(post("http://localhost/api/login", { passcode: "4821" }, "3.3.3.3"));
    expect(other.status).toBe(200);
  }, 20_000);
});

describe("admin sessions", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "correct horse";
    process.env.WATERMARK_SECRET = "s".repeat(32);
  });

  it("signs, verifies and expires session tokens", async () => {
    const id = "a".repeat(36);
    const now = Date.now();
    const t = await makeToken(id, now + 3_600_000);
    expect((await parseToken(t, now))?.id).toBe(id);
    expect(await parseToken(t, now + 2 * 3_600_000)).toBeNull(); // expired
    expect(await parseToken(t.replace(/.$/, (c) => (c === "0" ? "1" : "0")), now)).toBeNull(); // tampered
  });

  it("cookies stop working when the password changes", async () => {
    const t = await makeToken("b".repeat(36), Date.now() + 3_600_000);
    process.env.ADMIN_PASSWORD = "new password";
    expect(await parseToken(t)).toBeNull();
  });

  it("checks the password", () => {
    expect(samePassword("correct horse")).toBe(true);
    expect(samePassword("correct hors")).toBe(false);
    expect(samePassword(undefined)).toBe(false);
  });

  it("sign-in creates a random, expiring cookie; repeated wrong passwords get 429", async () => {
    const { POST } = await import("@/app/api/admin/session/route");
    const ok = await POST(post("http://localhost/api/admin/session", { password: "correct horse" }, "4.4.4.4"));
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/cm_admin=[0-9a-f]{36}\.[0-9a-z]+\.[0-9a-f]{40}/);
    expect(cookie).toMatch(/Max-Age=43200/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    const ok2 = await POST(post("http://localhost/api/admin/session", { password: "correct horse" }, "4.4.4.4"));
    expect(ok2.headers.get("set-cookie")).not.toBe(cookie);

    let last = 0;
    for (let i = 0; i < RULES.admin.max; i++) last = (await POST(post("http://localhost/api/admin/session", { password: "nope" }, "6.6.6.6"))).status;
    expect(last).toBe(429);
  }, 20_000);
});

describe("watermark codes", () => {
  beforeEach(() => {
    process.env.WATERMARK_SECRET = "x".repeat(32);
    process.env.WATERMARK_MASTER_CODE = "MY-MASTER-CODE";
  });

  it("creates codes that verify, and rejects edited ones", async () => {
    const c = await createCode("Ravi Patel", 24);
    expect(c.code).toMatch(/^AC-RAVIPATEL-[0-9A-Z]+-[0-9A-Z]{8}$/);
    expect((await verifyCode(c.code.toLowerCase())).ok).toBe(true);
    const forged = c.code.replace("RAVIPATEL", "MEERA");
    expect(await verifyCode(forged)).toMatchObject({ ok: false, reason: "signature" });
  });

  it("expires codes", async () => {
    const parts = (await createCode("TEST", 1)).code.split("-");
    // an expiry in the past, re-signed: build it with createCode at hours > 0 then fake the clock
    const realNow = Date.now;
    Date.now = () => realNow() + 2 * 3_600_000;
    try {
      expect(await verifyCode(parts.join("-"))).toMatchObject({ ok: false, reason: "expired" });
    } finally {
      Date.now = realNow;
    }
  });

  it("honours revocation and the master code", async () => {
    const c = await createCode("ASHA", 0);
    process.env.WATERMARK_REVOKED = "ASHA";
    expect(await verifyCode(c.code)).toMatchObject({ ok: false, reason: "revoked" });
    expect(await verifyCode("my master code")).toMatchObject({ ok: false }); // spaces are removed, dashes are not added
    expect((await verifyCode(normaliseCode("MY-MASTER-CODE"))).ok).toBe(true);
  });
});
