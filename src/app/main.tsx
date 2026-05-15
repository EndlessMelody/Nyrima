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
// Comic Neue — FOSS Comic Sans clone for the SubtitleOverlay. Falls back to
// system "Comic Sans MS" when present (Windows/macOS) and to Comic Neue on
// Linux/cross-OS so the fansub-style subtitle look stays consistent. We
// intentionally *don't* import Itim anymore: it was only ever a per-glyph
// fallback for stacked Vietnamese diacritics, but its cursive character bled
// into italic cues and made the look drift away from Comic Sans.
import "@fontsource/comic-neue/700.css";
import "@fontsource/comic-neue/700-italic.css";

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
