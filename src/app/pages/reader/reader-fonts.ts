/**
 * Reading fonts for the Light Novel reader.
 *
 * Imported from the lazy ReaderPage chunk (not main.tsx) so the rest of the
 * app never pays for them. Each @fontsource per-weight stylesheet declares one
 * @font-face per Unicode subset — crucially including `vietnamese` — so the
 * browser fetches only the subset a given book actually needs. We import 400 +
 * 700 (Regular/Bold), which every one of these families ships; the woff2 files
 * download lazily, only once a reader actually selects the face.
 *
 * Times New Roman is a system font and needs no import.
 */

import "@fontsource/merriweather/400.css";
import "@fontsource/merriweather/700.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/700.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/700.css";
import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/700.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/700.css";
