import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @tauri-apps/cli imposta TAURI_DEV_HOST quando serve (es. mobile)
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Tauri si aspetta una porta fissa e fallisce se non disponibile
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // non osservare la cartella del core Rust
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // Il dataset offline CAP/Belfiore è intenzionalmente grande: lo teniamo isolato
    // dagli altri chunk e alziamo la soglia solo per evitare warning non azionabili.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll("\\", "/");
          if (normalized.includes("/src/data/cap-db") || normalized.includes("/src/data/belfiore")) {
            return "data-locali";
          }
          if (!normalized.includes("/node_modules/")) return;
          if (normalized.includes("/react/") || normalized.includes("/react-dom/") || normalized.includes("/scheduler/")) {
            return "vendor-react";
          }
          if (normalized.includes("/@mantine/charts/") || normalized.includes("/recharts/") || normalized.includes("/d3-")) {
            return "vendor-charts";
          }
          if (normalized.includes("/@mantine/") || normalized.includes("/mantine-datatable/")) {
            return "vendor-mantine";
          }
          if (normalized.includes("/framer-motion/")) {
            return "vendor-motion";
          }
          if (normalized.includes("/@tauri-apps/")) {
            return "vendor-tauri";
          }
          if (normalized.includes("/@tabler/icons-react/")) {
            return "vendor-icons";
          }
        },
      },
    },
  },
}));
