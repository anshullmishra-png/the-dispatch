import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Unit tests stay network-free; DB tests run via `npm run test:db`.
    exclude: ["tests/integration/**", "**/node_modules/**"],
  },
});
