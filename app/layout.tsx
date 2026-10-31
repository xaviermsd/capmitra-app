/* eslint-disable @next/next/no-img-element */
import type { Metadata, Viewport } from "next";
import "./styles/capmitra-brand.css";
import "./styles/workspace.css";
import { CREATOR } from "@/components/Credit";
import { INDEXABLE, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "CapMitra", "auto captions", "Hindi captions", "Hinglish captions", "Gujarati captions", "Gujarati subtitles", "video editor", "Reels editor",
    "Reels captions", "YouTube Shorts captions", "ગુજરાતી કેપ્શન", "ગુજરાતી સબટાઇટલ", "SRT Gujarati", "Anek Gujarati",
  ],
  authors: [{ name: CREATOR.name, url: CREATOR.url }],
  creator: CREATOR.name,
  publisher: CREATOR.name,
  category: "video",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "gu_IN",
    alternateLocale: ["en_IN"],
  },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
  robots: INDEXABLE ? { index: true, follow: true } : { index: false, follow: false },
  appleWebApp: { capable: true, title: "CapMitra", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Any (web browser)",
  inLanguage: ["gu", "en"],
  offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
  author: { "@type": "Person", name: CREATOR.name, url: CREATOR.url },
  creator: { "@type": "Person", name: CREATOR.name, url: CREATOR.url },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F7F8F4",
};


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="gu" suppressHydrationWarning>
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Anek+Gujarati:wdth,wght@75..125,300..800&family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap"
        />
      </head>
      <body suppressHydrationWarning>
        <div id="splash" role="status" aria-label="Loading CapMitra">
          <img src="/brand/icon-192.png" width="96" height="96" alt="" className="splash-icon" />
          <p className="splash-name">CapMitra <span>EDIT</span></p>
          <span className="wave-loader big" aria-hidden="true">
            {Array.from({ length: 11 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 5) * 0.11}s` }} />)}
          </span>
          <p className="splash-sub">Preparing your studio…</p>
          <p className="credit splash-credit">Made with <span role="img" aria-label="love">❤️</span> by <a href={CREATOR.url} target="_blank" rel="noopener noreferrer">{CREATOR.name}</a></p>
        </div>
        {children}
      </body>
    </html>
  );
}
