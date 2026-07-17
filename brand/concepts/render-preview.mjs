// Quick raster preview of the concept SVGs on the brand ink tile,
// at large + favicon-16 sizes, side by side. Iteration tool only.
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const INK = { r: 7, g: 8, b: 18, alpha: 1 };

async function tile(svgPath, px) {
  const svg = readFileSync(resolve(here, svgPath));
  const mark = await sharp(svg, { density: 300 })
    .resize(px, px)
    .png()
    .toBuffer();
  return sharp({
    create: { width: px + 32, height: px + 32, channels: 4, background: INK },
  })
    .composite([{ input: mark, left: 16, top: 16 }])
    .png()
    .toBuffer();
}

async function upscaledFavicon(svgPath) {
  const svg = readFileSync(resolve(here, svgPath));
  // Render at true 16px, then nearest-neighbor upscale so we see what the
  // favicon actually resolves to.
  const tiny = await sharp(svg).resize(16, 16).png().toBuffer();
  const big = await sharp(tiny)
    .resize(192, 192, { kernel: "nearest" })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 224, height: 224, channels: 4, background: INK },
  })
    .composite([{ input: big, left: 16, top: 16 }])
    .png()
    .toBuffer();
}

const names = process.argv.slice(2);
const rows = [];
for (const name of names) {
  const large = await tile(name, 224);
  const fav = await upscaledFavicon(name);
  rows.push({ large, fav });
}

const CELL = 256;
const canvas = sharp({
  create: {
    width: CELL * 2,
    height: CELL * rows.length,
    channels: 4,
    background: { r: 24, g: 26, b: 34, alpha: 1 },
  },
});
const comps = [];
rows.forEach((row, i) => {
  comps.push({ input: row.large, left: 8, top: i * CELL + 8 });
  comps.push({ input: row.fav, left: CELL + 8, top: i * CELL + 8 });
});
await canvas.composite(comps).png().toFile(resolve(here, "preview.png"));
console.log("wrote preview.png");
