import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { fileURLToPath, URL } from "node:url";
import manifest from "./src/manifest.config";

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: [
      // @once-ui-system/core ships with a broken nested dist/package.json that
      // confuses Vite's package-entry resolver, AND some of its internal files
      // self-import via the bare "@once-ui-system/core" specifier. Pin the
      // bare specifier directly to the built ESM entry; subpaths
      // (/components, /css/*, etc.) keep going through normal exports.
      {
        // Point at dist/components/index.js (not dist/index.js) so we never
        // pull in dist/modules/* which depends on charts/prismjs/etc.
        find: /^@once-ui-system\/core$/,
        replacement: fileURLToPath(
          new URL(
            "./node_modules/@once-ui-system/core/dist/components/index.js",
            import.meta.url,
          ),
        ),
      },
      // Once UI lists these as OPTIONAL peer deps that back features we don't
      // ship (CodeBlock → prismjs, charts → recharts, MediaUpload → compressorjs / sharp).
      // The chart modules are lazy-loaded but Rollup still bundles the chunks,
      // so the stubs must expose the named exports each impl file expects.
      {
        find: /^recharts(\/.*)?$/,
        replacement: fileURLToPath(
          new URL("./src/stubs/recharts-stub.tsx", import.meta.url),
        ),
      },
      {
        find: /^prismjs(\/.*)?$/,
        replacement: fileURLToPath(
          new URL("./src/stubs/prismjs-stub.ts", import.meta.url),
        ),
      },
      {
        find: /^compressorjs(\/.*)?$/,
        replacement: fileURLToPath(
          new URL("./src/stubs/empty-module.ts", import.meta.url),
        ),
      },
      {
        find: /^sharp(\/.*)?$/,
        replacement: fileURLToPath(
          new URL("./src/stubs/empty-module.ts", import.meta.url),
        ),
      },
      // Next.js runtime stubs. Once UI is authored for Next.js and several of
      // its components (<Logo>, <Media>, <Schema>, navigation modules) import
      // next/link, next/image, next/navigation, next/script, next/server.
      // In a Vite extension build there is no Next runtime, so we degrade
      // them to native HTML elements / no-op hooks. None of these modules
      // are actually rendered by Drive Cinema; the stubs exist solely to
      // satisfy the barrel re-exports.
      {
        find: /^next\/link$/,
        replacement: fileURLToPath(
          new URL("./src/stubs/next-link-stub.tsx", import.meta.url),
        ),
      },
      {
        find: /^next\/image$/,
        replacement: fileURLToPath(
          new URL("./src/stubs/next-image-stub.tsx", import.meta.url),
        ),
      },
      {
        find: /^next\/navigation$/,
        replacement: fileURLToPath(
          new URL("./src/stubs/next-navigation-stub.ts", import.meta.url),
        ),
      },
      {
        find: /^next\/script$/,
        replacement: fileURLToPath(
          new URL("./src/stubs/next-script-stub.tsx", import.meta.url),
        ),
      },
      {
        find: /^next\/server$/,
        replacement: fileURLToPath(
          new URL("./src/stubs/next-server-stub.ts", import.meta.url),
        ),
      },
      {
        find: "@",
        replacement: fileURLToPath(new URL("./src", import.meta.url)),
      },
      {
        find: "@app",
        replacement: fileURLToPath(new URL("./src/app", import.meta.url)),
      },
      {
        find: "@shared",
        replacement: fileURLToPath(new URL("./src/shared", import.meta.url)),
      },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
  build: {
    target: "esnext",
    sourcemap: true,
    rollupOptions: {
      input: {
        // The extension's main app page lives in web_accessible_resources, not
        // in action.default_popup, so @crxjs/vite-plugin doesn't auto-detect
        // it as an HTML entry. Declare it explicitly so Vite rewrites the
        // <script src="./main.tsx"> to the bundled chunk and emits the file
        // at dist/src/app/index.html (preserving the path the background SW
        // uses via chrome.runtime.getURL(APP_PAGE)).
        appPage: fileURLToPath(
          new URL("./src/app/index.html", import.meta.url),
        ),
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
      },
    },
  },
  // The JASSUB worker (Emscripten output bundled inside `jassub/dist/wasm/`)
  // gets picked up by Vite's worker detection when we import its .js via
  // `?url`. Vite defaults to `iife` for workers, which Rollup rejects under a
  // code-splitting build. Force ES output so the worker can be emitted as a
  // module-format chunk alongside the rest of the extension bundle.
  worker: {
    format: "es",
  },
});
