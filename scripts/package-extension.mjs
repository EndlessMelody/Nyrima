#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readDistManifest,
  validateDistExtension,
} from "./lib/extension-toolkit.mjs";
import { packageExtension } from "./lib/package-toolkit.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

try {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const manifest = readDistManifest(root);
  const problems = validateDistExtension(root, manifest);

  if (problems.length) {
    throw new Error(
      `generated extension is not ready:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
  }

  const artifact = packageExtension({
    root,
    distDir: join(root, "dist"),
    outDir: join(root, "dist-zip"),
    version: pkg.version,
  });

  console.log(`[package] Wrote ${artifact.relativePath}`);
  console.log(`[package] Size ${artifact.size.toLocaleString("en-US")} bytes`);
  console.log(`[package] SHA-256 ${artifact.sha256}`);
} catch (error) {
  console.error(`[package] ${error.message}`);
  process.exitCode = 1;
}
