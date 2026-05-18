import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { AppProviders } from "./providers/AppProviders";
import { App } from "./App";

// Typography — Geist for the luxury minimal-tech aesthetic. Geist Sans handles
// display and body, Geist Mono carries technical labels (timestamps, codes).
// Zen Kaku Gothic is retained as the dedicated Japanese-glyph fallback so kana
// accents in headings still render with proper kerning.
import "@fontsource/geist-sans/300.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/500.css";
// M PLUS Rounded 1c 800 — chunky rounded Japanese sans, used by the topbar
// Nyrima wordmark. Heavy weight gives the animated brand-gradient + neon
// halo enough surface area to flow over without losing legibility at 15-17px.
import "@fontsource/m-plus-rounded-1c/800.css";
// Comic Neue — FOSS Comic Sans clone for the SubtitleOverlay. Falls back to
// system "Comic Sans MS" when present (Windows/macOS) and to Comic Neue on
// Linux/cross-OS so the fansub-style subtitle look stays consistent.
import "@fontsource/comic-neue/700.css";
import "@fontsource/comic-neue/700-italic.css";
// Itim — Vietnamese-subset ONLY. Comic Neue and Comic Sans MS have no
// Vietnamese glyph coverage (no `ế ữ ợ ầ ạ ẩ` etc.), so Vietnamese cues used
// to fall back to the OS default and lose the brushy look. Importing
// vietnamese-400 declares a unicode-range-scoped @font-face that the browser
// only consults for Vietnamese code points, so Italic-bleed into Latin
// (the original reason this was removed) can't happen.
import "@fontsource/itim/vietnamese-400.css";

import "./styles/global.scss";

const root = document.getElementById("root");
if (!root) throw new Error("Root container #root not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppProviders>
      <HashRouter>
        <App />
      </HashRouter>
    </AppProviders>
  </React.StrictMode>,
);
