import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    basicSsl({
      name: "subway-mate",
      domains: ["localhost", "10.48.77.182"],
    }),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: true },
      includeAssets: ["signs/*", "CREDITS.txt"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,json,txt,wasm}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "tesseract-cdn", expiration: { maxEntries: 20 } },
          },
        ],
      },
      manifest: {
        name: "Subway Mate",
        short_name: "Subway Mate",
        start_url: "/",
        display: "standalone",
        background_color: "#07110e",
        theme_color: "#07110e",
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  preview: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
