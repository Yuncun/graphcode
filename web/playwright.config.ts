import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { viewport: { width: 1400, height: 900 } },
  webServer: {
    command: "pnpm build && GRAPHCODE_WEB_PORT=4790 node server/main.ts",
    url: "http://localhost:4790",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
