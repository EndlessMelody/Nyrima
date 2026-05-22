#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  formatManifestSummary,
  readDistManifest,
  summarizeManifest,
  validateDistExtension,
} from "./lib/extension-toolkit.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

try {
  const manifest = readDistManifest(root);
  const problems = validateDistExtension(root, manifest);

  if (problems.length) {
    console.error("[verify:extension] Generated extension is not ready:");
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    process.exitCode = 1;
  } else {
    console.log("[verify:extension] Generated extension output is ready.");
    console.log(formatManifestSummary(summarizeManifest(manifest)));
  }
} catch (error) {
  console.error(`[verify:extension] ${error.message}`);
  process.exitCode = 1;
}
