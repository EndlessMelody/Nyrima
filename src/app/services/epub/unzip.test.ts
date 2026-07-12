/**
 * Tests for the minimal in-browser ZIP reader.
 *
 * The reader is the most failure-prone piece of the EPUB engine — it walks raw
 * binary offsets — so we build real ZIP archives by hand (STORE + DEFLATE
 * entries) and assert the central-directory walk, case-insensitive lookup, and
 * the `deflate-raw` inflate path all behave. We compress with the web
 * `CompressionStream` (available in modern browsers and Node 18+), the mirror
 * of the `DecompressionStream` the reader itself uses — so no node-only deps.
 */

import { describe, expect, it } from "vitest";
import { openZip } from "./unzip";

interface FileSpec {
  name: string;
  content: string;
  /** 0 = stored, 8 = deflate. */
  method: 0 | 8;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Assemble a spec-compliant single-disk ZIP (no ZIP64, no data descriptors). */
async function buildZip(files: FileSpec[]): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const raw = enc.encode(file.content);
    const data = file.method === 8 ? await deflateRaw(raw) : raw;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, file.method, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, raw.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra len
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(10, file.method, true);
    cv.setUint32(20, data.length, true); // compressed size
    cv.setUint32(24, raw.length, true); // uncompressed size
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const centralBuf = concat(centrals);
  const localBuf = concat(locals);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralBuf.length, true);
  ev.setUint32(16, localBuf.length, true); // CD offset = after all locals

  const all = concat([localBuf, centralBuf, eocd]);
  return all.buffer.slice(0);
}

describe("openZip", () => {
  it("lists entries and reads a stored (uncompressed) entry", async () => {
    const zip = await openZip(
      await buildZip([{ name: "mimetype", content: "application/epub+zip", method: 0 }]),
    );
    expect(zip.list()).toEqual(["mimetype"]);
    expect(zip.has("mimetype")).toBe(true);
    expect(await zip.text("mimetype")).toBe("application/epub+zip");
  });

  it("inflates a deflated entry via DecompressionStream", async () => {
    const body = "<html><body><p>Hello, light novel.</p></body></html>".repeat(40);
    const zip = await openZip(
      await buildZip([{ name: "OEBPS/ch1.xhtml", content: body, method: 8 }]),
    );
    expect(await zip.text("OEBPS/ch1.xhtml")).toBe(body);
  });

  it("resolves lookups case-insensitively and exposes every entry", async () => {
    const zip = await openZip(
      await buildZip([
        { name: "mimetype", content: "application/epub+zip", method: 0 },
        { name: "META-INF/container.xml", content: "<container/>", method: 8 },
        { name: "OEBPS/content.opf", content: "<package/>", method: 0 },
      ]),
    );
    expect(zip.list().length).toBe(3);
    expect(zip.has("oebps/content.opf")).toBe(true); // lower-case lookup
    expect(await zip.text("META-INF/container.xml")).toBe("<container/>");
    expect(zip.has("/OEBPS/content.opf")).toBe(true); // leading slash tolerated
  });

  it("throws a clear error on non-ZIP input", async () => {
    const bytes = new TextEncoder().encode("not a zip");
    await expect(
      openZip(bytes.buffer.slice(0, bytes.byteLength)),
    ).rejects.toThrow(/end-of-central-directory/);
  });
});
