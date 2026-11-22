import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "YOleotard CRM",
    short_name: "YOleotard CRM",
    lang: "ru",
    start_url: "/?section=overview",
    scope: "/",
    display: "standalone",
    theme_color: "#faf8fd",
    background_color: "#faf8fd",
    icons: [
      { src: "/meta/crm-pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/meta/crm-pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/meta/crm-pwa-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
