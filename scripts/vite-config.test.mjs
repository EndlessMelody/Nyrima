import { describe, expect, it } from "vitest";
import config from "../vite.config.ts";

describe("vite config", () => {
  it("only scans the active web app entry for dependency optimization", () => {
    expect(config.optimizeDeps?.entries).toEqual(["index.html"]);
  });
});
