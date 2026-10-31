/**
 * Make an uploaded SVG safe to store and draw.
 *
 * SVGs are drawn through an <img>/canvas, where browsers already refuse to run
 * scripts or load external files. We still clean them on the way in, so a
 * project or brand kit shared with someone else can never carry active content:
 *  - only plain drawing elements are kept (no script, foreignObject, iframe,
 *    links, animation elements that can rewrite attributes);
 *  - event handlers, javascript: URLs and external references are removed;
 *  - inline images must be data:image/png|jpeg|gif|webp.
 */

const MAX_BYTES = 512 * 1024;

const ALLOWED = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textpath",
  "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "use", "symbol", "title", "desc",
  "image", "filter", "fegaussianblur", "feoffset", "feblend", "fecolormatrix", "femerge", "femergenode", "feflood",
  "fecomposite", "fedropshadow", "femorphology", "style", "marker",
]);

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

function badValue(v: string): boolean {
  const s = v.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
  return s.includes("javascript:") || s.includes("vbscript:") || s.includes("data:text/html") || s.includes("expression(");
}

/** url(...) references must point inside the document (#id). */
function externalUrl(v: string): boolean {
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v))) if (!m[2].trim().startsWith("#")) return true;
  return /@import/i.test(v);
}

export class UnsafeSvgError extends Error {}

export interface CleanResult {
  svg: string;
  /** Things that were removed (for an honest message to the user). */
  removed: string[];
  width: number;
  height: number;
}

/** Clean SVG markup. Throws UnsafeSvgError when it isn't a usable SVG. */
export function sanitizeSvg(markup: string): CleanResult {
  if (typeof DOMParser === "undefined") throw new UnsafeSvgError("SVG cleaning needs a browser.");
  if (new Blob([markup]).size > MAX_BYTES) throw new UnsafeSvgError("That SVG is larger than 512 KB.");
  // never let the parser fetch an external DTD / entity
  if (/<!DOCTYPE[^>]*\[|<!ENTITY/i.test(markup)) throw new UnsafeSvgError("SVGs with entity declarations aren't allowed.");
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) {
    throw new UnsafeSvgError("That file isn't a valid SVG.");
  }
  const removed = new Set<string>();

  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const name = child.localName.toLowerCase();
      if (!ALLOWED.has(name)) {
        removed.add(`<${child.localName}>`);
        child.remove();
        continue;
      }
      walk(child);
    }
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name.toLowerCase();
      const v = attr.value;
      if (n.startsWith("on")) { el.removeAttribute(attr.name); removed.add("event handlers"); continue; }
      if (n === "href" || n === "xlink:href" || n.endsWith(":href")) {
        const ok = v.trim().startsWith("#") || (el.localName.toLowerCase() === "image" && SAFE_DATA_IMAGE.test(v.trim()));
        if (!ok) { el.removeAttribute(attr.name); removed.add("external links"); }
        continue;
      }
      if (badValue(v)) { el.removeAttribute(attr.name); removed.add("scripts in attributes"); continue; }
      if ((n === "style" || /^(fill|stroke|filter|clip-path|mask|marker-.*)$/.test(n)) && externalUrl(v)) {
        el.removeAttribute(attr.name);
        removed.add("external references");
      }
    }
    if (el.localName.toLowerCase() === "style") {
      const css = el.textContent ?? "";
      if (externalUrl(css) || badValue(css)) { el.textContent = ""; removed.add("external styles"); }
    }
  };
  walk(root);

  // make sure it has a size so <img> can draw it
  const vb = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  let width = parseFloat(root.getAttribute("width") ?? "");
  let height = parseFloat(root.getAttribute("height") ?? "");
  if (!(width > 0) || !(height > 0)) {
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { width = vb[2]; height = vb[3]; }
    else { width = 512; height = 512; }
    root.setAttribute("width", String(width));
    root.setAttribute("height", String(height));
  }
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const svg = new XMLSerializer().serializeToString(root);
  return { svg, removed: [...removed], width, height };
}
