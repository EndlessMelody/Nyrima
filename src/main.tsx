// Install the web platform shim FIRST — before any store/service module loads —
// so that `chrome.storage`, `chrome.runtime.getURL`, and `chrome.runtime
// .sendMessage` calls throughout the app resolve to web-backed implementations
// instead of crashing on `chrome is not defined`.
import "./platform/chrome-shim";

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppProviders } from "./app/providers/AppProviders";
import { AuthProvider } from "./auth/AuthProvider";
import { App } from "./App";

// Typography — Chakra Petch carries display headlines (the squared, techy
// "neon arcade" voice of the design language); Audiowide is the "Nyrima"
// wordmark lockup only; Geist Sans is body/UI text, Geist Mono is demoted
// to data-only labels (timecodes, codecs, file sizes); Zen Kaku covers kana
// accents; M PLUS Rounded stays at 400 for the landing VN "rounded"
// dialogue preset; Itim is a subtitle fallback (Vietnamese-only subset).
// Comic Neue is also a subtitle fallback but is only needed by the player,
// so it's deferred to `SubtitleOverlay.tsx` instead of loading on every page.
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource/audiowide/400.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/500.css";
import "@fontsource/zen-kaku-gothic-new/700.css";
import "@fontsource/zen-kaku-gothic-new/900.css";
import "@fontsource/m-plus-rounded-1c/400.css";
import "@fontsource/itim/vietnamese-400.css";

import "./app/styles/global.scss";

const root = document.getElementById("root");
if (!root) throw new Error("Root container #root not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppProviders>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </AppProviders>
  </React.StrictMode>,
);
