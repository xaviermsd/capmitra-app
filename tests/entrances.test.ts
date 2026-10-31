import { describe, expect, it } from "vitest";
import { entrance, REST } from "@/lib/animation";
import type { EnterAnimation } from "@/lib/types";

const ALL: EnterAnimation[] = ["none", "fade", "pop", "spring", "rise", "drop", "slideleft", "zoom", "blur", "letters", "typewriter", "bounce", "shake", "glitch",
  "stamp", "whip", "swing", "elastic", "slam", "sticker", "chatpop", "notify", "punch", "roll", "flicker"];

describe("caption entrances", () => {
  it("are hidden before they start and at rest once finished", () => {
    for (const k of ALL) {
      if (k !== "none") expect(entrance(k, -0.1).opacity, k).toBe(0);
      expect(entrance(k, 5), k).toEqual(REST);
    }
  });
  it("never produce NaN mid-way, with or without a custom easing", () => {
    for (const k of ALL) for (const t of [0, 0.03, 0.1, 0.2, 0.35]) {
      for (const p of [entrance(k, t), entrance(k, t, 1, { easing: "spring", direction: "left" })]) {
        for (const v of Object.values(p)) expect(Number.isFinite(v), `${k} at ${t}`).toBe(true);
      }
    }
  });
});
