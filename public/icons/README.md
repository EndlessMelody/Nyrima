# Icons

`app-icon.png` (512×512), `favicon-16/32.png`, `apple-touch-icon.png`, and
`/favicon.ico` are all generated from the vector masters in `brand/final/`
(`nyrima-tile.svg` — the mark on the ink tile). Never edit these PNGs by
hand; regenerate them with:

```
node brand/generate-icons.mjs
```

`NyrimaMark` renders `app-icon.png`; the favicon links live in `index.html`.
The OG/social card (`/og-image.png`) is built from `brand/concepts/og.html`
(see `brand/concepts/build-og.mjs`) and screenshotted at 1200×630.

`extension-icon*.png` are the legacy Chrome-extension icons (old logo),
kept only because `legacy/extension/manifest.config.ts` still references
them. `npm run icons` (scripts/make-icons.mjs) regenerates the sized copies
from `extension-icon.png`.
