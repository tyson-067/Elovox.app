import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Same "@/*" alias tsconfig.json declares, so a test imports a module by
    // the path the app uses rather than by a relative walk that silently
    // resolves to a different file after a move.
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Unit and component tests only. The Playwright suite lives in tests/e2e
    // and needs a real browser and a running server, so it must not be picked
    // up here — vitest would import its files and fail on the `test` import.
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
  },
});
