// Nyrima icon pipeline — regenerates every raster brand asset from the
// vector masters in brand/final/. Run from the repo root:
//   node brand/generate-icons.mjs
//
// Outputs (all into public/):
//   icons/app-icon.png        512×512 tile (NyrimaMark + favicon master)
//   icons/favicon-32.png      32×32
//   icons/favicon-16.png      16×16
//   icons/apple-touch-icon.png 180×180 (flattened, no alpha)
//   favicon.ico               16+32+48 multi-size
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pub = resolve(root, "public");

const tileSvg = readFileSync(resolve(here, "final/nyrima-tile.svg"));

const px = async (size) =>
  sharp(tileSvg, { density: (72 * size) / 512 })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();

const write = (rel, buf) => {
  writeFileSync(resolve(pub, rel), buf);
  console.log(`${rel}  ${(buf.length / 1024).toFixed(1)}KB`);
};

write("icons/app-icon.png", await px(512));
write("icons/favicon-32.png", await px(32));
write("icons/favicon-16.png", await px(16));

// iOS ignores alpha — flatten onto the ink base.
write(
  "icons/apple-touch-icon.png",
  await sharp(await px(180)).flatten({ background: "#070812" }).png().toBuffer(),
);

write("favicon.ico", await pngToIco([await px(16), await px(32), await px(48)]));
