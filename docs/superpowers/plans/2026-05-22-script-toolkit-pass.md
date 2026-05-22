# Nyrima Script Toolkit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a larger developer and release script toolkit that verifies the built Chrome extension, checks documentation links, exposes MKV diagnostics, and produces a real Chrome upload ZIP.

**Architecture:** Keep `package.json` as the command map and place reusable Node-only logic under `scripts/lib/` so the CLIs stay small and Vitest can exercise the behavior. Read generated extension state from `dist/` rather than duplicating the TypeScript manifest config, package `dist/` with `adm-zip`, and keep release commands cross-platform by using npm scripts and Node modules.

**Tech Stack:** Node ESM scripts, Vitest JavaScript tests, Chrome Manifest V3 output, `adm-zip`, npm scripts.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `package.json` | Public command map and ZIP dependency. |
| `package-lock.json` | Locked `adm-zip` dependency. |
| `vitest.config.ts` | Include Node script tests with the existing source tests. |
| `scripts/lib/extension-toolkit.mjs` | Generated-manifest reading, validation, summary formatting, required output checks. |
| `scripts/lib/docs-toolkit.mjs` | Local Markdown-link discovery and validation. |
| `scripts/lib/package-toolkit.mjs` | Walk `dist/`, write ZIP artifact, and compute artifact metadata. |
| `scripts/*.mjs` CLIs | Small entry points for manifest inspection, extension verification, docs checking, and packaging. |
| `scripts/lib/*.test.mjs` | Focused behavior tests for the script toolkit. |
| `README.md`, `.claude/workflow.md`, `PHASES.md` | Command map, deploy workflow, and closed packaging backlog claim. |

### Task 1: Make script modules testable

**Files:**
- Modify: `vitest.config.ts`
- Create: `scripts/lib/extension-toolkit.test.mjs`
- Create: `scripts/lib/docs-toolkit.test.mjs`
- Create: `scripts/lib/package-toolkit.test.mjs`

- [ ] **Step 1: Include script tests in Vitest**

```ts
test: {
  include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  environment: "node",
  globals: false,
  clearMocks: true,
}
```

- [ ] **Step 2: Write failing extension-toolkit tests**

```js
import { describe, expect, it } from "vitest";
import {
  getExtensionOutputProblems,
  summarizeManifest,
  validateManifest,
} from "./extension-toolkit.mjs";

it("summarizes Nyrima manifest access and entry points", () => {
  expect(summarizeManifest(manifest).hosts).toContain("https://www.googleapis.com/*");
});

it("reports missing generated extension output", () => {
  expect(getExtensionOutputProblems(root, manifest)).toContain("missing icons/extension-icon-128.png");
});

it("rejects manifest oauth2 because Nyrima uses BYOK OAuth", () => {
  expect(validateManifest({ ...manifest, oauth2: {} })).toContain("manifest.oauth2 must stay absent");
});
```

- [ ] **Step 3: Write failing docs and package tests**

```js
it("reports missing local markdown links", () => {
  expect(checkMarkdownLinks([readmePath], root)).toEqual([
    expect.objectContaining({ target: "./missing.md" }),
  ]);
});

it("packages dist files into a versioned zip", () => {
  const artifact = packageExtension({ root, distDir, outDir, version: "0.1.0" });
  expect(artifact.fileName).toBe("nyrima-0.1.0.zip");
  expect(new AdmZip(artifact.path).getEntries().map((entry) => entry.entryName))
    .toContain("manifest.json");
});
```

- [ ] **Step 4: Run the tests to verify RED**

Run: `npx vitest run scripts/lib/extension-toolkit.test.mjs scripts/lib/docs-toolkit.test.mjs scripts/lib/package-toolkit.test.mjs`

Expected: FAIL because `extension-toolkit.mjs`, `docs-toolkit.mjs`, and `package-toolkit.mjs` do not exist yet.

### Task 2: Implement reusable script behavior

