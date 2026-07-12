/**
 * Resolve a bundled asset path the way the extension's `chrome.runtime.getURL`
 * used to. In the extension, assets lived at `chrome-extension://<id>/icons/…`;
 * on the web they're served from the Vite `public/` root at `/icons/…`.
 *
 * Kept tiny and dependency-free so it can back the `chrome.runtime.getURL`
 * shim without pulling in the rest of the platform layer.
 */
export function assetUrl(path: string): string {
  const clean = String(path).replace(/^\/+/, "");
  return `/${clean}`;
}
