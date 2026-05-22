import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import AdmZip from "adm-zip";

function toZipPath(path) {
  return path.replace(/\\/g, "/");
}

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* walkFiles(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

function describeArtifact(root, path, entries) {
  const bytes = readFileSync(path);

  return {
    path,
    relativePath: toZipPath(relative(root, path)),
    fileName: basename(path),
    entries,
    size: statSync(path).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function packageExtension({ root, distDir, outDir, version }) {
  if (!existsSync(distDir)) {
    throw new Error("dist/ is missing. Run `npm run build` first.");
  }

  mkdirSync(outDir, { recursive: true });

  const zip = new AdmZip();
  const files = [...walkFiles(distDir)].sort();
  const entries = files.map((file) => toZipPath(relative(distDir, file)));

  for (const [index, file] of files.entries()) {
    const entry = entries[index];
    const zipDir = dirname(entry) === "." ? "" : dirname(entry);
    zip.addLocalFile(file, zipDir);
  }

  const path = join(outDir, `nyrima-${version}.zip`);
  zip.writeZip(path);

  return describeArtifact(root, path, entries);
}
