/** Public site URL: set NEXT_PUBLIC_SITE_URL in Vercel (e.g. https://capmitra-app.vercel.app). */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
  "http://localhost:3000"
).replace(/\/$/, "");

export const SITE_NAME = "CapMitra";
export const SITE_TITLE = "CapMitra: Captions & Video Editor";
export const SITE_DESCRIPTION =
  "Auto captions in Gujarati, Hindi, Hinglish, English and more, plus video editing, effects and music for Reels, Shorts and YouTube. Word-by-word transcription, animated templates, and MP4 or SRT export, rendered on your own device.";

/** Only let search engines index the site when it's meant to be public. */
export const INDEXABLE = process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true";
