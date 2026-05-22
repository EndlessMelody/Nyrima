#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  formatManifestSummary,
  readDistManifest,
  summarizeManifest,
} from "./lib/extension-toolkit.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

try {
  const manifest = readDistManifest(root);
  console.log("[inspect:manifest] Generated extension manifest");
  console.log(formatManifestSummary(summarizeManifest(manifest)));
} catch (error) {
  console.error(`[inspect:manifest] ${error.message}`);
  process.exitCode = 1;
}
