import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

/**
 * Injects a Content-Security-Policy <meta> tag into the production
 * index.html. Skipped under `vite dev` — a static CSP meta tag blocks
 * Vite's HMR websocket and eval-based dev module updates.
 */
function cspPlugin(): Plugin {
  const csp = [
    "default-src 'self'",
    // JASSUB (libass-wasm) instantiates its module via WebAssembly from the
    // main thread before handing off to its worker.
    "script-src 'self' 'wasm-unsafe-eval'",
    // Once UI components and inline `style={{...}}` props rely on inline
    // styles; the Google Fonts stylesheet is a <link> in index.html.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // Drive thumbnails/avatars are served from *.googleusercontent.com;
    // local posters and Drive downloads use blob:/data:.
    "img-src 'self' data: blob: https://*.googleusercontent.com https://drive.google.com",
    // <video>/<audio> always play from blob: object URLs (Drive downloads,
    // MSE MediaSource, local File handles) — never a remote URL directly.
    "media-src 'self' blob:",
    // Drive REST API + Supabase (social: friends/folder comments only).
    "connect-src 'self' https://www.googleapis.com https://*.supabase.co",
    // JASSUB loads its worker as a blob: URL wrapping the bundled script.
    "worker-src 'self' blob:",
    // Landing page YouTube embed (DownloadPage).
    "frame-src https://www.youtube.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  return {
    name: "nyrima-csp",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (ctx.server) return html;
        return html.replace(
          "<head>",
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        );
      },
    },
  };
}

// Nyrima is a normal web app. The former Chrome-extension build
// (@crxjs/vite-plugin + src/manifest.config.ts) is retired — that code now
// lives under legacy/extension and is not part of any build. See
// src/platform/* for the web shim that replaces the extension runtime APIs.
export default defineConfig({
  plugins: [react(), cspPlugin()],
  resolve: {
    alias: [
      // @once-ui-system/core ships with a broken nested dist/package.json that
      // confuses Vite's package-entry resolver, AND some of its internal files
      // self-import via the bare "@once-ui-system/core" specifier. Pin the
      // bare specifier directly to the built ESM entry; subpaths
      // (/components, /css/*, etc.) keep going through normal exports.
      {
        find: /^@once-ui-system\/core$/,
        replacement: fileURLToPath(
          new URL(
            "./node_modules/@once-ui-system/core/dist/components/index.js",
            import.meta.url,
          ),
        ),
      },
      // Once UI lists these as OPTIONAL peer deps backing features we don't ship
      // (CodeBlock → prismjs, charts → recharts, MediaUpload → compressorjs /
      // sharp). The stubs expose the named exports each impl file expects.
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
      // its components import next/link, next/image, next/navigation,
      // next/script, next/server. In a Vite app there is no Next runtime, so we
      // degrade them to native HTML elements / no-op hooks.
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
  // Without this, Vite's dependency scanner crawls every index.html under the
  // project root — including legacy/extension/popup/index.html, which is
  // frozen extension code excluded from all builds and references constants
  // (e.g. APP_PAGE) that no longer exist. Pin the scan to the real app entry.
  optimizeDeps: {
    entries: ["index.html"],
  },
  build: {
    target: "esnext",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Heavy, isolated landing-page vendors — split so they don't bloat
          // the app's cold-start bundle.
          if (id.includes("node_modules/three")) return "three-vendor";
          if (id.includes("node_modules/@once-ui-system/core"))
            return "once-ui-vendor";
          if (id.includes("node_modules/lucide-react")) return "icons-vendor";
          return undefined;
        },
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
  // The JASSUB worker (Emscripten output) is picked up by Vite's worker
  // detection. Force ES output so the worker emits as a module-format chunk
  // alongside the rest of the bundle.
  worker: {
    format: "es",
  },
});
