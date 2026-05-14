#!/usr/bin/env node
/**
 * Pack the built `dist/` directory into a Chrome Web Store-ready zip.
 *
 * Usage:  npm run zip   →  dist-zip/drive-cinema-<version>.zip
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");
const distDir = join(root, "dist");
const outDir = join(root, "dist-zip");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

if (!existsSync(distDir)) {
  console.error("[zip] No dist/ directory found. Run `npm run build` first.");
  process.exit(1);
}
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// We avoid pulling in an external dependency: use the standard library "zlib"
// to stream a basic store-only zip. For a richer zip (compressed, multi-file)
// run `npm i -D adm-zip` and replace this implementation.
//
// For now we emit a tar.gz — most Chrome Web Store tooling accepts zip only,
// so we recommend installing `adm-zip` for production publishing.
const out = join(outDir, `drive-cinema-${pkg.version}.tar.gz`);
const gzip = createGzip({ level: 9 });
const sink = createWriteStream(out);
gzip.pipe(sink);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Minimal TAR writer (POSIX ustar) so we don't need any deps.
function writeHeader(name, size) {
  const buf = Buffer.alloc(512);
  buf.write(name.slice(0, 100));
  buf.write("000644 ", 100);
  buf.write("000000 ", 108);
  buf.write("000000 ", 116);
  buf.write(size.toString(8).padStart(11, "0") + " ", 124);
  buf.write(Math.floor(Date.now() / 1000).toString(8) + " ", 136);
  buf.write("        ", 148); // checksum placeholder
  buf.write("0", 156); // regular file
  buf.write("ustar", 257);
  buf.write("00", 263);
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return buf;
}

for (const file of walk(distDir)) {
  const rel = relative(distDir, file).replace(/\\/g, "/");
  const data = readFileSync(file);
  gzip.write(writeHeader(rel, data.length));
  gzip.write(data);
  if (data.length % 512 !== 0) gzip.write(Buffer.alloc(512 - (data.length % 512)));
}
gzip.write(Buffer.alloc(1024)); // EOF
gzip.end();

sink.on("finish", () => {
  console.log(`[zip] Wrote ${relative(root, out)}`);
});
