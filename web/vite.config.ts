import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

const bridge = `http://localhost:${process.env.GRAPHCODE_WEB_PORT ?? "4747"}`;

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": bridge,
      "/ws": { target: bridge.replace("http", "ws"), ws: true },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
