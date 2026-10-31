import { describe, expect, it } from "vitest";
import { isStale, linesToTranslate, mergeTranslations, translationFor } from "@/lib/bilingual";
import { languageByCode, scriptOptions, scriptsIn, translationPlan } from "@/lib/languages";
import type { CaptionLine } from "@/lib/types";

const L = (key: string, text: string): CaptionLine => ({ id: key, key, start: 0, end: 1, words: text.split(" ").map((t, i) => ({ id: i ? `${key}${i}` : key, text: t, start: i, end: i + 1 })) });

describe("bilingual captions", () => {
  it("keeps translations apart from the words and finds them after regrouping", () => {
    const a = L("k1", "નમસ્તે મિત્રો");
    const tr = mergeTranslations([a], undefined, [{ line: a, text: "Hello friends" }], "en-IN");
    expect(translationFor(a, tr)?.text).toBe("Hello friends");
    const regrouped = L("k9", "નમસ્તે મિત્રો");
    expect(translationFor(regrouped, tr)?.text).toBe("Hello friends");
  });

  it("marks translations stale when the caption text changes, but keeps hand edits", () => {
    const a = L("k1", "નમસ્તે મિત્રો");
    const tr = mergeTranslations([a], undefined, [{ line: a, text: "Hello friends" }], "en-IN");
    const edited = L("k1", "નમસ્તે દોસ્તો");
    expect(isStale(edited, tr.k1)).toBe(true);
    expect(linesToTranslate([edited], tr, "en-IN")).toHaveLength(1);
    const manual = { k1: { ...tr.k1, manual: true } };
    expect(linesToTranslate([edited], manual, "en-IN")).toHaveLength(0);
    expect(linesToTranslate([edited], manual, "en-IN", true)).toHaveLength(1);
  });
});

describe("languages", () => {
  it("maps old codes and lists only sensible scripts", () => {
    expect(languageByCode("mr")?.code).toBe("mar");
    expect(languageByCode("gu-IN")?.name).toBe("Gujarati");
    expect(scriptOptions("hi").map((o) => o.value)).toEqual(["native", "casual", "roman"]);
    expect(scriptOptions("en")).toHaveLength(1);
    expect(scriptOptions("tam")).toHaveLength(1); // no local romaniser for Tamil
  });

  it("only offers translation pairs Sarvam supports", () => {
    expect(translationPlan("gu", "en-IN")).toEqual({ source: "gu-IN", target: "en-IN", model: "mayura:v1" });
    expect(translationPlan("urd", "en-IN")?.model).toBe("sarvam-translate:v1");
    expect(translationPlan("spa", "en-IN")).toBeNull();
    expect(translationPlan("en", "en-IN")).toBeNull();
    expect(translationPlan("auto", "ur-IN")).toBeNull(); // auto-detect needs mayura
  });

  it("detects writing systems in mixed text", () => {
    expect([...scriptsIn("नमस्ते Gujarat ગુજરાત")].sort()).toEqual(["Deva", "Gujr", "Latn"]);
  });
});
