/** Public site URL: set NEXT_PUBLIC_SITE_URL in Vercel (e.g. https://capmitra-app.vercel.app). */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
  "http://localhost:3000"
).replace(/\/$/, "");

export const SITE_NAME = "CapMitra";
export const SITE_TITLE = "CapMitra Edit: video, audio and caption editor";
export const SITE_DESCRIPTION =
  "Edit video, audio and captions in one place, right in your browser. Word-by-word captions in 34 languages, noise reduction and music, effects, transitions and 4K export.";

/** Only let search engines index the site when it's meant to be public. */
export const INDEXABLE = process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true";
