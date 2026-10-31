/**
 * Several ElevenLabs keys, used one at a time: when a key runs out of
 * credits or is refused, the same request is sent again with the next key.
 * The pool remembers which key worked, so the remaining pieces of a long
 * video (and the next video) start with it.
 *
 * Browser-free and unit-tested; the actual upload is passed in.
 */

export type KeyProblem = "quota" | "invalid";

/** Is this error about the key itself (so another key could work)? */
export function keyProblem(e: unknown): KeyProblem | null {
  const x = e as { status?: number; code?: string } | null;
  if (!x) return null;
  if (x.code === "quota_exceeded" || x.status === 402) return "quota";
  if (x.code === "invalid_api_key" || x.status === 401) return "invalid";
  return null;
}

export const keyLabel = (k: string) => `…${k.slice(-6)}`;

export class AllKeysFailedError extends Error {
  constructor(public problems: { key: string; problem: KeyProblem }[], public status: number) {
    const q = problems.filter((p) => p.problem === "quota").length;
    const n = problems.length;
    super(
      n === 1
        ? problems[0].problem === "quota" ? "Your ElevenLabs credits have run out." : "Your ElevenLabs API key was refused. Check it in Settings → Your API key."
        : `All ${n} ElevenLabs keys were tried: ${q ? `${q} out of credits` : ""}${q && q < n ? ", " : ""}${q < n ? `${n - q} refused` : ""}. Add another key in Settings, or wait for your credits to reset.`,
    );
    this.name = "AllKeysFailedError";
  }
  get code() { return "all_keys_failed"; }
}

export interface KeyPool {
  /** Run one request, moving to the next key when the current one can't be used. */
  run<T>(fn: (key: string) => Promise<T>): Promise<T>;
  /** Index (in the original list) of the key in use. */
  current(): number;
}

export interface KeyPoolOptions {
  /** Start with this key (e.g. the one that worked last time). */
  start?: number;
  onSwitch?: (info: { from: number; to: number; problem: KeyProblem }) => void;
  onProblem?: (info: { index: number; key: string; problem: KeyProblem }) => void;
  onWorked?: (index: number) => void;
}

export function createKeyPool(keys: string[], o: KeyPoolOptions = {}): KeyPool {
  if (!keys.length) throw new Error("No keys");
  // try order: start, start+1, …, wrapping round to the earlier ones
  const start = Math.min(Math.max(0, o.start ?? 0), keys.length - 1);
  const order = keys.map((_, i) => (start + i) % keys.length);
  const dead = new Map<number, KeyProblem>();
  let cur = start;
  return {
    current: () => cur,
    async run<T>(fn: (key: string) => Promise<T>): Promise<T> {
      if (dead.size === keys.length) throw new AllKeysFailedError(order.map((i) => ({ key: keys[i], problem: dead.get(i)! })), dead.get(cur) === "quota" ? 402 : 401);
      for (;;) {
        try {
          const r = await fn(keys[cur]);
          o.onWorked?.(cur);
          return r;
        } catch (e) {
          const p = keyProblem(e);
          if (!p) throw e;
          dead.set(cur, p);
          o.onProblem?.({ index: cur, key: keys[cur], problem: p });
          const next = order.find((i) => !dead.has(i));
          if (next === undefined) {
            throw new AllKeysFailedError(order.map((i) => ({ key: keys[i], problem: dead.get(i)! })), p === "quota" ? 402 : 401);
          }
          o.onSwitch?.({ from: cur, to: next, problem: p });
          cur = next;
        }
      }
    },
  };
}
