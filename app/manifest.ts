import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CapMitra: Captions & Video Editor",
    short_name: "CapMitra",
    description: "Edit video, audio and captions in one place",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F8F4",
    theme_color: "#F7F8F4",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
