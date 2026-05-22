import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getExtensionOutputProblems,
  summarizeManifest,
  validateManifest,
} from "./extension-toolkit.mjs";

const manifest = {
  manifest_version: 3,
  name: "Nyrima",
  version: "0.1.0",
  action: {
    default_popup: "src/popup/index.html",
    default_icon: {
      16: "icons/extension-icon-16.png",
      128: "icons/extension-icon-128.png",
    },
  },
  background: {
    service_worker: "assets/service-worker.js",
  },
  content_scripts: [
    {
      matches: ["https://drive.google.com/*"],
      js: ["assets/drive-inject.js"],
    },
  ],
  icons: {
    16: "icons/extension-icon-16.png",
    128: "icons/extension-icon-128.png",
  },
  permissions: [
    "identity",
    "storage",
    "contextMenus",
    "tabs",
    "declarativeNetRequestWithHostAccess",
    "alarms",
  ],
  host_permissions: [
    "https://drive.google.com/*",
    "https://www.googleapis.com/*",
    "https://content.googleapis.com/*",
    "https://raw.githubusercontent.com/*",
  ],
};

function makeDist(files) {
  const distDir = mkdtempSync(join(tmpdir(), "nyrima-dist-"));

  for (const file of files) {
    const path = join(distDir, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, file.endsWith(".json") ? "{}" : file);
  }

  return distDir;
}

describe("extension toolkit", () => {
  it("summarizes Nyrima manifest access and entry points", () => {
    expect(summarizeManifest(manifest)).toMatchObject({
      name: "Nyrima",
      version: "0.1.0",
      background: "assets/service-worker.js",
      popup: "src/popup/index.html",
      hosts: [
        "https://drive.google.com/*",
        "https://www.googleapis.com/*",
        "https://content.googleapis.com/*",
        "https://raw.githubusercontent.com/*",
      ],
    });
  });

  it("reports missing generated extension output", () => {
    const distDir = makeDist([
      "manifest.json",
      "src/app/index.html",
      "src/popup/index.html",
      "assets/service-worker.js",
      "assets/drive-inject.js",
      "icons/extension-icon-16.png",
    ]);

    expect(getExtensionOutputProblems(distDir, manifest)).toEqual([
      "missing icons/extension-icon-128.png",
    ]);
  });

  it("rejects manifest oauth2 because Nyrima uses BYOK OAuth", () => {
    expect(validateManifest({ ...manifest, oauth2: {} })).toContain(
      "manifest.oauth2 must stay absent for BYOK OAuth",
    );
  });
});
