import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

const bridge = `http://localhost:${process.env.GRAPHCODE_WEB_PORT ?? "4747"}`;

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // changeOrigin rewrites the Host header to the bridge's own; the bridge refuses a
    // WebSocket handshake addressed to any other host (see acceptsHandshake in server/main.ts).
    proxy: {
      "/api": { target: bridge, changeOrigin: true },
      "/ws": { target: bridge.replace("http", "ws"), ws: true, changeOrigin: true },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
