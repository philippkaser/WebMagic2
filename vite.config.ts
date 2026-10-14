import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Build stamp shown in the HUD corner: monotonically increasing commit
 * count + short SHA, so "which build am I actually running?" is never a
 * guessing game. */
function buildInfo(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD").toString().trim();
    const count = execSync("git rev-list --count HEAD").toString().trim();
    return JSON.stringify(`b${count} · ${sha}`);
  } catch {
    return JSON.stringify("dev");
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_INFO__: buildInfo(),
  },
  server: {
    port: 3000,
    // Game server (bun run dev:server). The client falls back to offline
    // single-player when this isn't running. WM_SERVER_PORT points the
    // proxy at a game server on another port (several dev stacks side by side).
    proxy: {
      "/ws": { target: `ws://localhost:${process.env.WM_SERVER_PORT ?? 3001}`, ws: true },
    },
    // Agent worktrees and server data live under the root but aren't the
    // app: a worktree coming or going must never reload a running client.
    watch: { ignored: ["**/.claude/**", "**/backups/**", "**/server-data*.json", "**/e2e-output/**"] },
  },
  // Only the app's own page seeds the dependency scan (a worktree's copy of
  // index.html under .claude/ would otherwise be crawled too).
  optimizeDeps: { entries: ["index.html"] },
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
