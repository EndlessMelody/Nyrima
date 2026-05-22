import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const APP_PAGE = "src/app/index.html";
const REQUIRED_PERMISSIONS = [
  "identity",
  "storage",
  "contextMenus",
  "tabs",
  "declarativeNetRequestWithHostAccess",
  "alarms",
];
const REQUIRED_HOSTS = [
  "https://drive.google.com/*",
  "https://www.googleapis.com/*",
  "https://content.googleapis.com/*",
  "https://raw.githubusercontent.com/*",
];

function compactStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

function iconPaths(icons) {
  return icons && typeof icons === "object" ? Object.values(icons) : [];
}

function contentScriptPaths(manifest) {
  return (manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []);
}

function outputPathsFromManifest(manifest) {
  return compactStrings([
    "manifest.json",
    APP_PAGE,
    manifest.action?.default_popup,
    manifest.background?.service_worker,
    ...contentScriptPaths(manifest),
    ...iconPaths(manifest.icons),
    ...iconPaths(manifest.action?.default_icon),
  ]);
}

export function readDistManifest(root) {
  const path = join(root, "dist", "manifest.json");

  if (!existsSync(path)) {
    throw new Error("dist/manifest.json is missing. Run `npm run build` first.");
  }

  return JSON.parse(readFileSync(path, "utf8"));
}

export function summarizeManifest(manifest) {
  return {
    name: manifest.name ?? "<missing>",
    version: manifest.version ?? "<missing>",
    popup: manifest.action?.default_popup ?? "<missing>",
    appPage: APP_PAGE,
    background: manifest.background?.service_worker ?? "<missing>",
    contentScripts: compactStrings(contentScriptPaths(manifest)),
    permissions: compactStrings(manifest.permissions ?? []),
    hosts: compactStrings(manifest.host_permissions ?? []),
    icons: compactStrings([
      ...iconPaths(manifest.icons),
      ...iconPaths(manifest.action?.default_icon),
    ]),
  };
}

export function formatManifestSummary(summary) {
  return [
    `Name:        ${summary.name}`,
    `Version:     ${summary.version}`,
    `App page:    ${summary.appPage}`,
    `Popup:       ${summary.popup}`,
    `Background:  ${summary.background}`,
    `Content JS:  ${summary.contentScripts.join(", ") || "<none>"}`,
    `Permissions: ${summary.permissions.join(", ") || "<none>"}`,
    `Hosts:       ${summary.hosts.join(", ") || "<none>"}`,
    `Icons:       ${summary.icons.join(", ") || "<none>"}`,
  ].join("\n");
}

export function validateManifest(manifest) {
  const problems = [];
  const summary = summarizeManifest(manifest);

  if (manifest.manifest_version !== 3) {
    problems.push("manifest_version must be 3");
  }
  if (manifest.name !== "Nyrima") {
    problems.push("manifest.name must be Nyrima");
  }
  if (!manifest.version) {
    problems.push("manifest.version is missing");
  }
  if (Object.hasOwn(manifest, "oauth2")) {
    problems.push("manifest.oauth2 must stay absent for BYOK OAuth");
  }
  if (!manifest.action?.default_popup) {
    problems.push("action.default_popup is missing");
  }
  if (!manifest.background?.service_worker) {
    problems.push("background.service_worker is missing");
  }
  if (!summary.contentScripts.length) {
    problems.push("content script output is missing");
  }

  for (const permission of REQUIRED_PERMISSIONS) {
    if (!summary.permissions.includes(permission)) {
      problems.push(`missing permission ${permission}`);
    }
  }
  for (const host of REQUIRED_HOSTS) {
    if (!summary.hosts.includes(host)) {
      problems.push(`missing host permission ${host}`);
    }
  }

  return problems;
}

export function getExtensionOutputProblems(distDir, manifest) {
  return outputPathsFromManifest(manifest)
    .filter((path) => !existsSync(join(distDir, path)))
    .map((path) => `missing ${path}`);
}

export function validateDistExtension(root, manifest = readDistManifest(root)) {
  return [
    ...validateManifest(manifest),
    ...getExtensionOutputProblems(join(root, "dist"), manifest),
  ];
}
