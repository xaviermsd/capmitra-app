import type { MetadataRoute } from "next";
import { INDEXABLE, SITE_URL } from "@/lib/site";

const PREVIEW_BOTS = ["Twitterbot", "facebookexternalhit", "Facebot", "LinkedInBot", "WhatsApp", "TelegramBot", "Slackbot", "Slackbot-LinkExpanding", "Discordbot", "Pinterestbot"];

export default function robots(): MetadataRoute.Robots {
  return INDEXABLE
    ? { rules: [{ userAgent: PREVIEW_BOTS, allow: "/" }, { userAgent: "*", allow: "/", disallow: ["/api/", "/login"] }], sitemap: `${SITE_URL}/sitemap.xml` }
    : {
        rules: [
          // link-preview bots may read the page so shared links show the CapMitra card;
          // search engines stay out (every page also carries a noindex tag)
          { userAgent: PREVIEW_BOTS, allow: "/" },
          { userAgent: "*", disallow: "/" },
        ],
      };
}
