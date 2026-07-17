import { describe, expect, it } from "vitest";

describe("Landing VN styles", () => {
  it("loads the stage stylesheet that styles the VN screen chrome", async () => {
    const { readFileSync } = await import("node:fs");
    const pageSource = readFileSync(new URL("./LandingVNPage.tsx", import.meta.url), "utf-8") as string;
    const stylesheet = readFileSync(new URL("./landing-vn.scss", import.meta.url), "utf-8") as string;

    expect(pageSource).toContain('import "./landing-vn.scss";');
    for (const selector of [
      ".lvn-stage",
      ".lvn-topbar",
      ".lvn-mascot",
      ".lvn-content",
      ".lvn-dialogue",
      ".lvn-index__card",
    ]) {
      expect(stylesheet).toContain(selector);
    }
  });
});
