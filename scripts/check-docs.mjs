#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  checkMarkdownLinks,
  findMarkdownDocs,
  formatMarkdownProblems,
} from "./lib/docs-toolkit.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const markdownPaths = findMarkdownDocs(root);
const problems = checkMarkdownLinks(markdownPaths, root);

if (problems.length) {
  console.error("[docs:check] Missing local Markdown targets:");
  for (const problem of formatMarkdownProblems(root, problems)) {
    console.error(`- ${problem}`);
  }
  process.exitCode = 1;
} else {
  console.log(`[docs:check] Checked ${markdownPaths.length} Markdown files.`);
}
