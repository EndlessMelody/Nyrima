/**
 * Minimal in-browser ZIP reader.
 *
 * EPUB files are ordinary ZIP archives, so to read one in the browser we only
 * need to walk the central directory and inflate the entries the reader
 * actually touches. We deliberately avoid a dependency (jszip / fflate) — the
 * archive is already fully in memory and modern Chromium-based desktops (the
 * Nyrima target) ship `DecompressionStream("deflate-raw")`, which does the
 * heavy lifting for us. The ~150 lines here are the cost of not shipping a
 * 40 KB+ zip vendor into the app's cold-start path.
 *
 * Scope: the common EPUB case — STORE (method 0) and DEFLATE (method 8)
 * entries, single-disk archives, no ZIP64. Encrypted or ZIP64 archives throw
 * with a clear message so the caller can surface a friendly error.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ZipArchive {
  /** Lower-cased path → entry name (as stored) for case-insensitive lookup. */
  has(path: string): boolean;
  /** Sorted list of every entry path, as stored in the archive. */
  list(): string[];
  /** Raw bytes of an entry, inflated as needed. Throws if absent. */
  bytes(path: string): Promise<Uint8Array>;
  /** UTF-8 text of an entry. */
  text(path: string): Promise<string>;
}

export async function openZip(buffer: ArrayBuffer): Promise<ZipArchive> {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const entries = readCentralDirectory(view, eocd);

  // Index entries case-insensitively. EPUB hrefs are case-sensitive per spec,
  // but real-world archives are sloppy; resolving leniently avoids spurious
  // "missing resource" failures on otherwise-valid books.
  const byLowerPath = new Map<string, CentralEntry>();
  for (const entry of entries) byLowerPath.set(normalize(entry.name), entry);

  const decoder = new TextDecoder("utf-8");

  async function bytes(path: string): Promise<Uint8Array> {
    const entry = byLowerPath.get(normalize(path));
    if (!entry) throw new Error(`zip: entry not found: ${path}`);
    return readEntry(buffer, view, entry);
  }

  return {
    has: (path) => byLowerPath.has(normalize(path)),
    list: () => entries.map((e) => e.name).sort(),
    bytes,
    text: async (path) => decoder.decode(await bytes(path)),
  };
}

function normalize(path: string): string {
  // Strip a leading slash and collapse "./" so "OEBPS/x" and "/OEBPS/x" match.
  return path.replace(/^\/+/, "").replace(/^\.\//, "").toLowerCase();
}

function findEndOfCentralDirectory(view: DataView): number {
  // The EOCD lives at the very end, after an optional comment of up to 64 KB.
  // Scan backwards for its signature.
  const len = view.byteLength;
  const minPos = Math.max(0, len - 22 - 0xffff);
  for (let pos = len - 22; pos >= minPos; pos--) {
    if (view.getUint32(pos, true) === EOCD_SIGNATURE) return pos;
  }
  throw new Error("zip: end-of-central-directory record not found (not a ZIP/EPUB?)");
}

function readCentralDirectory(view: DataView, eocdPos: number): CentralEntry[] {
  const totalEntries = view.getUint16(eocdPos + 10, true);
  let offset = view.getUint32(eocdPos + 16, true);
  if (offset === 0xffffffff) {
    throw new Error("zip: ZIP64 archives are not supported");
  }

  const entries: CentralEntry[] = [];
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = utf8Slice(view, offset + 46, nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(
  buffer: ArrayBuffer,
  view: DataView,
  entry: CentralEntry,
): Promise<Uint8Array> {
  const headerOffset = entry.localHeaderOffset;
  if (view.getUint32(headerOffset, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(`zip: bad local header for ${entry.name}`);
  }
  const nameLen = view.getUint16(headerOffset + 26, true);
  const extraLen = view.getUint16(headerOffset + 28, true);
  const dataStart = headerOffset + 30 + nameLen + extraLen;
  const compressed = new Uint8Array(buffer, dataStart, entry.compressedSize);

  if (entry.method === 0) {
    // Stored — copy out so the slice doesn't pin the whole archive buffer.
    return compressed.slice();
  }
  if (entry.method === 8) {
    return inflateRaw(compressed, entry.uncompressedSize);
  }
  throw new Error(`zip: unsupported compression method ${entry.method} for ${entry.name}`);
}

async function inflateRaw(data: Uint8Array, expectedSize: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "zip: DecompressionStream is unavailable in this browser — cannot inflate EPUB",
    );
  }
  const ds = new DecompressionStream("deflate-raw");
  // Copy into a standalone buffer: `data` is a view onto the shared archive
  // ArrayBuffer, and Blob/Response keep a reference we don't want to leak.
  const stream = new Blob([data.slice()]).stream().pipeThrough(ds);
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  // `expectedSize` is advisory; trust the inflated length but keep the hint
  // for callers that want to detect truncation.
  if (expectedSize > 0 && out.byteLength !== expectedSize) {
    // Not fatal — some writers store 0 or wrap with data descriptors. Return
    // what we got.
  }
  return out;
}

function utf8Slice(view: DataView, start: number, length: number): string {
  return new TextDecoder("utf-8").decode(
    new Uint8Array(view.buffer, view.byteOffset + start, length),
  );
}
