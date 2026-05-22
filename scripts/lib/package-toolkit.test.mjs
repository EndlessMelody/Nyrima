import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageExtension } from "./package-toolkit.mjs";

describe("package toolkit", () => {
  it("packages dist files into a versioned zip artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "nyrima-package-"));
    const distDir = join(root, "dist");
    const outDir = join(root, "dist-zip");

    mkdirSync(join(distDir, "assets"), { recursive: true });
    writeFileSync(join(distDir, "manifest.json"), '{"name":"Nyrima"}');
    writeFileSync(join(distDir, "assets", "app.js"), "console.log('Nyrima');");

    const artifact = packageExtension({
      root,
      distDir,
      outDir,
      version: "0.1.0",
    });

    expect(artifact.fileName).toBe("nyrima-0.1.0.zip");
    expect(artifact.entries).toEqual(["assets/app.js", "manifest.json"]);
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(artifact.path).subarray(0, 2).toString()).toBe("PK");
  });
});
