# Legacy — Chrome Extension shell (retired)

Nyrima started as a Chrome MV3 extension. As of the web-app migration it is a
**normal web application**, and the extension-only pieces below were retired
from the build and preserved here for reference.

## What's here

| Path | Was | Web replacement |
| --- | --- | --- |
| `manifest.config.ts` | `@crxjs/vite-plugin` manifest | — (no manifest on the web) |
| `background/service-worker.ts` | OAuth broker, context menus, DNR, alarms, deep-links | `src/platform/drive-auth-web.ts` + `src/platform/runtime-messages.ts` |
| `content/drive-inject.tsx` (+ `drive-fab-markup.ts`) | "Open with Nyrima" overlay injected into drive.google.com | — (the web app is opened directly) |
| `popup/` | Toolbar popup | — (replaced by the public landing + login) |

## Why it's kept, not deleted

These files still document how Drive OAuth, token refresh (`chrome.identity` +
`launchWebAuthFlow`), and the `Authorization: Bearer` DNR injection for ranged
`<video>` streams worked. The web Drive-auth adapter is a skeleton; the SW here
is the reference for hardening it (PKCE, silent refresh, login hints).

## Not part of the build

`legacy/` is excluded from `tsconfig`, `vitest`, and the Vite build. Nothing in
`src/` imports from here. The relative `import "../package.json"` in
`manifest.config.ts` no longer resolves from this location — that's expected; it
isn't compiled.

To resurrect an extension target later, restore these under `src/`, re-add
`@crxjs/vite-plugin`, and gate it behind a separate Vite mode.
