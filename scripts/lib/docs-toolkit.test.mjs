import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkMarkdownLinks } from "./docs-toolkit.mjs";

describe("docs toolkit", () => {
  it("reports missing local markdown links and ignores external links", () => {
    const root = mkdtempSync(join(tmpdir(), "nyrima-docs-"));
    const docsDir = join(root, "docs");
    const guidePath = join(docsDir, "guide.md");

    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(root, "README.md"), "# Home\n");
    writeFileSync(
      guidePath,
      [
        "[home](../README.md)",
        "[missing](./missing.md#setup)",
        "[web](https://example.com/docs)",
        "[heading](#local-heading)",
      ].join("\n"),
    );

    expect(checkMarkdownLinks([guidePath], root)).toEqual([
      {
        file: guidePath,
        target: "./missing.md#setup",
        resolvedPath: join(docsDir, "missing.md"),
      },
    ]);
  });
});
