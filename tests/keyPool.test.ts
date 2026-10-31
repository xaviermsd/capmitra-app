import { describe, expect, it } from "vitest";
import { AllKeysFailedError, createKeyPool, keyProblem } from "@/lib/keyPool";

const err = (status: number, code?: string) => Object.assign(new Error("x"), { status, code });

describe("key pool", () => {
  it("knows which errors are about the key", () => {
    expect(keyProblem(err(402))).toBe("quota");
    expect(keyProblem(err(402, "quota_exceeded"))).toBe("quota");
    expect(keyProblem(err(401, "invalid_api_key"))).toBe("invalid");
    expect(keyProblem(err(429))).toBeNull();
    expect(keyProblem(err(503))).toBeNull();
  });
  it("moves to the next key when one runs out, and stays there", async () => {
    const used: string[] = [];
    const switches: string[] = [];
    const pool = createKeyPool(["k1", "k2", "k3"], { onSwitch: (s) => switches.push(`${s.from}->${s.to}:${s.problem}`) });
    const send = async (k: string) => { used.push(k); if (k === "k1") throw err(402); return k; };
    expect(await pool.run(send)).toBe("k2");
    expect(await pool.run(send)).toBe("k2"); // next piece starts with the working key
    expect(used).toEqual(["k1", "k2", "k2"]);
    expect(switches).toEqual(["0->1:quota"]);
    expect(pool.current()).toBe(1);
  });
  it("starts with the remembered key and wraps round to earlier ones", async () => {
    const used: string[] = [];
    const pool = createKeyPool(["a", "b", "c"], { start: 2 });
    const r = await pool.run(async (k) => { used.push(k); if (k !== "a") throw err(401, "invalid_api_key"); return k; });
    expect(r).toBe("a");
    expect(used).toEqual(["c", "a"]);
  });
  it("doesn't switch keys for temporary errors", async () => {
    const pool = createKeyPool(["a", "b"]);
    await expect(pool.run(async () => { throw err(429); })).rejects.toMatchObject({ status: 429 });
    expect(pool.current()).toBe(0);
  });
  it("says so when every key has been tried", async () => {
    const pool = createKeyPool(["a", "b", "c"]);
    const e = await pool.run(async (k) => { throw k === "b" ? err(401) : err(402); }).catch((x) => x);
    expect(e).toBeInstanceOf(AllKeysFailedError);
    expect(e.message).toMatch(/All 3 .*2 out of credits, 1 refused/);
    expect(e.status).toBe(402);
  });
  it("once every key is used up, doesn't call any key again", async () => {
    const pool = createKeyPool(["a", "b"]);
    let n = 0;
    const send = async () => { n++; throw err(402); };
    await pool.run(send).catch(() => {});
    await expect(pool.run(send)).rejects.toBeInstanceOf(AllKeysFailedError);
    expect(n).toBe(2);
  });
  it("with one key, gives the plain message", async () => {
    const e = await createKeyPool(["a"]).run(async () => { throw err(402); }).catch((x) => x);
    expect(e.message).toBe("Your ElevenLabs credits have run out.");
  });
});
