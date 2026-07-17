// Builds board.html — the Nyrima logo concept board — inlining the concept
// SVGs and the brand fonts (Audiowide / Chakra Petch / Geist Sans) as data
// URIs so the page is fully self-contained (Artifact CSP blocks CDNs).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

const font = (rel) =>
  `data:font/woff2;base64,${readFileSync(resolve(root, "node_modules", rel)).toString("base64")}`;

const AUDIOWIDE = font("@fontsource/audiowide/files/audiowide-latin-400-normal.woff2");
const CHAKRA = font("@fontsource/chakra-petch/files/chakra-petch-latin-600-normal.woff2");
const GEIST = font("@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff2");

const svg1 = readFileSync(resolve(here, "concept1-neon-cat.svg"), "utf8");
const svg2 = readFileSync(resolve(here, "concept2-arcade.svg"), "utf8");

// Flat single-color variants (same geometry, no gradient/glow) — proves the
// mark works as a one-color stamp (OG image, engraving, print).
const FLAT1 = (color) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <path fill="${color}" d="M22 76 L22 18 L24.5 5 L31 16 L36 20 L60 52 L60 20 L65 16 L71.5 5 L74 18 L74 76 L60 76 L36 44 L36 76 Z"/>
  <path d="M28 70 C 28 82, 13 87, 10.5 77 C 9.5 72.5 12.5 69.5 16 70.5"
        fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>
</svg>`;

const FLAT2 = (color) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <path fill="${color}" fill-rule="evenodd"
        d="M22 76 V20 H36 L60 52 V20 H74 V76 H60 L36 44 V76 Z M61.5 55 L72 62 L61.5 69 Z"/>
</svg>`;

const html = readFileSync(resolve(here, "board-template.html"), "utf8")
  .replaceAll("%AUDIOWIDE%", AUDIOWIDE)
  .replaceAll("%CHAKRA%", CHAKRA)
  .replaceAll("%GEIST%", GEIST)
  .replaceAll("%SVG1%", svg1)
  .replaceAll("%SVG2%", svg2)
  .replaceAll("%FLAT1_LIGHT%", FLAT1("#f8f7fc"))
  .replaceAll("%FLAT1_INK%", FLAT1("#0b0d1a"))
  .replaceAll("%FLAT2_LIGHT%", FLAT2("#f8f7fc"))
  .replaceAll("%FLAT2_INK%", FLAT2("#0b0d1a"));

writeFileSync(resolve(here, "board.html"), html);
console.log("wrote board.html", (html.length / 1024).toFixed(0) + "KB");
