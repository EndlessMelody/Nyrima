import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const MARKDOWN_LINK = /!?\[[^\]]*]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const SKIP_DIRS = new Set([".git", "dist", "dist-zip", "node_modules"]);

function toTarget(rawTarget) {
  const target = rawTarget.trim();
  return target.startsWith("<") && target.endsWith(">")
    ? target.slice(1, -1)
    : target;
}

function splitTarget(target) {
  const anchor = target.indexOf("#");
  const query = target.indexOf("?");
  const end = [anchor, query].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  return end === undefined ? target : target.slice(0, end);
}

function isLocalFileLink(target) {
  if (!target || target.startsWith("#") || target.startsWith("//")) {
    return false;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) {
    return false;
  }

  return Boolean(splitTarget(target));
}

function resolveLocalLink(markdownPath, target, root) {
  const pathTarget = decodeURIComponent(splitTarget(target));
  return pathTarget.startsWith("/")
    ? resolve(root, `.${pathTarget}`)
    : resolve(dirname(markdownPath), pathTarget);
}

function* walkMarkdown(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        yield* walkMarkdown(join(dir, entry.name));
      }
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      yield join(dir, entry.name);
    }
  }
}

export function extractMarkdownLinks(markdown) {
  return [...markdown.matchAll(MARKDOWN_LINK)].map((match) => ({
    target: toTarget(match[1]),
  }));
}

export function findMarkdownDocs(root) {
  return ["README.md", "PHASES.md", "docs", ".claude"]
    .map((path) => join(root, path))
    .filter((path) => existsSync(path))
    .flatMap((path) => (statSync(path).isDirectory() ? [...walkMarkdown(path)] : [path]))
    .sort();
}

export function checkMarkdownLinks(markdownPaths, root) {
  return markdownPaths.flatMap((file) =>
    extractMarkdownLinks(readFileSync(file, "utf8"))
      .filter((link) => isLocalFileLink(link.target))
      .map((link) => ({
        file,
        target: link.target,
        resolvedPath: resolveLocalLink(file, link.target, root),
      }))
      .filter((link) => !existsSync(link.resolvedPath)),
  );
}

export function formatMarkdownProblems(root, problems) {
  return problems.map(
    (problem) =>
      `${relative(root, problem.file)} -> ${problem.target} (${relative(root, problem.resolvedPath)})`,
  );
}
