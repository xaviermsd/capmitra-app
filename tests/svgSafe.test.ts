// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeSvg, UnsafeSvgError } from "@/lib/svgSafe";

describe("SVG cleaning", () => {
  it("removes scripts, handlers, foreignObject and external links", () => {
    const r = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><foreignObject><div/></foreignObject><a href="https://x"><rect/></a><rect width="5" height="5" fill="url(https://evil/x)" onclick="x()"/><use href="#ok"/><image href="https://evil/p.png"/><circle r="2" style="fill:red"/></svg>`);
    expect(r.svg).not.toMatch(/script|onload|onclick|foreignObject|https:\/\/evil|<a/);
    expect(r.svg).toContain('href="#ok"');
    expect(r.svg).toContain("circle");
    expect(r.width).toBe(10);
    expect(r.removed.length).toBeGreaterThan(0);
  });
  it("rejects non-SVG and entity tricks", () => {
    expect(() => sanitizeSvg("<html></html>")).toThrow(UnsafeSvgError);
    expect(() => sanitizeSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')).toThrow(UnsafeSvgError);
  });
});
