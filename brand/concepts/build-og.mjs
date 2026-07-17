// Builds og.html — a 1200×630 OG/social card staged for a headless-browser
// screenshot (fonts inlined, fixed canvas, no scrollbars).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

const font = (rel) =>
  `data:font/woff2;base64,${readFileSync(resolve(root, "node_modules", rel)).toString("base64")}`;

const AUDIOWIDE = font("@fontsource/audiowide/files/audiowide-latin-400-normal.woff2");
const CHAKRA = font("@fontsource/chakra-petch/files/chakra-petch-latin-600-normal.woff2");
const MARK = readFileSync(resolve(here, "../final/nyrima-mark.svg"), "utf8");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: "Audiowide"; src: url("${AUDIOWIDE}") format("woff2"); }
  @font-face { font-family: "Chakra Petch"; src: url("${CHAKRA}") format("woff2"); font-weight: 600; }
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body {
    background:
      radial-gradient(900px 700px at 0% 0%, rgba(255, 79, 216, 0.14) 0%, transparent 60%),
      radial-gradient(900px 700px at 100% 100%, rgba(91, 200, 232, 0.1) 0%, transparent 60%),
      #070812;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .lockup { display: flex; align-items: center; gap: 56px; }
  .lockup svg { width: 240px; height: 240px; }
  .text { display: flex; flex-direction: column; gap: 18px; }
  .word {
    font-family: "Audiowide";
    font-size: 118px;
    letter-spacing: 0.02em;
    background-image: linear-gradient(92deg, #ff4fd8 10%, #5bc8e8 90%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 0 26px rgba(255, 79, 216, 0.35));
  }
  .tag {
    font-family: "Chakra Petch";
    font-size: 26px;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: rgba(244, 243, 252, 0.6);
  }
</style></head>
<body>
  <div class="lockup">
    ${MARK}
    <div class="text">
      <span class="word">Nyrima</span>
      <span class="tag">Personal Anime Cinema</span>
    </div>
  </div>
</body></html>`;

writeFileSync(resolve(here, "og.html"), html);
console.log("wrote og.html");
