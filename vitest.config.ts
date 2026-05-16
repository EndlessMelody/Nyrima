/**
 * Vitest config.
 *
 * Targets the pure-logic modules under `src/shared` and `src/app/services`
 * that the rest of the app leans on (title parser, subtitle converters,
 * folder URL parsing). UI components stay out of the test suite for now —
 * the chrome.* surface area and the WebGL/canvas paths in the player are
 * better covered by manual smoke passes than mocked unit tests.
 */

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    clearMocks: true,
  },
});
