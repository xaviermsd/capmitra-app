import { describe, expect, it } from "vitest";
import { ACCENT_TEMPLATE_IDS, TEMPLATES } from "@/lib/templates";
import { ALL_FONTS, cssUrl, fontByFamily } from "@/lib/fonts";

const known = new Set(ALL_FONTS.map((f) => f.family));

describe("caption templates", () => {
  it("have unique ids", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });
  it("only use fonts the app can load (caption, accent and row fonts)", () => {
    for (const t of TEMPLATES) {
      expect(known.has(t.font), `${t.id}: ${t.font}`).toBe(true);
      if (t.accent?.font) expect(known.has(t.accent.font), `${t.id} accent: ${t.accent.font}`).toBe(true);
      for (const r of t.rows ?? []) if (r.font) expect(known.has(r.font), `${t.id} row: ${r.font}`).toBe(true);
    }
  });
  it("mark accent templates so picking one can highlight keywords", () => {
    expect(ACCENT_TEMPLATE_IDS.has("mehndi-script")).toBe(true);
    expect(ACCENT_TEMPLATE_IDS.has("spotlight")).toBe(false);
  });
  it("request italic faces from Google Fonts when a font has them", () => {
    expect(cssUrl(fontByFamily("Playfair Display"))).toContain("ital,wght@0,400..900;1,400..900");
    expect(cssUrl(fontByFamily("Rasa"))).toContain("ital,wght@0,300;");
  });
});
