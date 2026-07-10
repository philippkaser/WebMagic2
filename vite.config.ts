import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Game server (bun run dev:server). The client falls back to offline
    // single-player when this isn't running.
    proxy: {
      "/ws": { target: "ws://localhost:3001", ws: true },
    },
  },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          r3f: [
            "@react-three/fiber",
            "@react-three/drei",
            "@react-three/postprocessing",
            "postprocessing",
          ],
          physics: ["@react-three/rapier"],
        },
      },
    },
  },
});
