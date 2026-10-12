import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Hits the real Neon database from .env.local. Kept out of `npm test`, which
// must stay network-free (docs/08-TESTING-DEMO-SUBMISSION.md §1).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
