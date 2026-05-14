#!/usr/bin/env node
/**
 * Generate extension toolbar icon PNGs (16/32/48/128) from the source image
 * at public/icons/Icon.png. Requires `sharp` for proper resizing; falls back
 * to a brand-coloured "N" placeholder when sharp is unavailable.
 *
 * NyrimaMark.tsx loads the unscaled Icon.png at runtime; this script only
 * produces the toolbar/manifest icons Chrome needs at fixed sizes.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const outDir = "public/icons";
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const SIZES = [16, 32, 48, 128];
const SOURCE = join(outDir, "Icon.png");

async function main() {
  // Try sharp first (best quality)
  try {
    const sharp = (await import("sharp")).default;
    const src = readFileSync(SOURCE);
    for (const s of SIZES) {
      const file = join(outDir, `icon-${s}.png`);
      await sharp(src)
        .resize(s, s, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toFile(file);
      console.log(`[icons] wrote ${file} (${s}x${s}) via sharp`);
    }
    return;
  } catch {
    // sharp not installed — fall back to placeholder generation
  }

  // Fallback: generate solid-color placeholders with the Nyrima brand color
  const { deflateSync, crc32 } = await import("node:zlib");

  const BG = [0x7d, 0xb8, 0xd4]; // Nyrima pastel blue
  const FG = [0xff, 0xff, 0xff]; // white

  function makePng(size) {
    const w = size;
    const h = size;
    const pixels = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const off = (y * w + x) * 4;
        pixels[off] = BG[0];
        pixels[off + 1] = BG[1];
        pixels[off + 2] = BG[2];
        pixels[off + 3] = 0xff;
      }
    }
    // Draw "N" letter shape
    const cx = w / 2;
    const r = w * 0.3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = (x - cx) / r;
        const ny = (y - cx) / r;
        // Left vertical bar
        if (nx >= -0.8 && nx <= -0.4 && ny >= -0.8 && ny <= 0.8) {
          const off = (y * w + x) * 4;
          pixels[off] = FG[0]; pixels[off + 1] = FG[1]; pixels[off + 2] = FG[2];
        }
        // Right vertical bar
        if (nx >= 0.4 && nx <= 0.8 && ny >= -0.8 && ny <= 0.8) {
          const off = (y * w + x) * 4;
          pixels[off] = FG[0]; pixels[off + 1] = FG[1]; pixels[off + 2] = FG[2];
        }
        // Diagonal
        const diag = -0.6 + (ny + 0.8) * 1.2 / 1.6;
        if (ny >= -0.8 && ny <= 0.8 && Math.abs(nx - diag) <= 0.25) {
          const off = (y * w + x) * 4;
          pixels[off] = FG[0]; pixels[off + 1] = FG[1]; pixels[off + 2] = FG[2];
        }
      }
    }

    const raw = Buffer.alloc(h * (1 + w * 4));
    for (let y = 0; y < h; y++) {
      raw[y * (1 + w * 4)] = 0;
      pixels.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
    }
    const idat = deflateSync(raw);

    function chunk(type, data) {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      const typeBuf = Buffer.from(type, "ascii");
      const c = crc32(Buffer.concat([typeBuf, data]));
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(c >>> 0, 0);
      return Buffer.concat([len, typeBuf, data, crc]);
    }

    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
      sig,
      chunk("IHDR", ihdr),
      chunk("IDAT", idat),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }

  for (const s of SIZES) {
    const file = join(outDir, `icon-${s}.png`);
    writeFileSync(file, makePng(s));
    console.log(`[icons] wrote ${file} (${s}x${s}) placeholder — install sharp for real icons`);
  }
}

main().catch(console.error);