**Files:**
- Create: `scripts/lib/extension-toolkit.mjs`
- Create: `scripts/lib/docs-toolkit.mjs`
- Create: `scripts/lib/package-toolkit.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add the ZIP dependency**

Run: `npm install -D adm-zip`

Expected: `adm-zip` is recorded under `devDependencies` and locked.

- [ ] **Step 2: Implement manifest and output checks**

```js
export function validateManifest(manifest) {
  const problems = [];
  if (manifest.name !== "Nyrima") problems.push("manifest.name must be Nyrima");
  if (manifest.oauth2) problems.push("manifest.oauth2 must stay absent");
  for (const permission of REQUIRED_PERMISSIONS) {
    if (!manifest.permissions?.includes(permission)) {
      problems.push(`missing permission ${permission}`);
    }
  }
  return problems;
}
```

- [ ] **Step 3: Implement Markdown local-link checks**

```js
export function checkMarkdownLinks(markdownPaths, root) {
  return markdownPaths.flatMap((markdownPath) =>
    extractMarkdownLinks(readFileSync(markdownPath, "utf8"))
      .filter((link) => isLocalFileLink(link.target))
      .filter((link) => !existsSync(resolveLink(markdownPath, link.target, root)))
      .map((link) => ({ file: markdownPath, target: link.target })),
  );
}
```

- [ ] **Step 4: Implement ZIP packaging**

```js
export function packageExtension({ root, distDir, outDir, version }) {
  const zip = new AdmZip();
  for (const file of walkFiles(distDir)) {
    zip.addLocalFile(file, dirname(relative(distDir, file)));
  }
  const path = join(outDir, `nyrima-${version}.zip`);
  zip.writeZip(path);
  return describeArtifact(root, path);
}
```

- [ ] **Step 5: Run the script toolkit tests to verify GREEN**

Run: `npx vitest run scripts/lib/extension-toolkit.test.mjs scripts/lib/docs-toolkit.test.mjs scripts/lib/package-toolkit.test.mjs`

Expected: PASS.

### Task 3: Add CLI entry points and npm commands

**Files:**
- Create: `scripts/inspect-manifest.mjs`
- Create: `scripts/verify-extension.mjs`
- Create: `scripts/check-docs.mjs`
- Create: `scripts/package-extension.mjs`
- Modify: `scripts/zip.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add generated-manifest CLIs**

```js
const manifest = readDistManifest(root);
const problems = validateDistExtension(root, manifest);
if (problems.length) fail("verify:extension", problems);
console.log(formatManifestSummary(summarizeManifest(manifest)));
```

- [ ] **Step 2: Add docs and package CLIs**

```js
const problems = checkMarkdownLinks(findMarkdownDocs(root), root);
if (problems.length) fail("docs:check", formatMarkdownProblems(root, problems));
console.log(`[docs:check] Checked ${markdownPaths.length} Markdown files.`);
```

- [ ] **Step 3: Keep the old ZIP entry point as a real ZIP compatibility path**

```js
import "./package-extension.mjs";
```

- [ ] **Step 4: Wire the command map**

```json
{
  "typecheck": "tsc --noEmit",
  "lint": "npm run typecheck",
  "docs:check": "node scripts/check-docs.mjs",
  "verify:extension": "node scripts/verify-extension.mjs",
  "inspect:manifest": "node scripts/inspect-manifest.mjs",
  "probe:mkv": "node scripts/probe-mkv.mjs",
  "check": "npm run typecheck && npm test && npm run docs:check",
  "release:check": "npm run build && npm test && npm run docs:check && npm run verify:extension",
  "package:dist": "node scripts/package-extension.mjs",
  "package": "npm run build && npm run verify:extension && npm run package:dist",
  "zip": "node scripts/zip.mjs"
}
```

- [ ] **Step 5: Run CLI checks**

Run: `npm run build`, `npm run inspect:manifest`, `npm run verify:extension`, `npm run docs:check`, `npm run package:dist`

Expected: manifest summary prints, extension and docs checks pass, and `dist-zip/nyrima-<version>.zip` exists.

### Task 4: Document the toolkit

**Files:**
- Modify: `README.md`
- Modify: `.claude/workflow.md`
- Modify: `PHASES.md`

- [ ] **Step 1: Update the README command map**

```md
| Command | Purpose |
| --- | --- |
| `npm run check` | Type-check, test, and check Markdown links. |
| `npm run release:check` | Build and verify the generated Chrome extension. |
| `npm run package` | Build and write the Chrome upload ZIP. |
| `npm run probe:mkv -- "<file.mkv>"` | Inspect MKV tracks and Nyrima audio-switch diagnostics. |
```

- [ ] **Step 2: Update contributor workflow guidance**

```md
### Release checks

Use `npm run release:check` before packaging and `npm run package` to build
the real upload ZIP under `dist-zip/`.
```

- [ ] **Step 3: Close the packaging backlog entry**

```md
- [x] **F.2** Replace the tarball fallback with a real Chrome upload ZIP
  - `npm run package` and `npm run zip` write a versioned ZIP from `dist/`.
```

### Task 5: Verify the pass

**Files:**
- Verify all changed paths.

- [ ] **Step 1: Run the broad release verification**

Run: `npm run release:check`

Expected: Build, tests, docs link check, and generated extension verification pass.

- [ ] **Step 2: Build the upload artifact**

Run: `npm run package`

Expected: A versioned ZIP path, byte size, and SHA-256 hash print for the upload artifact.

- [ ] **Step 3: Check the diff**

Run: `git diff --check`

Expected: Exit 0. Existing line-ending warnings may still print for files already using CRLF.
