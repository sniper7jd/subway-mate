import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const certificatePath = process.env.SUBWAY_MATE_CERT;
const privateKeyPath = process.env.SUBWAY_MATE_KEY;
if (Boolean(certificatePath) !== Boolean(privateKeyPath)) {
  throw new Error("Set both SUBWAY_MATE_CERT and SUBWAY_MATE_KEY, or neither.");
}
const customHttps = certificatePath
  ? { cert: readFileSync(certificatePath), key: readFileSync(privateKeyPath) }
  : undefined;

export default defineConfig({
  plugins: [
    ...(!customHttps ? [basicSsl({ name: "subway-mate", domains: ["localhost"] })] : []),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: true },
      includeAssets: ["signs/*", "CREDITS.txt"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,json,txt,wasm,traineddata}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
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
    https: customHttps,
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  preview: {
    https: customHttps,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  build: {
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => assetInfo.name === "eng.traineddata"
          ? "assets/ocr/eng.traineddata"
          : "assets/[name]-[hash][extname]",
      },
    },
  },
});
